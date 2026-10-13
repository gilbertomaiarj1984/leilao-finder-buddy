import { skipToken, useQuery } from "@tanstack/react-query";

import { useAppBadge } from "@/lib/app-badge";
import { queryKeys, useLookoutOverviewQuery } from "@/lib/queries";
import type { MyBid } from "@/lib/leiloesbr-bids.server";
import { bidIsCovered } from "@/lib/vinyl-parse";

/**
 * Atualiza o selo do ícone do app instalado: lances superados + discos novos do "De olho".
 * Só LÊ o cache dos lances (`skipToken` — não dispara a busca no site da casa); o número fica
 * correto assim que a home/Análise carrega os lances. Montado no layout logado.
 */
export function AppBadgeSync() {
  const lookoutNew = useLookoutOverviewQuery({ history: false }).data?.newCount ?? 0;
  const bids = useQuery<MyBid[]>({ queryKey: queryKeys.bids, queryFn: skipToken }).data;
  const covered = bids?.filter((b) => bidIsCovered(b.status)).length ?? 0;
  useAppBadge(lookoutNew + covered);
  return null;
}
