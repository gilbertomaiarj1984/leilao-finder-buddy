import { dealLabel, rarityLabel } from "@/components/vinyl/ai-score-utils";

/**
 * Conteúdo (assunto/texto/HTML) dos e-mails do app. Funções puras: quem monta os dados e envia
 * são `lookout-matches.server.ts` (aviso do "De olho") e `daily-digest.server.ts` (resumo diário).
 */
export type EmailContent = { subject: string; text: string; html: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brl(n: number | null): string {
  return n == null ? "—" : `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function brlRange(low: number | null, high: number | null): string {
  if (low == null && high == null) return "—";
  if (low != null && high != null && low !== high) return `${brl(low)}–${brl(high)}`;
  return brl(low ?? high);
}

/** "2026-10-12" + "19:30h" → "12/10 19:30h". */
function when(dayKey: string, time: string): string {
  const [, m, d] = dayKey.split("-");
  const day = m && d ? `${d}/${m}` : dayKey;
  return time ? `${day} ${time}` : day;
}

/** "IA: nota 82 · raro · barato" (só o que existe). */
function aiLine(aiScore: number | null, rarity: string | null, deal: string | null): string {
  const parts: string[] = [];
  if (aiScore != null) parts.push(`nota ${aiScore}`);
  if (rarity) parts.push(rarityLabel(rarity).toLowerCase());
  if (deal && deal !== "indefinido") parts.push(dealLabel(deal).toLowerCase());
  return parts.length ? `IA: ${parts.join(" · ")}` : "";
}

const WRAP =
  "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px;";
const BTN =
  "display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px;";

function button(label: string, href: string | undefined): string {
  return href ? `<a href="${escapeHtml(href)}" style="${BTN}">${escapeHtml(label)}</a>` : "";
}

// ---------------------------------------------------------------------------
// Aviso do "De olho"
// ---------------------------------------------------------------------------

export type LookoutEmailEntry = {
  label: string; // "Artista — Álbum" do disco marcado
  house: string;
  dayKey: string;
  time: string;
  lote: string;
  url: string;
  price: number | null;
  ceiling: number | null;
  /** 0–1. */
  score: number;
  aiScore: number | null;
  rarity: string | null;
  deal: string | null;
  marketLow: number | null;
  marketHigh: number | null;
};

function ceilingState(e: LookoutEmailEntry): "within" | "above" | null {
  if (e.ceiling == null || e.price == null) return null;
  return e.price <= e.ceiling ? "within" : "above";
}

export function buildLookoutEmail(
  entries: readonly LookoutEmailEntry[],
  pageUrl?: string,
): EmailContent {
  // Dentro do teto primeiro; depois o resto, na ordem recebida (data do pregão).
  const rank = (e: LookoutEmailEntry) => (ceilingState(e) === "within" ? 0 : 1);
  const list = entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i);
  const n = list.length;
  const subject = `👁 De olho: ${n} ${n === 1 ? "novo lote casa" : "novos lotes casam"} com seus discos`;

  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  list.forEach(({ e }, idx) => {
    const state = ceilingState(e);
    const stateText =
      state === "within" ? " [dentro do teto]" : state === "above" ? " [ACIMA do teto]" : "";
    const lote = e.lote ? ` · lote ${e.lote}` : "";
    const price = `Lance atual ${brl(e.price)} · ${e.ceiling != null ? `seu teto ${brl(e.ceiling)}` : "sem teto"} · confiança ${Math.round(e.score * 100)}%`;
    const ai = aiLine(e.aiScore, e.rarity, e.deal);
    const market =
      e.marketLow != null || e.marketHigh != null
        ? `Discogs: ${brlRange(e.marketLow, e.marketHigh)}`
        : "";
    const extra = [ai, market].filter(Boolean).join(" · ");
    textBlocks.push(
      [
        `${idx + 1}. ${e.label}${stateText}`,
        `${e.house} · ${when(e.dayKey, e.time)}${lote}`,
        price,
        extra,
        e.url,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const badge =
      state === "within"
        ? ' <span style="color:#15803d">● dentro do teto</span>'
        : state === "above"
          ? ' <span style="color:#b91c1c">● acima do teto</span>'
          : "";
    htmlBlocks.push(
      `<div style="border-top:1px solid #e5e5e5;padding:12px 0;">` +
        `<div style="font-size:15px;font-weight:600;">${idx + 1}. ${escapeHtml(e.label)}${badge}</div>` +
        `<div style="color:#555;">${escapeHtml(e.house)} · ${escapeHtml(when(e.dayKey, e.time))}${escapeHtml(lote)}</div>` +
        `<div>${escapeHtml(price)}</div>` +
        (extra ? `<div style="color:#555;">${escapeHtml(extra)}</div>` : "") +
        `<div style="margin-top:8px;">${button("Ver lote", e.url)}</div></div>`,
    );
  });

  const text = [
    "Novos lotes que casam com o que você procura",
    "",
    textBlocks.join("\n\n"),
    ...(pageUrl ? ["", `Abrir página De olho: ${pageUrl}`] : []),
  ].join("\n");
  const html =
    `<div style="${WRAP}"><h2 style="margin:0 0 8px;">Novos lotes que casam com o que você procura</h2>` +
    htmlBlocks.join("") +
    (pageUrl
      ? `<div style="border-top:1px solid #e5e5e5;padding-top:12px;">${button("Abrir página De olho", pageUrl)}</div>`
      : "") +
    `</div>`;
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Resumo diário dos melhores lotes
// ---------------------------------------------------------------------------

export type DigestEntry = {
  title: string; // "Artista — Álbum" (ou o título do lote)
  house: string;
  dayKey: string;
  time: string;
  url: string;
  price: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  aiScore: number;
  rarity: string | null;
  deal: string | null;
  watched: boolean;
};

export function buildDigestEmail(
  entries: readonly DigestEntry[],
  dateLabel: string,
  appUrl?: string,
): EmailContent {
  const subject = `🎵 Garimpo de Vinil: os ${entries.length} melhores lotes de hoje (${dateLabel})`;
  const sub = "Escolhidos pela nota da IA (lotes marcados como caros ficam de fora).";

  const text = [
    "Melhores lotes nos próximos 5 dias",
    sub,
    "",
    ...entries.map((e, i) => {
      const market =
        e.marketLow != null || e.marketHigh != null
          ? ` · Discogs ${brlRange(e.marketLow, e.marketHigh)}`
          : "";
      return [
        `${i + 1}. ${e.watched ? "⭐ " : ""}${e.title}`,
        `   ${e.house} · ${when(e.dayKey, e.time)} · atual ${brl(e.price)}${market}`,
        `   ${aiLine(e.aiScore, e.rarity, e.deal)}`,
        `   ${e.url}`,
      ].join("\n");
    }),
    ...(appUrl ? ["", `Abrir o Garimpo: ${appUrl}`] : []),
  ].join("\n");

  const th =
    'style="text-align:left;padding:6px 8px;border-bottom:2px solid #1a1a1a;font-size:12px;"';
  const td = 'style="padding:8px;border-bottom:1px solid #e5e5e5;vertical-align:top;"';
  const rows = entries
    .map((e, i) => {
      const title = e.url
        ? `<a href="${escapeHtml(e.url)}" style="color:#1a1a1a;font-weight:600;">${escapeHtml(e.title)}</a>`
        : `<b>${escapeHtml(e.title)}</b>`;
      return (
        `<tr><td ${td}>${i + 1}</td>` +
        `<td ${td}>${e.watched ? "⭐ " : ""}${title}<br><span style="color:#555;">${escapeHtml(e.house)} · ${escapeHtml(when(e.dayKey, e.time))}</span></td>` +
        `<td ${td}>${escapeHtml(brl(e.price))}</td>` +
        `<td ${td}>${escapeHtml(brlRange(e.marketLow, e.marketHigh))}</td>` +
        `<td ${td}><b>${e.aiScore}</b><br><span style="color:#555;">${escapeHtml(aiLine(null, e.rarity, e.deal).replace(/^IA: /, ""))}</span></td></tr>`
      );
    })
    .join("");
  const html =
    `<div style="${WRAP}"><h2 style="margin:0 0 4px;">Melhores lotes nos próximos 5 dias</h2>` +
    `<div style="color:#555;margin-bottom:12px;">${escapeHtml(sub)}</div>` +
    `<table style="border-collapse:collapse;width:100%;"><tr><th ${th}>#</th><th ${th}>Lote</th><th ${th}>Atual</th><th ${th}>Discogs</th><th ${th}>IA</th></tr>${rows}</table>` +
    (appUrl ? `<div style="padding-top:16px;">${button("Abrir o Garimpo", appUrl)}</div>` : "") +
    `</div>`;
  return { subject, text, html };
}
