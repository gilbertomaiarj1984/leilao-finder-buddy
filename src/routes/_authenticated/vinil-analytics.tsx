import { useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  type AnalyticsAiControls,
  AnalyticsView,
  type AnalyticsMutationHandlers,
} from "@/components/vinyl/analytics-view";
import { AI_PROVIDER_SHORT, type AiProvider, type GeminiModel } from "@/lib/ai-provider";
import {
  type AlbumAgg,
  type AnalyticsAliases,
  type ArtistAgg,
  type SaleRow,
} from "@/lib/analytics";
import {
  clearAnalyticsAlias,
  getAiProvider,
  getAnalyticsAliases,
  getGeminiModel,
  getTodayPublicAnalyticsToken,
  getVinylSales,
  reidentifySales,
  setAiProvider,
  setAnalyticsAlbumAlias,
  setAnalyticsArtistAlias,
  setAnalyticsExcludedArtist,
  setAnalyticsExcludedSale,
  setAnalyticsSaleOverride,
  setGeminiModel,
} from "@/lib/leiloesbr.functions";

export const Route = createFileRoute("/_authenticated/vinil-analytics")({
  head: () => ({ meta: [{ title: "Vinil Analytics — Garimpo de Vinil" }] }),
  component: VinilAnalyticsPage,
});

