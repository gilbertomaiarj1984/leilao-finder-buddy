import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Disc3 } from "lucide-react";

import { AnalyticsView } from "@/components/vinyl/analytics-view";
import { getPublicVinylAnalytics } from "@/lib/leiloesbr.functions";

// Rota TOP-LEVEL (fora de `_authenticated/`) — de propósito: link somente-leitura para
// compartilhar com alguém sem login Google, gated só pelo token diário na URL (`?token=`, ver
// `access.server.ts`/`getPublicVinylAnalytics`). Sem `beforeLoad`/gate de sessão nenhum; o token
// é validado NO SERVIDOR (dentro da server function), nunca no cliente.
export const Route = createFileRoute("/vinil-analytics-publico")({
  head: () => ({ meta: [{ title: "Vinil Analytics (somente leitura) — Garimpo de Vinil" }] }),
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  component: PublicVinylAnalyticsPage,
});

function PublicVinylAnalyticsPage() {
  const { token } = Route.useSearch();
  const fetchAnalytics = useServerFn(getPublicVinylAnalytics);

  const query = useQuery({
    queryKey: ["public-vinyl-analytics", token] as const,
    queryFn: () => fetchAnalytics({ data: { token } }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!token || query.isError) {
    return <InvalidLink />;
  }

  return (
    <AnalyticsView
      rows={query.data?.sales ?? []}
      aliases={query.data?.aliases}
      readOnly
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      onRefetch={() => query.refetch()}
    />
  );
}

/** Mensagem genérica (não distingue "sem token" de "token errado/expirado", de propósito). */
function InvalidLink() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <Disc3 className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Link inválido</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Este link de acompanhamento do Vinil Analytics expirou ou é inválido. Peça um link
          atualizado a quem compartilhou com você.
        </p>
      </div>
    </main>
  );
}
