/**
 * Lote em pregão AGORA de uma casa (ao lado de "Ao vivo agora"). Faz o mesmo que o JS do
 * `presencial.asp`: lê `idleilao`/`idsite` do HTML (sem login) e consulta o endpoint de
 * polling da plataforma — ver `presencial-now.ts` para o formato. Best-effort: `null` em erro.
 */
import { publicFetch } from "./leiloesbr-auth.server";
import { isPublicHost } from "./leiloesbr-live.server";
import { parsePregaoResponse, parsePresencialIds, type PresencialNow } from "./presencial-now";

// Endpoint comum da plataforma (`novoPresencial.defineLeRegistro("")` no navegador).
const PREGAO_URL =
  process.env["PRESENCIAL_PREGAO_URL"] ||
  "https://d1vzg1b1ofiies.cloudfront.net/1s/le_registro_pregao_cfbr_v1.asp";

// ≤ metade do intervalo do cliente (1 min), senão o cache vira o piso da atualização.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<string, { at: number; value: PresencialNow | null }>();
// `idsite` não muda durante o leilão: evita baixar o HTML do presencial a cada consulta.
const idsCache = new Map<string, { idleilao: string; idsite: string }>();

function validPresencialUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Só pregões https são suportados.");
  if (!isPublicHost(url.hostname)) throw new Error("Host do pregão não permitido.");
  if (!/^\/presencial\/presencial\.asp$/i.test(url.pathname) || !url.searchParams.get("Num")) {
    throw new Error("URL do pregão presencial inválida.");
  }
  return url;
}

export async function fetchPresencialNow(raw: string): Promise<PresencialNow | null> {
  const url = validPresencialUrl(raw);
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: PresencialNow | null = null;
  try {
    let ids = idsCache.get(key);
    if (!ids) {
      // Referer da própria casa (não o padrão leiloesbr.com.br de `publicFetch`) — mesmo
      // fix de `leiloesbr-catalog.server.ts` (v0.85.0): Referer de origem cruzada pro
      // domínio da casa zera a resposta em silêncio (HTTP 200 vazio, nunca um erro).
      ids = parsePresencialIds(await publicFetch(key, { referer: `${url.origin}/` })) ?? undefined;
      if (!ids) throw new Error("idleilao/idsite não encontrados no presencial.asp");
      idsCache.set(key, ids);
    }
    const qs = new URLSearchParams({ i: ids.idleilao, j: ids.idsite, p: "" });
    const text = await publicFetch(`${PREGAO_URL}?${qs}`, { referer: key });
    value = parsePregaoResponse(text);
  } catch (error) {
    console.error("[presencial] falha ao ler o lote em pregão", key, error);
  }
  // Um leilão por chave e poucos por dia: limpar tudo de vez em quando basta.
  if (cache.size > 200) cache.clear();
  if (idsCache.size > 200) idsCache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
