import { mutateAppState, parseStringList } from "@/lib/app-state-mutate.server";
import { db } from "@/lib/db-client.server";

import {
  describeKey,
  matchStore,
  type CaptureResult,
  parseAuctionPage,
  type KnownAuction,
  type StoreMatch,
} from "./auction-contact";
import { publicFetch } from "./leiloesbr-auth.server";
import { setAuctionStoreWithSource } from "./purchase-shipping.server";
import { parseAuctionRef } from "./vinyl-parse";

/**
 * Contatos dos pregões (`auction_contacts`) para reconhecer a LOJA de um pregão novo de um
 * leiloeiro que hospeda várias lojas. Ver `auction-contact.ts` (regras puras e testadas).
 *
 * Fluxo: (1) ao informar a loja de um pregão, lê a página e guarda a impressão digital; (2) o
 * passo `storelink` do cron lê os pregões novos desses sites e vincula (chave forte) ou sugere
 * (chave fraca). Falha de leitura NUNCA impede salvar a loja.
 */

/** `app_state.store_contact_blocked`: pares `loja|chave` que o usuário marcou como "Não é". */
const BLOCKED_KEY = "store_contact_blocked";

type ContactRow = {
  id_leilao: string;
  domain: string;
  strong: string[] | null;
  weak: string[] | null;
  model: string;
  local_text: string;
  ok: boolean;
  note: string;
  suggest_store: string;
  suggest_via: string;
  linked_via: string;
};

const CONTACT_COLS =
  "id_leilao, domain, strong, weak, model, local_text, ok, note, suggest_store, suggest_via, linked_via";

async function readBlocked(): Promise<Set<string>> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", BLOCKED_KEY)
    .maybeSingle();
  if (error) return new Set();
  return new Set(parseStringList(data?.value));
}

async function addBlocked(store: string, key: string): Promise<void> {
  if (!store || !key) return;
  const pair = `${store}|${key}`;
  await mutateAppState(BLOCKED_KEY, parseStringList, (cur) =>
    cur.includes(pair) ? cur : [...cur, pair],
  );
}

/** Domínio do site onde o pregão está publicado (a partir do link do lote/pregão que já temos). */
async function resolveDomain(idLeilao: string): Promise<string | null> {
  const seen = await db
    .from<{ entry_url: string | null }>("seen_auctions")
    .select("entry_url")
    .eq("id_leilao", idLeilao);
  for (const row of seen.data ?? []) {
    const ref = row.entry_url ? parseAuctionRef(row.entry_url) : null;
    if (ref) return ref.domain;
  }
  const lots = await db
    .from<{ url: string }>("lots")
    .select("url")
    .eq("id_leilao", idLeilao)
    .limit(1);
  for (const row of lots.data ?? []) {
    const ref = parseAuctionRef(row.url);
    if (ref) return ref.domain;
  }
  return null;
}

/** Lê a página do pregão e grava as chaves (sem decidir loja). */
export async function captureAuctionContacts(idLeilao: string): Promise<CaptureResult> {
  const domain = await resolveDomain(idLeilao);
  const save = async (row: Partial<ContactRow>) => {
    await db.from("auction_contacts").upsert(
      {
        id_leilao: idLeilao,
        domain: domain ?? "",
        strong: [],
        weak: [],
        model: "",
        local_text: "",
        ok: true,
        note: "",
        fetched_at: new Date().toISOString(),
        ...row,
      },
      { onConflict: "id_leilao" },
    );
  };
  if (!domain) {
    const note = "Não achei o site deste pregão.";
    await save({ ok: false, note });
    return { status: "failed", strong: [], weak: [], note };
  }
  let html: string;
  try {
    html = await publicFetch(`${domain}/leilao.asp?Num=${idLeilao}`);
  } catch (error) {
    const note = `Não consegui abrir a página do pregão (${(error as Error)?.message ?? "erro"}).`;
    await save({ ok: false, note: note.slice(0, 300) });
    return { status: "failed", strong: [], weak: [], note };
  }
  const page = parseAuctionPage(html);
  const empty = page.strong.length === 0 && page.weak.length === 0;
  await save({
    strong: page.strong,
    weak: page.weak,
    model: page.model,
    local_text: page.localText,
    ok: page.model !== "unknown",
    note: page.model === "unknown" ? "formato de página não reconhecido" : "",
  });
  if (page.model === "unknown") {
    return {
      status: "failed",
      strong: [],
      weak: [],
      note: "Abri a página, mas o formato não é um dos que conheço.",
    };
  }
  return {
    status: empty ? "no-contact" : "saved",
    strong: page.strong.map(describeKey),
    weak: page.weak.map(describeKey),
    note: empty ? 'Não há e-mail nem telefone no bloco "Local" desta página.' : "",
  };
}

