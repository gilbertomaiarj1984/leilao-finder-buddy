/**
 * Camada de IA (isolada; ponto plugável). Avalia lotes de vinil com um modelo barato
 * via **Batches API** da Anthropic (assíncrona, ~50% do preço). Só as funções de rede
 * importam o SDK (dinamicamente); as funções puras (hash, seleção, prompt, parsing) são
 * testáveis com `bun -e` sem chave de API.
 *
 * Uma requisição de batch POR LOTE (custom_id = lots.id): o mapeamento resultado→lote
 * fica trivial e robusto entre a submissão e a coleta (que ocorrem em execuções
 * diferentes do cron). O custo continua em centavos (single-user, poucas centenas de
 * lotes, cache por título → só lotes novos entram).
 */
import { parsePrice, type VinylLot } from "./vinyl-parse";
import type { LotAiRow } from "./lot-ai.server";
import type { LotIdentRow } from "./lot-ident.server";

/** Modelo mais barato do Claude (US$1/US$5 por 1M in/out; metade disso no batch). */
export const AI_MODEL = "claude-haiku-4-5";

/** Teto de lotes avaliados por rodada de cron (evita batches gigantes). */
export const MAX_PER_ROUND = 800;

export type EvalLot = {
  id: string;
  title: string;
  price: string;
  house: string;
  image: string | null;
};

const RARITIES = ["comum", "interessante", "raro", "muito_raro"] as const;
const DEALS = ["caro", "justo", "barato", "indefinido"] as const;

/** Hash estável e curto do título (djb2 → base36). Muda ⇒ re-avaliar. */
export function titleHash(title: string): string {
  let h = 5381;
  const s = title ?? "";
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Seleciona os lotes que ainda precisam de avaliação: sem linha em `lot_ai` ou com
 * `title_hash` divergente (título mudou). Teto por rodada.
 */
export function selectLotsToEvaluate(
  lots: Pick<VinylLot, "id" | "title" | "price" | "house" | "image">[],
  aiRows: Pick<LotAiRow, "id" | "title_hash">[],
  max = MAX_PER_ROUND,
): EvalLot[] {
  const known = new Map(aiRows.map((r) => [r.id, r.title_hash]));
  const out: EvalLot[] = [];
  for (const lot of lots) {
    if (!lot.id || !lot.title) continue;
    if (known.get(lot.id) === titleHash(lot.title)) continue;
    out.push({
      id: lot.id,
      title: lot.title,
      price: lot.price,
      house: lot.house,
      image: lot.image,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** URL de imagem http(s) aproveitável pela API de visão (senão texto puro). */
function usableImage(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const SYSTEM_PROMPT =
  "Você avalia discos de vinil (LPs, compactos, bolachões) que vão a leilão no Brasil, " +
  "para um colecionador. Quando houver imagem da capa, use-a para IDENTIFICAR o disco " +
  "(artista, álbum, selo/gravadora, país e época) — o título do leilão costuma ser " +
  "incompleto ou genérico. Estime o valor de coleção e se o preço pedido é uma boa " +
  "oportunidade, usando seu conhecimento de música e discografia. Seja realista: a grande " +
  "maioria dos discos é comum e de baixo valor. Responda SOMENTE com um objeto JSON, sem " +
  "nenhum texto fora do JSON.";

/** Prompt de usuário (texto) para UM lote. A imagem, quando houver, vai num bloco à parte. */
export function buildUserPrompt(lot: EvalLot): string {
  const price = parsePrice(lot.price);
  const info = {
    titulo: lot.title,
    casa: lot.house,
    preco_reais: price ?? null,
    tem_imagem: Boolean(usableImage(lot.image)),
  };
  return (
    "Avalie este disco de vinil e devolva um objeto JSON com EXATAMENTE estas chaves:\n" +
    '- "score": inteiro 0-100 (interesse geral para um colecionador = raridade + oportunidade)\n' +
    '- "rarity": um de "comum","interessante","raro","muito_raro"\n' +
    '- "deal": um de "caro","justo","barato","indefinido" (preço pedido vs. valor estimado; ' +
    '"indefinido" quando não houver preço)\n' +
    '- "album": artista e álbum que você identificou (da capa, se houver; "" se não souber)\n' +
    '- "reason": 1 frase curta em português justificando a nota\n' +
    '- "tags": array curto de gênero/estilo/época/selo (ex.: ["mpb","1972","odeon"])\n\n' +
    "Disco:\n" +
    JSON.stringify(info) +
    "\n\nResponda só com o objeto JSON."
  );
}

type ContentBlock =
  { type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } };

/** Parâmetros de mensagem para um lote (usado no request de batch). Inclui a capa (visão). */
export function buildLotParams(lot: EvalLot) {
  const img = usableImage(lot.image);
  const content: ContentBlock[] = [];
  // A imagem vem ANTES do texto (recomendação da API de visão).
  if (img) content.push({ type: "image", source: { type: "url", url: img } });
  content.push({ type: "text", text: buildUserPrompt(lot) });
  return {
    model: AI_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content }],
  };
}

/**
 * Extrai o objeto de avaliação do texto devolvido pelo modelo. Tolerante a cercas de
 * código e a texto ao redor: pega o primeiro `{...}` e valida os campos. Retorna null
 * quando não dá para aproveitar.
 */
export function parseEvalObject(
  text: string,
): Omit<LotAiRow, "id" | "title_hash" | "model"> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const scoreRaw = Number(obj["score"]);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : null;
  const rarity =
    typeof obj["rarity"] === "string" && (RARITIES as readonly string[]).includes(obj["rarity"])
      ? (obj["rarity"] as string)
      : null;
  const deal =
    typeof obj["deal"] === "string" && (DEALS as readonly string[]).includes(obj["deal"])
      ? (obj["deal"] as string)
      : null;
  const album =
    typeof obj["album"] === "string" && obj["album"].trim()
      ? obj["album"].trim().slice(0, 200)
      : null;
  const reason = typeof obj["reason"] === "string" ? obj["reason"].slice(0, 400) : null;
  const tags = Array.isArray(obj["tags"])
    ? (obj["tags"] as unknown[])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.slice(0, 40))
        .slice(0, 8)
    : [];
  if (score === null && !rarity && !deal && !album && !reason && tags.length === 0) return null;
  return { score, rarity, deal, album, reason, tags };
}

/** Extrai o texto concatenado dos blocos `text` de uma mensagem de resposta. */
export function messageText(message: { content?: Array<{ type: string; text?: string }> }): string {
  const blocks = message?.content ?? [];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** true quando há chave configurada (senão o cron faz no-op explícito). */
export function aiConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]);
}

