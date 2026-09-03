/**
 * Proxy reverso AUTENTICADO do pregão ao vivo. O iframe/aba do "Abrir aqui" aponta
 * para o NOSSO domínio (`/api/live/<origem>/<caminho>`); o servidor injeta a sessão
 * logada da casa (mesmas credenciais `LEILOESBR_EMAIL`/`LEILOESBR_SENHA` usadas no
 * scraping) e reescreve as URLs para que assets, polling e o POST do lance continuem
 * passando pelo proxy — assim o pregão abre JÁ LOGADO, sem depender de cookie de
 * terceiro no navegador.
 *
 * Fica FORA do fluxo de server functions (que exige Bearer + CSRF), como o `/api/cron`:
 * é tratado direto no `server.ts`. A proteção é um token HMAC de curta duração emitido
 * pela server function `openLiveAuction` (atrás do login do app) e guardado num cookie
 * httpOnly com Path amarrado à origem da casa.
 */
import { absorbSetCookie, getSessionCookieFor } from "./leiloesbr-auth.server";

const PREFIX = "/api/live/";
const COOKIE_NAME = "lp_auth";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8h — cobre um pregão longo.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function proxySecret(): string | null {
  return (
    process.env["LIVE_PROXY_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["CRON_TOKEN"] ||
    null
  );
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
const encodeOrigin = (origin: string) => toBase64Url(new TextEncoder().encode(origin));
function decodeOrigin(token: string): string | null {
  try {
    return new TextDecoder().decode(fromBase64Url(token));
  } catch {
    return null;
  }
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

/** Emite um token assinado que autoriza o proxy para UMA origem, por TOKEN_TTL_MS. */
export async function mintLiveToken(origin: string): Promise<string> {
  const secret = proxySecret();
  if (!secret) throw new Error("Proxy do pregão ao vivo não configurado no servidor.");
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ o: origin, exp: Date.now() + TOKEN_TTL_MS })),
  );
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyLiveToken(token: string): Promise<string | null> {
  const secret = proxySecret();
  if (!secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      o?: string;
      exp?: number;
    };
    if (!data.o || !data.exp || Date.now() > data.exp) return null;
    return data.o;
  } catch {
    return null;
  }
}

/**
 * Valida uma URL de pregão presencial e devolve o caminho no proxy já com o token
 * de primeira carga (`__lt`). Só aceita https em host público da plataforma.
 */
export async function buildLiveProxyUrl(houseUrl: string): Promise<string> {
  const url = new URL(houseUrl);
  if (url.protocol !== "https:") throw new Error("Só pregões https são suportados.");
  if (!isPublicHost(url.hostname)) throw new Error("Host do pregão não permitido.");
  const token = await mintLiveToken(url.origin);
  const b64 = encodeOrigin(url.origin);
  const search = url.search ? `${url.search}&__lt=${token}` : `?__lt=${token}`;
  return `${PREFIX}${b64}${url.pathname}${search}`;
}