/** Pregões já lidos + a loja de cada um (quem ensina e quem conflita). */
async function loadKnown(): Promise<KnownAuction[]> {
  const [contacts, states] = await Promise.all([
    db.from<ContactRow>("auction_contacts").select(CONTACT_COLS).eq("ok", true),
    db
      .from<{ id_leilao: string; store: string; store_source: string }>("purchase_auctions")
      .select("id_leilao, store, store_source"),
  ]);
  const stateById = new Map((states.data ?? []).map((s) => [s.id_leilao, s]));
  return (contacts.data ?? []).map((c) => {
    const s = stateById.get(c.id_leilao);
    const source = s?.store_source ?? "";
    return {
      id: c.id_leilao,
      store: (s?.store ?? "").trim(),
      source: source === "manual" || source === "auto" || source === "confirmado" ? source : "",
      strong: c.strong ?? [],
      weak: c.weak ?? [],
    };
  });
}

/**
 * Lê a página (se ainda não lida) e decide a loja do pregão: vincula (forte), sugere (fraca) ou
 * não faz nada. Nunca mexe em pregão que já tenha loja.
 */
async function linkAuction(idLeilao: string): Promise<StoreMatch | { kind: "failed" }> {
  const captured = await captureAuctionContacts(idLeilao);
  if (captured.status === "failed") return { kind: "failed" };
  const { data } = await db
    .from<ContactRow>("auction_contacts")
    .select(CONTACT_COLS)
    .eq("id_leilao", idLeilao);
  const row = (data ?? [])[0];
  if (!row) return { kind: "failed" };
  const [known, blocked] = await Promise.all([loadKnown(), readBlocked()]);
  const match = matchStore({
    id: idLeilao,
    strong: row.strong ?? [],
    weak: row.weak ?? [],
    known,
    blocked,
  });
  const own = known.find((k) => k.id === idLeilao);
  if (own?.store) return { kind: "none", reason: "já tem loja" };
  if (match.kind === "auto") {
    const done = await setAuctionStoreWithSource(idLeilao, match.store, "auto", {
      onlyIfEmpty: true,
    });
    if (!done) return { kind: "none", reason: "pregão numa remessa em andamento" };
    await db
      .from("auction_contacts")
      .update({ linked_via: match.via, suggest_store: "", suggest_via: "" })
      .eq("id_leilao", idLeilao);
  } else if (match.kind === "suggest") {
    await db
      .from("auction_contacts")
      .update({ suggest_store: match.store, suggest_via: match.via })
      .eq("id_leilao", idLeilao);
  }
  return match;
}

/** Aceita a sugestão: a loja passa a valer (como "confirmado", que também ensina). */
export async function confirmStoreSuggestion(idLeilao: string): Promise<void> {
  const { data } = await db
    .from<ContactRow>("auction_contacts")
    .select(CONTACT_COLS)
    .eq("id_leilao", idLeilao);
  const row = (data ?? [])[0];
  if (!row?.suggest_store) throw new Error("Não há sugestão para este pregão.");
  await setAuctionStoreWithSource(idLeilao, row.suggest_store, "confirmado");
  await db
    .from("auction_contacts")
    .update({ suggest_store: "", suggest_via: "" })
    .eq("id_leilao", idLeilao);
}

/** "Não é": esquece aquele contato para aquela loja e limpa a sugestão. */
export async function dismissStoreSuggestion(idLeilao: string): Promise<void> {
  const { data } = await db
    .from<ContactRow>("auction_contacts")
    .select(CONTACT_COLS)
    .eq("id_leilao", idLeilao);
  const row = (data ?? [])[0];
  if (!row?.suggest_store) return;
  await addBlocked(row.suggest_store, row.suggest_via);
  await db
    .from("auction_contacts")
    .update({ suggest_store: "", suggest_via: "" })
    .eq("id_leilao", idLeilao);
}

/** Desfaz um vínculo automático: tira a loja e esquece o contato que levou a ela. */
export async function undoAutoStore(idLeilao: string): Promise<void> {
  const [state, contact] = await Promise.all([
    db
      .from<{ store: string; store_source: string }>("purchase_auctions")
      .select("store, store_source")
      .eq("id_leilao", idLeilao),
    db.from<ContactRow>("auction_contacts").select(CONTACT_COLS).eq("id_leilao", idLeilao),
  ]);
  const s = (state.data ?? [])[0];
  if (!s || s.store_source !== "auto") throw new Error("Este pregão não foi ligado sozinho.");
  const via = (contact.data ?? [])[0]?.linked_via ?? "";
  await addBlocked(s.store, via);
  await setAuctionStoreWithSource(idLeilao, "", "");
  await db.from("auction_contacts").update({ linked_via: "" }).eq("id_leilao", idLeilao);
}

