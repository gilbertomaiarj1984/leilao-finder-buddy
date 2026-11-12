import { mutateAppState, parseStringList } from "@/lib/app-state-mutate.server";
import { db } from "@/lib/db-client.server";

import {
  isRatingLevel,
  sanitizeRating,
  pregaoRefs,
  summarizeHouses,
  guardedHouses,
  houseKey,
  type PregaoRating,
  type RatingsPayload,
} from "./house-rating";
import { getShippingData } from "./purchase-shipping.server";
import { getAllPurchases } from "./purchases.server";

/** `app_state.house_ratings`: { [id_leilao]: PregaoRating } — uma avaliação por pregão. */
const HOUSE_RATINGS_KEY = "house_ratings";
/** `app_state.house_no_guard`: lista de `houseKey` das casas que NÃO aceitam guardar compras. */
const NO_GUARD_KEY = "house_no_guard";

async function readNoGuard(): Promise<string[]> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", NO_GUARD_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseStringList(data?.value);
}

/** Marca/desmarca "casa não aceita guarda" (por casa, não por pregão). Escrita atômica. */
export async function setHouseNoGuard(house: string, noGuard: boolean): Promise<void> {
  const key = houseKey(house);
  if (!key) throw new Error("Casa inválida.");
  await mutateAppState(NO_GUARD_KEY, parseStringList, (cur) => {
    const rest = cur.filter((k) => k !== key);
    return noGuard ? [...rest, key] : rest;
  });
}

async function readRatings(): Promise<Record<string, PregaoRating>> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", HOUSE_RATINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PregaoRating> = {};
  for (const [id, v] of Object.entries(raw as Record<string, Partial<PregaoRating>>)) {
    if (!v || !isRatingLevel(v.level)) continue;
    const clean = sanitizeRating(v);
    if (clean) out[id] = { ...clean, updatedAt: String(v.updatedAt ?? "") };
  }
  return out;
}

/** Avaliações por pregão + semáforo agregado por casa. */
export async function getHouseRatings(): Promise<RatingsPayload> {
  const [ratings, purchases, shipping, noGuard] = await Promise.all([
    readRatings(),
    getAllPurchases(),
    getShippingData(),
    readNoGuard().catch(() => [] as string[]),
  ]);
  const stores = Object.fromEntries(
    shipping.auctions.filter((a) => a.store.trim()).map((a) => [a.idLeilao, a.store]),
  );
  const refs = pregaoRefs(purchases, stores);
  const guardIds = new Set(
    shipping.auctions.filter((a) => a.status === "guarda").map((a) => a.idLeilao),
  );
  return {
    ratings,
    houses: summarizeHouses(refs, ratings),
    guarded: guardedHouses(refs, guardIds),
    noGuard: Object.fromEntries(noGuard.map((k) => [k, true as const])),
  };
}

/** Grava (ou remove, com `rating === null`) a avaliação de um pregão. */
export async function setPregaoRating(
  idLeilao: string,
  rating: ReturnType<typeof sanitizeRating>,
): Promise<void> {
  const ratings = await readRatings();
  if (rating) ratings[idLeilao] = { ...rating, updatedAt: new Date().toISOString() };
  else delete ratings[idLeilao];
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: HOUSE_RATINGS_KEY, value: ratings, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`Não foi possível gravar a avaliação: ${error.message}`);
}
