import { createServerFn } from "@tanstack/react-start";

export const getVinylLots = createServerFn({ method: "GET" }).handler(async () => {
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  return await scrapeVinylLots();
});
