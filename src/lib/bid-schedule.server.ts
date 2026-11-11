/**
 * Lance agendado (servidor): guarda os agendamentos em `app_state.bid_schedules`, acompanha o
 * pregão e, no gatilho, dá UM lance no lote alvo pela PÁGINA DA PEÇA (`fazerlance.asp`, o mesmo
 * que o botão "Fazer Lance" usa — as casas aceitam lance prévio antes do lote entrar em pregão).
 *
 * Segurança (dinheiro real):
 * - MODO SIMULAÇÃO por padrão (`app_state.bid_schedule_live` = false): faz tudo, menos enviar.
 * - O agendamento é RESERVADO (`waiting` → `firing`) numa transação com a linha travada antes de
 *   qualquer envio; nunca volta a `waiting`, então não há segundo lance mesmo com dois leitores.
 * - O envio não é repetido (1 tentativa). Resposta incerta = `failed` ("confira no site").
 * - O lance é sempre o PRÓXIMO valor do lote, dentro do teto; já ganhando = não envia.
 * - O acompanhamento automático só liga com `BID_SCHEDULER=1` (o preview compartilha o banco da
 *   produção e não deve disparar); "Rodar agora" na tela roda um ciclo manualmente.
 */
import { randomUUID } from "node:crypto";

import { mutateAppState } from "./app-state-mutate.server";
import {
  decideBid,
  decideTrigger,
  formatBidValue,
  isEditable,
  parseLoteNumber,
  parseSchedules,
  validateScheduleInput,
  type BidSchedule,
  type BidScheduleInput,
  type BidScheduleStatus,
} from "./bid-schedule";
import { db } from "./db-client.server";
import { authFetchFor, ensureSessionFor } from "./leiloesbr-auth.server";
import { rowToLot } from "./leiloesbr-scrape.server";
import { parseLivePeca, type LivePeca } from "./leiloesbr-lot-details.server";
import { fetchPresencialNow } from "./leiloesbr-presencial.server";
import { auctionHouseDomain, presencialUrlFrom } from "./vinyl-parse";

const SCHEDULES_KEY = "bid_schedules";
const LIVE_KEY = "bid_schedule_live";
const MAX_KEPT = 200;
const TICK_MS = 15_000;

const nowIso = () => new Date().toISOString();

// ----------------------------------------------------------------------- estado ---

export async function listSchedules(): Promise<BidSchedule[]> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", SCHEDULES_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseSchedules(data?.value);
}

export async function isLiveMode(): Promise<boolean> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", LIVE_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.value === true;
}

export async function setLiveMode(live: boolean): Promise<boolean> {
  await mutateAppState(
    LIVE_KEY,
    (raw) => raw === true,
    () => live,
  );
  return live;
}

function mutateSchedules(change: (list: BidSchedule[]) => BidSchedule[]): Promise<BidSchedule[]> {
  return mutateAppState(SCHEDULES_KEY, parseSchedules, (cur) => change(cur).slice(-MAX_KEPT));
}

export async function createSchedule(raw: Partial<Record<keyof BidScheduleInput, unknown>>) {
  const v = validateScheduleInput(raw);
  if (!v.ok) throw new Error(v.error);
  const at = nowIso();
  const item: BidSchedule = {
    id: randomUUID(),
    ...v.value,
    status: "waiting",
    createdAt: at,
    updatedAt: at,
    message: "Aguardando o pregão chegar ao lote gatilho.",
  };
  await mutateSchedules((list) => [...list, item]);
  return item;
}

export async function updateSchedule(
  id: string,
  raw: Partial<Record<keyof BidScheduleInput, unknown>>,
) {
  const v = validateScheduleInput(raw);
  if (!v.ok) throw new Error(v.error);
  let found = false;
  await mutateSchedules((list) =>
    list.map((s) => {
      if (s.id !== id) return s;
      if (!isEditable(s)) throw new Error("Este agendamento já foi disparado ou encerrado.");
      found = true;
      return { ...s, ...v.value, dayKey: v.value.dayKey || s.dayKey, updatedAt: nowIso() };
    }),
  );
  if (!found) throw new Error("Agendamento não encontrado.");
}

export async function cancelSchedule(id: string) {
  let found = false;
  await mutateSchedules((list) =>
    list.map((s) => {
      if (s.id !== id) return s;
      if (!isEditable(s)) throw new Error("Este agendamento já foi disparado ou encerrado.");
      found = true;
      return { ...s, status: "cancelled", updatedAt: nowIso(), message: "Cancelado por você." };
    }),
  );
  if (!found) throw new Error("Agendamento não encontrado.");
}

