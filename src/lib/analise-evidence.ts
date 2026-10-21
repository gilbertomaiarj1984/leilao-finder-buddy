/**
 * "Por que esta nota": as evidências que o app tem de um lote (raridade, preço contra o mercado,
 * estado, vendas passadas, procura, casa, Coleção, De olho), cada uma com um tom. São os mesmos
 * dados que entram no contexto da IA — aqui só se mostram, sem inventar pesos numéricos.
 */
import { gradeAtLeast } from "./analise-rank";
import type { LotEconomics } from "./lot-score";
import type { PastSales } from "./past-sales";

export type EvidenceTone = "good" | "warn" | "bad" | "none";
type Evidence = { tone: EvidenceTone; text: string };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const RARITY_TEXT: Record<string, string> = {
  comum: "comum",
  interessante: "interessante",
  raro: "raro",
  muito_raro: "muito raro",
};

export type EvidenceInput = {
  rarity: string | null;
  eco: LotEconomics;
  media: string | null;
  sleeve: string | null;
  insert: "sim" | "nao" | null;
  past: PastSales | null;
  want: number | null;
  have: number | null;
  house: string;
  houseLevel: "verde" | "amarelo" | "laranja" | "vermelho" | null;
  lookout: boolean;
  interest: boolean;
  owned: { score: number } | null;
  ownedConfidentMin: number;
  /** Título de um lote excluído parecido com este ("possível lixo"). */
  trashLike: string | null;
};

export function buildEvidence(i: EvidenceInput): Evidence[] {
  const out: Evidence[] = [];
  out.push({
    tone:
      i.rarity === "raro" || i.rarity === "muito_raro"
        ? "good"
        : i.rarity === "comum"
          ? "bad"
          : i.rarity
            ? "warn"
            : "none",
    text: i.rarity ? `Raridade: ${RARITY_TEXT[i.rarity] ?? i.rarity}` : "Raridade: não avaliada",
  });
  if (i.eco.deal === "indefinido" || i.eco.ratio === null) {
    out.push({ tone: "none", text: "Preço: sem referência no Discogs" });
  } else {
    out.push({
      tone: i.eco.deal === "barato" ? "good" : i.eco.deal === "caro" ? "bad" : "warn",
      text: `Preço: ${i.eco.deal} (${Math.round(i.eco.ratio * 100)}% do Discogs com frete)`,
    });
  }
  if (!i.media) {
    out.push({ tone: "none", text: "Estado: não identificado no texto do lote" });
  } else {
    const parts = [
      `disco ${i.media}`,
      i.sleeve ? `capa ${i.sleeve}` : null,
      i.insert === "sim" ? "com encarte" : null,
    ];
    out.push({
      tone: gradeAtLeast(i.media, "VG+") ? "good" : gradeAtLeast(i.media, "VG") ? "warn" : "bad",
      text: `Estado: ${parts.filter(Boolean).join(", ")}`,
    });
  }
  if (i.past) {
    const total = i.eco.total;
    out.push({
      tone: total === null ? "none" : total <= i.past.median ? "good" : "warn",
      text: `Vendas passadas: ${i.past.count} venda(s), mediana ${brl(i.past.median)} (última ${brl(i.past.last?.price ?? i.past.median)})`,
    });
  } else {
    out.push({ tone: "none", text: "Vendas passadas: nenhuma deste disco no Analytics" });
  }
  if (i.want !== null && i.want > 0) {
    const ratio = i.want / Math.max(i.have ?? 0, 1);
    out.push({
      tone: ratio >= 1.5 ? "good" : "warn",
      text: `Procura no Discogs: ${i.want} querem × ${i.have ?? 0} têm`,
    });
  }
  out.push({
    tone:
      i.houseLevel === "verde"
        ? "good"
        : i.houseLevel === "amarelo"
          ? "warn"
          : i.houseLevel
            ? "bad"
            : "none",
    text: `Casa: ${i.house} (${i.houseLevel ? `semáforo ${i.houseLevel}` : "sem avaliação"})`,
  });
  if (i.lookout) out.push({ tone: "good", text: "Está no seu De olho" });
  if (i.interest) out.push({ tone: "good", text: "Combina com seus interesses" });
  if (i.owned) {
    out.push({
      tone: "bad",
      text:
        i.owned.score >= i.ownedConfidentMin
          ? "Já está na sua Coleção"
          : "Possível cópia na sua Coleção",
    });
  }
  if (i.trashLike)
    out.push({
      tone: "bad",
      text: `Possível lixo: parecido com um lote que você excluiu («${i.trashLike}»)`,
    });
  return out;
}
