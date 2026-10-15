/**
 * Migração da Sondagem (`wantlist_items`) para o De olho (`lookout_items`) — v0.149.0.
 *
 * A Sondagem foi descontinuada: o De olho faz o mesmo (e casa por artista + álbum + ano, com
 * confirmação, teto de preço e aviso). Cada obra da Sondagem é lida pela IA (`addLookoutFromText`,
 * que separa artista/álbum/ano de uma linha livre) e vira um item de olho SEM lote de origem;
 * as já adquiridas viram itens `acquired` (fora do radar, mas com histórico). A tabela antiga NÃO
 * é apagada — fica como cópia de segurança até o usuário confirmar a migração.
 *
 * Idempotente e retomável: o progresso fica em `app_state.wantlist_migration`. Roda em lotes
 * pequenos (a UI chama em laço até `pending = 0`), então uma falha de IA não perde o resto.
 */
import { db } from "@/lib/db-client.server";

const STATE_KEY = "wantlist_migration";
/** Obras lidas pela IA por chamada (4 em paralelo, ~150 tokens cada). */
const BATCH = 8;
const PARALLEL = 4;

type State = {
  /** obra da Sondagem → id do item de olho criado/reaproveitado. */
  done: Record<string, string>;
  /** obra da Sondagem → motivo da falha (a IA não resolveu / erro). */
  failed: Record<string, string>;
  /** Falhas que o usuário dispensou (não aparecem mais). */
  dismissed: string[];
};

type WantRow = {
  id: string;
  work: string;
  year: number | null;
  note: string | null;
  acquired: boolean;
};

type WantlistMigrationStatus = {
  /** Obras na tabela antiga. */
  total: number;
  /** Já viraram item de olho. */
  migrated: number;
  /** Ainda não tentadas. */
  pending: number;
  /** A IA não resolveu (ou deu erro): o usuário adiciona à mão ou dispensa. */
  failed: { id: string; work: string; year: number | null; reason: string }[];
};

async function readState(): Promise<State> {
  const { data } = await db.from("app_state").select("value").eq("key", STATE_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<State>;
  return {
    done: v.done && typeof v.done === "object" ? v.done : {},
    failed: v.failed && typeof v.failed === "object" ? v.failed : {},
    dismissed: Array.isArray(v.dismissed) ? v.dismissed : [],
  };
}

async function writeState(state: State): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: STATE_KEY, value: state, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`Não foi possível gravar o progresso da migração: ${error.message}`);
}

async function readWantlist(): Promise<WantRow[]> {
  const { data, error } = await db
    .from<WantRow>("wantlist_items")
    .select("id, work, year, note, acquired")
    .order("position", { ascending: true });
  // Tabela já removida (instalação nova) = nada a migrar.
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return data ?? [];
}

function toStatus(rows: WantRow[], state: State): WantlistMigrationStatus {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const failed = Object.entries(state.failed)
    .filter(([id]) => byId.has(id) && !state.dismissed.includes(id) && !(id in state.done))
    .map(([id, reason]) => ({
      id,
      work: byId.get(id)!.work,
      year: byId.get(id)!.year,
      reason,
    }));
  const migrated = rows.filter((r) => r.id in state.done).length;
  const pending = rows.filter((r) => !(r.id in state.done) && !(r.id in state.failed)).length;
  return { total: rows.length, migrated, pending, failed };
}

export async function getWantlistMigrationStatus(): Promise<WantlistMigrationStatus> {
  const [rows, state] = await Promise.all([readWantlist(), readState()]);
  return toStatus(rows, state);
}

/** Migra até `BATCH` obras ainda não tentadas. Devolve o estado depois do lote. */
export async function migrateWantlistBatch(): Promise<WantlistMigrationStatus> {
  const rows = await readWantlist();
  const state = await readState();
  const todo = rows.filter((r) => !(r.id in state.done) && !(r.id in state.failed)).slice(0, BATCH);
  if (!todo.length) return toStatus(rows, state);

  const { aiConfigured } = await import("./ai-eval.server");
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const { addLookoutFromText } = await import("./lookout-bulk.server");
  const { updateLookoutItem } = await import("./lookout.server");

  const run = async (w: WantRow) => {
    try {
      const r = await addLookoutFromText(w.work, w.year);
      if (r.status === "unresolved") {
        state.failed[w.id] = r.reason;
        return;
      }
      state.done[w.id] = r.item.id;
      // Só mexe no item que a migração CRIOU (não no que o usuário já tinha no De olho).
      if (r.status === "added") {
        const patch: { id: string; status?: "acquired"; note?: string } = { id: r.item.id };
        if (w.acquired) patch.status = "acquired";
        if (w.note?.trim()) patch.note = w.note.trim();
        if (patch.status || patch.note) await updateLookoutItem(patch);
      }
    } catch (error) {
      state.failed[w.id] = (error as Error)?.message || "falha";
    }
  };

  for (let i = 0; i < todo.length; i += PARALLEL) {
    await Promise.all(todo.slice(i, i + PARALLEL).map(run));
  }
  await writeState(state);

  const status = toStatus(rows, state);
  // Terminou: evita uma enxurrada de avisos de uma vez (push/e-mail) por discos que JÁ estão nos
  // leilões — eles continuam aparecendo na página De olho como "novos", só não geram aviso externo.
  if (status.pending === 0) await silenceNotificationsFor(Object.values(state.done));
  return status;
}

/** Marca como "já avisados" os matches de hoje dos itens migrados. Best-effort. */
async function silenceNotificationsFor(itemIds: string[]): Promise<void> {
  try {
    const ids = new Set(itemIds);
    const { computeLookout } = await import("./lookout-matches.server");
    const { addLookoutNotified } = await import("./lookout.server");
    const { notifyKey } = await import("./lookout-match");
    const overview = await computeLookout(false, false);
    const keys = overview.upcoming.filter((m) => ids.has(m.itemId)).map((m) => notifyKey(m));
    if (keys.length) await addLookoutNotified(keys);
  } catch (error) {
    console.error("[wantlist-migration] não foi possível silenciar os avisos iniciais", error);
  }
}

/** Dispensa as falhas atuais (o usuário não quer mais ver o aviso). */
export async function dismissWantlistMigrationFailures(): Promise<WantlistMigrationStatus> {
  const [rows, state] = await Promise.all([readWantlist(), readState()]);
  state.dismissed = [...new Set([...state.dismissed, ...Object.keys(state.failed)])];
  await writeState(state);
  return toStatus(rows, state);
}
