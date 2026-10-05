/**
 * Camada de IA (isolada; ponto plugável). Avalia/identifica lotes de vinil com um modelo
 * barato. O PROVEDOR é plugável (`ai-provider.server.ts`): **Claude (Anthropic)** ou
 * **Gemini (Google)**. Só as funções de rede tocam o provedor; as funções puras (hash,
 * seleção, prompt, parsing) são testáveis sem chave de API. Coleção e estado de conservação
 * ficam em `ai-collection.server.ts` e `ai-condition.server.ts`.
 *
 * Dois caminhos:
 * - **Batches API** da Anthropic (assíncrona, ~50% do preço) — só Claude, usada pelo cron.
 *   Uma requisição de batch POR LOTE (custom_id = lots.id): o mapeamento resultado→lote
 *   fica trivial entre a submissão e a coleta (execuções diferentes do cron).
 * - **Síncrono** (`runText`) — usado sob demanda (botões) e pela Coleção, e pelo cron quando
 *   o provedor é Gemini (que não tem Batches aqui). Tem **failover** por quota/sem créditos.
 *
 * O custo continua em centavos (single-user, poucas centenas de lotes, cache por título →
 * só lotes novos entram).
 */
import { parsePrice, type VinylLot } from "./vinyl-parse";
import { priceRoseSinceEval } from "./ai-reprice";
import { normalizeTracklist } from "./tracklist";
import type { LotAiRow } from "./lot-ai.server";
import type { LotIdentRow } from "./lot-ident.server";
import {
  runText,
  providerModel,
  providerConfigured,
  toAnthropicMessageParams,
  anyProviderConfigured,
  getAnthropicClient,
  type AiProvider,
  type AiRequest,
} from "./ai-provider.server";

/** Modelo do Claude usado nos BATCHES (Anthropic-only). O síncrono usa o modelo do provedor. */
const ANTHROPIC_MODEL = providerModel("anthropic");

/** Teto de lotes avaliados por rodada de cron (evita batches gigantes). */
const MAX_PER_ROUND = 800;

