// Server functions do Vinil Analytics: vendas, reidentificação, curadoria (apelidos,
// exclusões, overrides) e a variante pública somente-leitura.
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

/**
 * Histórico de vendas (`lot_sales`, base do Vinil Analytics). Best-effort: [] em erro.
 * Não pede `orig_text` (a coluna mais pesada por linha) — o navegador não precisa do descritivo
 * bruto do catálogo, só de `bundle` (já calculado na captura) para o mesmo filtro de lote/kit.
 */
export const getVinylSales = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotSales } = await import("./lot-sales.server");
      return await getAllLotSales({ withOrig: false });
    } catch (error) {
      console.error("[lot-sales] não foi possível ler o histórico de vendas", error);
      return [];
    }
  });

/**
 * Reidentificação por IA das vendas (mesma rotina do cron `step=reident`): ajusta artista/álbum
 * (texto original/título → IA) e padroniza a grafia dos nomes. Usa o provedor de IA PADRÃO (o
 * selecionado no topo do site).
 * - Sem `lotIds`: roda em TODO o histórico; o cliente chama em laço até `done`.
 * - Com `lotIds` (por ARTISTA ou por ÁLBUM): roda só nessas vendas, RETENTANDO as ainda não
 *   identificadas (chamada única — cap maior para cobrir o grupo).
 */
export const reidentifySales = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { max?: number; lotIds?: unknown } | undefined) => {
    const lotIds = Array.isArray(input?.lotIds)
      ? input.lotIds.filter((k): k is string => typeof k === "string" && !!k).slice(0, 500)
      : [];
    // Por grupo: cap maior (cobre o grupo numa chamada). Global: 25–50 por rodada (laço).
    const cap = lotIds.length ? 100 : 50;
    return { max: Math.min(Math.max(Number(input?.max) || 25, 1), cap), lotIds };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { reidentifyAllSales } = await import("./lot-sales.server");
    return await reidentifyAllSales(
      data.max,
      data.lotIds.length ? { lotIds: data.lotIds } : undefined,
    );
  });

/**
 * Apelidos do Vinil Analytics (curadoria manual do agrupamento artista → álbum, com
 * "aprendizado" durável). Ver `app-state.server.ts` / `buildAnalytics`.
 */
export const getAnalyticsAliases = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAnalyticsAliases: read } = await import("./app-state.server");
      return await read();
    } catch (error) {
      console.error("[analytics] não foi possível ler os apelidos", error);
      return { artists: {}, albums: {}, sales: {}, excludedSales: {}, excludedArtists: {} };
    }
  });

/** Renomear/fundir ARTISTA: cada chave normalizada em `sourceKeys` passa a apontar para `name`. */
export const setAnalyticsArtistAlias = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { sourceKeys?: unknown; name?: unknown }) => ({
    sourceKeys: Array.isArray(input?.sourceKeys)
      ? input.sourceKeys.filter((k): k is string => typeof k === "string" && !!k)
      : [],
    name: typeof input?.name === "string" ? input.name.trim() : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsArtistAlias: save } = await import("./app-state.server");
    return await save(data.sourceKeys, data.name);
  });

/** Renomear/fundir ÁLBUM: cada chave `"${artistKey}|${albumKey}"` em `keys` aponta para `name`. */
export const setAnalyticsAlbumAlias = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { keys?: unknown; name?: unknown }) => ({
    keys: Array.isArray(input?.keys)
      ? input.keys.filter((k): k is string => typeof k === "string" && !!k)
      : [],
    name: typeof input?.name === "string" ? input.name.trim() : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsAlbumAlias: save } = await import("./app-state.server");
    return await save(data.keys, data.name);
  });

/** Desfaz um apelido (remove a chave do mapa de artista ou de álbum). */
export const clearAnalyticsAlias = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { kind?: unknown; key?: unknown }) => ({
    kind: input?.kind === "album" ? ("album" as const) : ("artist" as const),
    key: typeof input?.key === "string" ? input.key : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { clearAnalyticsAlias: clear } = await import("./app-state.server");
    return await clear(data.kind, data.key);
  });

/**
 * Correção POR VENDA (aprendizado por `lot_id`): define artista/álbum de UMA venda específica —
 * usada para separar os "(álbum não identificado)". `clear` (ou artista+álbum vazios) remove a
 * correção (volta ao automático).
 */