async function getClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

export type SubmitResult = { batchId: string; hashes: Record<string, string>; count: number };

/** Cria um batch com 1 request por lote (custom_id = id). Retorna id + hashes por lote. */
export async function submitEvalBatch(lots: EvalLot[]): Promise<SubmitResult> {
  const client = await getClient();
  const hashes: Record<string, string> = {};
  const requests = lots.map((lot) => {
    hashes[lot.id] = titleHash(lot.title);
    return { custom_id: lot.id, params: buildLotParams(lot) };
  });
  // O SDK tipa `params` de forma estrita (MessageCreateParams); nosso builder devolve o
  // shape compatível, mas afrouxamos aqui para não duplicar os tipos do SDK.
  const batch = await client.messages.batches.create({ requests: requests as never });
  return { batchId: batch.id, hashes, count: requests.length };
}

export type CollectResult = { done: boolean; rows: LotAiRow[] };

/**
 * Coleta um batch. Se ainda processando, `{done:false}`. Se terminou, parseia os
 * resultados (chaveados por custom_id = id) e devolve as linhas prontas para o cache,
 * usando os `hashes` capturados na submissão.
 */
export async function collectEvalBatch(
  batchId: string,
  hashes: Record<string, string>,
): Promise<CollectResult> {
  const client = await getClient();
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return { done: false, rows: [] };

  const rows: LotAiRow[] = [];
  for await (const result of await client.messages.batches.results(batchId)) {
    if (result.result.type !== "succeeded") continue;
    const parsed = parseEvalObject(messageText(result.result.message));
    if (!parsed) continue;
    const id = result.custom_id;
    rows.push({
      id,
      title_hash: hashes[id] ?? "",
      score: parsed.score,
      rarity: parsed.rarity,
      deal: parsed.deal,
      album: parsed.album,
      reason: parsed.reason,
      tags: parsed.tags,
      model: AI_MODEL,
    });
  }
  return { done: true, rows };
}

