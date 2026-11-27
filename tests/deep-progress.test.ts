import { describe, expect, test } from "bun:test";

import {
  advanceDeepProgress,
  clearDeepProgress,
  finishDeepProgress,
  getDeepProgress,
  startDeepProgress,
} from "../src/lib/deep-progress";

describe("andamento da análise profunda (rodapé)", () => {
  test("acumula blocos, erros e termina; clear volta a idle", () => {
    startDeepProgress(20, "27/11");
    expect(getDeepProgress()).toMatchObject({ status: "running", done: 0, total: 20 });
    advanceDeepProgress({ size: 12, evaluated: 10, skipped: 0, failed: 2 }, [
      { title: "LP A", message: "erro" },
    ]);
    advanceDeepProgress({ size: 8, evaluated: 6, skipped: 2, failed: 0 });
    const s = getDeepProgress();
    expect(s).toMatchObject({ done: 20, evaluated: 16, skipped: 2, failed: 2 });
    expect(s.errors).toHaveLength(1);
    finishDeepProgress([{ title: "Provedores de IA", message: "sem crédito" }]);
    expect(getDeepProgress().status).toBe("done");
    expect(getDeepProgress().errors).toHaveLength(2);
    clearDeepProgress();
    expect(getDeepProgress().status).toBe("idle");
  });

  test("done nunca passa do total", () => {
    startDeepProgress(5, "28/11");
    advanceDeepProgress({ size: 12, evaluated: 5, skipped: 0, failed: 0 });
    expect(getDeepProgress().done).toBe(5);
    clearDeepProgress();
  });
});
