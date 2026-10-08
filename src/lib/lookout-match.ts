import { parseAiAlbum } from "@/components/vinyl/ai-score-utils";
import {
  COMPILATION_LABEL,
  isDiscBundle,
  LOTE_LABEL,
  titleCase,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";
import {
  lotIdentity,
  OWNED_CONFIDENT_MIN,
  ownedCandidate,
  ownedScore,
  resolveArtistAlias,
  type LotIdentity,
} from "@/lib/wantlist-match";

/**
 * "Ficar de olho": reconhece, nos lotes por vir, o MESMO disco (artista + álbum) que o usuário
 * marcou como compra muito em vista. Módulo puro/client-safe — usado no card da home, na página
 * `/olho` e no aviso do cron (`lookout-matches.server.ts`).
 *
 * Reusa o motor de casamento da Coleção (`ownedScore`, `wantlist-match.ts`): compara artista com
 * artista e álbum com álbum, por campo, com precisão em primeiro lugar. Aqui o "disco da
 * coleção" é o snapshot do item de olho.
 */

/** Álbum juntado a um item (mesmo disco com outro nome/edição): snapshot do lote de origem dele. */
export type LookoutMerged = {
  lotId: string;
  artist: string;
  album: string;
  year: number | null;
  title: string;
  house: string;
  image: string | null;
  url: string;
  dayKey: string;
};

/** Item de olho como a UI consome (espelha `lookout_items`). */
export type LookoutItem = {
  id: string;
  /** Lote de origem (`${idLeilao}-${idPeca}`) — nunca casa consigo mesmo. */
  lotId: string;
  artist: string;
  album: string;
  year: number | null;
  title: string;
  house: string;
  image: string | null;
  url: string;
  dayKey: string;
  /** Teto de preço (R$), opcional. */
  maxPrice: number | null;
  note: string;
  status: LookoutStatus;
  /** Álbuns juntados a este item — cada um também vira candidato do casamento. */
  merged?: LookoutMerged[];
};

export type LookoutStatus = "active" | "acquired" | "dismissed";

/**
 * Vínculos por lote: `false` = "não é este disco" (descartado); string = itemId confirmado
 * pelo usuário (casa mesmo abaixo do limiar). Ausente = vale o casamento automático.
 */
export type LookoutLinks = Record<string, string | false>;

/** Abaixo disto não marca; entre este e `LOOKOUT_CONFIDENT_MIN` aparece como "?" (incerto). */
const LOOKOUT_MATCH_MIN = 0.6;
/** Confiante: destaque normal e elegível a aviso externo. */
export const LOOKOUT_CONFIDENT_MIN = OWNED_CONFIDENT_MIN;
/** Teto do score quando o ano não permite validar um disco de nome genérico ("a validar"). */
const LOOKOUT_PENDING_SCORE = 0.7;

/** Resultado do casamento de um lote com um item de olho. */
export type LookoutHit = {
  itemId: string;
  /** "Artista Álbum" do item, para o tooltip. */
  label: string;
  score: number;
  /** Confirmado manualmente pelo usuário (score 1). */
  confirmed: boolean;
  /**
   * Disco de nome genérico (homônimo do artista, "Ao Vivo"…) cujo ANO não deu para validar:
   * fica "a validar" pelo usuário (score limitado a 0,7). Ver `yearVerdict`.
   */
  yearPending?: boolean;
  /** O lote é a ORIGEM do item (o que o usuário marcou) — só com `includeOrigin`. */
  isOrigin?: boolean;
};

type OwnedCand = ReturnType<typeof ownedCandidate>;
export type LookoutCandidate = { item: LookoutItem; cand: OwnedCand };

/**
 * Disco de nome GENÉRICO: o nome do álbum é o do próprio artista (homônimo — "Caetano Veloso —
 * Caetano Veloso") ou só tem termos genéricos ("Ao Vivo", "Seus Sucessos"). O artista costuma ter
 * VÁRIOS discos assim, então o nome sozinho não identifica: só o ANO distingue.
 */
function isGenericLookoutAlbum(c: Pick<OwnedCand, "selfTitled" | "albumTokens">): boolean {
  return c.selfTitled || c.albumTokens.length === 0;
}

/**
 * Validação por ANO para discos de nome genérico (v0.111.0):
 *  - não genérico → "ok" (o nome já distingue);
 *  - ano do item desconhecido, ou o lote/venda não informa ano → "pending" (usuário valida);
 *  - o lote informa o ano do item → "ok";
 *  - o lote informa outro(s) ano(s) e nenhum é o do item → "reject" (é outro disco do artista).
 */
type YearVerdict = "ok" | "pending" | "reject";
export function yearVerdict(
  item: Pick<LookoutItem, "year">,
  c: Pick<OwnedCand, "selfTitled" | "albumTokens">,
  years: ReadonlySet<number>,
): YearVerdict {
  if (!isGenericLookoutAlbum(c)) return "ok";
  if (item.year == null || years.size === 0) return "pending";
  return years.has(item.year) ? "ok" : "reject";
}

/** Rótulo curto do item ("Artista — Álbum (Ano)"). */
export function lookoutLabel(item: Pick<LookoutItem, "artist" | "album" | "year">): string {
  const base = [item.artist, item.album].filter((s) => s && s.trim()).join(" — ");
  return item.year ? `${base} (${item.year})` : base;
}

/**
 * Prepara os candidatos: só itens ativos com artista REAL e álbum (sem eles o casamento por
 * campo não tem como ter certeza — buckets "Lote"/"Coletâneas" geram falso positivo).
 */
export function lookoutCandidates(
  items: readonly LookoutItem[],
  aliases?: Readonly<Record<string, string>>,
): LookoutCandidate[] {
  const out: LookoutCandidate[] = [];
  for (const item of items) {
    if (item.status !== "active") continue;
    const artist = item.artist.trim();
    if (!artist || !item.album.trim()) continue;
    if (artist === LOTE_LABEL || artist === COMPILATION_LABEL || artist === UNCLASSIFIED_LABEL) {
      continue;
    }
    out.push({
      item,
      cand: ownedCandidate({
        id: item.id,
        artist: resolveArtistAlias(artist, aliases),
        album: item.album,
        year: item.year,
      }),
    });
    // Álbuns juntados: candidatos extras com o MESMO id do item (o resultado aponta para ele),
    // mas identidade e lote de origem próprios.
    for (const m of item.merged ?? []) {
      const mArtist = m.artist.trim();
      if (!mArtist || !m.album.trim()) continue;
      out.push({
        item: { ...item, lotId: m.lotId, artist: m.artist, album: m.album, year: m.year },
        cand: ownedCandidate({
          id: item.id,
          artist: resolveArtistAlias(mArtist, aliases),
          album: m.album,
          year: m.year,
        }),
      });
    }
  }
  return out;
}

/**
 * Identidade de um lote para o casamento — mesma regra da home (artista efetivo: "Lote" para
 * conjuntos, senão o artista da IA, senão o heurístico do título).
 */
export function buildLotIdentity(input: {
  title: string;
  artist: string;
  /** Álbum resolvido (`lot_ai.album ?? lot_ident.album`). */
  album?: string | null;
  marketTitle?: string | null;
  marketYear?: number | null;
  /** Ano já conhecido por outra fonte (ex.: `lot_ident.year`) — entra nos anos do lote. */
  knownYear?: number | null;
  aliases?: Readonly<Record<string, string>>;
}): LotIdentity {
  const parsed = parseAiAlbum(input.album ?? null).artist;
  const artist =
    isDiscBundle(input.title ?? "") || input.artist === LOTE_LABEL
      ? LOTE_LABEL
      : parsed
        ? titleCase(parsed)
        : input.artist;
  const identity = lotIdentity({
    title: input.title,
    artist: resolveArtistAlias(artist, input.aliases),
    album: input.album ?? null,
    marketTitle: input.marketTitle ?? null,
    marketYear: input.marketYear ?? null,
  });
  if (input.knownYear && input.knownYear > 0) identity.years.add(input.knownYear);
  return identity;
}

/**
 * Melhor item de olho para o lote, ou null. Ignora o próprio lote de origem do item, respeita o
 * vínculo manual do usuário (`links`: `false` = descartado; itemId = confirmado) e só considera
 * score ≥ `LOOKOUT_MATCH_MIN`.
 */
export function matchLookoutForLot(
  cands: readonly LookoutCandidate[],
  lotId: string,
  identity: LotIdentity,
  links?: LookoutLinks,
  opts?: { yearGate?: boolean; includeOrigin?: boolean },
): LookoutHit | null {
  const link = links?.[lotId];
  if (link === false) return null;
  if (typeof link === "string") {
    const forced = cands.find((c) => c.item.id === link);
    if (forced && (opts?.includeOrigin || forced.item.lotId !== lotId)) {
      return {
        itemId: forced.item.id,
        label: lookoutLabel(forced.item),
        score: 1,
        confirmed: true,
        isOrigin: forced.item.lotId === lotId,
      };
    }
  }
  let best: LookoutHit | null = null;
  for (const { item, cand } of cands) {
    const isOrigin = item.lotId === lotId;
    if (isOrigin && !opts?.includeOrigin) continue;
    if (isOrigin) {
      // O lote que o usuário marcou é, por definição, o próprio disco.
      return { itemId: item.id, label: lookoutLabel(item), score: 1, confirmed: true, isOrigin };
    }
    let score = ownedScore(cand, identity);
    if (score < LOOKOUT_MATCH_MIN) continue;
    // Disco de nome genérico: só o ano distingue. Outro ano → não é este disco; sem ano → "a
    // validar" (score limitado, nunca avisa nem conta como confirmado).
    let yearPending = false;
    if (opts?.yearGate !== false) {
      const verdict = yearVerdict(item, cand, identity.years);
      if (verdict === "reject") continue;
      if (verdict === "pending") {
        score = Math.min(score, LOOKOUT_PENDING_SCORE);
        yearPending = true;
      }
    }
    if (!best || score > best.score) {
      best = {
        itemId: item.id,
        label: lookoutLabel(item),
        score,
        confirmed: false,
        yearPending,
        isOrigin,
      };
    }
  }
  return best;
}

/** Um lote que casou, com o que a página/aviso precisam para exibir. */
export type LookoutMatch = {
  lotId: string;
  itemId: string;
  score: number;
  confirmed: boolean;
};

/**
 * Entre os `matches`, quais merecem AVISO externo: confiantes (≥ `LOOKOUT_CONFIDENT_MIN`, ou
 * confirmados) e ainda não avisados. Puro — o envio e a gravação do dedupe ficam no servidor.
 */
export function pickNotifiable(
  matches: readonly LookoutMatch[],
  notified: ReadonlySet<string>,
): LookoutMatch[] {
  return matches.filter(
    (m) => (m.confirmed || m.score >= LOOKOUT_CONFIDENT_MIN) && !notified.has(notifyKey(m)),
  );
}

/** Chave de dedupe do aviso: o mesmo lote pode avisar de novo se casar com OUTRO item. */
export function notifyKey(m: Pick<LookoutMatch, "lotId" | "itemId">): string {
  return `${m.lotId}|${m.itemId}`;
}

/** Teto de preço × valor atual do lote: "abaixo"/"acima" do teto, ou null sem teto/preço. */
export function priceVsCeiling(
  currentPrice: number | null,
  maxPrice: number | null,
): "under" | "over" | null {
  if (currentPrice == null || currentPrice <= 0 || maxPrice == null || maxPrice <= 0) return null;
  return currentPrice <= maxPrice ? "under" : "over";
}