// ---------------------------------------------------------------------------
// Identificação SIMPLIFICADA (camada barata, roda para TODOS os lotes)
//
// Diferente da avaliação completa acima (nota/raridade/oportunidade, gated pelo
// modo), esta passada só descobre **artista/álbum/ano** e alimenta a exibição, a
// busca, o filtro por artista e a correlação com o Discogs. 1ª passada só com o
// TÍTULO (barata); quando a confiança vem "baixa", uma 2ª passada usa a CAPA.
// ---------------------------------------------------------------------------

const CONFIDENCES = ["alta", "media", "baixa"] as const;

const IDENT_SYSTEM_PROMPT =
  "Você identifica discos de vinil (artista e álbum) que vão a leilão no Brasil. " +
  "Use seu conhecimento de música e discografia. Responda SOMENTE com um objeto JSON, " +
  "sem nenhum texto fora do JSON.";

/** Prompt de identificação de UM lote. Sem imagem por padrão (só o título). */
export function buildIdentUserPrompt(lot: EvalLot, opts?: { withImage?: boolean }): string {
  const withImage = Boolean(opts?.withImage) && Boolean(usableImage(lot.image));
  const info = { titulo: lot.title, casa: lot.house, tem_imagem: withImage };
  return (
    "Identifique este disco de vinil e devolva um objeto JSON com EXATAMENTE estas chaves:\n" +
    '- "album": "Artista - Álbum" identificado (use " - " entre artista e álbum; "" se não souber)\n' +
    '- "year": ano de lançamento (inteiro) ou null se não souber\n' +
    '- "confidence": "alta" | "media" | "baixa" (sua confiança na identificação)\n\n' +
    (withImage
      ? "Use a imagem da capa para identificar — o título do leilão costuma ser genérico.\n"
      : "Baseie-se apenas no título abaixo.\n") +
    "Disco:\n" +
    JSON.stringify(info) +
    "\n\nResponda só com o objeto JSON."
  );
}

/** Parâmetros de mensagem para identificar UM lote. Inclui a capa só quando `withImage`. */
export function buildIdentParams(lot: EvalLot, withImage: boolean) {
  const content: ContentBlock[] = [];
  const img = withImage ? usableImage(lot.image) : null;
  if (img) content.push({ type: "image", source: { type: "url", url: img } });
  content.push({ type: "text", text: buildIdentUserPrompt(lot, { withImage }) });
  return {
    model: AI_MODEL,
    max_tokens: 120,
    system: IDENT_SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content }],
  };
}

/** Extrai {album, year, confidence} do texto devolvido. Null quando não dá para aproveitar. */
export function parseIdentObject(
  text: string,
): { album: string | null; year: number | null; confidence: string | null } | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const album =
    typeof obj["album"] === "string" && obj["album"].trim()
      ? obj["album"].trim().slice(0, 200)
      : null;
  const yearRaw = Number(obj["year"]);
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? Math.round(yearRaw) : null;
  const c = typeof obj["confidence"] === "string" ? obj["confidence"].toLowerCase().trim() : "";
  const confidence = (CONFIDENCES as readonly string[]).includes(c) ? c : null;
  if (album === null && year === null && confidence === null) return null;
  return { album, year, confidence };
}

/**
 * Lotes que ainda precisam de identificação: sem linha em `lot_ident` ou com
 * `title_hash` divergente (título mudou). Mesma lógica de `selectLotsToEvaluate`.
 */
export function selectLotsToIdentify(
  lots: Pick<VinylLot, "id" | "title" | "price" | "house" | "image">[],
  identRows: Pick<LotIdentRow, "id" | "title_hash">[],
  max = MAX_PER_ROUND,
): EvalLot[] {
  return selectLotsToEvaluate(lots, identRows, max);
}

/**
 * Lotes para RE-identificar usando a CAPA: já passaram pela identificação por título
 * (`source='title'`), vieram com confiança **baixa** e têm imagem utilizável. Após a
 * passada com imagem a linha vira `source='image'` e não é selecionada de novo.
 */
