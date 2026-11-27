import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { analyzeOnDemand, analyzeWatchedDay, repriceLotAi } from "@/lib/ai.functions";
import {
  AI_PROVIDER_SHORT,
  formatAiUsed,
  formatFailoverTrail,
  type AiProvider,
} from "@/lib/ai-provider";
import {
  advanceDeepProgress,
  finishDeepProgress,
  getDeepProgress,
  startDeepProgress,
  useDeepProgress,
  type DeepErrorEntry,
} from "@/lib/deep-progress";
import { queryKeys, useAiProviderQuery } from "@/lib/queries";

type Scope = { day: string; house?: string; watched?: boolean };

type Summary = {
  evaluated: number;
  failed: number;
  scopeSize: number;
  lastError: string | null;
  switchedTo: AiProvider | null;
  /** Último provedor que atendeu uma rodada (para o balão de conclusão). */
  served: AiProvider | null;
  attemptErrors: Partial<Record<AiProvider, string>>;
};

/**
 * Análise de IA SOB DEMANDA (`analyzeOnDemand`) fora do hook da home: roda em laço, 25 lotes por
 * chamada, até esgotar os não avaliados (ou parar de progredir) e depois revalida `queryKeys.lotAi`
 * para as notas aparecerem. Usa SEMPRE o provedor escolhido no topo (sem perguntar). Uma análise
 * por vez. `analyzeScope` = um dia/casa/vigiados (botões da home); `analyzeDays` = vários dias em
 * sequência com um aviso só (botão "Analisar pendentes" da Análise).
 */
export function useAnalyzeScope() {
  const runAnalyze = useServerFn(analyzeOnDemand);
  const queryClient = useQueryClient();
  const provider: AiProvider = useAiProviderQuery().data ?? "anthropic";
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const loop = async (scope: Scope, into: Summary) => {
    for (let guard = 0; guard < 60; guard += 1) {
      const res = await runAnalyze({ data: { ...scope, max: 25, provider } });
      into.evaluated += res.evaluated;
      into.failed += res.failed ?? 0;
      into.scopeSize = Math.max(into.scopeSize, res.scope ?? 0);
      if (res.error) into.lastError = res.error;
      if (res.served) into.served = res.served;
      if (res.switched && res.served) into.switchedTo = res.served;
      if (res.attemptErrors) into.attemptErrors = { ...into.attemptErrors, ...res.attemptErrors };
      // Para quando não sobra nada OU quando a rodada não avaliou nada (lotes que falham sempre
      // voltariam ao "pendente" e causariam laço infinito).
      if (res.remaining === 0 || res.evaluated === 0) break;
    }
  };

  const report = (s: Summary, doneText: string, opts: { watched?: boolean } = {}) => {
    // Avisa se houve failover: mostra o motivo de CADA provedor pulado.
    const trail = formatFailoverTrail(s.attemptErrors);
    if (s.switchedTo && s.switchedTo !== provider) {
      toast.warning(
        trail
          ? `${trail} — usei ${AI_PROVIDER_SHORT[s.switchedTo]}`
          : `${AI_PROVIDER_SHORT[provider]} indisponível — usei ${AI_PROVIDER_SHORT[s.switchedTo]}`,
      );
    }
    if (s.evaluated) {
      const used = formatAiUsed(
        s.served ? { provider: s.served, model: "", switched: false } : null,
      );
      toast.success(`IA avaliou ${s.evaluated} lote(s) ${doneText}${used}`);
    } else if (s.failed) {
      // Havia lotes pendentes, mas a IA não devolveu nada (vazio/erro) — não é "já avaliado".
      toast.error(
        `A IA não retornou avaliação${s.lastError ? ` (${s.lastError})` : ""} — verifique a chave/limite do provedor`,
      );
    } else if (opts.watched && s.scopeSize === 0) {
      // Escopo vazio: a lista de vigiados/lances não veio (ex.: sessão do LeilõesBR expirada).
      toast.error("Nenhum vigiado/lance foi encontrado no LeilõesBR — confira o login da conta");
    } else {
      toast.success(
        `Nada novo para avaliar (${s.scopeSize} lote(s) verificado(s), todos já avaliados)`,
      );
    }
  };

  const run = (
    key: string,
    scopes: Scope[],
    doneText: string,
    opts: { watched?: boolean } = {},
  ) => {
    if (analyzing) return; // uma análise por vez (evita disparar vários batches síncronos)
    void (async () => {
      setAnalyzing(key);
      const summary: Summary = {
        evaluated: 0,
        failed: 0,
        scopeSize: 0,
        lastError: null,
        switchedTo: null,
        served: null,
        attemptErrors: {},
      };
      try {
        for (const scope of scopes) await loop(scope, summary);
        await queryClient.invalidateQueries({ queryKey: queryKeys.lotAi });
        report(summary, doneText, opts);
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível analisar agora");
      } finally {
        setAnalyzing(null);
      }
    })();
  };

  const analyzeScope = (opts: Scope) =>
    run(
      opts.watched ? "watched" : opts.house ? `${opts.day}|${opts.house}` : opts.day,
      [opts],
      opts.house ? "desta casa" : "deste dia",
      { watched: opts.watched },
    );
  const analyzeDays = (days: string[]) =>
    run(
      "days",
      days.map((day) => ({ day })),
      days.length > 1 ? `em ${days.length} dias` : "deste dia",
    );

  return { analyzing, analyzeScope, analyzeDays };
}

