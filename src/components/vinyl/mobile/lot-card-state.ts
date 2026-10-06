import { auctionStarted, bidIsSold, bidIsWinning } from "@/lib/vinyl-parse";

// Estado visual do cartão de lote no celular — mesma regra do `LotCard` do desktop (precedência
// lance > vigia > de olho; guarda "leilão que ainda não começou não tem lote vendido"; quando
// estou vencendo, o valor atual é o meu lance), em função pura para testar sem DOM.

type LotCardTone = "win" | "lose" | "watch" | "eye" | "none";

export function lotCardState(input: {
  watched: boolean;
  bidStatus?: string | null;
  myBid?: string;
  price: string;
  dayKey: string;
  time: string;
  sold?: string | null;
  lookoutActive: boolean;
}): {
  hasBid: boolean;
  winning: boolean;
  tone: LotCardTone;
  soldLabel?: string;
  currentPrice: string;
} {
  const hasBid =
    input.bidStatus !== undefined && input.bidStatus !== null && input.bidStatus !== "";
  const winning = hasBid && bidIsWinning(input.bidStatus as string);
  const notStartedYet =
    Boolean(input.dayKey && input.time) && !auctionStarted(input.dayKey, input.time);
  const soldLabel = notStartedYet
    ? undefined
    : input.sold || (hasBid && bidIsSold(input.bidStatus as string) ? "Vendido" : undefined);
  const tone: LotCardTone = hasBid
    ? winning
      ? "win"
      : "lose"
    : input.watched
      ? "watch"
      : input.lookoutActive
        ? "eye"
        : "none";
  const currentPrice = winning && input.myBid ? input.myBid : input.price;
  return { hasBid, winning, tone, soldLabel, currentPrice };
}

/** Classes da borda esquerda do cartão por tom. */
export const TONE_BORDER: Record<LotCardTone, string> = {
  win: "border-l-green-500",
  lose: "border-l-red-500",
  watch: "border-l-yellow-500",
  eye: "border-l-fuchsia-500",
  none: "border-l-transparent",
};
