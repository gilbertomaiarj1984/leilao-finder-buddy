import { describe, expect, test } from "bun:test";
import {
  buildDigestEmail,
  buildLookoutEmail,
  escapeHtml,
  type DigestEntry,
  type LookoutEmailEntry,
} from "../src/lib/email-templates.server";

const lookout = (over: Partial<LookoutEmailEntry> = {}): LookoutEmailEntry => ({
  label: "Milton Nascimento — Clube da Esquina",
  house: "Casa <Exemplo>",
  dayKey: "2026-10-15",
  time: "19:30h",
  lote: "142",
  url: "https://x.test/lote/1",
  price: 180,
  ceiling: 250,
  score: 0.96,
  aiScore: 82,
  rarity: "raro",
  deal: "barato",
  marketLow: 300,
  marketHigh: 450,
  ...over,
});

describe("escapeHtml", () => {
  test("escapa caracteres especiais", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});

describe("buildLookoutEmail", () => {
  test("assunto no singular/plural e dentro do teto primeiro", () => {
    const above = lookout({ label: "ACIMA", price: 400 });
    const within = lookout({ label: "DENTRO" });
    const one = buildLookoutEmail([within]);
    expect(one.subject).toContain("1 novo lote casa");
    const two = buildLookoutEmail([above, within], "https://x.test/olho");
    expect(two.subject).toContain("2 novos lotes casam");
    expect(two.text.indexOf("DENTRO")).toBeLessThan(two.text.indexOf("ACIMA"));
    expect(two.text).toContain("[dentro do teto]");
    expect(two.text).toContain("[ACIMA do teto]");
    expect(two.text).toContain("https://x.test/olho");
  });
  test("escapa o HTML e formata preço em reais", () => {
    const r = buildLookoutEmail([lookout()]);
    expect(r.html).toContain("Casa &lt;Exemplo&gt;");
    expect(r.text).toContain("R$ 180,00");
    expect(r.text).toContain("R$ 300,00–R$ 450,00");
  });
  test("sem teto", () => {
    expect(buildLookoutEmail([lookout({ ceiling: null })]).text).toContain("sem teto");
  });
});

describe("buildDigestEmail", () => {
  const entry = (over: Partial<DigestEntry> = {}): DigestEntry => ({
    title: "Gilberto Gil — Expresso 2222",
    house: "Casa Exemplo",
    dayKey: "2026-10-13",
    time: "19:30h",
    url: "https://x.test/lote/2",
    price: 120,
    marketLow: null,
    marketHigh: null,
    aiScore: 91,
    rarity: "raro",
    deal: "barato",
    watched: true,
    ...over,
  });
  test("assunto com a quantidade e estrela nos vigiados", () => {
    const r = buildDigestEmail([entry(), entry({ watched: false })], "12/10", "https://x.test");
    expect(r.subject).toBe("🎵 Garimpo de Vinil: os 2 melhores lotes de hoje (12/10)");
    expect(r.text).toContain("1. ⭐ Gilberto Gil");
    expect(r.text).toContain("2. Gilberto Gil");
    expect(r.text).toContain("13/10 19:30h");
    expect(r.html).toContain("<table");
  });
});