/** Linha mínima de um lote para a reavaliação por subida de preço (`repriceLotAi`). */
type RepriceLot = {
  id: string;
  title: string;
  price: string;
  house: string;
  image: string | null;
};

/**
 * Reavalia lotes cuja nota foi dada a um preço bem menor (ver `priceRoseSinceEval`). O servidor
 * RECONFERE a subida e só refaz lote que já tem nota (respeitando o modo "off"). As linhas novas
 * entram direto no cache `queryKeys.lotAi`, sem reler a tabela.
 */
export function useRepriceLots() {
  const runReprice = useServerFn(repriceLotAi);
  const queryClient = useQueryClient();
  const [repricing, setRepricing] = useState(false);

  const repriceLots = (lots: RepriceLot[]) => {
    if (repricing || !lots.length) return;
    void (async () => {
      setRepricing(true);
      let done = 0;
      try {
        for (let i = 0; i < lots.length; i += 10) {
          const { rows } = await runReprice({ data: { lots: lots.slice(i, i + 10) } });
          if (!rows.length) continue;
          done += rows.length;
          const byId = new Map(rows.map((r) => [r.id, r]));
          queryClient.setQueriesData({ queryKey: queryKeys.lotAi }, (old: unknown) =>
            Array.isArray(old)
              ? [
                  ...old.map((r) => byId.get((r as { id: string })?.id) ?? r),
                  ...rows.filter((r) => !old.some((o) => (o as { id: string })?.id === r.id)),
                ]
              : old,
          );
        }
        if (done) toast.success(`${done} nota(s) refeita(s) com o preço de hoje`);
        else
          toast.info(
            "Nenhuma nota foi refeita: o modo da IA pode estar desligado ou o servidor não viu subida de preço",
          );
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível reavaliar agora");
      } finally {
        setRepricing(false);
      }
    })();
  };
  return { repricing, repriceLots };
}

/** Lote do dia a analisar a fundo, já com o PREÇO a avaliar (ver `deepPriceFor`). */
export type DeepLotInput = {
  id: string;
  idPeca: string;
  url: string;
  title: string;
  price: string;
  house: string;
  image: string | null;
};

/** Lotes por chamada ao servidor (cada um lê o catálogo e chama a IA com texto completo). */
const DEEP_CHUNK = 12;

/**
 * Análise PROFUNDA dos vigiados do dia (`analyzeWatchedDay`): em blocos de 12, grava as linhas
 * devolvidas direto no cache `queryKeys.lotAi` (a nota e o painel atualizam sozinhos). Uma por vez.
 */
