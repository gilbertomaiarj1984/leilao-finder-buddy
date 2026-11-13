import { decodeHtmlEntities } from "./vinyl-parse";

/**
 * Leitura dos CONTATOS de uma página de pregão (`leilao.asp?Num=…`) para reconhecer a LOJA que
 * vende quando um leiloeiro hospeda várias lojas no mesmo site (Alberto Lopes → Discos da
 * Palmeira / JM Antiguidades; Claudio Firmino → Família Sardinha; Bruce Angeiras → Leilão Meier).
 *
 * Regra do Giba: só vale o bloco "Local" (retirada/endereço da loja). O cabeçalho e o rodapé do
 * site são do LEILOEIRO e iguais em todos os pregões, então ficam de fora. Telefone/WhatsApp fora
 * do "Local" (linha "Exposição", "Informações importantes", `TEL_ZAP`) é CHAVE FRACA: só sugere.
 *
 * Módulo puro (sem I/O): a leitura da página e a gravação ficam em `auction-contact.server.ts`.
 */

type AuctionPageContacts = {
  model: "v89" | "v71" | "unknown";
  siteName: string;
  siteId: string;
  title: string;
  /** Texto do bloco "Local" (para exibir/diagnosticar). */
  localText: string;
  /** Chaves do bloco "Local" (e-mail, telefone, endereço, CEP). */
  strong: string[];
  /** Telefone/e-mail fora do "Local" e que não são do leiloeiro. */
  weak: string[];
};

/** Resultado de ler a página do pregão (mostrado ao Giba ao informar a loja). */
export type CaptureResult = {
  status: "saved" | "no-contact" | "failed";
  /** Chaves em texto legível. */
  strong: string[];
  weak: string[];
  note: string;
};

export type StoreSaveResult = { capture: CaptureResult | null };

// ---------------------------------------------------------------- chaves de contato

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const PHONE_RE = /(?<!\d)(?:\+?55[\s-]*)?\(?(\d{2})\)?[\s.-]*(9?\d{4})[\s.-]*(\d{4})(?!\d)/g;
const CEP_RE = /(?<!\d)(\d{5})-?(\d{3})(?!\d)/g;
const STREET_RE =
  /\b((?:rua|r\.|avenida|av\.?|alameda|travessa|estrada|rodovia|pra[cç]a|largo)\s+[^,\n;()]+?)[\s,.-]*(?:n[ºo°.]{0,2}\s*)?(\d{1,5})\b/i;

function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML → linhas de texto puro (`<br>`/`<p>`/`<div>` viram quebra de linha). */
function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|h\d|tr|span)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return withBreaks
    .split("\n")
    .map((l) => decodeHtmlEntities(l))
    .filter(Boolean);
}

/** Chaves de contato (`email:`, `tel:`, `cep:`, `end:`) de um texto. Ordem estável, sem repetição. */
export function contactKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) keys.add(`email:${m[0].toLowerCase()}`);
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(PHONE_RE)) keys.add(`tel:${m[1]}${m[2]}${m[3]}`);
    for (const m of line.matchAll(CEP_RE)) keys.add(`cep:${m[1]}${m[2]}`);
    const street = STREET_RE.exec(line);
    if (street) keys.add(`end:${plain(street[1]!)} ${street[2]}`);
  }
  return [...keys];
}

// ---------------------------------------------------------------- leitura da página

function jsonField(decoded: string, key: string): string {
  // `loadData` vem como JSON mal-formado dentro do HTML (aspas escapadas como entidade): lê
  // `"CHAVE":"valor"` até a próxima `","OUTRA_CHAVE":` sem tentar `JSON.parse`.
  const m = new RegExp(`"${key}":"([\\s\\S]*?)"(?:,"[A-Z_]{2,}":|\\}|$)`).exec(decoded);
  return m?.[1] ?? "";
}

