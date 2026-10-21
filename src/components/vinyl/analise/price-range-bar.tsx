import type { PastSales } from "@/lib/past-sales";
import { DEAL_BAND_CHEAP, DEAL_BAND_EXPENSIVE, fmtMoney } from "@/lib/lot-score";

/**
 * Onde o custo do lote (lance + frete) cai na faixa de preços já vendidos do MESMO disco
 * (Analytics): a barra azul vai do menor ao maior valor vendido, o traço é a mediana e o losango é
 * o custo de hoje (verde ≤ 70% da mediana, vermelho ≥ 115%, mesmas faixas do veredicto).
 */
export function PriceRangeBar({ total, past }: { total: number; past: PastSales }) {
  const lo = Math.min(past.min, total) * 0.85;
  const hi = Math.max(past.max, total) * 1.1;
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  const tone =
    total <= past.median * DEAL_BAND_CHEAP
      ? "bg-green-600"
      : total >= past.median * DEAL_BAND_EXPENSIVE
        ? "bg-red-600"
        : "bg-foreground";
  const title = `Vendas passadas: ${fmtMoney(past.min, "BRL")} a ${fmtMoney(past.max, "BRL")}, mediana ${fmtMoney(past.median, "BRL")} (${past.count} venda(s)). O losango é o custo de hoje: ${fmtMoney(total, "BRL")}.`;
  return (
    <div className="relative mt-1 h-5 min-w-[160px]" role="img" aria-label={title} title={title}>
      <div className="absolute inset-x-0 top-2 h-1 rounded bg-secondary" />
      <div
        className="absolute top-[7px] h-2 rounded border border-primary bg-primary/15"
        style={{ left: pos(past.min), width: `calc(${pos(past.max)} - ${pos(past.min)})` }}
      />
      <div className="absolute top-1 h-3.5 w-0.5 bg-primary" style={{ left: pos(past.median) }} />
      <div
        className={`absolute top-1 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border-2 border-card ${tone}`}
        style={{ left: pos(total) }}
      />
    </div>
  );
}
