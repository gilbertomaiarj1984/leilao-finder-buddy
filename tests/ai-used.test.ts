import { describe, expect, test } from "bun:test";

import { formatAiUsed } from "../src/lib/ai-provider";

describe("formatAiUsed", () => {
  test("sem dado devolve vazio", () => {
    expect(formatAiUsed(null)).toBe("");
    expect(formatAiUsed(undefined)).toBe("");
  });

  test("mostra provedor e modelo", () => {
    expect(formatAiUsed({ provider: "groq", model: "openai/gpt-oss-120b", switched: false })).toBe(
      " · IA: Groq openai/gpt-oss-120b",
    );
  });

  test("sem modelo mostra só o provedor; failover é avisado", () => {
    expect(formatAiUsed({ provider: "gemini", model: null, switched: true })).toBe(
      " · IA: Gemini (failover)",
    );
  });
});
