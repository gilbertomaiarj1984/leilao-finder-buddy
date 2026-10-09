import { parseAiAlbum } from "@/components/vinyl/ai-score-utils";
import {
  COMPILATION_LABEL,
  normalizeForMatch,
  isDiscBundle,
  LOTE_LABEL,
  titleCase,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";
import {
  lotIdentity,
  OWNED_CONFIDENT_MIN,
  ownedArtistLevel,
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
  /** Palavras/frases extras do usuário: lote do mesmo artista que as contém casa com o item. */
  terms?: string[];
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

/** Frases extras normalizadas (minúsculas, sem acento), sem vazias nem repetidas. */
function normTerms(terms: readonly string[] | undefined): string[] {
  return [...new Set((terms ?? []).map((t) => normalizeForMatch(t)).filter(Boolean))];
}

/**
 * Casamento por PALAVRAS do usuário: o lote é do artista do candidato (confirmado ou citado no
 * título) E o texto dele contém alguma frase extra inteira (ex.: "1971"). 0 = não casa.
 */
function termScore(item: LookoutItem, cand: OwnedCand, id: LotIdentity): number {
  const terms = normTerms(item.terms);
  if (!terms.length) return 0;
  const level = ownedArtistLevel(cand, id);
  if (level === "none") return 0;
  const text = ` ${id.text} `;
  if (!terms.some((t) => text.includes(` ${t} `))) return 0;
  return level === "confirmed" ? 0.92 : 0.8;
}

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

/** Chave "palavras normalizadas" de um texto (para comparar artista/álbum entre itens). */
function words(text: string): string[] {
  return normalizeForMatch(text).split(" ").filter(Boolean);
}

/**
 * Itens de olho ATIVOS do MESMO artista que PODEM ser o mesmo disco do lote que o usuário vai
 * marcar — para perguntar "criar novo ou inserir no existente?" só quando há dúvida. Não inclui o
 * idêntico (mesmo artista+álbum: o servidor reaproveita sozinho). Há dúvida quando falta o álbum
 * (de um lado), os nomes compartilham palavra distintiva ou um contém o outro, ou o ano é o mesmo.
 */
export function similarLookoutItems(
  items: readonly LookoutItem[],
  input: { artist: string; album: string; year: number | null; lotId: string },
): LookoutItem[] {
  const artistKey = words(input.artist).join(" ");
  if (
    !artistKey ||
    [LOTE_LABEL, COMPILATION_LABEL, UNCLASSIFIED_LABEL].includes(input.artist.trim())
  ) {
    return [];
  }
  const albumWords = words(input.album);
  const albumKey = albumWords.join(" ");
  const out: LookoutItem[] = [];
  for (const it of items) {
    if (it.status !== "active") continue;
    if (words(it.artist).join(" ") !== artistKey) continue;
    const known = [it, ...(it.merged ?? [])];
    if (known.some((k) => k.lotId === input.lotId)) continue;
    if (known.some((k) => words(k.album).join(" ") === albumKey && albumKey)) continue; // idêntico
    const doubt = known.some((k) => {
      const kw = words(k.album);
      if (!kw.length || !albumWords.length) return true;
      const a = kw.join(" ");
      if (a.includes(albumKey) || albumKey.includes(a)) return true;
      if (kw.some((w) => w.length >= 3 && albumWords.includes(w))) return true;
      return input.year != null && k.year === input.year;
    });
    if (doubt) out.push(it);
  }
  return out;
}

/**
 * Grupos de artistas juntados na página `/olho` (arrastar um artista sobre outro): chave = nome
 * normalizado do artista absorvido; `to` = nome que PERMANECE (o que recebeu); `label` = nome
 * original, para exibir/desfazer. Só agrupa a exibição — o casamento segue com o artista de cada item.
 */
export type LookoutArtistGroups = Record<string, { to: string; label: string }>;

/** Chave do artista (sem acento/pontuação/caixa) — a mesma do servidor (`lookout.server.ts`). */
function lookoutArtistKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Nome FINAL do artista após seguir as junções (com guarda contra ciclos). */
export function resolveLookoutArtist(name: string, groups?: LookoutArtistGroups): string {
  let current = name;
  for (let i = 0; i < 10 && groups; i++) {
    const next = groups[lookoutArtistKey(current)];
    if (!next || lookoutArtistKey(next.to) === lookoutArtistKey(current)) break;
    current = next.to;
  }
  return current;
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
    const byTerm = termScore(item, cand, identity);
    let score = Math.max(ownedScore(cand, identity), byTerm);
    if (score < LOOKOUT_MATCH_MIN) continue;
    // Disco de nome genérico: só o ano distingue. Outro ano → não é este disco; sem ano → "a
    // validar" (score limitado, nunca avisa nem conta como confirmado).
    let yearPending = false;
    if (opts?.yearGate !== false && !byTerm) {
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

/** Disco da Coleção que corresponde a um item de olho (o usuário já possui). */
export type LookoutOwnedHit = {
  itemId: string;
  owned: { id: string; artist: string; album: string; year: number | null };
  score: number;
  /** score ≥ `LOOKOUT_CONFIDENT_MIN`: vem pré-marcado na confirmação. */
  confident: boolean;
};

/**
 * Itens de olho ATIVOS cujo disco (ou um álbum juntado) já está na Coleção. Reusa o mesmo motor
 * do casamento de lotes: cada disco da Coleção vira uma "identidade de lote" (artista + álbum +
 * ano) e é pontuado contra o candidato do item. Melhor disco da Coleção por item; score ≥
 * `LOOKOUT_MATCH_MIN`.
 */
export function lookoutOwnedInCollection(
  items: readonly LookoutItem[],
  collection: readonly { id: string; artist: string; album: string; year: number | null }[],
  aliases?: Readonly<Record<string, string>>,
): LookoutOwnedHit[] {
  const cands = lookoutCandidates(items, aliases);
  const owned = collection
    .filter((c) => c.artist.trim() && c.album.trim())
    .map((c) => ({
      c,
      identity: buildLotIdentity({
        title: `${c.artist} ${c.album}`,
        artist: c.artist,
        album: `${c.artist} - ${c.album}`,
        knownYear: c.year,
        aliases,
      }),
    }));
  const best = new Map<string, LookoutOwnedHit>();
  for (const { item, cand } of cands) {
    for (const { c, identity } of owned) {
      const score = ownedScore(cand, identity);
      if (score < LOOKOUT_MATCH_MIN) continue;
      const prev = best.get(item.id);
      if (prev && prev.score >= score) continue;
      best.set(item.id, {
        itemId: item.id,
        owned: { id: c.id, artist: c.artist, album: c.album, year: c.year },
        score,
        confident: score >= LOOKOUT_CONFIDENT_MIN,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
