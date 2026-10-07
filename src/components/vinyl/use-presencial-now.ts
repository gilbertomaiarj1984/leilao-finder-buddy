import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getPresencialNow } from "@/lib/leiloesbr.functions";

/**
 * Lote em pregão agora de uma casa — mesmo polling usado pela barra "peça x de y" (`LiveLotNow`,
 * `HouseInfoLine`). `isFinished` é o sinal PRECISO de que os lotes da casa acabaram (peça atual
 * chegou ao total), a única fonte do fim de pregão (não há mais janela fixa de horas) — mas só existe quando a casa tem pregão presencial funcionando; sem dado, `isFinished`
 * fica `false` e a UI de quem chama continua com o comportamento normal (link, card ao vivo).
 */
export function usePresencialNow(url: string | null | undefined) {
  const fetchNow = useServerFn(getPresencialNow);
  const query = useQuery({
    queryKey: ["presencial-now", url ?? ""] as const,
    queryFn: () => fetchNow({ data: { url: url! } }),
    enabled: Boolean(url),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const now = query.data ?? null;
  const isFinished = Boolean(
    now && now.peca !== null && now.total !== null && now.peca >= now.total,
  );
  // Ainda há peças pela frente: pregão rolando.
  const inProgress = Boolean(
    now && now.peca !== null && now.total !== null && now.peca < now.total,
  );
  return { now, isFinished, inProgress };
}
