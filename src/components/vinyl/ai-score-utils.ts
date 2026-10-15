// Classes de cor (Tailwind) dos selos de nota/oportunidade e da borda por estado do lance. Tudo o
// que é lógica pura (álbum, mercado, veredicto, rótulos) mora em `@/lib/lot-score` e é reexportado
// aqui para as telas importarem de um lugar só.
import { bidIsWinning } from "@/lib/vinyl-parse";

export * from "@/lib/lot-score";

/** Classes de cor do badge por faixa de nota (verde alto → cinza baixo). */
export function scoreTone(score: number | null): string {
  if (score === null) return "bg-secondary text-muted-foreground";
  if (score >= 80) return "bg-emerald-500 text-white";
  if (score >= 60) return "bg-green-600 text-white";
  if (score >= 40) return "bg-amber-500 text-black";
  if (score >= 20) return "bg-orange-500 text-white";
  return "bg-zinc-500 text-white";
}

export function dealTone(d: string | null): string {
  if (d === "barato") return "text-emerald-600 dark:text-emerald-400";
  if (d === "caro") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

/**
 * Cor da BORDA de um item conforme o padrão do site (mesma regra do `LotCard`/painel):
 * meu lance ganhando = verde; meu lance coberto = vermelho; apenas vigiado = amarelo;
 * caso contrário, neutro. Usado como borda esquerda nas linhas das tabelas da Análise.
 */
export function rowStatusTone(bidStatus: string | null | undefined, watched: boolean): string {
  const hasBid = bidStatus !== undefined && bidStatus !== null && bidStatus !== "";
  if (hasBid)
    return bidIsWinning(bidStatus)
      ? "border-l-4 border-l-green-500"
      : "border-l-4 border-l-red-500";
  if (watched) return "border-l-4 border-l-yellow-500";
  return "border-l-4 border-l-transparent";
}
