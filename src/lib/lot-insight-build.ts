/**
 * Peças PURAS do "o que o app sabe de cada lote" — um único lugar para a home
 * (`use-dashboard-data.tsx`) e a Análise (`use-lot-insights.ts`) montarem o estado (Disco/Capa),
 * a demanda do catálogo, a identidade do lote e a relação com a Coleção ("já tenho"). Antes cada
 * tela tinha a sua cópia.
 */
import { scoreCondition, type Condition, type Grade } from "./grading";
import type { LotEdition } from "./album-edition";
import { buildLotIdentity } from "./lookout-match";
import {
  ownedMatchForLot,
  type LotIdentity,
  type OwnedCandidate,
  type OwnedHit,
  type OwnedResolution,
} from "./wantlist-match";

type ConditionRow = {
  id: string;
  media?: string | null;
  sleeve?: string | null;
  insert_state?: string | null;
  views?: number | null;
  bids?: number | null;
};

/**
 * Estado por lote a partir de `lot_condition`. `scoreCondition` ESPELHA o lado desconhecido (padrão
 * do app) e o retorno dele (não os campos crus) é o que vale, para o badge refletir isso mesmo em
 * linhas antigas do cache. Linha sem Disco, Capa nem encarte é "indefinida" e não entra.
 */
export function conditionMap(rows: readonly ConditionRow[] | undefined): Map<string, Condition> {
  const map = new Map<string, Condition>();
  for (const r of rows ?? []) {
    const rawMedia = (r.media || null) as Grade | null;
    const rawSleeve = (r.sleeve || null) as Grade | null;
    const { media, sleeve, score, faixa } = scoreCondition(rawMedia, rawSleeve);
    const insert = r.insert_state === "sim" ? "sim" : r.insert_state === "nao" ? "nao" : null;
    if (!media && !sleeve && insert === null) continue;
    map.set(r.id, { media, sleeve, insert, score, faixa, source: "regex", raw: "" });
  }
  return map;
}

/** Demanda do catálogo (visitas e lances) por lote, da mesma tabela `lot_condition`. */
export function demandMap(
  rows: readonly ConditionRow[] | undefined,
): Map<string, { views: number | null; bids: number | null }> {
  const map = new Map<string, { views: number | null; bids: number | null }>();
  for (const r of rows ?? []) {
    if (r.views == null && r.bids == null) continue;
    map.set(r.id, { views: r.views ?? null, bids: r.bids ?? null });
  }
  return map;
}

/**
 * Identidade de cada lote (título + artista efetivo + álbum da IA + release do Discogs), reusada
 * pelo De olho, pelo casamento com a Coleção e pelas assinaturas das decisões. Um lote
 * problemático nunca derruba a tela.
 */
export function lotIdentityMap(
  lots: readonly { id: string; title: string; artist: string }[],
  albumById: ReadonlyMap<string, string | null>,
  marketById: ReadonlyMap<
    string,
    { releaseTitle: string | null; year: number | null; masterId?: number | null }
  >,
  aliases: Readonly<Record<string, string>>,
  editions?: Readonly<Record<string, LotEdition>>,
): Map<string, LotIdentity> {
  const map = new Map<string, LotIdentity>();
  for (const lot of lots) {
    try {
      const market = marketById.get(lot.id);
      map.set(
        lot.id,
        buildLotIdentity({
          title: lot.title,
          artist: lot.artist,
          album: albumById.get(lot.id) ?? null,
          marketTitle: market?.releaseTitle ?? null,
          marketYear: market?.year ?? null,
          marketMasterId: market?.masterId ?? null,
          editionOverride: editions?.[lot.id] ?? null,
          aliases,
        }),
      );
    } catch {
      /* um lote problemático não derruba a tela */
    }
  }
  return map;
}

/**
 * Casamento AUTOMÁTICO cru com a Coleção (antes de vínculo manual e aprendizado): peça exata já
 * arrematada (score 1) ou o melhor candidato com confiança mínima.
 */
export function ownedAutoMap(input: {
  lots: readonly { id: string }[];
  ownedByLotId: ReadonlyMap<string, string>;
  ownedCands: readonly OwnedCandidate[];
  identityById: ReadonlyMap<string, LotIdentity>;
  denylist: ReadonlySet<string>;
  labelOf: (itemId: string) => string;
}): Map<string, OwnedHit> {
  const map = new Map<string, OwnedHit>();
  for (const lot of input.lots) {
    try {
      const exactId = input.ownedByLotId.get(lot.id);
      if (exactId) {
        map.set(lot.id, { id: exactId, label: input.labelOf(exactId), score: 1 });
        continue;
      }
      if (!input.ownedCands.length) continue;
      const identity = input.identityById.get(lot.id);
      if (!identity) continue;
      const best = ownedMatchForLot([...input.ownedCands], identity, input.denylist);
      if (best) map.set(lot.id, best);
    } catch {
      /* falha de casamento de um lote é ignorada */
    }
  }
  return map;
}

/**
 * `OwnedHit` efetivo de uma resolução (vínculo manual, automático ou sugerido); `null` = sem
 * relação (nenhuma ou rejeitada).
 */
export function ownedHitFromResolution(
  res: OwnedResolution,
  labelOf: (itemId: string) => string,
): OwnedHit | null {
  switch (res.kind) {
    case "linked":
      return { id: res.itemId, label: labelOf(res.itemId), score: 1 };
    case "auto":
      return res.hit;
    case "suggested":
      return { id: res.itemId, label: labelOf(res.itemId), score: res.score };
    default:
      return null;
  }
}
