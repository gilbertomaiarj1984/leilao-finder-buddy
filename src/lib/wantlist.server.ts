import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeForMatch } from "@/lib/vinyl-parse";
import { parseWantlistText } from "@/lib/wantlist-parse";

/**
 * Item da "sondagem" (tabela `wantlist_items`) como a UI consome. Espelha as colunas do
 * banco; `year` pode ser null (obra sem ano informado).
 */
export type WantlistRow = {
  id: string;
  raw: string;
  work: string;
  year: number | null;
  note: string;
  norm: string;
  acquired: boolean;
  position: number;
};

const COLS = "id, raw, work, year, note, norm, acquired, position";
const PAGE = 1000;

type DbRow = {
  id: string;
  raw: string | null;
  work: string;
  year: number | null;
  note: string | null;
  norm: string | null;
  acquired: boolean;
  position: number;
};

function toRow(r: DbRow): WantlistRow {
  return {
    id: r.id,
    raw: r.raw ?? "",
    work: r.work,
    year: r.year,
    note: r.note ?? "",
    norm: r.norm ?? "",
    acquired: r.acquired,
    position: r.position,
  };
}

/** Lê a sondagem inteira, ordenada por `position` (single-user; poucas linhas). */
export async function getAllWantlist(): Promise<WantlistRow[]> {
  const rows: WantlistRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("wantlist_items")
      .select(COLS)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as DbRow[];
    for (const r of batch) rows.push(toRow(r));
    if (batch.length < PAGE) break;
  }
  return rows;
}

/**
 * Importa (acrescenta) obras a partir do texto colado. Não apaga o que já existe e ignora
 * duplicatas (obra normalizada + ano) contra a lista atual. Retorna quantas entraram.
 */
export async function importWantlistText(text: string): Promise<{ added: number }> {
  const parsed = parseWantlistText(text);
  if (!parsed.length) return { added: 0 };

  const existing = await getAllWantlist();
  const seen = new Set(existing.map((r) => `${r.norm}|${r.year ?? ""}`));
  let pos = existing.reduce((max, r) => Math.max(max, r.position), 0);

  const payload: {
    raw: string;
    work: string;
    year: number | null;
    note: string;
    norm: string;
    position: number;
    acquired: boolean;
  }[] = [];
  for (const p of parsed) {
    const key = `${p.norm}|${p.year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pos += 1;
    payload.push({
      raw: p.raw,
      work: p.work,
      year: p.year,
      note: p.note,
      norm: p.norm,
      position: pos,
      acquired: false,
    });
  }
  if (!payload.length) return { added: 0 };

  const { error } = await supabaseAdmin.from("wantlist_items").insert(payload);
  if (error) {
    console.error("[wantlist] falha ao importar", error);
    throw new Error(`Não foi possível importar a sondagem: ${error.message}`);
  }
  return { added: payload.length };
}

/** Adiciona uma obra manualmente (no fim da lista). */
export async function addWantlistItem(input: {
  work: string;
  year: number | null;
  note: string;
}): Promise<WantlistRow> {
  const work = input.work.trim();
  if (!work) throw new Error("Informe a obra.");
  const existing = await getAllWantlist();
  const position = existing.reduce((max, r) => Math.max(max, r.position), 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("wantlist_items")
    .insert({
      raw: work,
      work,
      year: input.year,
      note: input.note.trim(),
      norm: normalizeForMatch(work),
      position,
      acquired: false,
    })
    .select(COLS)
    .single();
  if (error) {
    console.error("[wantlist] falha ao adicionar", error);
    throw new Error(`Não foi possível adicionar a obra: ${error.message}`);
  }
  return toRow(data as DbRow);
}

/** Atualiza campos de uma obra (obra/ano/nota/adquirida). Recalcula `norm` se `work` mudar. */
export async function updateWantlistItem(input: {
  id: string;
  work?: string;
  year?: number | null;
  note?: string;
  acquired?: boolean;
}): Promise<WantlistRow> {
  const patch: {
    work?: string;
    norm?: string;
    year?: number | null;
    note?: string;
    acquired?: boolean;
  } = {};
  if (typeof input.work === "string") {
    const work = input.work.trim();
    if (!work) throw new Error("A obra não pode ficar vazia.");
    patch.work = work;
    patch.norm = normalizeForMatch(work);
  }
  if (input.year !== undefined) patch.year = input.year;
  if (typeof input.note === "string") patch.note = input.note.trim();
  if (typeof input.acquired === "boolean") patch.acquired = input.acquired;

  const { data, error } = await supabaseAdmin
    .from("wantlist_items")
    .update(patch)
    .eq("id", input.id)
    .select(COLS)
    .single();
  if (error) {
    console.error("[wantlist] falha ao atualizar", error);
    throw new Error(`Não foi possível atualizar a obra: ${error.message}`);
  }
  return toRow(data as DbRow);
}

/** Remove uma obra da sondagem. */
export async function deleteWantlistItem(id: string): Promise<{ ok: true }> {
  const { error } = await supabaseAdmin.from("wantlist_items").delete().eq("id", id);
  if (error) {
    console.error("[wantlist] falha ao remover", error);
    throw new Error(`Não foi possível remover a obra: ${error.message}`);
  }
  return { ok: true };
}
