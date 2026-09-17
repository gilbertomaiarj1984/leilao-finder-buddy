/**
 * Fase 2 da migração para VPS (docs/economia-fase-2-vps-unico.md): OAuth do
 * Google implementado à mão (authorization code + PKCE), substituindo o
 * Supabase Auth. Sessão via cookie HttpOnly assinado (HMAC) — mesmo padrão de
 * src/lib/leiloesbr-live.server.ts (cookie lp_auth), aqui para a sessão do
 * app em vez do proxy do pregão.
 *
 * Fica FORA do fluxo de server functions (sem Bearer/CSRF), como /api/cron e
 * /api/live: tratado direto em src/server.ts.
 */

const SESSION_COOKIE = "gs_session";
const OAUTH_COOKIE = "gs_oauth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const OAUTH_TTL_MS = 10 * 60 * 1000; // 10 min para completar o login

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}

// ---------------------------------------------------------------- base64url ---
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// -------------------------------------------------------------------- HMAC ----
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signPayload(secret: string, payload: unknown): Promise<string> {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, encoded);
  return `${encoded}.${sig}`;
}

async function verifyPayload<T>(secret: string, token: string): Promise<T | null> {
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = await hmac(secret, encoded);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookieHeader(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${
    secure ? "; Secure" : ""
  }`;
}

// -------------------------------------------------------------- PKCE + state --
function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toBase64Url(arr);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

// ------------------------------------------------------------------ sessão ----
async function mintSessionCookie(email: string): Promise<string> {
  return signPayload(env("SESSION_SECRET"), { email, exp: Date.now() + SESSION_TTL_MS });
}

/** Lê e valida o cookie de sessão da requisição; `null` se ausente/expirado/inválido. */
export async function readSessionEmail(request: Request): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const data = await verifyPayload<{ email?: string; exp?: number }>(env("SESSION_SECRET"), token);
  if (!data?.email || !data.exp || Date.now() > data.exp) return null;
  return data.email;
}

// ------------------------------------------------------------------ Google ----
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// PUBLIC_BASE_URL (Fase 4 da migração para VPS) tem prioridade sobre `url.origin`: atrás do
// Caddy, a conexão do Node com o container é HTTP puro (TLS só na borda), e o Nitro/h3 não
// confia em X-Forwarded-Proto por padrão — `url.origin` vinha como "http://" mesmo com o site
// servido em HTTPS, e o Google recusava o redirect_uri por mismatch de protocolo.
function redirectUri(origin: string): string {
  const base = process.env["PUBLIC_BASE_URL"] || origin;
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

async function startGoogleAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const verifier = randomToken(32);
  const challenge = await pkceChallenge(verifier);
  const state = randomToken(16);

  const authorizeUrl = new URL(GOOGLE_AUTH_URL);
  authorizeUrl.searchParams.set("client_id", env("GOOGLE_CLIENT_ID"));
  authorizeUrl.searchParams.set("redirect_uri", redirectUri(url.origin));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "select_account");

  const oauthToken = await signPayload(env("SESSION_SECRET"), {
    state,
    verifier,
    exp: Date.now() + OAUTH_TTL_MS,
  });

  const headers = new Headers({ location: authorizeUrl.toString() });
  headers.append(
    "set-cookie",
    cookieHeader(
      OAUTH_COOKIE,
      oauthToken,
      Math.floor(OAUTH_TTL_MS / 1000),
      url.protocol === "https:",
    ),
  );
  return new Response(null, { status: 302, headers });
}

function errorRedirect(origin: string, reason: string): Response {
  const to = new URL("/auth", origin);
  to.searchParams.set("error", reason);
  return new Response(null, { status: 302, headers: { location: to.toString() } });
}

async function googleAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthCookie = readCookie(request, OAUTH_COOKIE);
  const clearOauthCookie = cookieHeader(OAUTH_COOKIE, "", 0, url.protocol === "https:");

  if (!code || !state || !oauthCookie) return errorRedirect(url.origin, "missing_code");

  const oauthData = await verifyPayload<{ state?: string; verifier?: string; exp?: number }>(
    env("SESSION_SECRET"),
    oauthCookie,
  );
  if (
    !oauthData?.state ||
    !oauthData.verifier ||
    !oauthData.exp ||
    Date.now() > oauthData.exp ||
    !timingSafeEqual(oauthData.state, state)
  ) {
    return errorRedirect(url.origin, "invalid_state");
  }

  let email: string;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        code,
        code_verifier: oauthData.verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(url.origin),
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) throw new Error("resposta sem access_token");

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`userinfo failed: ${userRes.status}`);
    const userData = (await userRes.json()) as { email?: string; email_verified?: boolean };
    if (!userData.email || userData.email_verified === false) {
      throw new Error("e-mail não verificado pelo Google");
    }
    email = userData.email;
  } catch (error) {
    console.error("[auth] falha no login com Google", error);
    return errorRedirect(url.origin, "google_failed");
  }

  const sessionToken = await mintSessionCookie(email);
  const headers = new Headers({ location: new URL("/", url.origin).toString() });
  headers.append("set-cookie", clearOauthCookie);
  headers.append(
    "set-cookie",
    cookieHeader(
      SESSION_COOKIE,
      sessionToken,
      Math.floor(SESSION_TTL_MS / 1000),
      url.protocol === "https:",
    ),
  );
  return new Response(null, { status: 302, headers });
}

function logout(request: Request): Response {
  const url = new URL(request.url);
  const headers = new Headers({ location: new URL("/auth", url.origin).toString() });
  headers.append("set-cookie", cookieHeader(SESSION_COOKIE, "", 0, url.protocol === "https:"));
  return new Response(null, { status: 302, headers });
}

/**
 * Trata /api/auth/google/start, /api/auth/google/callback e /api/auth/logout.
 * Retorna `null` para outros caminhos (deixa o TanStack seguir).
 */
export async function handleGoogleAuth(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/auth/google/start") return startGoogleAuth(request);
  if (pathname === "/api/auth/google/callback") return googleAuthCallback(request);
  if (pathname === "/api/auth/logout") return logout(request);
  return null;
}
