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

/** Modelo mais barato do Claude (US$1/US$5 por 1M in/out; metade disso no batch). */
export const AI_MODEL = "claude-haiku-4-5";

/** Teto de lotes avaliados por rodada de cron (evita batches gigantes). */
export const MAX_PER_ROUND = 800;

export type EvalLot = { id: string; title: string; price: string; house: string };

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
  lots: Pick<VinylLot, "id" | "title" | "price" | "house">[],
  aiRows: Pick<LotAiRow, "id" | "title_hash">[],
  max = MAX_PER_ROUND,
): EvalLot[] {
  const known = new Map(aiRows.map((r) => [r.id, r.title_hash]));
  const out: EvalLot[] = [];
  for (const lot of lots) {
    if (!lot.id || !lot.title) continue;
    if (known.get(lot.id) === titleHash(lot.title)) continue;
    out.push({ id: lot.id, title: lot.title, price: lot.price, house: lot.house });
    if (out.length >= max) break;
  }
  return out;
}

const SYSTEM_PROMPT =
  "Você avalia discos de vinil (LPs, compactos, bolachões) que vão a leilão no Brasil, " +
  "para um colecionador. Estime o valor de coleção do disco e se o preço pedido é uma boa " +
  "oportunidade, usando seu conhecimento de música e discografia. Seja realista: a grande " +
  "maioria dos discos é comum e de baixo valor. Responda SOMENTE com um objeto JSON, sem " +
  "nenhum texto fora do JSON.";

/** Prompt de usuário para UM lote. */
export function buildUserPrompt(lot: EvalLot): string {
  const price = parsePrice(lot.price);
  const info = {
    titulo: lot.title,
    casa: lot.house,
    preco_reais: price ?? null,
  };
  return (
    "Avalie este disco de vinil e devolva um objeto JSON com EXATAMENTE estas chaves:\n" +
    '- "score": inteiro 0-100 (interesse geral para um colecionador = raridade + oportunidade)\n' +
    '- "rarity": um de "comum","interessante","raro","muito_raro"\n' +
    '- "deal": um de "caro","justo","barato","indefinido" (preço pedido vs. valor estimado; ' +
    '"indefinido" quando não houver preço)\n' +
    '- "reason": 1 frase curta em português justificando a nota\n' +
    '- "tags": array curto de gênero/estilo/época (ex.: ["mpb","1972","psicodelia"])\n\n' +
    "Disco:\n" +
    JSON.stringify(info) +
    "\n\nResponda só com o objeto JSON."
  );
}

/** Parâmetros de mensagem para um lote (usado no request de batch). */
export function buildLotParams(lot: EvalLot) {
  return {
    model: AI_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: buildUserPrompt(lot) }],
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
  const reason = typeof obj["reason"] === "string" ? obj["reason"].slice(0, 400) : null;
  const tags = Array.isArray(obj["tags"])
    ? (obj["tags"] as unknown[])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.slice(0, 40))
        .slice(0, 8)
    : [];
  if (score === null && !rarity && !deal && !reason && tags.length === 0) return null;
  return { score, rarity, deal, reason, tags };
}

/** Extrai o texto concatenado dos blocos `text` de uma mensagem de resposta. */
function messageText(message: { content?: Array<{ type: string; text?: string }> }): string {
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
      reason: parsed.reason,
      tags: parsed.tags,
      model: AI_MODEL,
    });
  }
  return { done: true, rows };
}
