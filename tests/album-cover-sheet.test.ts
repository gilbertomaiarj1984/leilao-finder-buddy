import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "covers-"));
  process.env["COLLECTION_DIR"] = dir;
  delete process.env["PUBLIC_BASE_URL"];
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("monta a folha com capas existentes e ignora as que faltam", async () => {
  const sharp = (await import("sharp")).default;
  const { uploadCollectionFile } = await import("@/lib/collection-storage.server");
  const { buildCoverSheet } = await import("@/lib/album-cover-sheet.server");
  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  const { publicUrl } = await uploadCollectionFile("sales/a.webp", png);
  const sheet = await buildCoverSheet([
    { image: publicUrl },
    { image: null },
    { image: "/x/y.webp" },
  ]);
  expect(sheet?.startsWith("data:image/jpeg;base64,")).toBe(true);
});

test("sem nenhuma capa legível devolve null (vai só texto)", async () => {
  const { buildCoverSheet } = await import("@/lib/album-cover-sheet.server");
  expect(
    await buildCoverSheet([{ image: null }, { image: "/collection/sales/nao-existe.webp" }]),
  ).toBeNull();
});
