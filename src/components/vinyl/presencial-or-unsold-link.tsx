import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Flag, Radio } from "lucide-react";
import { useState } from "react";

import { getUnsoldLots } from "@/lib/leiloesbr.functions";
import { lotOpenUrl } from "@/lib/vinyl-parse";

import { useManuallyFinished } from "./use-manually-finished";
import { usePresencialNow } from "./use-presencial-now";

type UnsoldLotItem = {
  idPeca: string;
  lote: string | null;
  title: string;
  artist: string;
  image: string | null;
  url: string;
};

/** Card compacto de um lote sem lance — mesmo espírito visual do `LotCard` (imagem + badge do
 * nº do lote + título), sem os controles de vigiar/lance (o pregão já terminou). */
function UnsoldLotCard({ lot }: { lot: UnsoldLotItem }) {
  return (
    <a
      href={lotOpenUrl(lot.url, lot.title)}
      target="_blank"
      rel="noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-md border border-border bg-card transition hover:border-primary"
    >
      {lot.lote ? (
        <span className="absolute left-2 top-2 z-10 max-w-[5rem] truncate rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground shadow">
          Lote {lot.lote}
        </span>
      ) : null}
      <div className="relative h-28 w-full overflow-hidden bg-secondary">
        {lot.image ? (
          <img
            src={lot.image}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            sem imagem
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {lot.artist ? (
          <p className="truncate text-xs font-medium text-foreground">{lot.artist}</p>
        ) : null}
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{lot.title}</p>
      </div>
    </a>
  );
}

/**
 * Link "pregão presencial" da linha da casa (dia principal / vigiados) — perde sentido assim
 * que os lotes acabam, então vira o acesso à lista de lotes sem lance daquele pregão
 * (`getUnsoldLots`). Busca assim que detecta o fim (não só ao expandir) para já mostrar o
 * total de lotes ao lado do botão; a lista em cards só renderiza ao expandir. `dayKey`
 * restringe ao dia desta linha — o catálogo do site é por LEILÃO, não por dia, e leilões que
 * se estendem por mais de um dia (mesmo `idLeilao`) trariam lotes de outros dias junto.
 *
 * Fim do pregão, em ordem de confiança: (1) sinal PRECISO de `usePresencialNow` (peça atual =
 * total); (2) heurística de 3h já usada pelo badge "Encerrado" (`statusEnded`, de
 * `houseAuctionInfo`) — descoberto na prática: quando o pregão termina de verdade, o polling
 * do presencial costuma parar de responder em vez de ficar parado em "peça = total", então o
 * sinal preciso sozinho nunca dispara pra maioria das casas; (3) override MANUAL do usuário
 * (`useManuallyFinished`, `src/lib/manually-finished-auctions.ts`, só no navegador) — leilões
 * mais rápidos que 3h (comum) ficam sem sinal 1 e 2 até completar as 3h, então o usuário pode
 * marcar "encerrado" à mão quando souber que acabou (botão bandeira ao lado do link).
 *
 * ⚠️ **Nenhum sinal vale pra um dia "Em breve"** (`status === "upcoming"`): achado do usuário
 * — casa cujo catálogo se estende por mais de um dia (mesmo `idLeilao`) tinha "lotes sem
 * lance" habilitado também na linha de um dia FUTURO que nem começou, porque o sinal preciso
 * (mesma URL de presencial, sem dia embutido) e o override manual (antes só por `idLeilao`,
 * agora por `idLeilao:dayKey`) valiam pra QUALQUER dia daquela casa. `isFinished` agora exige
 * `status !== "upcoming"` antes de considerar qualquer um dos três sinais.
 */
export function PresencialOrUnsoldLink({
  presencialUrl,
  idLeilao,
  dayKey,
  status,
}: {
  presencialUrl: string;
  idLeilao: string;
  dayKey: string;
  status: "upcoming" | "live" | "ended" | null;
}) {
  const { isFinished: presencialFinished } = usePresencialNow(presencialUrl);
  const { finished: manuallyFinished, markFinished } = useManuallyFinished(idLeilao, dayKey);
  const isFinished =
    status !== "upcoming" && (presencialFinished || status === "ended" || manuallyFinished);
  const [open, setOpen] = useState(false);
  const fetchUnsold = useServerFn(getUnsoldLots);
  const query = useQuery({
    queryKey: ["unsold-lots", idLeilao, dayKey] as const,
    queryFn: () => fetchUnsold({ data: { idLeilao, presencialUrl, dayKey } }),
    enabled: isFinished,
    staleTime: 5 * 60 * 1000,
  });

  if (!isFinished) {
    return (
      <>
        <a
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          href={presencialUrl}
          target="_blank"
          rel="noreferrer"
          title="Acompanhar o pregão presencial desta casa"
        >
          <Radio className="h-3 w-3" /> pregão presencial
        </a>
        <button
          type="button"
          onClick={markFinished}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          title="O sistema ainda não detectou o fim do pregão — marcar como encerrado manualmente (mostra os lotes sem lance)"
        >
          <Flag className="h-3 w-3" />
        </button>
      </>
    );
  }

  const lots = query.data?.lots ?? [];
  const total = query.data?.total ?? null;
  const countLabel = query.isLoading
    ? "lotes sem lance…"
    : total !== null
      ? `lotes sem lance (${lots.length} de ${total})`
      : `lotes sem lance (${lots.length})`;

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
        {countLabel}
      </button>
      {open ? (
        <div className="basis-full">
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          ) : lots.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum lote sem lance encontrado.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {lots.map((lot) => (
                <UnsoldLotCard key={lot.idPeca} lot={lot} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