// Evita SSRF para redes internas: exige host com ponto (FQDN) e não-privado.
function isPublicHost(host: string): boolean {
  if (!host || host === "localhost" || !host.includes(".")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

// --------------------------------------------------------------- reescrita ----
function rewriteAbsolute(text: string, origin: string, mount: string): string {
  // URLs absolutas da própria casa → passam pelo proxy (funciona em HTML/CSS/JS).
  let out = text.split(origin).join(mount);
  // Protocolo-relativo (//host/...) da mesma casa.
  const host = new URL(origin).host;
  out = out.split(`//${host}`).join(mount);
  return out;
}

function rewriteRootRelative(html: string, mount: string): string {
  // Atributos com URL absoluta-da-raiz (/x) — não mexe em // (protocolo-relativo).
  return html
    .replace(
      /\b(src|href|action|poster|formaction|data-src|data-href|data-url|data-action)(\s*=\s*)(["'])\/(?!\/)/gi,
      (_m, attr: string, eq: string, q: string) => `${attr}${eq}${q}${mount}/`,
    )
    .replace(/\burl\(\s*(["']?)\/(?!\/)/gi, (_m, q: string) => `url(${q}${mount}/`);
}

function rewriteCss(css: string, origin: string, mount: string): string {
  return rewriteAbsolute(css, origin, mount).replace(
    /\burl\(\s*(["']?)\/(?!\/)/gi,
    (_m, q: string) => `url(${q}${mount}/`,
  );
}

function rewriteHtml(html: string, origin: string, mount: string): string {
  return rewriteRootRelative(rewriteAbsolute(html, origin, mount), mount);
}

// ------------------------------------------------------------ cookie helpers --
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function htmlError(message: string, status: number): Response {
  const body = `<!doctype html><meta charset="utf-8"><title>Pregão ao vivo</title>
<body style="font-family:system-ui;padding:2rem;color:#111;background:#fafafa">
<h1 style="font-size:1.1rem">Não foi possível abrir o pregão logado</h1>
<p style="color:#555;max-width:40ch">${message}</p></body>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Trata `/api/live/<origem>/<caminho>`. Retorna `null` para outros caminhos (deixa o
 * TanStack seguir). Injeta a sessão logada da casa e reescreve a resposta.
 */
export async function handleLiveProxy(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;

  // <b64origem>/<resto...>
  const afterPrefix = url.pathname.slice(PREFIX.length);
  const slash = afterPrefix.indexOf("/");
  const b64 = slash === -1 ? afterPrefix : afterPrefix.slice(0, slash);
  const restPath = slash === -1 ? "/" : afterPrefix.slice(slash);
  const pathOrigin = decodeOrigin(b64);
  if (!pathOrigin) return htmlError("Endereço do pregão inválido.", 400);

  // Autorização: token na querystring (primeira carga) ou no cookie (subrequests).
  const search = new URLSearchParams(url.search);
  const queryToken = search.get("__lt");
  const cookieToken = readCookie(request, COOKIE_NAME);
  const token = queryToken ?? cookieToken;
  if (!token) return htmlError("Sessão do pregão ausente. Abra o pregão pelo app.", 401);

  const tokenOrigin = await verifyLiveToken(token);
  if (!tokenOrigin) return htmlError("Sessão do pregão expirada. Abra o pregão de novo.", 401);
  if (tokenOrigin !== pathOrigin) return htmlError("Sessão do pregão não confere.", 403);

  const mount = `${PREFIX}${b64}`;

  // Monta a URL de destino na casa (sem o parâmetro interno __lt).
  search.delete("__lt");
  const qs = search.toString();
  const targetUrl = `${pathOrigin}${restPath}${qs ? `?${qs}` : ""}`;

  // Referer coerente: se veio de outra página do proxy, mapeia de volta para a casa.
  const rawReferer = request.headers.get("referer");
  let referer = `${pathOrigin}/default.asp`;
  if (rawReferer) {
    try {
      const r = new URL(rawReferer);
      if (r.pathname.startsWith(`${mount}/`)) {
        referer = `${pathOrigin}${r.pathname.slice(mount.length)}${r.search}`;
      }
    } catch {
      /* ignora referer inválido */
    }
  }

  const isPost = request.method === "POST";
  const reqBody = isPost ? await request.arrayBuffer() : undefined;

  async function callHouse(forceLogin: boolean): Promise<Response> {
    const cookie = await getSessionCookieFor(pathOrigin!, forceLogin);
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: request.headers.get("accept") ?? "*/*",
      Cookie: cookie,
      Referer: referer,
    };
    const ct = request.headers.get("content-type");
    if (ct) headers["Content-Type"] = ct;
    const xrw = request.headers.get("x-requested-with");
    if (xrw) headers["X-Requested-With"] = xrw;
    return await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(reqBody ? { body: reqBody } : {}),
      redirect: "manual",
    });
  }

  let houseRes: Response;
  try {
    houseRes = await callHouse(false);
    // Sessão pode ter caído: uma nova tentativa forçando login.
    if (houseRes.status === 401 || houseRes.status === 403) {
      houseRes = await callHouse(true);
    }
  } catch (error) {
    console.error("[live-proxy] falha ao acessar o pregão", error);
    return htmlError("A casa não respondeu. Tente novamente em instantes.", 502);
  }

  // Mantém a sessão viva com os cookies que a casa devolver (não repassa ao navegador).
  absorbSetCookie(targetUrl, houseRes);

  // Redirecionamentos da casa: reescreve o Location para continuar no proxy.
  const location = houseRes.headers.get("location");
  if (location && houseRes.status >= 300 && houseRes.status < 400) {
    let loc = location;
    try {
      const abs = new URL(location, targetUrl);
      if (abs.origin === pathOrigin) loc = `${mount}${abs.pathname}${abs.search}`;
    } catch {
      /* mantém como veio */
    }
    return new Response(null, {
      status: houseRes.status,
      headers: { location: loc, "cache-control": "no-store" },
    });
  }

  const contentType = houseRes.headers.get("content-type") ?? "";
  const outHeaders = new Headers();
  outHeaders.set("content-type", contentType || "application/octet-stream");
  outHeaders.set("cache-control", houseRes.headers.get("cache-control") ?? "no-store");
  // Nunca repassa cabeçalhos que bloqueiam o iframe ou cookies de outro domínio.

  // Primeira carga (token na URL): fixa o cookie de sessão do proxy, com Path amarrado
  // à origem, para as subrequests seguintes serem autorizadas sem o __lt.
  if (queryToken) {
    const secure = url.protocol === "https:" ? "; Secure" : "";
    outHeaders.append(
      "set-cookie",
      `${COOKIE_NAME}=${token}; Path=${mount}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
        TOKEN_TTL_MS / 1000,
      )}${secure}`,
    );
  }

  const isHtml = contentType.includes("text/html");
  const isCss = contentType.includes("text/css");
  if (isHtml || isCss) {
    const text = await houseRes.text();
    const rewritten = isHtml
      ? rewriteHtml(text, pathOrigin, mount)
      : rewriteCss(text, pathOrigin, mount);
    return new Response(rewritten, { status: houseRes.status, headers: outHeaders });
  }

  // Demais tipos (imagens, JS, fontes): repassa os bytes sem alterar.
  const buf = await houseRes.arrayBuffer();
  return new Response(buf, { status: houseRes.status, headers: outHeaders });
}
