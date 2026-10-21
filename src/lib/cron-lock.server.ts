import { getSql } from "./db.server";

/**
 * Trava de execução por step do cron. O workflow chama o servidor com `curl --retry 3`: se uma
 * chamada demora mais que o `--max-time`, o curl desiste e repete enquanto a primeira continua
 * rodando — e num step pago (`aieval`, `aiident`...) isso gerava trabalho e batch em dobro. O
 * mesmo vale para o botão "Atualizar tudo" e para dois deploys seguidos.
 *
 * Usa `pg_try_advisory_xact_lock` dentro de uma transação que fica aberta enquanto o step roda:
 * o Postgres solta a trava sozinho no commit, no rollback ou se o processo cair (sem trava
 * "órfã"). Quem não consegue a trava não espera: devolve `busy` e o chamador responde "já em
 * execução".
 */
export async function withStepLock<T>(
  step: string,
  fn: () => Promise<T>,
): Promise<{ busy: true } | { busy: false; value: T }> {
  const sql = getSql();
  let outcome: { busy: true } | { busy: false; value: T } | null = null;
  await sql.begin(async (tx) => {
    const rows = await tx`select pg_try_advisory_xact_lock(hashtext(${`cron:${step}`})) as ok`;
    if (!rows[0]?.["ok"]) {
      outcome = { busy: true };
      return;
    }
    outcome = { busy: false, value: await fn() };
  });
  if (!outcome) throw new Error("withStepLock: transação terminou sem resultado");
  return outcome;
}
