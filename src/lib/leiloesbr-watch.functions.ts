import { createServerFn } from "@tanstack/react-start";

export const listWatched = createServerFn({ method: "GET" }).handler(async () => {
  const { listWatchedFromSite } = await import("./leiloesbr-watch.server");
  return await listWatchedFromSite();
});

export const toggleWatch = createServerFn({ method: "POST" })
  .inputValidator((input: { idPeca: string; idLeilao: string; base: string; watch: boolean }) => {
    if (!input?.idPeca || !input?.idLeilao) throw new Error("Lote inválido.");
    return {
      idPeca: String(input.idPeca),
      idLeilao: String(input.idLeilao),
      base: String(input.base ?? "0"),
      watch: Boolean(input.watch),
    };
  })
  .handler(async ({ data }) => {
    const { toggleWatchOnSite } = await import("./leiloesbr-watch.server");
    const watched = await toggleWatchOnSite(
      { idPeca: data.idPeca, idLeilao: data.idLeilao, base: data.base },
      data.watch,
    );
    return { watched };
  });
