/**
 * Fase 3 da migração para VPS (docs/economia-fase-2-vps-unico.md): as fotos da
 * Coleção saem do bucket `collection` do Supabase Storage e passam a ser
 * arquivos num volume em disco (`COLLECTION_DIR`). Até a Fase 4 (Docker/Caddy)
 * entrar, `handleCollectionAssets` serve esses arquivos direto — mesmo padrão
 * de `handleCron`/`handleLiveProxy`/`handleGoogleAuth` em `server.ts`. Na
 * Fase 4 o Caddy assume esse papel na frente do Node, sem mudar este arquivo.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const PREFIX = "/collection/";
/** Cache no navegador (7 dias) — fotos da coleção não mudam depois de enviadas. */
const CACHE_CONTROL = "public, max-age=604800";
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

function collectionDir(): string {
  return path.resolve(process.env["COLLECTION_DIR"] || "./data/collection");
}

function publicBase(): string {
  const base = process.env["PUBLIC_BASE_URL"];
  return base ? `${base.replace(/\/$/, "")}${PREFIX}` : PREFIX;
}

/** `null` se `relPath` tentar escapar de `collectionDir()` (path traversal). */
function safeResolve(relPath: string): string | null {
  const dir = collectionDir();
  const target = path.resolve(dir, relPath);
  if (target !== dir && !target.startsWith(dir + path.sep)) return null;
  return target;
}

export async function uploadCollectionFile(
  relPath: string,
  bytes: Buffer,
): Promise<{ publicUrl: string }> {
  const target = safeResolve(relPath);
  if (!target) throw new Error("Caminho de arquivo inválido.");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { publicUrl: `${publicBase()}${relPath}` };
}

export function getCollectionPublicUrl(relPath: string): string {
  return `${publicBase()}${relPath}`;
}

/** Extrai o path relativo de uma URL pública já gravada no banco; `null` se não bater o prefixo. */
export function collectionPathFromUrl(url: string): string | null {
  const prefix = publicBase();
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

export async function removeCollectionFile(relPath: string): Promise<void> {
  const target = safeResolve(relPath);
  if (!target) return;
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Trata `GET/HEAD /collection/<path>`. Retorna `null` para outros caminhos/métodos. */
export async function handleCollectionAssets(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const relPath = decodeURIComponent(url.pathname.slice(PREFIX.length));
  const target = relPath ? safeResolve(relPath) : null;
  if (!target) return new Response("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(relPath).slice(1).toLowerCase();
  const headers = {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "cache-control": CACHE_CONTROL,
  };
  return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
    status: 200,
    headers,
  });
}
