// Backfill: recomprime (redimensiona + recodifica em WEBP) as fotos da coleção já enviadas antes
// da compressão automática existir.
//
// Roda uma vez, manualmente, DE UM AMBIENTE COM SAÍDA DE REDE PRO DOMÍNIO PÚBLICO DO APP
// (baixa cada foto por HTTP de `PUBLIC_BASE_URL` antes de recomprimir) — não funciona em
// sandboxes com allowlist de rede restrita; nesse caso use o step `compressimages` do
// `/api/cron`. Precisa de `DATABASE_URL` no ambiente (o `.env` da raiz já serve, o Bun
// carrega automaticamente).
//
// Compartilha a lógica com o step do cron (`listUncompressedCollectionImages` /
// `backfillCompressCollectionImage` em `collection.server.ts`). Idempotente: só processa
// imagens que ainda não são `.webp` (a saída da compressão sempre é `.webp`).

import {
  listUncompressedCollectionImages,
  backfillCompressCollectionImage,
} from "../src/lib/collection.server";

const BATCH_SIZE = 10;

async function main() {
  let originalTotal = 0;
  let compressedTotal = 0;
  let ok = 0;
  let failed = 0;
  // Evita loop infinito: uma foto que falha (ex.: URL morta) continua "não-webp" pra sempre,
  // então seria devolvida de novo pela query a cada rodada — filtramos as já tentadas.
  const failedIds = new Set<string>();

  for (;;) {
    const fetched = await listUncompressedCollectionImages(BATCH_SIZE + failedIds.size);
    const targets = fetched.filter((r) => !failedIds.has(r.id));
    if (!targets.length) break;

    for (const row of targets) {
      try {
        const r = await backfillCompressCollectionImage(row);
        originalTotal += r.originalBytes;
        compressedTotal += r.compressedBytes;
        ok++;
        console.log(
          `[backfill] ok  ${row.id}  ${(r.originalBytes / 1024).toFixed(0)}KB -> ${(r.compressedBytes / 1024).toFixed(0)}KB`,
        );
      } catch (e) {
        failed++;
        failedIds.add(row.id);
        console.error(`[backfill] falhou ${row.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(
    `[backfill] concluído: ${ok} ok, ${failed} falha(s). ${(originalTotal / 1024 / 1024).toFixed(2)}MB -> ${(compressedTotal / 1024 / 1024).toFixed(2)}MB` +
      (originalTotal > 0
        ? ` (-${(100 - (compressedTotal / originalTotal) * 100).toFixed(0)}%)`
        : ""),
  );
}

main().catch((e) => {
  console.error("[backfill] erro fatal:", e);
  process.exit(1);
});
