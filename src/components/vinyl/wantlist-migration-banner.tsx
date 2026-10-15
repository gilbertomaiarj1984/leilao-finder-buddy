import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  dismissWantlistFailures,
  getWantlistMigration,
  migrateWantlist,
} from "@/lib/lookout.functions";
import { queryKeys } from "@/lib/queries";

/**
 * Aviso de migração da Sondagem (descontinuada) para o De olho. Só aparece enquanto houver obra
 * por migrar ou que a IA não resolveu; some sozinho quando tudo estiver migrado. Cada obra é lida
 * pela IA (artista/álbum/ano) e vira um disco de olho; as já adquiridas entram como «adquiridas».
 */
export function WantlistMigrationBanner({ onChanged }: { onChanged: () => void }) {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getWantlistMigration);
  const runMigrate = useServerFn(migrateWantlist);
  const runDismiss = useServerFn(dismissWantlistFailures);
  const status = useQuery({
    queryKey: queryKeys.wantlistMigration,
    queryFn: () => fetchStatus(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ migrated: number; total: number } | null>(null);

  const s = status.data;
  if (!s || (s.pending === 0 && s.failed.length === 0)) return null;

  const start = async () => {
    setBusy(true);
    try {
      for (let guard = 0; guard < 200; guard++) {
        const r = await runMigrate();
        queryClient.setQueryData(queryKeys.wantlistMigration, r);
        setProgress({ migrated: r.migrated, total: r.total });
        onChanged();
        if (r.pending === 0) break;
      }
      toast.success("Sondagem migrada para o De olho");
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível migrar a Sondagem");
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const dismiss = async () => {
    const r = await runDismiss();
    queryClient.setQueryData(queryKeys.wantlistMigration, r);
  };

  return (
    <div
      role="status"
      className="space-y-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <b className="text-amber-700 dark:text-amber-300">A Sondagem foi descontinuada.</b>{" "}
          {s.pending > 0 ? (
            <>
              {s.pending} obra(s) da sua lista ainda não estão no De olho. A migração usa a IA para
              separar artista e álbum de cada linha (um pouco de crédito) e não apaga nada.
            </>
          ) : (
            <>Estas obras não puderam ser migradas automaticamente:</>
          )}
          {progress ? (
            <span className="ml-1 text-muted-foreground">
              ({progress.migrated}/{progress.total} migradas)
            </span>
          ) : null}
        </div>
        {s.pending > 0 ? (
          <Button size="sm" onClick={() => void start()} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRightLeft className="mr-2 h-4 w-4" />
            )}
            {busy ? "Migrando…" : "Migrar para o De olho"}
          </Button>
        ) : null}
      </div>
      {s.failed.length ? (
        <div className="space-y-1">
          {s.pending > 0 ? (
            <p className="text-xs text-muted-foreground">Não resolvidas até agora:</p>
          ) : null}
          <ul className="list-inside list-disc text-xs">
            {s.failed.map((f) => (
              <li key={f.id}>
                {f.work}
                {f.year ? ` (${f.year})` : ""}{" "}
                <span className="text-muted-foreground">— {f.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Adicione-as pelo botão «Adicionar» (digitando artista e álbum) ou dispense o aviso.
          </p>
          <Button size="sm" variant="ghost" onClick={() => void dismiss()} disabled={busy}>
            Dispensar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