// Página autenticada: busca os dados via server functions protegidas (`requireSupabaseAuth` +
// `assertAllowed`), monta os handlers de MUTAÇÃO (curadoria, IA, exclusões) e delega TODA a
// apresentação para `AnalyticsView` (compartilhada com a página pública somente-leitura,
// `/vinil-analytics-publico` — ver `src/components/vinyl/analytics-view.tsx`). Único cuidado
// extra aqui: o botão "Copiar link público" (token diário — `access.server.ts`).
function VinilAnalyticsPage() {
  const [reidentifying, setReidentifying] = useState(false);
  const queryClient = useQueryClient();
  const fetchSales = useServerFn(getVinylSales);
  const runReident = useServerFn(reidentifySales);
  const fetchAiProvider = useServerFn(getAiProvider);
  const runSetAiProvider = useServerFn(setAiProvider);
  const fetchGeminiModel = useServerFn(getGeminiModel);
  const runSetGeminiModel = useServerFn(setGeminiModel);
  const fetchAliases = useServerFn(getAnalyticsAliases);
  const runSetArtistAlias = useServerFn(setAnalyticsArtistAlias);
  const runSetAlbumAlias = useServerFn(setAnalyticsAlbumAlias);
  const runClearAlias = useServerFn(clearAnalyticsAlias);
  const runSetSaleOverride = useServerFn(setAnalyticsSaleOverride);
  const runExcludeSale = useServerFn(setAnalyticsExcludedSale);
  const runExcludeArtist = useServerFn(setAnalyticsExcludedArtist);
  const fetchPublicToken = useServerFn(getTodayPublicAnalyticsToken);

  const sales = useQuery({
    queryKey: ["vinyl-sales"] as const,
    queryFn: () => fetchSales(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Apelidos (curadoria manual do agrupamento — renomear/fundir artistas e álbuns). Fonte da
  // verdade no servidor (`app_state`); aplicados em `buildAnalytics`. Escrita otimista.
  const aliasesQuery = useQuery({
    queryKey: ["analytics-aliases"] as const,
    queryFn: () => fetchAliases(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Provedor de IA PADRÃO (o mesmo do topo da home/Coleção) — fonte da verdade no servidor.
  const aiProviderQuery = useQuery({
    queryKey: ["ai-provider"] as const,
    queryFn: () => fetchAiProvider(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const aiProvider: AiProvider = aiProviderQuery.data ?? "anthropic";
  const changeAiProvider = (provider: AiProvider) => {
    const prev = aiProviderQuery.data;
    queryClient.setQueryData(["ai-provider"], provider); // otimista
    void runSetAiProvider({ data: { provider } })
      .then(() => toast.success(`Provedor padrão: ${AI_PROVIDER_SHORT[provider]}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(["ai-provider"], prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o provedor de IA");
      });
  };

  // Modelo do Gemini (Flash-Lite/Flash/Pro) — vale mesmo com Claude escolhido: o failover
  // por falta de créditos pode acabar caindo no Gemini com esse modelo.
  const geminiModelQuery = useQuery({
    queryKey: ["gemini-model"] as const,
    queryFn: () => fetchGeminiModel(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const geminiModel: GeminiModel = geminiModelQuery.data ?? "gemini-3.1-flash-lite";
  const changeGeminiModel = (model: GeminiModel) => {
    const prev = geminiModelQuery.data;
    queryClient.setQueryData(["gemini-model"], model); // otimista
    void runSetGeminiModel({ data: { model } })
      .then(() => toast.success(`Modelo do Gemini: ${model}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(["gemini-model"], prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o modelo do Gemini");
      });
  };

  // Clona o cache de apelidos (com os 3 mapas) para o update otimista.
  const cloneAliases = (): AnalyticsAliases => {
    const prev = aliasesQuery.data;
    return {
      artists: { ...(prev?.artists ?? {}) },
      albums: { ...(prev?.albums ?? {}) },
      sales: { ...(prev?.sales ?? {}) },
      excludedSales: { ...(prev?.excludedSales ?? {}) },
      excludedArtists: { ...(prev?.excludedArtists ?? {}) },
    };
  };
  const revertAliases = (prev: AnalyticsAliases | undefined) =>
    queryClient.setQueryData(["analytics-aliases"], prev);

  // Grava um apelido de ARTISTA (renomear/fundir). Update otimista no cache dos apelidos → o
  // `AnalyticsView` recomputa na hora; em erro, reverte.
  const applyArtistAlias = (sourceKeys: string[], name: string) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of sourceKeys) next.artists![k] = name;
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetArtistAlias({ data: { sourceKeys, name } })
      .then(() => toast.success(`Artista atualizado: ${name}`))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o artista");
      });
  };

  // Grava um apelido de ÁLBUM (renomear/fundir no escopo do artista).
  const applyAlbumAlias = (keys: string[], name: string) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of keys) next.albums![k] = name;
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetAlbumAlias({ data: { keys, name } })
      .then(() => toast.success(`Álbum atualizado: ${name}`))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o álbum");
      });
  };

  // Desfaz os apelidos de um artista (remove suas chaves dos dois mapas). Volta ao automático.
  const clearArtistAlias = (artist: ArtistAgg) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of artist.sourceKeys) delete next.artists![k];
    queryClient.setQueryData(["analytics-aliases"], next);
    void Promise.all(
      artist.sourceKeys.map((key) => runClearAlias({ data: { kind: "artist", key } })),
    )
      .then(() => toast.success("Curadoria do artista desfeita"))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível desfazer");
      });
  };

  // Correção POR VENDA (por `lot_id`): define/limpa artista+álbum de uma venda; separa os não
  // identificados. `clear` volta ao automático. Update otimista no mapa `sales`.
  const applySaleOverride = (lotId: string, value: { artist: string; album: string } | null) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    if (!value || (!value.artist.trim() && !value.album.trim())) delete next.sales![lotId];
    else {
      const entry: { artist?: string; album?: string } = {};
      if (value.artist.trim()) entry.artist = value.artist.trim();
      if (value.album.trim()) entry.album = value.album.trim();
      next.sales![lotId] = entry;
    }
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetSaleOverride({
      data: {
        lotId,
        artist: value?.artist ?? "",
        album: value?.album ?? "",
        clear: !value,
      },
    })
      .then(() => toast.success(value ? "Venda corrigida" : "Correção da venda desfeita"))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível corrigir a venda");
      });
  };

  // EXCLUIR/REINCLUIR uma VENDA (oculta do Analytics, sem apagar do banco). Update otimista.
  const setSaleExcluded = (lotId: string, excluded: boolean, label = "") => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    if (excluded) next.excludedSales![lotId] = label.trim() || lotId;
    else delete next.excludedSales![lotId];
    queryClient.setQueryData(["analytics-aliases"], next);
    void runExcludeSale({ data: { lotId, excluded, label } })
      .then(() => toast.success(excluded ? "Venda ocultada do Analytics" : "Venda reincluída"))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível ocultar a venda");
      });
  };

  // EXCLUIR/REINCLUIR um ARTISTA inteiro (oculta o grupo do Analytics, sem apagar do banco). As
  // chaves ocultadas são a `key` final + as `sourceKeys` (robusto a fusões/apelidos).
  const setArtistExcluded = (artist: ArtistAgg, excluded: boolean) => {
    const keys = [...new Set([artist.key, ...artist.sourceKeys])];
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of keys) {
      if (excluded) next.excludedArtists![k] = artist.artist;
      else delete next.excludedArtists![k];
    }
    queryClient.setQueryData(["analytics-aliases"], next);
    void runExcludeArtist({ data: { keys, excluded, label: artist.artist } })
      .then(() =>
        toast.success(excluded ? `Artista ocultado: ${artist.artist}` : "Artista reincluído"),
      )
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível ocultar o artista");
      });
  };

  // Reidentifica TODO o histórico pela IA (título+descrição → artista/álbum) e padroniza os
  // nomes. Roda em laço até `done`, então revalida a lista. Usa o provedor selecionado no topo.
  const reidentifyAll = () => {
    if (reidentifying) return;
    setReidentifying(true);
    void (async () => {
      let identified = 0;
      let applied = 0;
      try {
        for (let guard = 0; guard < 200; guard += 1) {
          const res = await runReident({ data: { max: 25 } });
          identified += res.identified;
          applied += res.applied;
          if (res.done) break;
        }
        await queryClient.invalidateQueries({ queryKey: ["vinyl-sales"] });
        await sales.refetch();
        toast.success(
          `Reidentificação concluída: ${identified} identificado(s) pela IA · ${applied} registro(s) padronizado(s)`,
        );
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível reidentificar agora");
      } finally {
        setReidentifying(false);
      }
    })();
  };

  // Reidentifica pela IA só as vendas de um GRUPO (artista ou álbum). Chamada única (o servidor
  // retenta os ainda não identificados do grupo); revalida a lista ao terminar.
  const reidentifyGroupSales = async (lotIds: string[]) => {
    if (!lotIds.length) return;
    try {
      const res = await runReident({ data: { lotIds, max: Math.min(lotIds.length, 100) } });
      await queryClient.invalidateQueries({ queryKey: ["vinyl-sales"] });
      await sales.refetch();
      if (res.identified > 0) {
        toast.success(
          `IA: ${res.identified} identificado(s)${
            res.remaining ? ` · ${res.remaining} restante(s) — clique de novo` : ""
          }`,
        );
      } else if (res.remaining > 0) {
        toast.info(`Nada novo pela IA · ${res.remaining} venda(s) sem identificação`);
      } else {
        toast.success("Nada a identificar neste grupo");
      }
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível reidentificar o grupo");
    }
  };

  // Reidentifica pela IA TODOS os álbuns de um artista de uma vez — uma chamada por álbum (o
  // mesmo que o botão de UM álbum já faz), só que em sequência automática, sem precisar abrir e
  // clicar álbum por álbum. Agrega o resultado num único toast/invalidação ao final.
  const reidentifyAllAlbums = async (albums: AlbumAgg[]) => {
    const groups = albums.map((al) => al.sales.map((s) => s.lot_id)).filter((ids) => ids.length);
    if (!groups.length) return;
    let identified = 0;
    let remaining = 0;
    try {
      for (const lotIds of groups) {
        const res = await runReident({ data: { lotIds, max: Math.min(lotIds.length, 100) } });
        identified += res.identified;
        remaining += res.remaining;
      }
      await queryClient.invalidateQueries({ queryKey: ["vinyl-sales"] });
      await sales.refetch();
      if (identified > 0) {
        toast.success(
          `IA: ${identified} identificado(s) em ${groups.length} álbum(ns)${
            remaining ? ` · ${remaining} restante(s) — rode de novo` : ""
          }`,
        );
      } else if (remaining > 0) {
        toast.info(`Nada novo pela IA · ${remaining} venda(s) sem identificação`);
      } else {
        toast.success("Nada a identificar nos álbuns deste artista");
      }
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível reidentificar os álbuns");
    }
  };

  const rows = (sales.data ?? []) as SaleRow[];

  const handlers: AnalyticsMutationHandlers = {
    onApplyArtistAlias: applyArtistAlias,
    onClearArtist: clearArtistAlias,
    onApplyAlbumAlias: applyAlbumAlias,
    onApplySaleOverride: applySaleOverride,
    onExcludeSale: (sale, label) => setSaleExcluded(sale.lot_id, true, label),
    onExcludeArtist: (artist) => setArtistExcluded(artist, true),
    onReidentGroup: reidentifyGroupSales,
    onReidentAllAlbums: reidentifyAllAlbums,
    onRestoreSale: (lotId) => setSaleExcluded(lotId, false),
    onRestoreArtist: (key) => {
      // Reincluir remove a chave (e as chaves-irmãs que compartilham o mesmo rótulo, para
      // desfazer também as sourceKeys gravadas junto).
      const map = aliasesQuery.data?.excludedArtists ?? {};
      const label = map[key];
      const keys = Object.keys(map).filter((k) => k === key || map[k] === label);
      setArtistExcluded({ key, sourceKeys: keys, artist: label ?? key } as ArtistAgg, false);
    },
  };

  const ai: AnalyticsAiControls = {
    provider: aiProvider,
    geminiModel,
    onChangeProvider: changeAiProvider,
    onChangeGeminiModel: changeGeminiModel,
    reidentifying,
    onReidentifyAll: reidentifyAll,
  };

  // Copia o link público (somente leitura) de hoje pra área de transferência — token diário
  // (`access.server.ts`), sem expor o segredo ao cliente (só o token do dia, via server function
  // autenticada `getTodayPublicAnalyticsToken`).
  const copyPublicLink = async () => {
    try {
      const { token } = await fetchPublicToken();
      const url = `${window.location.origin}/vinil-analytics-publico?token=${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link público (somente leitura) copiado — válido até amanhã");
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível gerar o link público");
    }
  };

  return (
    <AnalyticsView
      rows={rows}
      aliases={aliasesQuery.data}
      readOnly={false}
      isLoading={sales.isLoading}
      isFetching={sales.isFetching}
      onRefetch={() => sales.refetch()}
      handlers={handlers}
      ai={ai}
      headerExtra={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void copyPublicLink()}
            title="Copiar link público (somente leitura, sem login) de hoje"
            aria-label="Copiar link público"
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        </div>
      }
    />
  );
}
