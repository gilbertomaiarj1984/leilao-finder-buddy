import { isSafeImageUrl } from "./ai-provider.server";

const MAX_REDIRECTS = 3;

/**
 * Baixa uma imagem de uma URL que pode vir de fora (HTML de casa de leilão, capa informada pelo
 * cliente) sem abrir portas: valida a URL (`isSafeImageUrl`: só http(s) público, nada de rede
 * interna ou metadados), segue redirects MANUALMENTE revalidando cada salto (um host público pode
 * redirecionar para 169.254.169.254), tem timeout e lê em fluxo com teto de bytes (não baixa um
 * arquivo gigante inteiro antes de recusar). `null` = recusada, falhou ou passou do teto.
 */
export async function fetchImageBytes(
  url: string,
  opts: { maxBytes: number; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isSafeImageUrl(current)) return null;
      const resp = await fetchImpl(current, { redirect: "manual", signal });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!resp.ok || !resp.body) return null;
      const declared = Number(resp.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > opts.maxBytes) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
      const type = (resp.headers.get("content-type") || "").split(";")[0]?.trim() ?? "";
      return { bytes: Buffer.concat(chunks), contentType: type };
    }
    return null;
  } catch {
    return null;
  }
}
