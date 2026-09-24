/** Só o e-mail cadastrado para as casas de leilão pode usar o app. */
export function configuredEmail(): string | null {
  const email = process.env["LEILOESBR_EMAIL"];
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function allowedEmail(): string {
  const email = configuredEmail();
  if (!email) throw new Error("LEILOESBR_EMAIL não está configurado.");
  return email;
}

export function assertAllowed(email: string | undefined): void {
  const current = (email ?? "").trim().toLowerCase();
  if (!current || current !== allowedEmail()) {
    throw new Error("Esta conta Google não tem acesso ao Garimpo de Vinil.");
  }
}

// -------------------------------------------------------- link público do Analytics ---
//
// Variante somente-leitura do Vinil Analytics (`/vinil-analytics-publico`) para compartilhar
// com alguém FORA do app, sem dar login Google nem qualquer capacidade de edição. Em vez de
// sessão (cookie/OAuth) ou registro no banco, o token é derivado deterministicamente por dia
// (HMAC-SHA256 de "vinil-analytics:" + a data em America/Sao_Paulo, hex, truncado a 16
// caracteres) — não precisa ser emitido nem revogado, só "expira" sozinho à meia-noite (com uma
// folga de 1 dia, `assertPublicAnalyticsToken` aceita o de ontem também, pra um link
// compartilhado perto da virada não quebrar na hora). Mesmo padrão de Web Crypto
// (`crypto.subtle`) do `auth.server.ts`, mas hex em vez de base64url (token mais curto/typável).

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function publicAnalyticsSecret(): string {
  const secret = process.env["PUBLIC_ANALYTICS_SECRET"];
  if (!secret) throw new Error("PUBLIC_ANALYTICS_SECRET não está configurado.");
  return secret;
}

/** Token do link público para um dia (`YYYY-MM-DD`) — determinístico, nunca gravado no banco. */
export async function publicAnalyticsTokenFor(dateKey: string): Promise<string> {
  const full = await hmacHex(publicAnalyticsSecret(), `vinil-analytics:${dateKey}`);
  return full.slice(0, 16);
}

function todayKeySaoPaulo(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}

/** Token de hoje (fuso America/Sao_Paulo) — o que o botão "Copiar link público" oferece. */
export async function todayPublicAnalyticsToken(): Promise<string> {
  return publicAnalyticsTokenFor(todayKeySaoPaulo());
}

/**
 * Valida o token do link público: aceita o de HOJE ou o de ONTEM (folga pra um link
 * compartilhado perto da virada do dia não quebrar na hora). Lança em qualquer outro caso —
 * token errado, expirado (mais de 1 dia) ou ausente.
 */
export async function assertPublicAnalyticsToken(token: string | undefined): Promise<void> {
  const current = (token ?? "").trim();
  if (!current) throw new Error("Link expirado ou inválido.");
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [todayToken, yesterdayToken] = await Promise.all([
    publicAnalyticsTokenFor(todayKeySaoPaulo(now)),
    publicAnalyticsTokenFor(todayKeySaoPaulo(yesterday)),
  ]);
  const ok = timingSafeEqual(current, todayToken) || timingSafeEqual(current, yesterdayToken);
  if (!ok) throw new Error("Link expirado ou inválido.");
}
