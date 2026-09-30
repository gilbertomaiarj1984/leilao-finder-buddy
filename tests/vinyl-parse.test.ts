import { describe, expect, test } from "bun:test";

import {
  decodeHtmlEntities,
  extractArtist,
  isDiscBundle,
  isVinylTitle,
  laterAuctionSlot,
  looksNonVinyl,
  lotOpenUrl,
  normalizeForMatch,
  parsePrice,
  pickCanonical,
  titleCase,
} from "@/lib/vinyl-parse";

describe("vinil x não-vinil", () => {
  test("títulos de vinil", () => {
    expect(isVinylTitle("Compacto Beatles - Help")).toBe(true);
    expect(isVinylTitle("Disco de Vinil Raul Seixas - Krig-ha, Bandolo!")).toBe(true);
  });
  test("títulos que não são disco", () => {
    expect(looksNonVinyl("CD Caetano Veloso - Transa")).toBe(true);
    expect(looksNonVinyl("Vitrola antiga Philips")).toBe(true);
  });
});

describe("isDiscBundle", () => {
  test("lotes com vários discos", () => {
    expect(isDiscBundle("Lote com 10 LPs")).toBe(true);
    expect(isDiscBundle("5 discos de vinil MPB")).toBe(true);
    expect(isDiscBundle("três LPs de rock")).toBe(true);
    expect(isDiscBundle("150 discos diversos")).toBe(true);
    expect(isDiscBundle("Coleção de discos Beatles")).toBe(true);
  });
  test("disco único (inclui duplo e nº de lote no início)", () => {
    expect(isDiscBundle("2 LPs Pink Floyd The Wall")).toBe(false);
    expect(isDiscBundle("Lote 09 vinil único Chico")).toBe(false);
  });
  test("ano colado no formato não é quantidade", () => {
    expect(isDiscBundle("LP Vinil Chico Buarque - Construção 1971 Disco VG+ Capa VG")).toBe(false);
  });
});

describe("extractArtist", () => {
  test("artista antes do separador", () => {
    expect(extractArtist("LP Chico Buarque - Construção")).toBe("Chico Buarque");
    expect(extractArtist("Disco de Vinil Raul Seixas - Krig-ha, Bandolo!")).toBe("Raul Seixas");
    expect(extractArtist("LP Vinil Chico Buarque - Construção 1971 Disco VG+ Capa VG")).toBe(
      "Chico Buarque",
    );
  });
  test("apelido de artista conhecido", () => {
    expect(extractArtist("Compacto Beatles - Help")).toBe("The Beatles");
  });
  test("lote vira a categoria Lote", () => {
    expect(extractArtist("Lote com 10 LPs")).toBe("Lote");
  });
});

test("parsePrice", () => {
  expect(parsePrice("R$ 1.234,56")).toBe(1234.56);
  expect(parsePrice("R$ 50,00")).toBe(50);
  expect(parsePrice("Lance: R$ 10")).toBe(10);
  expect(parsePrice("")).toBeNull();
});

test("normalizeForMatch", () => {
  expect(normalizeForMatch("Construção - Chico Buarque (1971)")).toBe(
    "construcao chico buarque 1971",
  );
});

test("titleCase", () => {
  expect(titleCase("chico BUARQUE de hollanda")).toBe("Chico Buarque de Hollanda");
});

test("pickCanonical prefere a grafia acentuada", () => {
  expect(pickCanonical(["Alceu Valenca", "Alceu Valença"])).toBe("Alceu Valença");
  expect(pickCanonical([])).toBe("");
});

test("decodeHtmlEntities", () => {
  expect(decodeHtmlEntities("A &amp; B &#39;x&#39;")).toBe("A & B 'x'");
});

describe("laterAuctionSlot (leilão de vários dias)", () => {
  test("fica com o dia mais tardio", () => {
    const a = { dayKey: "2026-10-02", time: "19h" };
    const b = { dayKey: "2026-10-03", time: "10h" };
    expect(laterAuctionSlot(a, b)).toBe(b);
    expect(laterAuctionSlot(b, a)).toBe(b);
  });
  test("mesmo dia: hora maior vence (9h < 19h)", () => {
    const a = { dayKey: "2026-10-02", time: "9h" };
    const b = { dayKey: "2026-10-02", time: "19h" };
    expect(laterAuctionSlot(a, b)).toBe(b);
  });
  test("null perde; hora ilegível perde", () => {
    const a = { dayKey: "2026-10-02", time: "19h" };
    expect(laterAuctionSlot(null, a)).toBe(a);
    expect(laterAuctionSlot(a, null)).toBe(a);
    expect(laterAuctionSlot(a, { dayKey: "2026-10-05", time: "" })).toBe(a);
  });
});

describe("lotOpenUrl", () => {
  test("troca o redirecionador abre_catalogo pela peca.asp da casa", () => {
    expect(
      lotOpenUrl(
        "https://leiloesbr.com.br/abre_catalogo.asp?t=1|http://www.tremdas7.com.br|65073|32383278",
      ),
    ).toBe("https://www.tremdas7.com.br/peca.asp?ID=32383278");
  });
  test("deixa links fora do padrão intactos", () => {
    expect(lotOpenUrl("https://casa.com.br/peca.asp?ID=1")).toBe(
      "https://casa.com.br/peca.asp?ID=1",
    );
  });
});
