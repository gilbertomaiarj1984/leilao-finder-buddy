// Calibração dos limiares do casamento "já tenho na Coleção" (`OWNED_MATCH_MIN`,
// `OWNED_CONFIDENT_MIN` em `src/lib/wantlist-match.ts`) usando o `collection_feedback` que o
// usuário já acumulou — em vez de manter os limiares "no chute", mede precisão/recall real
// nos casos que o próprio usuário já corrigiu (confirmou = deveria casar; "não tenho" = NÃO
// deveria casar) e sugere onde cortar.
//
// Roda uma vez, manualmente, com `DATABASE_URL` no ambiente (o `.env` da raiz já serve, o Bun
// carrega automaticamente): `bun run scripts/calibrate-collection-thresholds.ts`.
//
// ⚠️ Aproximação: reconstrói a identidade do lote a partir de `lots`/`lot_ident`/`lot_market`
// tal como estavam a última vez que a varredura passou por ali — NÃO reproduz 100% a lógica de
// `identityById` da home (que também resolve `parseAiAlbum`/`titleCase`/apelidos do Analytics
// no artista); serve para calibrar a FORMA da curva de score, não para replicar bit-a-bit o
// casamento em produção. Lotes já removidos da base (`lots` não guarda o que nunca varreu, mas
// pode não ter mais um lote muito antigo se ele foi excluído manualmente) ficam de fora — o
// script avisa quantos feedbacks não puderam ser recalculados.

import { getSql } from "../src/lib/db.server";
import { getAllCollection } from "../src/lib/collection.server";
import { getCollectionFeedback } from "../src/lib/app-state.server";
import { lotIdentity, ownedCandidate, ownedScore } from "../src/lib/wantlist-match";

const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

async function main() {
  const sql = getSql();
  const [feedback, collection] = await Promise.all([getCollectionFeedback(), getAllCollection()]);
  if (!feedback.length) {
    console.log(
      "Sem `collection_feedback` ainda — confirme/negue alguns casamentos na home antes de calibrar.",
    );
    return;
  }

  const collById = new Map(collection.map((it) => [it.id, it]));
  const lotIds = [...new Set(feedback.map((f) => f.lotId))];

  const lots = await sql<{ id: string; title: string; artist: string }[]>`
    select id, title, artist from lots where id in ${sql(lotIds)}
  `;
  const idents = await sql<{ id: string; album: string | null }[]>`
    select id, album from lot_ident where id in ${sql(lotIds)}
  `;
  const markets = await sql<{ id: string; release_title: string | null; year: number | null }[]>`
    select id, release_title, year from lot_market where id in ${sql(lotIds)}
  `;
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const identById = new Map(idents.map((i) => [i.id, i]));
  const marketById = new Map(markets.map((m) => [m.id, m]));

  type Sample = { score: number; label: 0 | 1; lotId: string; itemId: string };
  const samples: Sample[] = [];
  let skipped = 0;

  for (const fb of feedback) {
    const item = collById.get(fb.itemId);
    const lot = lotById.get(fb.lotId);
    if (!item || !lot) {
      skipped++;
      continue;
    }
    const ident = identById.get(fb.lotId);
    const market = marketById.get(fb.lotId);
    const identity = lotIdentity({
      title: lot.title,
      artist: lot.artist,
      album: ident?.album ?? null,
      marketTitle: market?.release_title ?? null,
      marketYear: market?.year ?? null,
    });
    const cand = ownedCandidate({
      id: item.id,
      artist: item.artist,
      album: item.album,
      year: item.year,
    });
    const score = ownedScore(cand, identity);
    samples.push({
      score,
      label: fb.verdict === "pos" ? 1 : 0,
      lotId: fb.lotId,
      itemId: fb.itemId,
    });
  }

  console.log(
    `${samples.length} amostras (${samples.filter((s) => s.label === 1).length} confirmadas / ` +
      `${samples.filter((s) => s.label === 0).length} negadas)` +
      (skipped ? `, ${skipped} ignoradas (lote não está mais em \`lots\`)` : ""),
  );
  if (!samples.length) return;

  console.log("\ncutoff | precisão | recall | TP | FP | FN | TN");
  for (const cutoff of THRESHOLDS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const s of samples) {
      const predicted = s.score >= cutoff ? 1 : 0;
      if (predicted === 1 && s.label === 1) tp++;
      else if (predicted === 1 && s.label === 0) fp++;
      else if (predicted === 0 && s.label === 1) fn++;
      else tn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : null;
    const recall = tp + fn ? tp / (tp + fn) : null;
    console.log(
      `${cutoff.toFixed(2)}  | ${precision == null ? "  -   " : (precision * 100).toFixed(0).padStart(3) + "%"}    | ` +
        `${recall == null ? "  -   " : (recall * 100).toFixed(0).padStart(3) + "%"}   | ` +
        `${tp} | ${fp} | ${fn} | ${tn}`,
    );
  }
  console.log(
    "\nLimiares atuais: OWNED_MATCH_MIN=0.60 (mostra “?”), OWNED_CONFIDENT_MIN=0.80 (confiante).",
  );
  console.log(
    "Falso positivo (FP) pesa mais que falso negativo (FN) aqui — o app prioriza precisão. " +
      "Suba OWNED_MATCH_MIN/CONFIDENT_MIN até a linha em que FP chega perto de 0, sem derrubar " +
      "TP a zero.",
  );

  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
