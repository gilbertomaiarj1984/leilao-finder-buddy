export const BASE_URL = "https://leiloesbr.com.br";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// Sessão logada por ORIGEM (leiloesbr.com.br e o domínio de cada casa do pregão
// presencial usam a mesma plataforma/login, mas cada domínio tem seu próprio
// ASPSESSIONID). Guardamos um "cookie jar" e um login em andamento por origem.
const jars = new Map<string, string>();
const logins = new Map<string, Promise<string>>();

/** Origem canônica (protocolo + host) de uma URL, sem barra final. */
function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * Mescla os `Set-Cookie` de uma resposta no jar da origem (mantendo os cookies
 * já existentes). Aceita o header múltiplo (`getSetCookie`) e o único.
 */
function mergeCookies(current: string | undefined, response: Response): string {
  const raw =
    (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const single = response.headers.get("set-cookie");
  const all = raw.length ? raw : single ? [single] : [];
  const jar = new Map<string, string>();
  for (const entry of current?.split("; ") ?? []) {
    const [name, ...rest] = entry.split("=");
    if (name) jar.set(name, rest.join("="));
  }
  for (const cookie of all) {
    for (const part of cookie.split(/,(?=[^;=]+=)/)) {
      const [pair] = part.split(";");
      const [name, ...rest] = (pair ?? "").trim().split("=");
      if (name && rest.length) jar.set(name, rest.join("="));
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function performLogin(origin: string): Promise<string> {
  const email = process.env["LEILOESBR_EMAIL"];
  const password = process.env["LEILOESBR_SENHA"];
  if (!email || !password) {
    throw new Error(
      "Credenciais do LeilõesBR não configuradas (LEILOESBR_EMAIL / LEILOESBR_SENHA).",
    );
  }

  const body = new URLSearchParams({
    campoeml: email,
    campopwd: password,
    refererclick: "",
    AuthenticationMethod: "",
  });

  const response = await fetch(`${origin}/portal/assets/modulos/login/asp/login.asp`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${origin}/default.asp`,
      Accept: "*/*",
    },
    body: body.toString(),
    redirect: "manual",
  });

  const text = await response.text();
  let payload: { NUM_ERRO?: number; MENSAGEM_ERRO?: string } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("Resposta inesperada do login do LeilõesBR.");
  }
  if (payload.NUM_ERRO && payload.NUM_ERRO !== 0) {
    throw new Error(payload.MENSAGEM_ERRO ?? "Login no LeilõesBR recusado.");
  }

  const cookie = mergeCookies(jars.get(origin), response);
  if (!cookie.includes("ASPSESSIONID")) {
    throw new Error("Login no LeilõesBR não devolveu sessão.");
  }
  jars.set(origin, cookie);
  return cookie;
}

/** Cookie logado da origem informada (login preguiçoso, compartilhado). */
export async function getSessionCookieFor(origin: string, force = false): Promise<string> {
  if (force) {
    jars.delete(origin);
    logins.delete(origin);
  }
  const existing = jars.get(origin);
  if (existing) return existing;
  let pending = logins.get(origin);
  if (!pending) {
    pending = performLogin(origin).finally(() => {
      logins.delete(origin);
    });
    logins.set(origin, pending);
  }
  return await pending;
}

/** Compat.: sessão logada do domínio principal (leiloesbr.com.br). */
export async function getSessionCookie(force = false): Promise<string> {
  return await getSessionCookieFor(BASE_URL, force);
}

/**
 * Absorve os `Set-Cookie` de uma resposta da casa no jar da origem, para manter a
 * sessão viva ao longo do pregão (o site rotaciona/renova cookies durante os lances).
 */
export function absorbSetCookie(url: string, response: Response): void {
  const origin = originOf(url);
  const current = jars.get(origin);
  const merged = mergeCookies(current, response);
  if (merged) jars.set(origin, merged);
}

export type AuthFetchInit = {
  method?: "GET" | "POST";
  body?: string;
  referer?: string;
};

const REQUEST_TIMEOUT_MS = 20000;

// Erro com o status HTTP anexado, para o retry distinguir 4xx (definitivo) de 5xx
// (intermitente). Sem status = falha de rede/timeout (também vale re-tentar).
class LeiloesBrHttpError extends Error {
  constructor(readonly status: number) {
    super(`LeilõesBR respondeu ${status}`);
  }
}

async function fetchOnce(url: string, init: AuthFetchInit, cookie?: string): Promise<string> {
  // Timeout para a requisição não travar indefinidamente (evita "fica carregando").
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        "User-Agent": UA,
        Accept: init.method === "POST" ? "*/*" : "text/html",
        // Deslogado (varredura pública) não envia Cookie; logado (vigia) envia.
        ...(cookie ? { Cookie: cookie } : {}),
        Referer: init.referer ?? `${BASE_URL}/default.asp`,
        ...(init.method === "POST"
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            }
          : {}),
      },
      signal: controller.signal,
      ...(init.body ? { body: init.body } : {}),
    });
    if (!response.ok) throw new LeiloesBrHttpError(response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// O site devolve 500/502 de forma intermitente sob carga: tentamos algumas vezes.
// Um 4xx (ex.: 404/403) é definitivo — re-tentar só adiciona latência, então falha logo.
async function fetchWithRetry(url: string, init: AuthFetchInit, cookie?: string): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetchOnce(url, init, cookie);
    } catch (error) {
      lastError = error;
      if (error instanceof LeiloesBrHttpError && error.status >= 400 && error.status < 500) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao acessar o LeilõesBR.");
}

/**
 * Fetches a public LeilõesBR URL WITHOUT logging in. The general listing is public,
 * and scraping it anonymously avoids the intermittent 500s the site throws for
 * authenticated sessions under load. Login stays reserved for the watch (vigia) calls.
 */
export async function publicFetch(url: string, init: AuthFetchInit = {}): Promise<string> {
  return await fetchWithRetry(url, init);
}

/**
 * Fetches a LeilõesBR URL with the shared logged-in session. When `isLoggedOut`
 * says the response came back anonymous, it logs in again and retries once.
 */
export async function authFetch(
  url: string,
  init: AuthFetchInit = {},
  isLoggedOut?: (html: string) => boolean,
): Promise<string> {
  let html = await fetchWithRetry(url, init, await getSessionCookie());
  if (isLoggedOut?.(html)) {
    html = await fetchWithRetry(url, init, await getSessionCookie(true));
  }
  return html;
}

export function loginEmail(): string {
  const email = process.env["LEILOESBR_EMAIL"];
  if (!email) throw new Error("LEILOESBR_EMAIL não configurado.");
  return email;
}
