import { db } from "@/lib/db-client.server";

import {
  isRatingLevel,
  sanitizeRating,
  summarizeHouses,
  type PurchaseRating,
  type RatingsPayload,
} from "./house-rating";
import { getAllPurchases } from "./purchases.server";

/** `app_state.house_ratings`: { [purchases.id]: PurchaseRating } — uma avaliação por compra. */
const HOUSE_RATINGS_KEY = "house_ratings";

async function readRatings(): Promise<Record<string, PurchaseRating>> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", HOUSE_RATINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PurchaseRating> = {};
  for (const [id, v] of Object.entries(raw as Record<string, Partial<PurchaseRating>>)) {
    if (!v || !isRatingLevel(v.level)) continue;
    const clean = sanitizeRating(v);
    if (clean) out[id] = { ...clean, updatedAt: String(v.updatedAt ?? "") };
  }
  return out;
}

/** Avaliações por compra + semáforo agregado por casa. */
export async function getHouseRatings(): Promise<RatingsPayload> {
  const [ratings, purchases] = await Promise.all([readRatings(), getAllPurchases()]);
  return { ratings, houses: summarizeHouses(purchases, ratings) };
}

/** Grava (ou remove, com `rating === null`) a avaliação de uma compra. */
export async function setPurchaseRating(
  purchaseId: string,
  rating: ReturnType<typeof sanitizeRating>,
): Promise<void> {
  const ratings = await readRatings();
  if (rating) ratings[purchaseId] = { ...rating, updatedAt: new Date().toISOString() };
  else delete ratings[purchaseId];
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: HOUSE_RATINGS_KEY, value: ratings, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`Não foi possível gravar a avaliação: ${error.message}`);
}