export function useAnalyzeWatchedDay() {
  const runDeep = useServerFn(analyzeWatchedDay);
  const queryClient = useQueryClient();
  const provider: AiProvider = useAiProviderQuery().data ?? "anthropic";
  // O andamento vive num store de módulo (`deep-progress.ts`): o rodapé o mostra em qualquer tela.
  const progress = useDeepProgress();
  const running = progress.status === "running";

  const analyzeDay = (
    lots: DeepLotInput[],
    opts: { mode: "image" | "text"; redo: boolean },
    dayLabel = "",
  ) => {
    if (running || !lots.length) return;
    void (async () => {
      startDeepProgress(lots.length, dayLabel);
      const titleById = new Map(lots.map((l) => [l.id, l]));
      let served: AiProvider | null = null;
      let switchedTo: AiProvider | null = null;
      let attemptErrors: Partial<Record<AiProvider, string>> = {};
      const fatal: DeepErrorEntry[] = [];
      try {
        for (let i = 0; i < lots.length; i += DEEP_CHUNK) {
          const chunk = lots.slice(i, i + DEEP_CHUNK);
          try {
            const res = await runDeep({ data: { lots: chunk, ...opts, provider } });
            if (res.served) served = res.served;
            if (res.switched && res.served) switchedTo = res.served;
            attemptErrors = { ...attemptErrors, ...res.attemptErrors };
            const why = res.error || "a IA não devolveu uma análise válida";
            const errors: DeepErrorEntry[] = res.failedIds.map((id) => ({
              title: titleById.get(id)?.title ?? id,
              house: titleById.get(id)?.house,
              message: why,
            }));
            // Falhas sem id (não deve ocorrer) ainda aparecem na lista.
            for (let k = errors.length; k < res.failed; k += 1)
              errors.push({ title: "Lote sem identificação", message: why });
            if (res.rows.length) {
              const byId = new Map(res.rows.map((r) => [r.id, r]));
              queryClient.setQueriesData({ queryKey: queryKeys.lotAi }, (old: unknown) =>
                Array.isArray(old)
                  ? [
                      ...old.map((r) => byId.get((r as { id: string })?.id) ?? r),
                      ...res.rows.filter(
                        (r) => !old.some((o) => (o as { id: string })?.id === r.id),
                      ),
                    ]
                  : old,
              );
            }
            advanceDeepProgress(
              {
                size: chunk.length,
                evaluated: res.evaluated,
                skipped: res.skipped,
                failed: res.failed,
              },
              errors,
            );
          } catch (error) {
            // A chamada inteira caiu (rede, servidor, IA sem chave): o bloco todo conta como falha.
            const message = (error as Error)?.message || "A chamada ao servidor falhou";
            advanceDeepProgress(
              { size: chunk.length, evaluated: 0, skipped: 0, failed: chunk.length },
              chunk.map((l) => ({ title: l.title, house: l.house, message })),
            );
          }
        }
        const trail = formatFailoverTrail(attemptErrors);
        if (switchedTo && switchedTo !== provider) {
          toast.warning(
            trail
              ? `${trail} — usei ${AI_PROVIDER_SHORT[switchedTo]}`
              : `${AI_PROVIDER_SHORT[provider]} indisponível — usei ${AI_PROVIDER_SHORT[switchedTo]}`,
          );
        }
        if (trail && !switchedTo) fatal.push({ title: "Provedores de IA", message: trail });
        const final = getDeepProgress();
        const used = formatAiUsed(served ? { provider: served, model: "", switched: false } : null);
        if (final.evaluated) toast.success(`IA analisou ${final.evaluated} lote(s) a fundo${used}`);
        else if (final.failed) toast.error("A análise não retornou nada — veja os erros no rodapé");
        else toast.success("Nada novo para analisar: todos os lotes do dia já estão em dia");
      } finally {
        finishDeepProgress(fatal);
      }
    })();
  };

  return { progress: running ? { done: progress.done, total: progress.total } : null, analyzeDay };
}