function finish(id: string, status: BidScheduleStatus, message: string) {
  return mutateSchedules((list) =>
    list.map((s) => (s.id === id ? { ...s, status, message, updatedAt: nowIso() } : s)),
  );
}

/** `waiting` → `firing` na transação; só quem conseguir reservar segue para o envio. */
async function claim(id: string): Promise<boolean> {
  let claimed = false;
  await mutateSchedules((list) =>
    list.map((s) => {
      if (s.id !== id || s.status !== "waiting") return s;
      claimed = true;
      return { ...s, status: "firing", updatedAt: nowIso(), message: "Enviando o lance…" };
    }),
  );
  return claimed;
}

// ------------------------------------------------------------------- leitura/envio ---

/** Lote alvo no banco: `id_peca` e URL (para achar o domínio da casa). */
async function findTargetLot(s: BidSchedule): Promise<{ idPeca: string; url: string } | null> {
  const { data, error } = await db
    .from("lots")
    .select("id_peca,url,lote")
    .eq("id_leilao", s.idLeilao);
  if (error) throw error;
  const rows = (data ?? []) as { id_peca: string; url: string; lote: string }[];
  const row = rows.find((r) => parseLoteNumber(r.lote) === s.targetLote);
  return row ? { idPeca: row.id_peca, url: row.url } : null;
}

type BidResponse = { NUM_ERRO?: string | number; MENSAGEM_ERRO?: string; TEMERRO?: boolean };

/** Resposta do `fazerlance.asp`: NUM_ERRO 0 (lance) ou 4 (lance + vigia) = aceito. */
function bidAccepted(r: BidResponse): boolean {
  const n = String(r.NUM_ERRO ?? "");
  return n === "0" || n === "4";
}

/** Etapa em andamento: se algo lançar exceção, a mensagem do agendamento diz onde parou. */
type Progress = { stage: string };

async function processFired(s: BidSchedule, live: boolean, progress: Progress): Promise<void> {
  progress.stage = "procurar o lote no banco";
  const lot = await findTargetLot(s);
  const origin = lot ? auctionHouseDomain(lot.url)?.replace(/^http:/i, "https:") : null;
  if (!lot || !origin) {
    await finish(s.id, "skipped", `Lote ${s.targetLote} não encontrado no banco para este leilão.`);
    return;
  }
  const pecaUrl = `${origin}/peca.asp?id=${lot.idPeca}`;
  // Página lida COM login: só assim `VENCENDO` vem preenchido.
  progress.stage = "entrar na conta da casa e ler a página da peça";
  const html = await authFetchFor(origin, pecaUrl, { referer: `${origin}/` });
  const peca = parseLivePeca(html);
  if (peca.winning) {
    await finish(s.id, "skipped", "Você já está com o lance vencedor neste lote; nada enviado.");
    return;
  }
  if (peca.template === null || peca.nextBid === null) {
    await finish(
      s.id,
      "failed",
      "A página da peça desta casa veio diferente dos modelos conhecidos (sem o próximo lance). Nada foi enviado.",
    );
    return;
  }
  const decision = decideBid(s, peca);
  if (decision.action === "skip") {
    await finish(s.id, "skipped", decision.reason);
    return;
  }
  const value = decision.value;
  const valueTxt = value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (!live) {
    await finish(
      s.id,
      "simulated",
      `SIMULAÇÃO: teria enviado ${valueTxt} no lote ${s.targetLote}. Nada foi enviado ao site.`,
    );
    return;
  }

  if (peca.template === "old") {
    progress.stage = "enviar o lance (modelo antigo)";
    await sendOldTemplate(s, { origin, pecaUrl, idPeca: lot.idPeca, value, valueTxt, peca });
  } else {
    progress.stage = "conferir os termos do leilão na conta";
    await sendNewTemplate(
      s,
      { origin, pecaUrl, idPeca: lot.idPeca, value, valueTxt, peca },
      progress,
    );
  }
}

type SendCtx = {
  origin: string;
  pecaUrl: string;
  idPeca: string;
  value: number;
  valueTxt: string;
  peca: LivePeca;
};

