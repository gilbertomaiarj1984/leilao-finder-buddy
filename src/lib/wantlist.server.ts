import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Item da sondagem (obra que o usuário está caçando). */
export type WantlistItem = {
  id: string;
  label: string;
  note: string | null;
  year: number | null;
  acquired: boolean;
};

export type ParsedWantlistItem = { label: string; note: string | null; year: number | null };

/**
 * Faz o parse de um rascunho em texto (uma linha = um item). Best-effort e tolerante ao
 * formato do usuário:
 *   "01. Tim Maia (1970)"                              → label "Tim Maia", year 1970
 *   "03. Tim Maia Racional, Vol. 1 (1975 - Fase Rara)" → label "Tim Maia Racional, Vol. 1",
 *                                                        year 1975, note "Fase Rara"
 *   "[Bônus/Cult: Tim Maia Racional, Vol. 2 (1975)]"   → label "Tim Maia Racional, Vol. 2 …"
 * Remove numeração inicial ("NN." / "NN)" / "-" / "•") e colchetes externos. Ignora linhas
 * vazias. O primeiro parêntese com um ano (4 dígitos) vira `year` (+ `note` do resto dele).
 */
export function parseWantlistText(text: string): ParsedWantlistItem[] {
  const out: ParsedWantlistItem[] = [];
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    // Colchetes externos: "[Bônus/Cult: X]" → remove os colchetes e o rótulo "Bônus:".
    if (line.startsWith("[") && line.endsWith("]")) line = line.slice(1, -1).trim();
    line = line.replace(/^(b[ôo]nus|cult|extra)[^:]*:\s*/i, "").trim();
    // Numeração / marcador inicial.
    line = line
      .replace(/^\(?\d{1,3}\)?[.)\-–]\s*/, "")
      .replace(/^[-–•*]\s*/, "")
      .trim();
    if (!line) continue;

    let year: number | null = null;
    let note: string | null = null;
    let label = line;

    // Primeiro parêntese que contém um ano de 4 dígitos (19xx/20xx).
    const paren = line.match(/\(([^)]*\b(19|20)\d{2}\b[^)]*)\)/);
    if (paren) {
      const inside = paren[1]!;
      const y = inside.match(/\b(19|20)\d{2}\b/);
      if (y) year = Number(y[0]);
      const rest = inside
        .replace(/\b(19|20)\d{2}\b/, "")
        .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "")
        .trim();
      if (rest) note = rest.slice(0, 300);
      // Tira o parêntese do label.
      label = line.replace(paren[0], "").replace(/\s+/g, " ").trim();
    }

    label = label
      .replace(/[\s,;:–—-]+$/g, "")
      .trim()
      .slice(0, 300);
    if (label) out.push({ label, note, year });
  }
  return out;
}

const SELECT = "id, label, note, year, acquired";

export async function getWantlist(): Promise<WantlistItem[]> {
  const { data, error } = await supabaseAdmin
    .from("wantlist_items")
    .select(SELECT)
    .order("acquired", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WantlistItem[];
}

/**
 * Insere itens do parse, ignorando duplicatas por **label + ano** (sem caixa/acentos) —
 * assim "Tim Maia (1970)" e "Tim Maia (1973)" coexistem, mas reimportar o mesmo rascunho
 * não empilha repetidos.
 */
export async function addWantlistItems(items: ParsedWantlistItem[]): Promise<number> {
  const clean = items.filter((i) => i.label && i.label.trim());
  if (!clean.length) return 0;
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("wantlist_items")
    .select("label, year");
  if (readErr) throw readErr;
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const keyOf = (label: string, year: number | null) => `${norm(label)}|${year ?? ""}`;
  const seen = new Set((existing ?? []).map((r) => keyOf(r.label, r.year)));
  const toInsert: ParsedWantlistItem[] = [];
  for (const it of clean) {
    const key = keyOf(it.label, it.year);
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push(it);
  }
  if (!toInsert.length) return 0;
  const { error } = await supabaseAdmin
    .from("wantlist_items")
    .insert(toInsert.map((i) => ({ label: i.label, note: i.note, year: i.year })));
  if (error) throw error;
  return toInsert.length;
}

export async function updateWantlistItem(
  id: string,
  patch: { label?: string; note?: string | null; acquired?: boolean },
): Promise<void> {
  const update: { label?: string; note?: string | null; acquired?: boolean } = {};
  if (typeof patch.label === "string") update.label = patch.label.trim().slice(0, 300);
  if (patch.note !== undefined) update.note = patch.note;
  if (typeof patch.acquired === "boolean") update.acquired = patch.acquired;
  if (!Object.keys(update).length) return;
  const { error } = await supabaseAdmin.from("wantlist_items").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteWantlistItem(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("wantlist_items").delete().eq("id", id);
  if (error) throw error;
}
