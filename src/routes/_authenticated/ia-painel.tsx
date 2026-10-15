import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlocksTab } from "@/components/vinyl/ai-panel/blocks-tab";
import { CorrelTab } from "@/components/vinyl/ai-panel/correl-tab";
import { FreightTab } from "@/components/vinyl/ai-panel/freight-tab";
import { ModelTab } from "@/components/vinyl/ai-panel/model-tab";
import { DEFAULT_PANEL_CONFIG, type PanelConfig } from "@/lib/ai-panel-config";
import { setAiPanel } from "@/lib/ai-panel.functions";
import { queryKeys, useAiPanelQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/ia-painel")({
  head: () => ({ meta: [{ title: "Painel de IA — Garimpo de Vinil" }] }),
  component: IaPainelPage,
});

function IaPainelPage() {
  const query = useAiPanelQuery();
  const qc = useQueryClient();
  const save = useServerFn(setAiPanel);
  const [edited, setEdited] = useState<PanelConfig | null>(null);
  const [tab, setTab] = useState("blocos");

  const saved = query.data ?? null;
  const draft = edited ?? saved;
  const dirty = Boolean(edited && saved && JSON.stringify(edited) !== JSON.stringify(saved));

  const mutation = useMutation({
    mutationFn: (config: PanelConfig) => save({ data: { config } }),
    onSuccess: (res) => {
      qc.setQueryData(queryKeys.aiPanel, res.config);
      setEdited(null);
      toast.success("Painel de IA salvo");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o painel."),
  });

  const setDraft = (fn: (d: PanelConfig) => PanelConfig) => {
    if (!draft) return;
    setEdited(fn(draft));
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="max-sm:hidden">
              <Link to="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar
              </Link>
            </Button>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              Painel de IA
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {dirty ? <span className="text-xs text-amber-500">alterações não salvas</span> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setEdited({ ...DEFAULT_PANEL_CONFIG, blocks: [...DEFAULT_PANEL_CONFIG.blocks] })
              }
              title="Volta blocos, regras, frete e condição padrão ao padrão do app (só vale depois de salvar)"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar padrão
            </Button>
            <Button
              size="sm"
              onClick={() => draft && mutation.mutate(draft)}
              disabled={!dirty || mutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Salvar
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4">
        {query.isLoading || !draft ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="blocos">Blocos de contexto</TabsTrigger>
              <TabsTrigger value="correlacao">Correlação de condições</TabsTrigger>
              <TabsTrigger value="frete">Frete e padrões</TabsTrigger>
              <TabsTrigger value="modelo">Modelo e modo</TabsTrigger>
            </TabsList>
            <TabsContent value="blocos">
              <BlocksTab draft={draft} setDraft={setDraft} />
            </TabsContent>
            <TabsContent value="correlacao">
              <CorrelTab draft={draft} setDraft={setDraft} />
            </TabsContent>
            <TabsContent value="frete">
              <FreightTab draft={draft} setDraft={setDraft} />
            </TabsContent>
            <TabsContent value="modelo">
              <ModelTab />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
}
