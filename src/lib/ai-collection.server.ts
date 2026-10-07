// IA da Coleção: identifica + descreve UM disco da coleção do usuário (artista/álbum/ano +
// descritivo), só texto. Chamada síncrona (sem Batches). Ver docs/areas/colecao-sondagem-compras.md.

import { runText, type AiProvider, type AiRequest } from "./ai-provider.server";
import {
  CONFIDENCES,
  ProviderTracker,
  resolveGeminiModel,
  SYNC_CONCURRENCY,
  type SyncOutcome,
} from "./ai-eval.server";

const COLLECTION_IDENT_SYSTEM_PROMPT =
  "Você identifica e descreve discos de vinil de uma coleção, para um colecionador " +
  "brasileiro. Use seu conhecimento de música e discografia. Baseie-se APENAS no texto " +
  "informado (não há imagem). Responda SOMENTE com um objeto JSON, sem texto fora dele.";

const COLLECTION_IDENT_IMAGE_SYSTEM_PROMPT =
  "Você identifica e descreve discos de vinil de uma coleção, para um colecionador " +
  "brasileiro. Há a imagem da CAPA do disco: leia nela o artista, o nome do álbum, a " +
  "gravadora e a época, e use seu conhecimento de música e discografia. Se a capa não permitir " +
  'identificar com segurança, devolva "album" vazio e confiança "baixa" — nunca invente. ' +
  "Responda SOMENTE com um objeto JSON, sem texto fora dele.";

/** Entrada da identificação da Coleção: título do lote + artista/álbum/ano atuais (pista). */
type CollectionIdentInput = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  year?: number | null;
  /** URL http(s) da capa: quando presente, identifica PELA IMAGEM (sem as pistas de texto). */
  image?: string | null;
  /** Dica livre do colecionador (ex.: "LP de 1979, selo Philips, tem a faixa X"): PRIORIDADE máxima. */
  hint?: string | null;
};

/** Resultado: identificação + descritivo do disco + tags de gênero/estilo. */
type CollectionIdentResult = {
  id: string;
  album: string | null;
  year: number | null;
  confidence: string | null;
  description: string | null;
  tags: string[];
};

/** Prompt de identificação+descrição de UM disco da coleção (só texto). */
function buildCollectionIdentPrompt(input: CollectionIdentInput): string {
  // Pela imagem, as pistas de texto atuais seriam justamente o que se quer corrigir: não vão.
  const info = input.image
    ? { origem: "capa do disco (imagem anexada)" }
    : {
        titulo: input.title,
        artista_atual: input.artist || null,
        album_atual: input.album || null,
        ano_atual: input.year ?? null,
      };
  const hint = input.hint?.trim();
  if (hint) (info as Record<string, unknown>)["dica_do_colecionador"] = hint.slice(0, 600);
  return (
    "Identifique e descreva EM DETALHE este disco de vinil. Devolva um objeto JSON com " +
    "EXATAMENTE estas chaves:\n" +
    '- "album": "Artista - Álbum" (use " - " entre artista e álbum; "" se não souber). ' +
    "Se for coletânea/vários artistas (sucessos, trilha sonora, novela, seleção), use " +
    '"Vários Artistas" como artista.\n' +
    '- "year": ano de lançamento (inteiro) ou null se não souber\n' +
    '- "confidence": "alta" | "media" | "baixa" (sua confiança na identificação)\n' +
    '- "tags": array de 2 a 5 tags curtas APENAS de ESTILO/GÊNERO MUSICAL em português ' +
    '(ex.: "MPB", "Samba", "Bossa Nova", "Rock", "Jazz", "Forró"). NÃO inclua época/ano, ' +
    "artista, país, formato nem qualquer outra coisa que não seja estilo musical; [] se não souber.\n" +
    '- "description": um descritivo RICO e DETALHADO em português (vários parágrafos, ' +
    "quanto mais completo melhor). Baseie-se PRINCIPALMENTE no NOME DO ÁLBUM (além do artista) e " +
    "traga: (1) o momento histórico do álbum — contexto e ano de lançamento, gravadora, " +
    "importância na carreira do artista e na música da época; (2) um panorama do artista; e " +
    "(3) quando souber, comentários FAIXA A FAIXA, destacando as principais músicas. Seja " +
    'informativo e específico deste álbum. "" só se realmente não conhecer o disco.\n\n' +
    (hint
      ? "A dica_do_colecionador vem de quem tem o disco em mãos: dê PRIORIDADE a ela sobre os " +
        "demais campos e sobre a capa, e use-a para achar o álbum certo.\n"
      : "") +
    (input.image
      ? "Identifique o disco PELA CAPA (imagem anexada).\n"
      : "Use os campos atuais só como pista — corrija se estiverem errados.\n") +
    "Disco:\n" +
    JSON.stringify(info) +
    "\n\nResponda só com o objeto JSON."
  );
}