/** Sugestões pendentes (id do pregão → loja e contato) para a tela. */
export async function getStoreSuggestions(): Promise<
  Record<string, { store: string; via: string }>
> {
  const { data } = await db
    .from<ContactRow>("auction_contacts")
    .select("id_leilao, suggest_store, suggest_via")
    .neq("suggest_store", "");
  const out: Record<string, { store: string; via: string }> = {};
  for (const r of data ?? []) out[r.id_leilao] = { store: r.suggest_store, via: r.suggest_via };
  return out;
}

/** Pregões ligados sozinhos (id → contato que levou à loja), para a marca "automático". */
export async function getAutoStores(): Promise<Record<string, string>> {
  const [states, contacts] = await Promise.all([
    db
      .from<{ id_leilao: string }>("purchase_auctions")
      .select("id_leilao")
      .eq("store_source", "auto"),
    db.from<ContactRow>("auction_contacts").select("id_leilao, linked_via").neq("linked_via", ""),
  ]);
  const via = new Map((contacts.data ?? []).map((c) => [c.id_leilao, c.linked_via]));
  return Object.fromEntries(
    (states.data ?? []).map((s) => [s.id_leilao, via.get(s.id_leilao) ?? ""]),
  );
}

// --------------------------------------------------------------------------- cron

const RECENT_DAYS = 3;
const RETRY_HOURS = 12;

/**
 * Passo `storelink` do cron. Fila: (a) pregões com loja informada à mão e sem contatos lidos
 * (aprendizado do que já existia); (b) pregões novos dos sites onde já existe uma loja
 * aprendida. Um pregão por vez, `max` por chamada; falha de leitura não trava a fila.
 */
export async function linkNewAuctions(max = 6): Promise<{
  checked: number;
  linked: number;
  suggested: number;
  failed: number;
  remaining: number;
  done: boolean;
}> {
  const [states, contacts, seen] = await Promise.all([
    db
      .from<{ id_leilao: string; store: string; store_source: string }>("purchase_auctions")
      .select("id_leilao, store, store_source"),
    db
      .from<Pick<ContactRow, "id_leilao" | "domain" | "ok"> & { fetched_at: string }>(
        "auction_contacts",
      )
      .select("id_leilao, domain, ok, fetched_at"),
    db
      .from<{ id_leilao: string; entry_url: string | null; day_key: string }>("seen_auctions")
      .select("id_leilao, entry_url, day_key"),
  ]);
  // Lido = com contatos gravados, ou falha recente (tenta de novo depois de `RETRY_HOURS`).
  const retryBefore = Date.now() - RETRY_HOURS * 3_600_000;
  const read = new Set(
    (contacts.data ?? [])
      .filter((c) => c.ok || new Date(c.fetched_at).getTime() > retryBefore)
      .map((c) => c.id_leilao),
  );
  const taught = (states.data ?? []).filter(
    (s) => s.store.trim() && (s.store_source === "manual" || s.store_source === "confirmado"),
  );

  // (a) aprendizado do que já existe
  const backfill = taught.filter((s) => !read.has(s.id_leilao)).map((s) => s.id_leilao);

  // (b) pregões recentes dos domínios que têm loja aprendida
  const taughtIds = new Set(taught.map((s) => s.id_leilao));
  const domainOf = new Map<string, string>();
  for (const c of contacts.data ?? []) if (c.domain) domainOf.set(c.id_leilao, c.domain);
  const learnedDomains = new Set(
    [...taughtIds].map((id) => domainOf.get(id)).filter((d): d is string => !!d),
  );
  const limitDay = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const hasStore = new Set(
    (states.data ?? []).filter((s) => s.store.trim()).map((s) => s.id_leilao),
  );
  const fresh = (seen.data ?? [])
    .filter((a) => a.day_key >= limitDay && !read.has(a.id_leilao) && !hasStore.has(a.id_leilao))
    .filter((a) => {
      const ref = a.entry_url ? parseAuctionRef(a.entry_url) : null;
      return !!ref && learnedDomains.has(ref.domain);
    })
    .map((a) => a.id_leilao);

  const queue = [...new Set([...backfill, ...fresh])];
  const batch = queue.slice(0, max);
  let linked = 0;
  let suggested = 0;
  let failed = 0;
  for (const id of batch) {
    try {
      if (backfill.includes(id)) {
        const r = await captureAuctionContacts(id);
        if (r.status === "failed") failed++;
        continue;
      }
      const r = await linkAuction(id);
      if (r.kind === "auto") linked++;
      else if (r.kind === "suggest") suggested++;
      else if (r.kind === "failed") failed++;
    } catch {
      failed++;
    }
  }
  const remaining = Math.max(queue.length - batch.length, 0);
  return { checked: batch.length, linked, suggested, failed, remaining, done: remaining === 0 };
}