export const setAnalyticsSaleOverride = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { lotId?: unknown; artist?: unknown; album?: unknown; clear?: unknown }) => ({
      lotId: typeof input?.lotId === "string" ? input.lotId : "",
      artist: typeof input?.artist === "string" ? input.artist.trim() : "",
      album: typeof input?.album === "string" ? input.album.trim() : "",
      clear: input?.clear === true,
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsSaleOverride: save } = await import("./app-state.server");
    const value = data.clear ? null : { artist: data.artist, album: data.album };
    return await save(data.lotId, value);
  });

/** Correção por venda em LOTE (mover um álbum inteiro): mesma `value` para todos os `lotIds`. */
export const setAnalyticsSaleOverrides = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { lotIds?: unknown; artist?: unknown; album?: unknown; clear?: unknown }) => ({
      lotIds: Array.isArray(input?.lotIds)
        ? input.lotIds.filter((k): k is string => typeof k === "string" && !!k).slice(0, 500)
        : [],
      artist: typeof input?.artist === "string" ? input.artist.trim() : "",
      album: typeof input?.album === "string" ? input.album.trim() : "",
      clear: input?.clear === true,
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsSaleOverrides: save } = await import("./app-state.server");
    const value = data.clear ? null : { artist: data.artist, album: data.album };
    return await save(data.lotIds, value);
  });

/** Excluir/reincluir uma VENDA do Analytics (oculta por `lot_id`, sem deletar do banco). */
export const setAnalyticsExcludedSale = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { lotId?: unknown; excluded?: unknown; label?: unknown }) => ({
    lotId: typeof input?.lotId === "string" ? input.lotId : "",
    excluded: input?.excluded !== false,
    label: typeof input?.label === "string" ? input.label : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsExcludedSale: save } = await import("./app-state.server");
    return await save(data.lotId, data.excluded, data.label);
  });

/** Excluir/reincluir um ARTISTA inteiro do Analytics (oculta por chave, sem deletar do banco). */
export const setAnalyticsExcludedArtist = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { keys?: unknown; excluded?: unknown; label?: unknown }) => ({
    keys: Array.isArray(input?.keys)
      ? input.keys.filter((k): k is string => typeof k === "string" && !!k)
      : [],
    excluded: input?.excluded !== false,
    label: typeof input?.label === "string" ? input.label : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsExcludedArtist: save } = await import("./app-state.server");
    return await save(data.keys, data.excluded, data.label);
  });

/** Token de HOJE do link público (somente leitura) do Vinil Analytics — ver `access.server.ts`.
 *  Só o token derivado é exposto ao cliente; o `PUBLIC_ANALYTICS_SECRET` nunca sai do servidor. */
export const getTodayPublicAnalyticsToken = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { todayPublicAnalyticsToken } = await import("./access.server");
    return { token: await todayPublicAnalyticsToken() };
  });

/**
 * Variante PÚBLICA (sem login) do Vinil Analytics: mesmos dados de `getVinylSales` +
 * `getAnalyticsAliases`, gated SÓ pelo token diário (`?token=` — ver `access.server.ts`), sem
 * `requireAuth` nem `assertAllowed`. Propositalmente sem nenhuma escrita/mutação — só
 * leitura, para a página `/vinil-analytics-publico`.
 */
export const getPublicVinylAnalytics = createServerFn({ method: "GET" })
  .inputValidator((input: { token?: string } | undefined) => ({
    token: typeof input?.token === "string" ? input.token : undefined,
  }))
  .handler(async ({ data }) => {
    const { assertPublicAnalyticsToken } = await import("./access.server");
    await assertPublicAnalyticsToken(data.token);
    try {
      const { getAllLotSales } = await import("./lot-sales.server");
      const { getAnalyticsAliases: readAliases } = await import("./app-state.server");
      const [sales, aliases] = await Promise.all([
        getAllLotSales({ withOrig: false }),
        readAliases(),
      ]);
      return { sales, aliases };
    } catch (error) {
      console.error("[analytics] não foi possível ler o Analytics público", error);
      return {
        sales: [],
        aliases: { artists: {}, albums: {}, sales: {}, excludedSales: {}, excludedArtists: {} },
      };
    }
  });