/** Requisição NEUTRA (só texto) para identificar+descrever UM disco da coleção. */
function buildCollectionRequest(input: CollectionIdentInput): AiRequest {
  return {
    system: input.image ? COLLECTION_IDENT_IMAGE_SYSTEM_PROMPT : COLLECTION_IDENT_SYSTEM_PROMPT,
    // Descritivo longo (momento histórico + panorama + faixa a faixa) precisa de folga para o
    // JSON COMPLETAR — 2000 truncava e o Gemini (modo JSON) devolvia vazio no `MAX_TOKENS`.
    maxTokens: 4096,
    text: buildCollectionIdentPrompt(input),
    image: input.image ?? null,
    json: true,
  };
}

/** Extrai {album, year, confidence, description} do texto devolvido. Null se nada aproveitável. */
function parseCollectionIdentObject(text: string): Omit<CollectionIdentResult, "id"> | null {
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
  const description =
    typeof obj["description"] === "string" && obj["description"].trim()
      ? obj["description"].trim().slice(0, 6000)
      : null;
  const tags = Array.isArray(obj["tags"])
    ? [
        ...new Set(
          obj["tags"]
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 40))
            .filter(Boolean),
        ),
      ].slice(0, 8)
    : [];
  if (
    album === null &&
    year === null &&
    confidence === null &&
    description === null &&
    tags.length === 0
  ) {
    return null;
  }
  return { album, year, confidence, description, tags };
}

/**
 * Identificação + descrição SÍNCRONA (só texto) de um conjunto pequeno de discos da coleção.
 * Roda no `provider` pedido, com **failover** por quota. Best-effort POR DISCO; **não**
 * persiste (o chamador grava). Retorna só os discos que a IA de fato aproveitou (com álbum
 * OU descrição), além de `served`/`switched` (para a UI avisar sobre a troca de provedor).
 */
export async function identCollectionSync(
  inputs: CollectionIdentInput[],
  provider: AiProvider,
): Promise<SyncOutcome<CollectionIdentResult>> {
  if (!inputs.length)
    return { rows: [], served: null, switched: false, failed: 0, error: null, attemptErrors: {} };
  const geminiModel = await resolveGeminiModel();
  const rows: CollectionIdentResult[] = [];
  const tracker = new ProviderTracker();
  let failed = 0;
  let firstError: string | null = null;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      if (!input) return;
      try {
        const r = await runText(buildCollectionRequest(input), provider, geminiModel);
        tracker.note(r.provider, r.switched, r.attemptErrors);
        const parsed = parseCollectionIdentObject(r.text);
        if (parsed) rows.push({ id: input.id, ...parsed });
      } catch (error) {
        failed += 1;
        if (!firstError) firstError = (error as Error)?.message || String(error);
        console.error(`[ai-eval] falha ao identificar/descrever o disco ${input.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, inputs.length) }, () => worker()),
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
// Fallback de IA para o ESTADO de conservação (Disco/Capa/encarte) — usado quando o regex
// puro (`grading.ts:parseConditionFromText`) não encontra NADA no texto, mas há descritivo.
// Alimenta tanto os cards PRÉ-leilão (`lot_condition`) quanto o histórico de vendas
// (`lot_sales`/Analytics). Só texto (sem imagem — o estado é uma informação DESCRITA, não
// visual) e barato (poucas dezenas de tokens de saída).
// ---------------------------------------------------------------------------
