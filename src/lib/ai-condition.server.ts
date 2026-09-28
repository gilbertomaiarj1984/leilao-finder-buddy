// IA de estado de conservação: fallback quando o regex de `grading.ts` não acha grau de
// Disco/Capa no texto do lote/venda. Ver docs/areas/grading-e-estado.md.

import { runText, type AiProvider, type AiRequest } from "./ai-provider.server";
import {
  ProviderTracker,
  resolveGeminiModel,
  SYNC_CONCURRENCY,
  type SyncOutcome,
} from "./ai-eval.server";
import { GRADE_ORDER, normalizeGrade, type Grade, type InsertState } from "./grading";

const CONDITION_SYSTEM_PROMPT =
  "Você extrai o estado de conservação de um disco de vinil (Disco/mídia e Capa) a partir " +
  "do texto de um anúncio de leilão. Responda SOMENTE com um objeto JSON, sem nenhum texto " +
  "fora do JSON. NUNCA invente: se o texto não disser claramente o estado de um lado (ou do " +
  "encarte), use null para ele — melhor null do que um palpite.";

/** Prompt de extração de estado de UM lote, a partir do texto do catálogo/título. */
function buildConditionUserPrompt(text: string): string {
  return (
    "Leia a descrição abaixo de um lote de vinil em leilão e devolva um objeto JSON com " +
    "EXATAMENTE estas chaves:\n" +
    `- "media": o estado do DISCO (mídia), como uma destas siglas EXATAS: ${GRADE_ORDER.join(", ")}` +
    " — ou null se o texto não disser o estado do disco.\n" +
    '- "sleeve": o estado da CAPA, mesma escala de siglas, ou null se não disser.\n' +
    '- "insert": "sim" se o texto afirma CLARAMENTE que há encarte interno, "nao" se afirma ' +
    "CLARAMENTE que não há, ou null se o texto não fala sobre encarte (nunca adivinhe).\n\n" +
    "Escala (do melhor para o pior): M (Mint/Lacrado), NM (Near Mint), EX (Excelente), " +
    "VG+ (Muito Bom), VG (Bom), VG-, G+, G, G-, F/P (Ruim/Danificado).\n\n" +
    "Descrição do lote:\n" +
    text.slice(0, 2000) +
    "\n\nResponda só com o objeto JSON."
  );
}

/** Requisição NEUTRA (só texto) para extrair o estado de UM lote. */
function buildConditionRequest(text: string): AiRequest {
  return {
    system: CONDITION_SYSTEM_PROMPT,
    maxTokens: 150,
    text: buildConditionUserPrompt(text),
    image: null,
    json: true,
  };
}

/**
 * Extrai {media, sleeve, insert} do texto devolvido pela IA. `media`/`sleeve` passam por
 * `normalizeGrade` — só a escala canônica é aceita (qualquer outra coisa vira null, nunca
 * inventa um grau fora da escala). Null quando não dá para aproveitar nada.
 */
function parseConditionAiObject(
  text: string,
): { media: Grade | null; sleeve: Grade | null; insert: InsertState } | null {
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
  const media = typeof obj["media"] === "string" ? normalizeGrade(obj["media"]) : null;
  const sleeve = typeof obj["sleeve"] === "string" ? normalizeGrade(obj["sleeve"]) : null;
  const insertRaw = typeof obj["insert"] === "string" ? obj["insert"].toLowerCase().trim() : "";
  const insert: InsertState = insertRaw === "sim" ? "sim" : insertRaw === "nao" ? "nao" : null;
  if (media === null && sleeve === null && insert === null) return null;
  return { media, sleeve, insert };
}

type ConditionAiResult = {
  id: string;
  media: Grade | null;
  sleeve: Grade | null;
  insert: InsertState;
  model: string;
};

/**
 * Fallback de IA SÍNCRONO para um pequeno lote de itens {id, text} sem estado reconhecido
 * pelo regex. Best-effort POR ITEM (um item que falhe não derruba os demais); failover por
 * quota via `runText`. Chamado tanto por `enrichConditions` (`lot_condition`) quanto por
 * `captureFinishedSales` (`lot_sales`) — ambos com um teto de itens por rodada.
 */
export async function conditionAiSync(
  items: { id: string; text: string }[],
  provider: AiProvider,
): Promise<SyncOutcome<ConditionAiResult>> {
  if (!items.length)
    return { rows: [], served: null, switched: false, failed: 0, error: null, attemptErrors: {} };
  const geminiModel = await resolveGeminiModel();
  const rows: ConditionAiResult[] = [];
  const tracker = new ProviderTracker();
  let failed = 0;
  let firstError: string | null = null;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      try {
        const r = await runText(buildConditionRequest(item.text), provider, geminiModel);
        tracker.note(r.provider, r.switched, r.attemptErrors);
        const parsed = parseConditionAiObject(r.text);
        if (parsed) rows.push({ id: item.id, ...parsed, model: r.model });
      } catch (error) {
        failed += 1;
        if (!firstError) firstError = (error as Error)?.message || String(error);
        console.error(`[ai-eval] falha ao extrair estado (IA) do lote ${item.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, items.length) }, () => worker()),
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
