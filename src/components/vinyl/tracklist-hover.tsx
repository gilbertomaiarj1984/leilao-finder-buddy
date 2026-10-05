import { useMemo, useRef, useState } from "react";
import { ListMusic } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLotAiQuery } from "@/lib/queries";
import { groupTracksBySide, type Track, type TrackFame } from "@/lib/tracklist";

const FAME_DOT: Record<TrackFame, string> = {
  alta: "bg-green-500",
  media: "bg-yellow-400",
  baixa: "bg-red-500",
};

const FAME_LABEL: Record<TrackFame, string> = {
  alta: "Maiores sucessos",
  media: "Conhecidas",
  baixa: "Pouco conhecidas / lado B",
};

/**
 * Ícone de TRACKLIST do álbum (dados da IA, `lot_ai.tracklist`). Ao parar o mouse em cima
 * abre a lista por lado, com bolinha verde (mais famosas), amarela (menos) ou vermelha
 * (desconhecidas e/ou lado B). Toque/clique também abre (mobile). Sem tracklist, o ícone
 * fica apagado e explica que ela vem com a análise da IA.
 */
export function TracklistHover({
  tracklist,
  title,
}: {
  tracklist?: Track[] | null;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const has = Boolean(tracklist?.length);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (has) setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const tip = has
    ? "Tracklist do álbum (verde = mais famosas, vermelho = pouco conhecidas/lado B)"
    : "Tracklist ainda não disponível — vem com a análise da IA";

  return (
    <Popover open={open} onOpenChange={(o) => setOpen(o && has)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          className={`flex items-center rounded-full px-1.5 py-1 text-white shadow ${
            has ? "bg-sky-600" : "bg-zinc-500/50"
          }`}
          title={open ? undefined : tip}
          aria-label={tip}
        >
          <ListMusic className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      {has ? (
        <PopoverContent
          side="left"
          align="start"
          className="max-h-[70vh] w-80 overflow-y-auto p-3 text-xs"
          onMouseEnter={show}
          onMouseLeave={hide}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {title ? <p className="mb-2 text-sm font-semibold leading-snug">{title}</p> : null}
          <div className="space-y-2">
            {groupTracksBySide(tracklist ?? []).map((g, gi) => (
              <div key={`${g.side ?? "-"}-${gi}`}>
                {g.side ? (
                  <p className="mb-1 font-semibold text-muted-foreground">Lado {g.side}</p>
                ) : null}
                <ul className="space-y-1">
                  {g.tracks.map((t, i) => (
                    <li key={`${t.title}-${i}`} className="flex items-start gap-2">
                      <span
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${FAME_DOT[t.fame]}`}
                        title={FAME_LABEL[t.fame]}
                      />
                      <span className="leading-snug">{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
            {(Object.keys(FAME_DOT) as TrackFame[]).map((f) => (
              <span key={f} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${FAME_DOT[f]}`} />
                {FAME_LABEL[f]}
              </span>
            ))}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

/**
 * Tracklist de um item que veio de um LOTE (Compras/Coleção): reaproveita a tracklist já
 * gravada na avaliação da IA do lote (`lot_ai.tracklist`), achada pelo `lotId`. Sem lote ou sem
 * avaliação (ex.: lote já podado do banco), o ícone fica apagado.
 */
export function LotTracklistHover({ lotId, title }: { lotId?: string | null; title?: string }) {
  const aiQuery = useLotAiQuery();
  const tracklist = useMemo(
    () => (lotId ? (aiQuery.data?.find((r) => r.id === lotId)?.tracklist ?? null) : null),
    [aiQuery.data, lotId],
  );
  return <TracklistHover tracklist={tracklist} title={title} />;
}
