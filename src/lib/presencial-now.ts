/**
 * Lote em pregão AGORA no presencial (`presencial.asp`) de uma casa da plataforma LeilõesBR.
 * Puro (sem I/O) — o fetch fica em `leiloesbr-presencial.server.ts`.
 *
 * O `presencial.asp` chega com o lote VAZIO (`<span class="is-lotenumber">--</span>`): quem
 * preenche é o JS da página (`novoPresencial.LePregao`), consultando um endpoint de polling
 * comum da plataforma com `?i=<idleilao>&j=<idsite>&p=<idPeça atual ou vazio>`. A resposta é
 * `<LANCES json>*|*<INFOLEILAO json>*|*<flag>[*|*<PROXIMOS_LOTES json>]`; o `INFOLEILAO` traz
 * `LOTE` (nº do lote), `QTD_ATUAL` (peça nº) e `QTD_LOTES` (total) — a barra "Peça nº 135 de
 * 322 - 41%" do site é `QTD_ATUAL/QTD_LOTES` arredondado para baixo.
 */

export type PresencialNow = {
  lote: string;
  peca: number | null;
  total: number | null;
  pct: number | null;
};

/** `idleilao`/`idsite` do script inline do `presencial.asp` (`UpdatePresencialArr`). */
export function parsePresencialIds(html: string): { idleilao: string; idsite: string } | null {
  const idleilao = /\bidleilao\s*:\s*["'](\d+)["']/i.exec(html)?.[1];
  const idsite = /\bidsite\s*:\s*["'](\d+)["']/i.exec(html)?.[1];
  return idleilao && idsite ? { idleilao, idsite } : null;
}

function toInt(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resposta do endpoint de polling → lote/peça/total/percentual. `null` quando não há pregão
 * (`np`/`invalido`, vazio) ou o formato não bate.
 */
export function parsePregaoResponse(text: string): PresencialNow | null {
  const parts = text.split("*|*");
  if (parts.length < 2) return null;
  let info: Record<string, unknown> | undefined;
  try {
    info = (JSON.parse(parts[1]!) as { INFOLEILAO?: Record<string, unknown> }).INFOLEILAO;
  } catch {
    return null;
  }
  const lote = String(info?.["LOTE"] ?? "").trim();
  if (!info || !lote) return null;
  const peca = toInt(info["QTD_ATUAL"]);
  const total = toInt(info["QTD_LOTES"]);
  const pct = peca && total ? Math.min(100, Math.floor((peca / total) * 100)) : null;
  return { lote, peca, total, pct };
}
