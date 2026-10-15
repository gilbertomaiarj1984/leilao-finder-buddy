/**
 * Perfil do colecionador (v0.149.0) = «De olho» + «Meus interesses». Módulo PURO (client-safe).
 *
 * Os interesses efetivos são a lista que o usuário escreve à mão MAIS os artistas dos discos que
 * ele está de olho (itens ativos): quem entra no De olho passa a contar como interesse sem
 * precisar digitar de novo, e a edição manual continua valendo como sempre.
 */
import {
  buildLotIdentity,
  LOOKOUT_CONFIDENT_MIN,
  lookoutCandidates,
  lookoutLabel,
  matchLookoutForLot,
  type LookoutCandidate,
  type LookoutItem,
  type LookoutLinks,
} from "./lookout-match";
import { buildInterestMatcher } from "./lot-score";
import {
  COMPILATION_LABEL,
  LOTE_LABEL,
  normalizeForMatch,
  UNCLASSIFIED_LABEL,
} from "./vinyl-parse";
import {
  OWNED_CONFIDENT_MIN,
  ownedCandidate,
  ownedMatchForLot,
  resolveArtistAlias,
} from "./wantlist-match";

type LookoutArtistsSource = {
  artist: string;
  status: string;
  merged?: readonly { artist: string }[];
};

const GENERIC = new Set([LOTE_LABEL, COMPILATION_LABEL, UNCLASSIFIED_LABEL].map(normalizeForMatch));

/** Artistas (sem repetição, na grafia do primeiro item) dos discos de olho ATIVOS. */
export function lookoutArtists(items: readonly LookoutArtistsSource[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (it.status !== "active") continue;
    for (const name of [it.artist, ...(it.merged ?? []).map((m) => m.artist)]) {
      const key = normalizeForMatch(name);
      if (key.length < 3 || GENERIC.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(name.trim());
    }
  }
  return out;
}

type CollectorInterests = {
  /** O que o usuário escreveu (editável). */
  manual: string[];
  /** Artistas vindos do De olho que ainda não estão na lista manual (somente leitura). */
  derived: string[];
  /** manual + derived — o que o casamento usa. */
  all: string[];
};

export function collectorInterests(
  manual: readonly string[],
  lookout: readonly LookoutArtistsSource[],
): CollectorInterests {
  const manualClean = manual.map((s) => s.trim()).filter(Boolean);
  const have = new Set(manualClean.map(normalizeForMatch));
  const derived = lookoutArtists(lookout).filter((a) => !have.has(normalizeForMatch(a)));
  return { manual: manualClean, derived, all: [...manualClean, ...derived] };
}

/** Teste «combina com meus interesses» já sobre a lista efetiva (manual + De olho). */
export function buildCollectorMatcher(
  manual: readonly string[],
  lookout: readonly LookoutArtistsSource[],
): (text: string) => boolean {
  return buildInterestMatcher(collectorInterests(manual, lookout).all);
}

type OwnedCandidate = ReturnType<typeof ownedCandidate>;

/**
 * Candidatos de casamento a partir da Coleção (`ownedCandidate` separa tokens de artista e álbum
 * para dosar a confiança). Ignora buckets ruidosos (Lote/Coletâneas/Não classificados) e artista
 * vazio, que gerariam tokens fracos e falsos positivos. Usado pela home e pela IA.
 */
export function buildOwnedCandidates(
  collection: readonly { id: string; artist: string; album: string; year: number | null }[],
  aliases?: Readonly<Record<string, string>>,
): OwnedCandidate[] {
  return collection
    .filter(
      (it) =>
        it.artist &&
        it.artist !== LOTE_LABEL &&
        it.artist !== COMPILATION_LABEL &&
        it.artist !== UNCLASSIFIED_LABEL,
    )
    .map((it) =>
      ownedCandidate({
        id: it.id,
        artist: resolveArtistAlias(it.artist, aliases),
        album: it.album,
        year: it.year,
      }),
    );
}

/** O que a IA recebe sobre a relação do colecionador com UM lote (só o resultado do casamento). */
export type CollectorProfile = {
  /** O artista/álbum do lote combina com «Meus interesses» (manual ou vindo do De olho). */
  interesse: boolean;
  /** O lote é um disco que o colecionador está de olho (ou o próprio lote que ele marcou). */
  deOlho: { label: string; teto: number | null; confirmado: boolean } | null;
  /** Disco da Coleção que parece ser este mesmo (casamento automático e confiante). */
  jaTenho: string | null;
};

/** Tudo o que o casamento do perfil precisa, montado uma vez por lote de lotes. */
export type ProfileContext = {
  matchesInterest: (text: string) => boolean;
  lookoutCands: readonly LookoutCandidate[];
  lookoutById: ReadonlyMap<string, LookoutItem>;
  lookoutLinks: LookoutLinks;
  ownedCands: readonly OwnedCandidate[];
  ownedDenylist: ReadonlySet<string>;
  artistAliases: Readonly<Record<string, string>>;
};

export function buildProfileContext(input: {
  interests: readonly string[];
  lookout: readonly LookoutItem[];
  lookoutLinks: LookoutLinks;
  collection: readonly { id: string; artist: string; album: string; year: number | null }[];
  ownedDenylist: readonly string[];
  artistAliases?: Readonly<Record<string, string>>;
}): ProfileContext {
  const aliases = input.artistAliases ?? {};
  return {
    matchesInterest: buildCollectorMatcher(input.interests, input.lookout),
    lookoutCands: lookoutCandidates(input.lookout, aliases),
    lookoutById: new Map(input.lookout.map((i) => [i.id, i])),
    lookoutLinks: input.lookoutLinks,
    ownedCands: buildOwnedCandidates(input.collection, aliases),
    ownedDenylist: new Set(input.ownedDenylist),
    artistAliases: aliases,
  };
}

/** Perfil do colecionador para um lote; `null` quando nada se aplica (nada vai ao prompt). */
export function profileForLot(
  pc: ProfileContext,
  lot: {
    id: string;
    title: string;
    artist: string;
    album?: string | null;
    marketTitle?: string | null;
    marketYear?: number | null;
  },
): CollectorProfile | null {
  const identity = buildLotIdentity({
    title: lot.title,
    artist: lot.artist,
    album: lot.album ?? null,
    marketTitle: lot.marketTitle ?? null,
    marketYear: lot.marketYear ?? null,
    aliases: pc.artistAliases,
  });
  const interesse = pc.matchesInterest(`${lot.title} ${lot.album ?? ""}`);

  let deOlho: CollectorProfile["deOlho"] = null;
  if (pc.lookoutCands.length) {
    // `includeOrigin`: o lote que o próprio usuário marcou também conta como «de olho».
    const hit = matchLookoutForLot(pc.lookoutCands, lot.id, identity, pc.lookoutLinks, {
      includeOrigin: true,
    });
    if (hit && (hit.confirmed || hit.score >= LOOKOUT_CONFIDENT_MIN)) {
      const item = pc.lookoutById.get(hit.itemId);
      deOlho = {
        label: item ? lookoutLabel(item) : hit.label,
        teto: item?.maxPrice ?? null,
        confirmado: hit.confirmed,
      };
    }
  }

  let jaTenho: string | null = null;
  if (pc.ownedCands.length) {
    const owned = ownedMatchForLot([...pc.ownedCands], identity, pc.ownedDenylist);
    if (owned && owned.score >= OWNED_CONFIDENT_MIN) jaTenho = owned.label;
  }

  return interesse || deOlho || jaTenho ? { interesse, deOlho, jaTenho } : null;
}