/** Template NOVO (ex.: Escafandro): `fazerlance.asp`, resposta JSON. */
async function sendNewTemplate(s: BidSchedule, c: SendCtx, progress: Progress): Promise<void> {
  // Termos do leilão precisam já estar aceitos na conta (não aceitamos termos por você).
  const terms = (
    await authFetchFor(
      c.origin,
      `${c.origin}/modulos/lance/asp/verifica_temcartela.asp?leilao=${encodeURIComponent(s.idLeilao)}`,
      { referer: c.pecaUrl, attempts: 1 },
    )
  ).trim();
  if (terms !== "1") {
    await finish(
      s.id,
      "failed",
      "A conta ainda não aceitou os termos deste leilão. Dê um lance manual uma vez no site e tente de novo.",
    );
    return;
  }

  progress.stage = "enviar o lance (modelo novo)";
  const v = formatBidValue(c.value);
  const qs = new URLSearchParams({
    ValorMinimo: v,
    valor: v,
    ID: c.idPeca,
    IdLeilao: s.idLeilao,
    qtdlances: c.peca.qtdLances,
    lanceautomatico: "0",
    lanceclicado: "1",
    vendaposflag: "0",
  });
  try {
    // UM envio: sem repetição (um GET repetido poderia lançar duas vezes).
    const text = await authFetchFor(
      c.origin,
      `${c.origin}/modulos/lance/asp/fazerlance.asp?${qs}`,
      { referer: c.pecaUrl, attempts: 1 },
    );
    let res: BidResponse;
    try {
      res = JSON.parse(text) as BidResponse;
    } catch {
      await finish(
        s.id,
        "failed",
        "Resposta ilegível do site: confira o lote no site antes de repetir.",
      );
      return;
    }
    const msg = String(res.MENSAGEM_ERRO ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (bidAccepted(res)) {
      await finish(s.id, "fired", `Lance de ${c.valueTxt} enviado e aceito. ${msg}`.trim());
    } else {
      await finish(s.id, "failed", `O site recusou o lance: ${msg || "sem mensagem"}`);
    }
  } catch (error) {
    console.error("[bid-schedule] envio sem resposta confiável", error);
    await finish(s.id, "failed", "Sem resposta do site: confira o lote no site antes de repetir.");
  }
}

/**
 * Template ANTIGO (ex.: RT Leilões): formulário POST em `peca.asp?ID=…`. O formato da resposta
 * varia, então o sucesso é CONFIRMADO relendo a página: o valor atual precisa ser o do lance.
 */
async function sendOldTemplate(s: BidSchedule, c: SendCtx): Promise<void> {
  const form = c.peca.oldForm;
  if (!form) {
    await finish(s.id, "failed", "Formulário de lance não encontrado na página. Nada foi enviado.");
    return;
  }
  const body = new URLSearchParams({
    IdLeilao: s.idLeilao,
    IdPeca: c.idPeca,
    ValorMinimo: form.valorMinimo,
    lanceclicado: form.lanceclicado,
    vold: form.vold,
    valor: formatBidValue(c.value),
  }).toString();
  try {
    await authFetchFor(c.origin, `${c.origin}/peca.asp?ID=${c.idPeca}`, {
      method: "POST",
      body,
      referer: c.pecaUrl,
      attempts: 1,
    });
  } catch (error) {
    console.error("[bid-schedule] envio (template antigo) sem resposta confiável", error);
    await finish(s.id, "failed", "Sem resposta do site: confira o lote no site antes de repetir.");
    return;
  }
  try {
    const after = parseLivePeca(
      await authFetchFor(c.origin, c.pecaUrl, { referer: `${c.origin}/` }),
    );
    if (after.currentValue !== null && Math.abs(after.currentValue - c.value) < 0.005) {
      await finish(s.id, "fired", `Lance de ${c.valueTxt} enviado e confirmado na página do lote.`);
    } else {
      await finish(
        s.id,
        "failed",
        `Enviei ${c.valueTxt}, mas a página não mostra esse valor: confira o lote no site.`,
      );
    }
  } catch {
    await finish(
      s.id,
      "failed",
      `Enviei ${c.valueTxt}, mas não consegui confirmar: confira o lote no site.`,
    );
  }
}

// --------------------------------------------------------------------- ciclo/poller ---

let running = false;
/** Último resultado do aquecimento do login por agendamento (só grava a mensagem quando muda). */
const warmed = new Map<string, string>();

/** Pregão em andamento + agendamento aguardando: já entra na conta da casa (sessão pronta no gatilho). */
async function warmLogin(s: BidSchedule): Promise<void> {
  let status: string;
  try {
    await ensureSessionFor(new URL(s.presencialUrl).origin);
    status = "ok";
  } catch (error) {
    status = `erro:${(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 160)}`;
  }
  if (warmed.get(s.id) === status) return;
  warmed.set(s.id, status);
  if (warmed.size > 500) warmed.clear();
  const message =
    status === "ok"
      ? "Pregão em andamento: login na casa feito. Aguardando o lote gatilho."
      : `Pregão em andamento, mas o login na casa falhou (${status.slice(5)}). O lance pode falhar.`;
  await mutateSchedules((list) =>
    list.map((x) => (x.id === s.id && x.status === "waiting" ? { ...x, message } : x)),
  );
}

/** Um ciclo: lê o pregão de cada leilão com agendamento aguardando e age. */
export async function runSchedulerOnce(): Promise<{ checked: number }> {
  if (running) return { checked: 0 };
  running = true;
  try {
    const waiting = (await listSchedules()).filter((s) => s.status === "waiting");
    if (!waiting.length) return { checked: 0 };
    const live = await isLiveMode();
    const nowByUrl = new Map<string, number | null>();
    for (const s of waiting) {
      try {
        if (!nowByUrl.has(s.presencialUrl)) {
          const now = await fetchPresencialNow(s.presencialUrl);
          nowByUrl.set(s.presencialUrl, now ? parseLoteNumber(now.lote) : null);
        }
        const currentLote = nowByUrl.get(s.presencialUrl) ?? null;
        const decision = decideTrigger(s, currentLote);
        if (decision === "wait" && currentLote !== null) await warmLogin(s);
        if (decision === "expire") {
          await finish(s.id, "expired", "O pregão já passou do lote alvo antes do disparo.");
        } else if (decision === "fire" && (await claim(s.id))) {
          const progress: Progress = { stage: "iniciar" };
          try {
            await processFired(s, live, progress);
          } catch (error) {
            console.error("[bid-schedule] falha ao processar o disparo", error);
            const detail = (error instanceof Error ? error.message : String(error))
              .replace(/\s+/g, " ")
              .slice(0, 200);
            await finish(
              s.id,
              "failed",
              `Erro ao ${progress.stage}: ${detail}. O lance pode não ter sido enviado: confira o lote no site.`,
            );
          }
        }
      } catch (error) {
        console.error("[bid-schedule] ciclo falhou para um agendamento", error);
      }
    }
    return { checked: waiting.length };
  } finally {
    running = false;
  }
}

const g = globalThis as { __bidSchedulerStarted?: boolean };

/** Liga o acompanhamento automático (idempotente; só com `BID_SCHEDULER=1`). */
export function ensureBidSchedulerStarted(): void {
  if (g.__bidSchedulerStarted || process.env["BID_SCHEDULER"] !== "1") return;
  g.__bidSchedulerStarted = true;
  setInterval(() => {
    runSchedulerOnce().catch((error) => console.error("[bid-schedule] ciclo", error));
  }, TICK_MS).unref?.();
}

type SchedulableAuction = {
  idLeilao: string;
  house: string;
  dayKey: string;
  time: string;
  lotCount: number;
  presencialUrl: string;
};

/** Leilões que dá para agendar: de ontem em diante, só os que têm pregão presencial. */
export async function listSchedulableAuctions(): Promise<SchedulableAuction[]> {
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("seen_auctions")
    .select("id_leilao, house, entry_url, day_key, start_time, lot_count")
    .not("starts_at", "is", null)
    .gte("starts_at", from)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  const out: SchedulableAuction[] = [];
  for (const r of (data ?? []) as {
    id_leilao: string;
    house: string;
    entry_url: string | null;
    day_key: string;
    start_time: string;
    lot_count: number;
  }[]) {
    const presencialUrl = presencialUrlFrom(r.entry_url);
    if (!presencialUrl) continue;
    out.push({
      idLeilao: r.id_leilao,
      house: r.house,
      dayKey: r.day_key,
      time: r.start_time,
      lotCount: r.lot_count,
      presencialUrl,
    });
  }
  return out;
}

/** Lote (do banco) de um leilão pelo número do lote, para abrir o card a partir do agendamento. */
export async function findLotCard(idLeilao: string, lote: number) {
  const { data, error } = await db
    .from("lots")
    .select(
      "id, id_leilao, id_peca, base, lote, title, url, image, price, day_key, start_time, uf, house, house_url, artist",
    )
    .eq("id_leilao", idLeilao);
  if (error) throw error;
  const rows = (data ?? []) as Parameters<typeof rowToLot>[0][];
  const row = rows.find((r) => parseLoteNumber(r.lote) === lote);
  return row ? rowToLot(row) : null;
}
