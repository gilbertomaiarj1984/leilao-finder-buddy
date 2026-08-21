export const BASE_URL = "https://leiloesbr.com.br";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

let cookieHeader: string | null = null;
let loginPromise: Promise<string> | null = null;

function collectCookies(response: Response): string {
  const raw = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const single = response.headers.get("set-cookie");
  const all = raw.length ? raw : single ? [single] : [];
  const jar = new Map<string, string>();
  for (const entry of cookieHeader?.split("; ") ?? []) {
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

async function performLogin(): Promise<string> {
  const email = process.env["LEILOESBR_EMAIL"];
  const password = process.env["LEILOESBR_SENHA"];
  if (!email || !password) {
    throw new Error("Credenciais do LeilõesBR não configuradas (LEILOESBR_EMAIL / LEILOESBR_SENHA).");
  }

  const body = new URLSearchParams({
    campoeml: email,
    campopwd: password,
    refererclick: "",
    AuthenticationMethod: "",
  });

  const response = await fetch(`${BASE_URL}/portal/assets/modulos/login/asp/login.asp`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${BASE_URL}/default.asp`,
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

  cookieHeader = collectCookies(response);
  if (!cookieHeader.includes("ASPSESSIONID")) {
    throw new Error("Login no LeilõesBR não devolveu sessão.");
  }
  return cookieHeader;
}

export async function getSessionCookie(force = false): Promise<string> {
  if (force) {
    cookieHeader = null;
    loginPromise = null;
  }
  if (cookieHeader) return cookieHeader;
  loginPromise ??= performLogin().finally(() => {
    loginPromise = null;
  });
  return await loginPromise;
}

export type AuthFetchInit = {
  method?: "GET" | "POST";
  body?: string;
  referer?: string;
};

/**
 * Fetches a LeilõesBR URL with the shared logged-in session. When `isLoggedOut`
 * says the response came back anonymous, it logs in again and retries once.
 */
export async function authFetch(
  url: string,
  init: AuthFetchInit = {},
  isLoggedOut?: (html: string) => boolean,
): Promise<string> {
  const run = async (cookie: string) => {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        "User-Agent": UA,
        Accept: init.method === "POST" ? "*/*" : "text/html",
        Cookie: cookie,
        Referer: init.referer ?? `${BASE_URL}/default.asp`,
        ...(init.method === "POST"
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
            }
          : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    if (!response.ok) throw new Error(`LeilõesBR respondeu ${response.status}`);
    return await response.text();
  };

  let html = await run(await getSessionCookie());
  if (isLoggedOut?.(html)) {
    html = await run(await getSessionCookie(true));
  }
  return html;
}

export function loginEmail(): string {
  const email = process.env["LEILOESBR_EMAIL"];
  if (!email) throw new Error("LEILOESBR_EMAIL não configurado.");
  return email;
}
