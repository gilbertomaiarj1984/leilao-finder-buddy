/**
 * Alerta de teto de lance (puro): avisa quando o valor atual de um lote VIGIADO cruza o teto de
 * "barato" (`lotEconomics.capCheap`: o maior lance que ainda fica ≤ 70% do Discogs com frete).
 * Avisa na ENTRADA na faixa (o lote ficou barato, ou já era barato quando o vigiaste) e na SAÍDA
 * (o lance passou do teto); nunca repete enquanto continua do mesmo lado.
 */
export type CapState = "below" | "above";

export type CapItem = {
  id: string;
  title: string;
  house: string;
  /** Valor atual do lote (BRL). */
  price: number;
  /** Teto para ainda ser barato (BRL); `null` = sem mercado casado, não há o que avisar. */
  capCheap: number | null;
};

type CapAlert = CapItem & { kind: "entered" | "left" };

export function decideCapAlerts(
  items: readonly CapItem[],
  prev: Readonly<Record<string, CapState>>,
): { alerts: CapAlert[]; next: Record<string, CapState> } {
  const alerts: CapAlert[] = [];
  const next: Record<string, CapState> = {};
  for (const it of items) {
    if (it.capCheap === null || !Number.isFinite(it.price)) continue;
    const state: CapState = it.price <= it.capCheap ? "below" : "above";
    next[it.id] = state;
    if (state === "below" && prev[it.id] !== "below") alerts.push({ ...it, kind: "entered" });
    // Só avisa a saída de quem tínhamos visto abaixo do teto (um lote que sempre esteve acima não vira aviso).
    else if (state === "above" && prev[it.id] === "below") alerts.push({ ...it, kind: "left" });
  }
  return { alerts, next };
}

const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

export function capAlertText(alerts: readonly CapAlert[]): { title: string; body: string } {
  const entered = alerts.filter((a) => a.kind === "entered").length;
  const left = alerts.length - entered;
  const title =
    alerts.length === 1
      ? alerts[0]!.kind === "entered"
        ? "Lote vigiado dentro do teto"
        : "Lote vigiado passou do teto"
      : entered && left
        ? `${alerts.length} lotes vigiados cruzaram o teto`
        : entered
          ? `${entered} lotes vigiados dentro do teto`
          : `${left} lotes vigiados passaram do teto`;
  const line = (a: CapAlert) =>
    `${a.kind === "entered" ? "↓" : "↑"} ${a.title.slice(0, 48)} (${a.house}): ${brl(a.price)} · teto ${brl(a.capCheap!)}`;
  return { title, body: alerts.slice(0, 5).map(line).join("\n") };
}
