// Backfill: recomprime (redimensiona + recodifica em WEBP) as fotos da coleção já enviadas antes
// da compressão automática existir, para reduzir o egress do Supabase Storage.
//
// Roda uma vez, manualmente (fora do cron): `bun run scripts/compress-collection-images.ts`
// Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (o `.env` da raiz já serve,
// o Bun carrega automaticamente).
//
// Idempotente: só processa imagens do bucket `collection` que ainda não são `.webp` (a saída da
// compressão sempre é `.webp`), então rodar de novo não recomprime o que já foi convertido.

import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { compressCollectionImage } from "../src/lib/collection.server";

const IMAGE_BUCKET = "collection";

function publicUrlPrefix(): string {
  const { data } = supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl("");
  return data.publicUrl;
}

async function main() {
  const prefix = publicUrlPrefix();
  console.log(`[backfill] bucket público: ${prefix}`);

  const { data: rows, error } = await supabaseAdmin
    .from("collection_items")
    .select("id, image")
    .not("image", "is", null);
  if (error) throw new Error(`Falha ao listar collection_items: ${error.message}`);

  const targets = (rows ?? []).filter(
    (r): r is { id: string; image: string } =>
      !!r.image && r.image.startsWith(prefix) && !r.image.toLowerCase().endsWith(".webp"),
  );
  console.log(
    `[backfill] ${targets.length} imagem(ns) para recomprimir (de ${rows?.length ?? 0} itens)`,
  );

  let originalTotal = 0;
  let compressedTotal = 0;
  let ok = 0;
  let failed = 0;

  for (const row of targets) {
    const oldPath = row.image.slice(prefix.length);
    try {
      const res = await fetch(row.image);
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const rawBytes = Buffer.from(await res.arrayBuffer());

      const compressed = await compressCollectionImage(rawBytes);
      const newPath = `${crypto.randomUUID()}.${compressed.ext}`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(IMAGE_BUCKET)
        .upload(newPath, compressed.bytes, {
          contentType: compressed.contentType,
          upsert: false,
          cacheControl: "604800",
        });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      const { data: pub } = supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(newPath);
      const { error: dbErr } = await supabaseAdmin
        .from("collection_items")
        .update({ image: pub.publicUrl })
        .eq("id", row.id);
      if (dbErr) throw new Error(`update DB: ${dbErr.message}`);

      // Só remove o arquivo antigo depois que a linha já aponta para o novo.
      await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([oldPath]);

      originalTotal += rawBytes.length;
      compressedTotal += compressed.bytes.length;
      ok++;
      console.log(
        `[backfill] ok  ${row.id}  ${(rawBytes.length / 1024).toFixed(0)}KB -> ${(compressed.bytes.length / 1024).toFixed(0)}KB`,
      );
    } catch (e) {
      failed++;
      console.error(
        `[backfill] falhou ${row.id} (${oldPath}):`,
        e instanceof Error ? e.message : e,
      );
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
