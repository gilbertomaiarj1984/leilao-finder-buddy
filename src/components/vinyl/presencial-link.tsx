import { Radio } from "lucide-react";

import { useAuctionStatus } from "./use-auction-status";

/**
 * Link "pregão presencial" da linha da casa (dia principal / vigiados). Some quando o pregão
 * termina (`useAuctionStatus` → "encerrado"): os lotes sem lance daquela casa vivem na visão
 * "Sem lance" do dia de hoje (`unsold-view.tsx`), não mais na linha da casa. Nenhum sinal vale
 * para um dia "Em breve" nem muda o link — só esconde depois do fim.
 */
export function PresencialLink({
  presencialUrl,
  idLeilao,
  dayKey,
  status: baseStatus,
}: {
  presencialUrl: string;
  idLeilao: string;
  dayKey: string;
  status: "upcoming" | "live" | "ended" | null;
}) {
  const { status } = useAuctionStatus({ status: baseStatus, presencialUrl, idLeilao, dayKey });
  if (status === "ended") return null;
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      href={presencialUrl}
      target="_blank"
      rel="noreferrer"
      title="Acompanhar o pregão presencial desta casa"
    >
      <Radio className="h-3 w-3" /> pregão presencial
    </a>
  );
}
