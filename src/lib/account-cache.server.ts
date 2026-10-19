// Cache curto (com deduplicação de chamadas simultâneas) das leituras da CONTA do LeilõesBR
// (`conta_site.asp` l=8 vigiados / l=4 lances — até 100 páginas cada, com login). Antes a home,
// o auto-refresh da aba Vigiados e o De olho (`getAccountLots`) liam a conta cada um por conta
// própria, muitas vezes ao mesmo tempo. Ver `docs/areas/ui.md`, "Desempenho das telas (v0.155.0)".

/** Idade máxima aceita pelas telas (home, De olho). Cron/alertas passam 0 (sempre fresco). */
export const ACCOUNT_CACHE_MS = 60_000;

/**
 * `get(maxAgeMs)`: reaproveita a leitura em andamento (qualquer `maxAgeMs`) ou a última
 * terminada há no máximo `maxAgeMs`; senão lê de novo. Erro não fica em cache.
 * `invalidate()`: descarta tudo (ex.: depois de vigiar/desvigiar) — a próxima chamada lê de novo.
 */
export function createAccountCache<T>(load: () => Promise<T>) {
  type Entry = { at: number; promise: Promise<T>; settled: boolean };
  let entry: Entry | null = null;
  return {
    get(maxAgeMs = 0): Promise<T> {
      const now = Date.now();
      if (entry && (!entry.settled || (maxAgeMs > 0 && now - entry.at <= maxAgeMs)))
        return entry.promise;
      const current = { at: now, settled: false } as Entry;
      current.promise = load().then(
        (value) => {
          current.settled = true;
          return value;
        },
        (error: unknown) => {
          if (entry === current) entry = null;
          throw error;
        },
      );
      entry = current;
      return current.promise;
    },
    invalidate(): void {
      entry = null;
    },
  };
}
