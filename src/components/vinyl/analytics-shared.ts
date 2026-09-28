// Tipos e helpers compartilhados pelos componentes do Vinil Analytics.

import { fmtMoney } from "@/components/vinyl/ai-score-utils";
import { type AlbumAgg, type ArtistAgg, type SaleRow } from "@/lib/analytics";
import { type Condition, EMPTY_CONDITION, normalizeGrade, scoreCondition } from "@/lib/grading";

// Componente COMPARTILHADO entre a página autenticada (`/vinil-analytics`, com curadoria/IA) e a
// pública somente-leitura (`/vinil-analytics-publico`, link com token diário — ver
// `access.server.ts`/`leiloesbr.functions.ts`). `readOnly=true` esconde TODO controle de
// mutação (editar/fundir artista ou álbum, corrigir/excluir venda, excluir artista,
// reidentificar por IA, seletor de provedor/modelo de IA) — só ordenação/filtro/expansão
// continuam ativos. `handlers`/`ai` são omitidos no modo público (só existem no modo editável).
export const money = (n: number | null) => fmtMoney(n, "BRL");

/** Custo real = valor de venda + comissão do leiloeiro (quando a taxa é conhecida). */
export function netCost(s: SaleRow): number | null {
  if (s.sold_price == null || s.fee_pct == null) return null;
  return Math.round(s.sold_price * (1 + s.fee_pct / 100));
}

export function feeTip(s: SaleRow): string {
  return s.fee_pct != null ? `Taxa do leiloeiro: ${s.fee_pct}%` : "Taxa do leiloeiro desconhecida";
}

/** Ágio/desconto do valor de venda sobre o valor inicial. */
export function discountTip(s: SaleRow): string {
  if (s.initial_price == null || !s.initial_price || s.sold_price == null) return "Valor inicial";
  const pct = Math.round(((s.sold_price - s.initial_price) / s.initial_price) * 100);
  return `Valor inicial ${money(s.initial_price)} → venda ${money(s.sold_price)} (${
    pct >= 0 ? "+" : ""
  }${pct}%)`;
}

/** Rótulo compacto de demanda: "👁 26 · 🔨 3" (só o que houver). */
export function demandLabel(s: SaleRow): string {
  const parts: string[] = [];
  if (s.views != null) parts.push(`👁 ${s.views}`);
  if (s.bids != null) parts.push(`🔨 ${s.bids}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Reconstrói o estado (Disco/Capa/Score/Faixa/encarte) de uma venda para os badges (mesma
 *  regra de espelhamento do resto do app, via `scoreCondition`). */
export function conditionFromSale(s: SaleRow): Condition {
  const g = scoreCondition(normalizeGrade(s.media), normalizeGrade(s.sleeve));
  return {
    ...EMPTY_CONDITION,
    media: g.media,
    sleeve: g.sleeve,
    score: g.score,
    faixa: g.faixa,
    insert: s.insert_state === "sim" ? "sim" : s.insert_state === "nao" ? "nao" : null,
  };
}

export type ArtistSort = "count" | "alpha";

export type AlbumSort = "count" | "alpha";

// `albumsByArtist`: álbuns já vistos, por CHAVE normalizada do artista — a caixa de correção por
// venda usa isso para só oferecer álbuns DAQUELE artista (artista é a chave principal; o álbum
// só faz sentido dentro do universo dele).
export type Suggestions = {
  artists: string[];
  albums: string[];
  albumsByArtist: Map<string, string[]>;
};

export type ApplySaleOverride = (
  lotId: string,
  value: { artist: string; album: string } | null,
) => void;

// Drag-and-drop de venda entre álbuns do MESMO artista (organização mais rápida que abrir o
// diálogo de correção toda vez). Tipo MIME próprio no `dataTransfer` — só `AlbumRow` reage a ele
// (`types.includes(...)`), então arrastar um card não interfere em nenhum outro drop nativo da
// página. Payload carrega o artista/álbum de ORIGEM: o alvo confere o artista (nunca move entre
// artistas diferentes, mesmo que o DOM permita o drop) e ignora o drop se já é o álbum atual.
// Desativado inteiramente em `readOnly` (é uma mutação).
export const SALE_DRAG_TYPE = "application/x-vinyl-sale";

export type SaleDragPayload = { lotId: string; artist: string; album: string };

export type ReidentGroup = (lotIds: string[]) => Promise<void>;

// Roda a IA em CADA álbum de um artista, um de cada vez (mesma chamada por grupo que o botão de
// UM álbum já faz) — poupa o usuário de abrir álbum por álbum manualmente.
export type ReidentAllAlbums = (albums: AlbumAgg[]) => Promise<void>;

export type ExcludeSale = (sale: SaleRow, label: string) => void;

export type ExcludeArtist = (artist: ArtistAgg) => void;
