import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Radio } from "lucide-react";
import { useState } from "react";

import { getUnsoldLots } from "@/lib/leiloesbr.functions";

import { usePresencialNow } from "./use-presencial-now";

/**
 * Link "pregão presencial" da linha da casa (dia principal / vigiados) — perde sentido assim
 * que os lotes acabam, então vira o acesso à lista de lotes sem lance daquele pregão
 * (`getUnsoldLots`, sob demanda ao expandir).
 *
 * Fim do pregão: sinal PRECISO de `usePresencialNow` (peça atual = total) OU, quando esse
 * dado não vem (`isFinished` nunca fica `true`), a heurística de 3h já usada pelo badge
 * "Encerrado" (`statusEnded`, de `houseAuctionInfo`) — descoberto na prática: quando o pregão
 * termina de verdade, o polling do presencial costuma parar de responder em vez de ficar
 * parado em "peça = total", então o sinal preciso sozinho nunca dispara pra maioria das casas.
 */
export function PresencialOrUnsoldLink({
  presencialUrl,
  idLeilao,
  statusEnded,
}: {
  presencialUrl: string;
  idLeilao: string;
  statusEnded: boolean;
}) {
  const { isFinished: presencialFinished } = usePresencialNow(presencialUrl);
  const isFinished = presencialFinished || statusEnded;
  const [open, setOpen] = useState(false);
  const fetchUnsold = useServerFn(getUnsoldLots);
  const query = useQuery({
    queryKey: ["unsold-lots", idLeilao] as const,
    queryFn: () => fetchUnsold({ data: { idLeilao, presencialUrl } }),
    enabled: open && isFinished,
    staleTime: 5 * 60 * 1000,
  });

  if (!isFinished) {
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

  const lots = query.data ?? [];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        title="Pregão encerrado — ver lotes sem lance"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        lotes sem lance
      </button>
      {open ? (
        <div className="basis-full">
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : lots.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum lote sem lance encontrado.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {lots.map((lot) => (
                <li key={lot.idPeca}>
                  <a
                    href={lot.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-primary hover:underline"
                  >
                    {lot.lote ? `Lote ${lot.lote} — ` : ""}
                    {lot.artist ? `${lot.artist} — ` : ""}
                    {lot.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}