type EvalLot = {
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
 * `repriceIds` (opcional — vigiados + lances): esses lotes também voltam para a fila quando o
 * preço atual subiu o bastante desde a avaliação (`priceRoseSinceEval`, ver `ai-reprice.ts`) —
 * a nota inclui a oportunidade (preço vs. valor), então fica defasada quando os lances sobem.
 */
export function selectLotsToEvaluate(
  lots: Pick<VinylLot, "id" | "title" | "price" | "house" | "image">[],
  aiRows: (Pick<LotAiRow, "id" | "title_hash"> & { eval_price?: number | null })[],
  max = MAX_PER_ROUND,
  repriceIds?: ReadonlySet<string>,
): EvalLot[] {
  const known = new Map(aiRows.map((r) => [r.id, r]));
  const out: EvalLot[] = [];
  for (const lot of lots) {
    if (!lot.id || !lot.title) continue;
    const row = known.get(lot.id);
    if (row && row.title_hash === titleHash(lot.title)) {
      const reprice =
        repriceIds?.has(lot.id) && priceRoseSinceEval(row.eval_price, parsePrice(lot.price));
      if (!reprice) continue;
    }
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
function buildUserPrompt(lot: EvalLot): string {
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
    '- "tags": array curto de gênero/estilo/época/selo (ex.: ["mpb","1972","odeon"])\n' +
    '- "tracklist": faixas do álbum, na ordem do disco, como array de ' +
    '{"side":"A","title":"Nome da faixa","fame":"alta|media|baixa"}. "side" é o lado do ' +
    'vinil ("A", "B"...). "fame": "alta" = os maiores sucessos do álbum, "media" = ' +
    'conhecidas, "baixa" = pouco conhecidas e/ou de lado B. Só inclua se tiver CERTEZA do ' +
    "álbum e de suas faixas — nunca invente; use [] quando não souber.\n\n" +
    "Disco:\n" +
    JSON.stringify(info) +
    "\n\nResponda só com o objeto JSON."
  );
}

/** Requisição NEUTRA (provedor-agnóstica) para avaliar UM lote. Inclui a capa (visão). */
function buildEvalRequest(lot: EvalLot): AiRequest {
  return {
    system: SYSTEM_PROMPT,
    maxTokens: 1200,
    text: buildUserPrompt(lot),
    image: usableImage(lot.image),
    json: true,
  };
}

/** Parâmetros de mensagem (Anthropic) para um lote — usado no request de BATCH. */
function buildLotParams(lot: EvalLot) {
  return toAnthropicMessageParams(buildEvalRequest(lot), ANTHROPIC_MODEL);
}

/**
 * Extrai o objeto de avaliação do texto devolvido pelo modelo. Tolerante a cercas de
 * código e a texto ao redor: pega o primeiro `{...}` e valida os campos. Retorna null
 * quando não dá para aproveitar.
 */
function parseEvalObject(
  text: string,
): Omit<LotAiRow, "id" | "title_hash" | "model" | "eval_price"> | null {
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
  const tracklist = normalizeTracklist(obj["tracklist"]);
  if (score === null && !rarity && !deal && !album && !reason && tags.length === 0) return null;
  return { score, rarity, deal, album, reason, tags, tracklist };
}

/** Extrai o texto concatenado dos blocos `text` de uma mensagem de resposta. */
function messageText(message: { content?: Array<{ type: string; text?: string }> }): string {
  const blocks = message?.content ?? [];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** true quando ALGUM provedor de IA está configurado (senão o cron faz no-op explícito). */
export function aiConfigured(): boolean {
  return anyProviderConfigured();
}

type SubmitResult = {
  batchId: string;
  hashes: Record<string, string>;
  /** Preço (R$) por lote no envio — só a avaliação usa (`lot_ai.eval_price`). */
  prices?: Record<string, number>;
  count: number;
};

/** Cria um batch com 1 request por lote (custom_id = id). Retorna id + hashes por lote. */
export async function submitEvalBatch(lots: EvalLot[]): Promise<SubmitResult> {
  const client = await getAnthropicClient();
  const hashes: Record<string, string> = {};
  const prices: Record<string, number> = {};
  const requests = lots.map((lot) => {
    hashes[lot.id] = titleHash(lot.title);
    const price = parsePrice(lot.price);
    if (price != null && price > 0) prices[lot.id] = price;
    return { custom_id: lot.id, params: buildLotParams(lot) };
  });
  // O SDK tipa `params` de forma estrita (MessageCreateParams); nosso builder devolve o
  // shape compatível, mas afrouxamos aqui para não duplicar os tipos do SDK.
  const batch = await client.messages.batches.create({ requests: requests as never });
  return { batchId: batch.id, hashes, prices, count: requests.length };
}

type CollectResult = { done: boolean; rows: LotAiRow[] };

/**
 * Coleta um batch. Se ainda processando, `{done:false}`. Se terminou, parseia os
 * resultados (chaveados por custom_id = id) e devolve as linhas prontas para o cache,
 * usando os `hashes` capturados na submissão.
 */
export async function collectEvalBatch(
  batchId: string,
  hashes: Record<string, string>,
  prices: Record<string, number> = {},
): Promise<CollectResult> {
  const client = await getAnthropicClient();
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
      tracklist: parsed.tracklist,
      model: ANTHROPIC_MODEL,
      eval_price: prices[id] ?? null,
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

export const CONFIDENCES = ["alta", "media", "baixa"] as const;

const IDENT_SYSTEM_PROMPT =
  "Você identifica discos de vinil (artista e álbum) que vão a leilão no Brasil. " +
  "Use seu conhecimento de música e discografia. Use SEMPRE o nome ARTÍSTICO padrão e " +
  "consistente do artista (a grafia oficial/canônica, com acentuação correta), o MESMO " +
  "entre discos diferentes do mesmo artista — nunca abreviações, variações ou grafias " +
  "alternativas — para não criar registros duplicados. Responda SOMENTE com um objeto " +
  "JSON, sem nenhum texto fora do JSON.";

/** Prompt de identificação de UM lote. Sem imagem por padrão (só o título). */
function buildIdentUserPrompt(lot: EvalLot, opts?: { withImage?: boolean }): string {
  const withImage = Boolean(opts?.withImage) && Boolean(usableImage(lot.image));
  const info = { titulo: lot.title, casa: lot.house, tem_imagem: withImage };
  return (
    "Identifique este disco de vinil e devolva um objeto JSON com EXATAMENTE estas chaves:\n" +
    '- "album": "Artista - Álbum" identificado (use " - " entre artista e álbum; "" se não souber). ' +
    "Se for uma coletânea/vários artistas (sucessos, trilha sonora, novela, seleção), use " +
    '"Vários Artistas" como artista.\n' +
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

/** Requisição NEUTRA para identificar UM lote. Inclui a capa só quando `withImage`. */
function buildIdentRequest(lot: EvalLot, withImage: boolean): AiRequest {
  return {
    system: IDENT_SYSTEM_PROMPT,
    maxTokens: 120,
    text: buildIdentUserPrompt(lot, { withImage }),
    image: withImage ? usableImage(lot.image) : null,
    json: true,
  };
}

/** Parâmetros de mensagem (Anthropic) para identificar UM lote — usado no request de BATCH. */
function buildIdentParams(lot: EvalLot, withImage: boolean) {
  return toAnthropicMessageParams(buildIdentRequest(lot, withImage), ANTHROPIC_MODEL);
}

/** Extrai {album, year, confidence} do texto devolvido. Null quando não dá para aproveitar. */
function parseIdentObject(
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
  const client = await getAnthropicClient();
  const hashes: Record<string, string> = {};
  const requests = lots.map((lot) => {
    hashes[lot.id] = titleHash(lot.title);
    return { custom_id: lot.id, params: buildIdentParams(lot, withImage) };
  });
  const batch = await client.messages.batches.create({ requests: requests as never });
  return { batchId: batch.id, hashes, count: requests.length };
}

type CollectIdentResult = { done: boolean; rows: LotIdentRow[] };

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
  const client = await getAnthropicClient();
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
      model: ANTHROPIC_MODEL,
    });
  }
  return { done: true, rows };
}

/** Concorrência das chamadas síncronas sob demanda (mantém o servidor dentro do tempo). */
export const SYNC_CONCURRENCY = 4;

/**
 * Resultado de uma passada SÍNCRONA: as linhas + qual provedor de fato atendeu e se houve
 * **failover** (troca por falta de créditos). A UI usa `served`/`switched` para avisar.
 * `failed` = quantos itens a IA NÃO conseguiu processar (erro/vazio); `error` = a 1ª mensagem
 * de erro, para o chamador distinguir "a IA falhou" de "não havia nada a fazer" e mostrá-la.
 */
export type SyncOutcome<T> = {
  rows: T[];
  served: AiProvider | null;
  switched: boolean;
  failed: number;
  error: string | null;
  /** Motivo de cada provedor pulado/que falhou no caminho até o que atendeu (ver `runText`). */
  attemptErrors: Partial<Record<AiProvider, string>>;
};

/** Acumula, entre os workers concorrentes, o provedor que atendeu, se houve troca e por quê. */
export class ProviderTracker {
  private used = new Set<AiProvider>();
  private attemptErrors: Partial<Record<AiProvider, string>> = {};
  switched = false;
  note(
    provider: AiProvider,
    switched: boolean,
    attemptErrors: Partial<Record<AiProvider, string>>,
  ) {
    this.used.add(provider);
    if (switched) this.switched = true;
    // Primeiro motivo registrado pra cada provedor prevalece (workers concorrentes veem o mesmo).
    for (const [p, reason] of Object.entries(attemptErrors) as Array<[AiProvider, string]>) {
      if (!this.attemptErrors[p]) this.attemptErrors[p] = reason;
    }
  }
  served(requested: AiProvider): AiProvider | null {
    if (!this.used.size) return null;
    if (this.used.has(requested)) return requested;
    // Failover: devolve o provedor alternativo que efetivamente atendeu.
    return [...this.used][0] ?? null;
  }
  errors(): Partial<Record<AiProvider, string>> {
    return this.attemptErrors;
  }
}

/**
 * Avaliação SÍNCRONA de um conjunto pequeno de lotes — usada pela análise SOB DEMANDA
 * (botões por dia/casa), onde o usuário espera o resultado NA HORA (a Batches API é
 * assíncrona e serve à rodada automática). Roda no `provider` pedido, com **failover**
 * por quota. Best-effort POR LOTE: um lote que falhe (rede/parsing) é ignorado e não
 * derruba os demais. Concorrência limitada.
 */
export async function evalLotsSync(
  lots: EvalLot[],
  provider: AiProvider,
): Promise<SyncOutcome<LotAiRow>> {
  if (!lots.length)
    return { rows: [], served: null, switched: false, failed: 0, error: null, attemptErrors: {} };
  const geminiModel = await resolveGeminiModel();
  const rows: LotAiRow[] = [];
  const tracker = new ProviderTracker();
  let failed = 0;
  let firstError: string | null = null;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const lot = lots[index];
      if (!lot) return;
      try {
        const r = await runText(buildEvalRequest(lot), provider, geminiModel);
        tracker.note(r.provider, r.switched, r.attemptErrors);
        const parsed = parseEvalObject(r.text);
        if (parsed) {
          rows.push({
            id: lot.id,
            title_hash: titleHash(lot.title),
            score: parsed.score,
            rarity: parsed.rarity,
            deal: parsed.deal,
            album: parsed.album,
            reason: parsed.reason,
            tags: parsed.tags,
            tracklist: parsed.tracklist,
            model: r.model,
            eval_price: parsePrice(lot.price) || null,
          });
        }
      } catch (error) {
        failed += 1;
        if (!firstError) firstError = (error as Error)?.message || String(error);
        console.error(`[ai-eval] falha ao avaliar o lote ${lot.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, lots.length) }, () => worker()),
  );
  return {
    rows,
    served: tracker.served(provider),
    switched: tracker.switched,
    failed,
    error: firstError,
    attemptErrors: tracker.errors(),
  };
}

/** Resultado da identificação síncrona por lote. */
type IdentResult = {
  id: string;
  album: string | null;
  year: number | null;
  confidence: string | null;
};

/**
 * Identificação SÍNCRONA de um conjunto pequeno de lotes — MESMA lógica da identificação
 * automática (`buildIdentRequest` + `parseIdentObject`), mas sob demanda (a rodada normal é
 * assíncrona via Batches). `withImage` decide o uso da capa: a Coleção roda **só por texto**
 * (`withImage=false`) porque a capa de leilão engana o modelo (mistura artistas parecidos).
 * Best-effort POR LOTE, com failover por quota. **Não** persiste — o chamador grava onde
 * quiser. Retorna só os lotes que a IA de fato identificou (com `album`).
 */
export async function identLotsSync(
  lots: EvalLot[],
  withImage = false,
  provider: AiProvider = "anthropic",
): Promise<IdentResult[]> {
  if (!lots.length) return [];
  const geminiModel = await resolveGeminiModel();
  const rows: IdentResult[] = [];
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const lot = lots[index];
      if (!lot) return;
      try {
        const r = await runText(buildIdentRequest(lot, withImage), provider, geminiModel);
        const parsed = parseIdentObject(r.text);
        if (parsed?.album) rows.push({ id: lot.id, ...parsed });
      } catch (error) {
        console.error(`[ai-eval] falha ao identificar o lote ${lot.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, lots.length) }, () => worker()),
  );
  return rows;
}

/**
 * Como `identLotsSync`, mas devolve LINHAS prontas para `lot_ident` (com `source`/`model`),
 * mesmo shape que a coleta de batch. Usada pelo cron `aiident` quando o provedor é o Gemini
 * (que não tem Batches aqui) — roda síncrono, em bloco, com failover por quota.
 */
export async function identLotsSyncRows(
  lots: EvalLot[],
  withImage: boolean,
  provider: AiProvider,
): Promise<SyncOutcome<LotIdentRow>> {
  if (!lots.length)
    return { rows: [], served: null, switched: false, failed: 0, error: null, attemptErrors: {} };
  const geminiModel = await resolveGeminiModel();
  const rows: LotIdentRow[] = [];
  const tracker = new ProviderTracker();
  const source: "title" | "image" = withImage ? "image" : "title";
  let failed = 0;
  let firstError: string | null = null;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const lot = lots[index];
      if (!lot) return;
      try {
        const r = await runText(buildIdentRequest(lot, withImage), provider, geminiModel);
        tracker.note(r.provider, r.switched, r.attemptErrors);
        const parsed = parseIdentObject(r.text);
        if (parsed) {
          rows.push({
            id: lot.id,
            title_hash: titleHash(lot.title),
            album: parsed.album,
            year: parsed.year,
            confidence: parsed.confidence,
            source,
            model: r.model,
          });
        }
      } catch (error) {
        failed += 1;
        if (!firstError) firstError = (error as Error)?.message || String(error);
        console.error(`[ai-eval] falha ao identificar (rows) o lote ${lot.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, lots.length) }, () => worker()),
  );
  return {
    rows,
    served: tracker.served(provider),
    switched: tracker.switched,
    failed,
    error: firstError,
    attemptErrors: tracker.errors(),
  };
}

// ---------------------------------------------------------------------------
// Identificação + DESCRIÇÃO da Coleção (síncrona, SÓ TEXTO)
//
// Usada pela re-identificação da Coleção: além de artista/álbum/ano, pede um
// descritivo curto do disco. Nunca usa a capa (a imagem do leilão engana o
// modelo). Recebe também o artista/álbum atuais como pista.
// ---------------------------------------------------------------------------

/**
 * Provedor EFETIVO para uma chamada síncrona sob demanda: o padrão do usuário
 * (`app_state.ai_provider`) quando tem chave configurada, senão o primeiro disponível
 * (Claude, depois Gemini). Mesmo critério usado pelo cron `aiident`.
 */
export async function resolveAiProvider(): Promise<AiProvider> {
  const { getAiProvider } = await import("./app-state.server");
  const preferred = await getAiProvider();
  if (providerConfigured(preferred)) return preferred;
  return providerConfigured("anthropic") ? "anthropic" : "gemini";
}

/**
 * Modelo do Gemini escolhido pelo usuário (`app_state.gemini_model`, ver `getGeminiModel` em
 * `app-state.server.ts`) — chamado UMA VEZ por rodada síncrona (não por lote) e repassado a
 * cada `runText`. Best-effort: em qualquer falha de leitura, cai pro padrão de fábrica (mais
 * barato) — nunca impede a avaliação de rodar por causa da preferência de modelo.
 */
export async function resolveGeminiModel(): Promise<string> {
  try {
    const { getGeminiModel } = await import("./app-state.server");
    return await getGeminiModel();
  } catch (error) {
    console.error("[ai-eval] não foi possível ler o modelo do Gemini (usando padrão)", error);
    return "gemini-3.1-flash-lite";
  }
}
