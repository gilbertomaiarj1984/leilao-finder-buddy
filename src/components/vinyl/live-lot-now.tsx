import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gavel } from "lucide-react";

import { getPresencialNow } from "@/lib/leiloesbr.functions";

/**
 * Lote em pregão AGORA + barra "peça x de y · %", ao lado de "Ao vivo agora". Atualiza a cada
 * 5 min só com a aba visível (o React Query pausa o intervalo em segundo plano) e ao voltar
 * para a aba; mesma casa na lista e no /ao-vivo compartilha a consulta (mesma queryKey).
 */
export function LiveLotNow({ url }: { url: string }) {
  const fetchNow = useServerFn(getPresencialNow);
  const query = useQuery({
    queryKey: ["presencial-now", url] as const,
    queryFn: () => fetchNow({ data: { url } }),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const now = query.data;
  if (!now) return null;
  const mins = Math.max(0, Math.round((Date.now() - query.dataUpdatedAt) / 60000));
  const title = `Lote em pregão agora${
    now.peca && now.total ? ` — peça nº ${now.peca} de ${now.total}` : ""
  } (atualizado ${mins ? `há ${mins} min` : "agora"})`;

  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
        <Gavel className="h-3 w-3" />
        Lote {now.lote}
      </span>
      {now.pct !== null ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-yellow-500"
              style={{ width: `${now.pct}%` }}
            />
          </span>
          <span className="tabular-nums">
            {now.peca}/{now.total} · {now.pct}%
          </span>
        </span>
      ) : null}
    </span>
  );
}
