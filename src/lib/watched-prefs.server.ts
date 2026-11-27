import { db } from "@/lib/db-client.server";
import { mutateAppState, parseObject } from "@/lib/app-state-mutate.server";

const WATCHED_PREFS_KEY = "watched_prefs";
/** Quanto tempo um lote acompanhado fica registrado (o lote some da janela do app bem antes). */
const FOLLOW_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Casa oculta "só no dia": entradas com mais de 3 dias não servem mais. */
const HIDDEN_KEEP_DAYS = 3;

// Mesmo formato de `WatchedPrefs` em `watched-prefs.ts` (client-safe; servidor não importa de lá).
type Prefs = { followed: Record<string, string>; hidden: Record<string, string> };

/** Normaliza o JSON cru e descarta o que passou do prazo. */
export function parseWatchedPrefs(raw: unknown, now = Date.now()): Prefs {
  const root = parseObject(raw);
  const followed: Record<string, string> = {};
  for (const [id, at] of Object.entries(parseObject(root["followed"]))) {
    if (typeof at === "string" && Date.parse(at) > now - FOLLOW_TTL_MS) followed[id] = at;
  }
  const oldest = new Date(now - HIDDEN_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const hidden: Record<string, string> = {};
  for (const [house, day] of Object.entries(parseObject(root["hidden"]))) {
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= oldest)
      hidden[house] = day;
  }
  return { followed, hidden };
}

/**
 * Lê as preferências. Erro PROPAGA (a tela fica com o que tem no aparelho): devolver "vazio" aqui
 * faria o cliente apagar as marcações locais por causa de uma falha passageira do banco.
 */
export async function getWatchedPrefs(): Promise<Prefs> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", WATCHED_PREFS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseWatchedPrefs(data?.value);
}

/** Aplica uma mudança de forma atômica e devolve o estado novo. Erros propagam. */
export function changeWatchedPrefs(change: (cur: Prefs) => Prefs): Promise<Prefs> {
  return mutateAppState(WATCHED_PREFS_KEY, parseWatchedPrefs, change);
}