export function selectLotsToReident(
  lots: Pick<VinylLot, "id" | "title" | "price" | "house" | "image">[],
  identRows: Pick<LotIdentRow, "id" | "confidence" | "source">[],
  max = MAX_PER_ROUND,
): EvalLot[] {
  const byId = new Map(identRows.map((r) => [r.id, r]));
  const out: EvalLot[] = [];
  for (const lot of lots) {
    if (!lot.id || !lot.title) continue;
    if (!usableImage(lot.image)) continue;
    const row = byId.get(lot.id);
    if (!row || row.source !== "title" || row.confidence !== "baixa") continue;
    out.push({
      id: lot.id,
      title: lot.title,
      price: lot.price,
      house: lot.house,
      image: lot.image,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Cria um batch de identificação (1 request por lote). `withImage` decide o uso da capa. */
export async function submitIdentBatch(lots: EvalLot[], withImage: boolean): Promise<SubmitResult> {
  const client = await getClient();
  const hashes: Record<string, string> = {};
  const requests = lots.map((lot) => {
    hashes[lot.id] = titleHash(lot.title);
    return { custom_id: lot.id, params: buildIdentParams(lot, withImage) };
  });
  const batch = await client.messages.batches.create({ requests: requests as never });
  return { batchId: batch.id, hashes, count: requests.length };
}

export type CollectIdentResult = { done: boolean; rows: LotIdentRow[] };

/**
 * Coleta um batch de identificação. `source` marca de onde veio a identificação
 * ('title' ou 'image'), para a lógica de escalonamento (só reidentifica os 'title'
 * de baixa confiança).
 */
export async function collectIdentBatch(
  batchId: string,
  hashes: Record<string, string>,
  source: "title" | "image",
): Promise<CollectIdentResult> {
  const client = await getClient();
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return { done: false, rows: [] };

  const rows: LotIdentRow[] = [];
  for await (const result of await client.messages.batches.results(batchId)) {
    if (result.result.type !== "succeeded") continue;
    const parsed = parseIdentObject(messageText(result.result.message));
    if (!parsed) continue;
    const id = result.custom_id;
    rows.push({
      id,
      title_hash: hashes[id] ?? "",
      album: parsed.album,
      year: parsed.year,
      confidence: parsed.confidence,
      source,
      model: AI_MODEL,
    });
  }
  return { done: true, rows };
}

/** Monta a linha de cache a partir do texto devolvido pelo modelo (null se não aproveitável). */
function rowFromMessage(
  lot: EvalLot,
  message: { content?: Array<{ type: string; text?: string }> },
): LotAiRow | null {
  const parsed = parseEvalObject(messageText(message));
  if (!parsed) return null;
  return {
    id: lot.id,
    title_hash: titleHash(lot.title),
    score: parsed.score,
    rarity: parsed.rarity,
    deal: parsed.deal,
    album: parsed.album,
    reason: parsed.reason,
    tags: parsed.tags,
    model: AI_MODEL,
  };
}

/** Concorrência das chamadas síncronas sob demanda (mantém o servidor dentro do tempo). */
const SYNC_CONCURRENCY = 4;

/**
 * Avaliação SÍNCRONA (Messages API) de um conjunto pequeno de lotes — usada pela análise
 * SOB DEMANDA (botões por dia/casa), onde o usuário espera o resultado NA HORA (a Batches
 * API é assíncrona e serve à rodada automática). Best-effort POR LOTE: um lote que falhe
 * (rede/parsing) é ignorado e não derruba os demais. Concorrência limitada.
 */
export async function evalLotsSync(lots: EvalLot[]): Promise<LotAiRow[]> {
  if (!lots.length) return [];
  const client = await getClient();
  const rows: LotAiRow[] = [];
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const lot = lots[index];
      if (!lot) return;
      try {
        const message = await client.messages.create(buildLotParams(lot));
        const row = rowFromMessage(lot, message);
        if (row) rows.push(row);
      } catch (error) {
        console.error(`[ai-eval] falha ao avaliar o lote ${lot.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, lots.length) }, () => worker()),
  );
  return rows;
}