/** Contatos do cabeçalho/rodapé (do leiloeiro, iguais em todos os pregões do site). */
function siteLevelKeys(html: string): Set<string> {
  const out = new Set<string>();
  const add = (chunk: string) => {
    for (const k of contactKeys(htmlToLines(chunk).join("\n"))) out.add(k);
  };
  for (const m of html.matchAll(/class="[^"]*(?:telefone-topo|mail-topo)[^"]*"[\s\S]{0,500}/gi)) {
    add(m[0]);
  }
  const header = /^[\s\S]*?<!--\s*Topo do Header End\s*-->/i.exec(html);
  if (header) add(header[0].slice(-4000));
  const footer = /<footer[\s\S]*?<\/footer>/i.exec(html);
  if (footer) add(footer[0]);
  for (const m of html.matchAll(/mailto:([^"'>\s]+)/gi)) out.add(`email:${m[1]!.toLowerCase()}`);
  return out;
}

/** Bloco com o título `titleRe` (`<h2><span>…Título</span></h2>` + `<span>conteúdo</span>`). */
function sectionBlock(html: string, titleRe: RegExp): string {
  const head = new RegExp(`${titleRe.source}\\s*<\\/span>\\s*<\\/h2>\\s*<\\/div>`, "i").exec(html);
  if (!head) return "";
  const rest = html.slice(head.index + head[0].length);
  const body = /<span>([\s\S]*?)<\/span>\s*<\/div>/i.exec(rest);
  return body?.[1] ?? "";
}

export function parseAuctionPage(html: string): AuctionPageContacts {
  const siteLevel = siteLevelKeys(html);
  const decoded = html.includes("&#34;") ? decodeHtmlEntities(html) : html;
  const hasJson = /"IDLEILAO":"/.test(decoded) && /"LOCAL":"/.test(decoded);

  let model: AuctionPageContacts["model"] = "unknown";
  let siteName = "";
  let siteId = "";
  let title = "";
  let localHtml = "";
  let otherHtml = "";

  if (hasJson) {
    model = "v89";
    siteName = decodeHtmlEntities(jsonField(decoded, "NOMESITE"));
    siteId = jsonField(decoded, "IDSITE");
    title = decodeHtmlEntities(jsonField(decoded, "TITULO"));
    localHtml = jsonField(decoded, "LOCAL");
    otherHtml = [jsonField(decoded, "EXPOSICAO"), jsonField(decoded, "TEL_ZAP")].join("\n");
  } else {
    localHtml = sectionBlock(html, /fa-map-marker[^>]*>\s*<\/i>\s*Local/);
    const exposicao = sectionBlock(
      html,
      /fa-calendar[^>]*>\s*<\/i>\s*Exposi(?:ç|c|&ccedil;|&#231;)(?:ã|a|&atilde;|&#227;)o/,
    );
    const important = /content-info-important[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? "";
    otherHtml = `${exposicao}\n${important}`;
    if (localHtml) model = "v71";
    title = decodeHtmlEntities(
      /title-numleilao[^>]*>[\s\S]*?<\/span>\s*([\s\S]*?)<\/h2>/i
        .exec(html)?.[1]
        ?.replace(/<[^>]+>/g, " ") ?? "",
    );
  }

  const localLines = htmlToLines(localHtml);
  const otherLines = htmlToLines(otherHtml);
  const strong = contactKeys(localLines.join("\n")).filter((k) => !siteLevel.has(k));
  const weak = contactKeys(otherLines.join("\n")).filter(
    (k) => !siteLevel.has(k) && !strong.includes(k),
  );
  return {
    model,
    siteName,
    siteId,
    title,
    localText: localLines.join(" ").slice(0, 600),
    strong,
    weak,
  };
}

// ---------------------------------------------------------------- casamento com lojas já conhecidas

/** Um pregão já lido, com a loja atual dele (`""` = nenhuma / padrão). */
export type KnownAuction = {
  id: string;
  store: string;
  /** Quem definiu a loja: só "manual" e "confirmado" ENSINAM; "auto" não propaga erro. */
  source: "manual" | "auto" | "confirmado" | "";
  strong: string[];
  weak: string[];
};

export type StoreMatch =
  | { kind: "auto"; store: string; via: string }
  | { kind: "suggest"; store: string; via: string }
  | { kind: "none"; reason: string };

const teaches = (a: KnownAuction) =>
  !!a.store && (a.source === "manual" || a.source === "confirmado");

/**
 * Decide a loja de um pregão novo comparando suas chaves com as dos pregões já conhecidos.
 * - Chave FORTE (bloco "Local") que bate com UMA só loja ensinada, sem nenhum pregão sem loja
 *   usando o mesmo contato: vincula sozinho ("auto").
 * - Chave FRACA (telefone fora do "Local", ou contato do "Local" que só aparece como fraco do
 *   outro lado): só SUGERE, nunca vincula.
 * - Contato repetido em lojas diferentes, ou em pregão sem loja (é do leiloeiro): nada.
 * `blocked` = pares `loja|chave` que o Giba marcou "Não é".
 */
export function matchStore(args: {
  id: string;
  strong: readonly string[];
  weak: readonly string[];
  known: readonly KnownAuction[];
  blocked?: ReadonlySet<string>;
}): StoreMatch {
  const { id, known } = args;
  const blocked = args.blocked ?? new Set<string>();
  const others = known.filter((k) => k.id !== id);

  const resolve = (
    keys: readonly string[],
    sharesWith: (a: KnownAuction) => string | undefined,
  ): { store: string; via: string } | { reason: string } | null => {
    const stores = new Set<string>();
    let via = "";
    let conflict = false;
    for (const a of others) {
      const shared = sharesWith(a);
      if (!shared) continue;
      if (!a.store) {
        conflict = true; // o mesmo contato aparece em pregão sem loja: é do leiloeiro
        continue;
      }
      if (!teaches(a)) continue;
      if (blocked.has(`${a.store}|${shared}`)) continue;
      stores.add(a.store);
      via ||= shared;
    }
    if (keys.length === 0 || (stores.size === 0 && !conflict)) return null;
    if (conflict) return { reason: "contato repetido em pregão sem loja" };
    if (stores.size > 1) return { reason: "contato repetido em lojas diferentes" };
    return { store: [...stores][0]!, via };
  };

  const strongKeys = new Set(args.strong);
  const weakKeys = new Set(args.weak);
  const allKeys = new Set([...strongKeys, ...weakKeys]);

  const strongHit = resolve(args.strong, (a) => a.strong.find((k) => strongKeys.has(k)));
  if (strongHit && "store" in strongHit) {
    return { kind: "auto", store: strongHit.store, via: strongHit.via };
  }
  const anyHit = resolve([...allKeys], (a) => [...a.strong, ...a.weak].find((k) => allKeys.has(k)));
  if (anyHit && "store" in anyHit) {
    return { kind: "suggest", store: anyHit.store, via: anyHit.via };
  }
  const reason =
    (strongHit && "reason" in strongHit && strongHit.reason) ||
    (anyHit && "reason" in anyHit && anyHit.reason) ||
    (allKeys.size === 0 ? "sem contato" : "sem loja conhecida com esse contato");
  return { kind: "none", reason };
}

/** Texto curto da chave para mostrar ao Giba ("telefone (21) 98228-9851"). */
export function describeKey(key: string): string {
  const [kind, ...rest] = key.split(":");
  const v = rest.join(":");
  if (kind === "email") return `e-mail ${v}`;
  if (kind === "tel") {
    const ddd = v.slice(0, 2);
    const num = v.slice(2);
    return `telefone (${ddd}) ${num.length === 9 ? `${num.slice(0, 5)}-${num.slice(5)}` : `${num.slice(0, 4)}-${num.slice(4)}`}`;
  }
  if (kind === "cep") return `CEP ${v.slice(0, 5)}-${v.slice(5)}`;
  if (kind === "end") return `endereço ${v}`;
  return key;
}
