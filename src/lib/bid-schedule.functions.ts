import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

async function guard(context: { claims?: Record<string, unknown> }) {
  const { assertAllowed } = await import("./access.server");
  assertAllowed(context.claims?.["email"] as string | undefined);
}

type FormInput = {
  idLeilao?: unknown;
  house?: unknown;
  presencialUrl?: unknown;
  dayKey?: unknown;
  triggerLote?: unknown;
  targetLote?: unknown;
  expectedValue?: unknown;
  maxValue?: unknown;
};

const asForm = (input: FormInput | undefined): FormInput => input ?? {};

/** Agendamentos + modo (simulação/real) + leilões disponíveis para agendar. */
export const getBidSchedules = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await guard(context);
    const s = await import("./bid-schedule.server");
    const [schedules, live, auctions] = await Promise.all([
      s.listSchedules(),
      s.isLiveMode(),
      s.listSchedulableAuctions().catch(() => []),
    ]);
    return {
      schedules: [...schedules].reverse(),
      live,
      auctions,
      autoRunner: process.env["BID_SCHEDULER"] === "1",
    };
  });

export const createBidSchedule = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(asForm)
  .handler(async ({ context, data }) => {
    await guard(context);
    const { createSchedule } = await import("./bid-schedule.server");
    return await createSchedule(data);
  });

export const updateBidSchedule = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: (FormInput & { id?: string }) | undefined) => ({
    id: String(input?.id ?? ""),
    form: asForm(input),
  }))
  .handler(async ({ context, data }) => {
    await guard(context);
    const { updateSchedule } = await import("./bid-schedule.server");
    await updateSchedule(data.id, data.form);
    return { ok: true };
  });

export const cancelBidSchedule = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string } | undefined) => ({ id: String(input?.id ?? "") }))
  .handler(async ({ context, data }) => {
    await guard(context);
    const { cancelSchedule } = await import("./bid-schedule.server");
    await cancelSchedule(data.id);
    return { ok: true };
  });

/** Liga/desliga o envio REAL (desligado = simulação). */
export const setBidScheduleLive = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { live?: boolean } | undefined) => ({ live: input?.live === true }))
  .handler(async ({ context, data }) => {
    await guard(context);
    const { setLiveMode } = await import("./bid-schedule.server");
    return { live: await setLiveMode(data.live) };
  });

/** Roda um ciclo do acompanhamento agora (útil no preview, onde o automático fica desligado). */
export const runBidSchedulerNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await guard(context);
    const { runSchedulerOnce } = await import("./bid-schedule.server");
    return await runSchedulerOnce();
  });
