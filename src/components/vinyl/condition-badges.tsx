import { scoreTone } from "@/components/vinyl/ai-score-utils";
import type { Condition } from "@/lib/grading";

/**
 * Badges de estado de conservação (Disco/Capa), Faixa/Score e encarte — padrão de card do
 * app (`rounded bg-secondary px-1.5 py-0.5 ...`). Compartilhado pelo card do lote e pela
 * Coleção. Não renderiza nada quando o estado é indefinido e não há informação de encarte.
 */
export function ConditionBadges({ condition }: { condition: Condition | null | undefined }) {
  if (!condition) return null;
  const { media, sleeve, insert, score, faixa } = condition;
  if (!media && !sleeve && insert === null) return null;

  return (
    <>
      {media ? (
        <span
          className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
          title="Estado do disco (mídia)"
        >
          Disco {media}
        </span>
      ) : null}
      {sleeve ? (
        <span
          className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
          title="Estado da capa"
        >
          Capa {sleeve}
        </span>
      ) : null}
      {score !== null && faixa ? (
        <span
          className={`rounded px-1.5 py-0.5 font-semibold ${scoreTone(score)}`}
          title={`Score Final ${score} — ${faixa.full}`}
        >
          {faixa.label} · {score}
        </span>
      ) : null}
      {insert === "sim" ? (
        <span
          className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
          title="Acompanha encarte interno"
        >
          Encarte
        </span>
      ) : insert === "nao" ? (
        <span
          className="rounded bg-secondary px-1.5 py-0.5 font-medium text-muted-foreground"
          title="Sem encarte interno"
        >
          Sem encarte
        </span>
      ) : null}
    </>
  );
}
