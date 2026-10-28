import { describe, expect, test } from "bun:test";

import {
  errorMessage,
  isTransientTransportError,
  retryTransient,
  transientRetryDelay,
} from "@/lib/transient-error";

describe("isTransientTransportError", () => {
  test("reconhece o Invariant failed do cliente e erros de rede do navegador", () => {
    for (const m of [
      "Invariant failed",
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "fetch failed",
    ]) {
      expect(isTransientTransportError(new Error(m))).toBe(true);
    }
  });
  test("erro do servidor não é transitório", () => {
    expect(isTransientTransportError(new Error("Disco não encontrado"))).toBe(false);
    expect(isTransientTransportError(undefined)).toBe(false);
  });
});

describe("errorMessage", () => {
  test("transporte vira mensagem útil; o resto mantém a do servidor ou o padrão", () => {
    expect(errorMessage(new Error("Invariant failed"), "x")).toContain("não respondeu");
    expect(errorMessage(new Error("Disco não encontrado"), "x")).toBe("Disco não encontrado");
    expect(errorMessage(new Error(""), "padrão")).toBe("padrão");
  });
});

describe("retryTransient", () => {
  test("repete até 2 vezes, só em transporte", () => {
    const e = new Error("Invariant failed");
    expect(retryTransient(0, e)).toBe(true);
    expect(retryTransient(1, e)).toBe(true);
    expect(retryTransient(2, e)).toBe(false);
    expect(retryTransient(0, new Error("Disco não encontrado"))).toBe(false);
    expect(transientRetryDelay(0)).toBe(600);
    expect(transientRetryDelay(1)).toBe(1200);
  });
});
