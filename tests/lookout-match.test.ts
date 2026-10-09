import { describe, expect, test } from "bun:test";

import type { SaleRow } from "@/lib/analytics";
import { analyticsHistoryForItems } from "@/lib/lookout-analytics";
import { parseLookoutBulk } from "@/lib/lookout-bulk";
import {
  buildLotIdentity,
  lookoutCandidates,
  lookoutOwnedInCollection,
  matchLookoutForLot,
  notifyKey,
  pickNotifiable,
  priceVsCeiling,
  resolveLookoutArtist,
  similarLookoutItems,
  type LookoutItem,
  type LookoutMatch,
} from "@/lib/lookout-match";

function item(over: Partial<LookoutItem> = {}): LookoutItem {
  return {
    id: "it1",
    lotId: "100-1",
    artist: "Chico Buarque",
    album: "Construção",
    year: 1971,
    title: "LP Chico Buarque Construção 1971",
    house: "Casa A",
    image: null,
    url: "",
    dayKey: "2026-10-01",
    maxPrice: null,
    note: "",
    status: "active",
    ...over,
  };
}

const ident = (title: string, artist: string, album?: string) =>
  buildLotIdentity({ title, artist, album: album ?? null });

describe("matchLookoutForLot", () => {
  test("reconhece o mesmo disco em outro lote (artista + álbum)", () => {
    const cands = lookoutCandidates([item()]);
    const hit = matchLookoutForLot(
      cands,
      "200-9",
      ident("LP Chico Buarque - Construção - 1971", "Chico Buarque"),
    );
    expect(hit?.itemId).toBe("it1");
    expect(hit!.score).toBeGreaterThanOrEqual(0.8);
  });

  test("não casa outro disco do mesmo artista", () => {
    const cands = lookoutCandidates([item()]);
    const hit = matchLookoutForLot(
      cands,
      "200-9",
      ident("LP Chico Buarque - Almanaque - 1981", "Chico Buarque", "Chico Buarque - Almanaque"),
    );
    expect(hit).toBeNull();
  });

  test("nunca casa com o próprio lote de origem", () => {
    const cands = lookoutCandidates([item()]);
    expect(
      matchLookoutForLot(cands, "100-1", ident("LP Chico Buarque - Construção", "Chico Buarque")),
    ).toBeNull();
  });

  test("lote descartado pelo usuário não casa; confirmado casa mesmo sem texto", () => {
    const cands = lookoutCandidates([item()]);
    const id = ident("LP Chico Buarque - Construção", "Chico Buarque");
    expect(matchLookoutForLot(cands, "200-9", id, { "200-9": false })).toBeNull();
    const forced = matchLookoutForLot(cands, "300-3", ident("Disco qualquer", "Fulano"), {
      "300-3": "it1",
    });
    expect(forced).toMatchObject({ itemId: "it1", score: 1, confirmed: true });
  });

  test("itens adquiridos/descartados e sem artista real não viram candidatos", () => {
    expect(lookoutCandidates([item({ status: "acquired" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ status: "dismissed" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ artist: "Lote" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ album: "" })])).toHaveLength(0);
  });
});

describe("pickNotifiable", () => {
  const m = (lotId: string, itemId: string, score: number, confirmed = false): LookoutMatch => ({
    lotId,
    itemId,
    score,
    confirmed,
  });

  test("só confiantes e ainda não avisados", () => {
    const matches = [m("a", "i", 0.9), m("b", "i", 0.65), m("c", "i", 1, true), m("d", "i", 0.85)];
    const notified = new Set([notifyKey({ lotId: "d", itemId: "i" })]);
    expect(pickNotifiable(matches, notified).map((x) => x.lotId)).toEqual(["a", "c"]);
  });
});

describe("priceVsCeiling", () => {
  test("compara com o teto", () => {
    expect(priceVsCeiling(50, 80)).toBe("under");
    expect(priceVsCeiling(80, 80)).toBe("under");
    expect(priceVsCeiling(120, 80)).toBe("over");
    expect(priceVsCeiling(null, 80)).toBeNull();
    expect(priceVsCeiling(50, null)).toBeNull();
  });
});

describe("analyticsHistoryForItems", () => {
  const sale = (lot_id: string, title: string, over: Partial<SaleRow> = {}): SaleRow => ({
    lot_id,
    id_leilao: "1",
    id_peca: lot_id,
    artist: "Gal Costa",
    title,
    sold_price: 50,
    sold_price_raw: "R$ 50,00",
    sold_date: "2026-09-01",
    house: "Casa X",
    uf: "SP",
    media: "",
    sleeve: "",
    score: null,
    faixa: "",
    insert_state: "",
    source_url: "",
    ...over,
  });
  const cands = lookoutCandidates([
    item({ id: "g", lotId: "origem", artist: "Gal Costa", album: "Profana", year: 1984 }),
  ]);
  const sales = [
    sale("a", "LP Gal Costa - Profana 1984"),
    sale("b", "Gal Costa - Profana - Capa VG+ - Disco EX", { media: "EX", sleeve: "VG+" }),
    sale("oculta", "LP Gal Costa - Profana 1984"),
    sale("kit", "LP Gal Costa - Profana 1984", { bundle: true }),
    sale("outro", "LP Gal Costa - Fa-Tal 1971"),
    sale("origem", "LP Gal Costa - Profana 1984"),
  ];

  test("traz as vendas do álbum certo, sem ocultas, kits, outro disco nem o lote de origem", () => {
    const hits = analyticsHistoryForItems({
      sales,
      aliases: { excludedSales: { oculta: "Gal Costa — Profana" } },
      cands,
    });
    expect(hits.map((h) => h.sale.lot_id).sort()).toEqual(["a", "b"]);
    expect(hits.every((h) => h.itemId === "g")).toBe(true);
  });

  test("respeita o descarte por lote e funciona sem candidatos", () => {
    const hits = analyticsHistoryForItems({ sales, aliases: {}, cands, links: { a: false } });
    expect(hits.map((h) => h.sale.lot_id)).not.toContain("a");
    expect(analyticsHistoryForItems({ sales, aliases: {}, cands: [] })).toEqual([]);
  });
});

describe("disco de nome genérico (homônimo do artista) — validação por ano", () => {
  const cands = lookoutCandidates([
    item({
      id: "cv",
      lotId: "origem",
      artist: "Caetano Veloso",
      album: "Caetano Veloso",
      year: 1986,
    }),
  ]);
  const lot = (title: string, knownYear?: number) =>
    buildLotIdentity({
      title,
      artist: "Caetano Veloso",
      album: "Caetano Veloso - Caetano Veloso",
      knownYear,
    });

  test("ano igual ao do item → confirmado; ano diferente → não é este disco", () => {
    const ok = matchLookoutForLot(cands, "a", lot("LP Caetano Veloso 1986"));
    expect(ok?.yearPending).toBeFalsy();
    expect(ok!.score).toBeGreaterThanOrEqual(0.8);
    expect(matchLookoutForLot(cands, "b", lot("LP Caetano Veloso 1971"))).toBeNull();
  });

  test("sem ano → fica 'a validar' (score limitado, nunca confiante)", () => {
    const hit = matchLookoutForLot(cands, "c", lot("LP Caetano Veloso"));
    expect(hit?.yearPending).toBe(true);
    expect(hit!.score).toBeLessThan(0.8);
    expect(hit!.score).toBeGreaterThanOrEqual(0.6);
  });

  test("ano conhecido por outra fonte (lot_ident) vale; vínculo do usuário vence", () => {
    expect(matchLookoutForLot(cands, "d", lot("LP Caetano Veloso", 1986))?.yearPending).toBeFalsy();
    expect(matchLookoutForLot(cands, "e", lot("LP Caetano Veloso", 1971))).toBeNull();
    const forced = matchLookoutForLot(cands, "f", lot("LP Caetano Veloso 1971"), { f: "cv" });
    expect(forced?.confirmed).toBe(true);
  });

  test("histórico do Analytics: confere o ano venda a venda", () => {
    const mk = (id: string, title: string): SaleRow => ({
      lot_id: id,
      id_leilao: "1",
      id_peca: id,
      artist: "Caetano Veloso",
      title,
      sold_price: 50,
      sold_price_raw: "",
      sold_date: "2026-09-01",
      house: "Casa",
      uf: "SP",
      media: "",
      sleeve: "",
      score: null,
      faixa: "",
      insert_state: "",
      source_url: "",
    });
    const sales = [
      mk("s86", "Caetano Veloso 1986"),
      mk("s71", "Caetano Veloso 1971"),
      mk("sem", "Caetano Veloso - Uns"),
      mk("ident", "Caetano Veloso LP"),
    ];
    const overrides = Object.fromEntries(sales.map((x) => [x.lot_id, { album: "Caetano Veloso" }]));
    const hits = analyticsHistoryForItems({
      sales,
      aliases: { sales: overrides },
      cands,
      yearOf: (id) => (id === "ident" ? 1986 : null),
    });
    const byId = Object.fromEntries(hits.map((h) => [h.sale.lot_id, h.pending]));
    expect(byId).toEqual({ s86: false, sem: true, ident: false });
  });
});

describe("juntar álbuns e lote de origem (v0.117.0)", () => {
  test("álbum juntado vira candidato do MESMO item", () => {
    const base = item({
      id: "tm",
      lotId: "1-1",
      artist: "Tim Maia",
      album: "Tim Maia",
      year: 1971,
      merged: [
        {
          lotId: "2-2",
          artist: "Tim Maia",
          album: "Racional",
          year: 1975,
          title: "LP Tim Maia Racional",
          house: "Casa B",
          image: null,
          url: "",
          dayKey: "2026-10-02",
        },
      ],
    });
    const cands = lookoutCandidates([base]);
    expect(cands).toHaveLength(2);
    const hit = matchLookoutForLot(
      cands,
      "9-9",
      ident("LP Tim Maia Racional 1975", "Tim Maia", "Tim Maia - Racional"),
    );
    expect(hit?.itemId).toBe("tm");
  });

  test("includeOrigin: o lote marcado casa com o próprio item (confirmado, isOrigin)", () => {
    const cands = lookoutCandidates([item()]);
    const id = ident(
      "LP Chico Buarque Construção 1971",
      "Chico Buarque",
      "Chico Buarque - Construção",
    );
    expect(matchLookoutForLot(cands, "100-1", id)).toBeNull();
    const hit = matchLookoutForLot(cands, "100-1", id, undefined, { includeOrigin: true });
    expect(hit).toMatchObject({ itemId: "it1", confirmed: true, isOrigin: true });
  });
});

describe("palavras extras do usuário (v0.118.0)", () => {
  const tm = (terms?: string[]) =>
    item({ id: "tm", lotId: "1-1", artist: "Tim Maia", album: "Tim Maia", year: 1972, terms });
  const lot = ident("LP Tim Maia 1971 Disco de ouro", "Tim Maia");

  test("sem a palavra, o ano 1971 não casa com o disco de 1972", () => {
    const hit = matchLookoutForLot(lookoutCandidates([tm()]), "9-9", lot);
    expect(hit === null || hit.yearPending || hit.score < 0.8).toBe(true);
  });

  test("com a palavra '1971', o lote do mesmo artista casa com confiança", () => {
    const hit = matchLookoutForLot(lookoutCandidates([tm(["1971"])]), "9-9", lot);
    expect(hit?.itemId).toBe("tm");
    expect(hit?.score).toBeGreaterThanOrEqual(0.8);
    expect(hit?.yearPending).toBeFalsy();
  });

  test("a palavra sozinha não casa lote de OUTRO artista", () => {
    const other = ident("LP Jorge Ben 1971 Força Bruta", "Jorge Ben");
    expect(matchLookoutForLot(lookoutCandidates([tm(["1971"])]), "9-9", other)).toBeNull();
  });
});

describe("similarLookoutItems — só pergunta quando há dúvida", () => {
  const tm = item({ id: "tm", lotId: "1-1", artist: "Tim Maia", album: "Tim Maia", year: 1972 });
  const input = (album: string, year: number | null) => ({
    artist: "Tim Maia",
    album,
    year,
    lotId: "9-9",
  });

  test("mesmo artista e mesmo álbum → idêntico, sem pergunta (o servidor reaproveita)", () => {
    expect(similarLookoutItems([tm], input("Tim Maia", 1972))).toHaveLength(0);
  });
  test("mesmo artista, outro ano do disco homônimo / sem álbum → pergunta", () => {
    expect(similarLookoutItems([tm], input("Tim Maia", 1971))).toHaveLength(0); // idêntico por nome
    expect(similarLookoutItems([tm], input("", 1971))).toHaveLength(1);
    expect(similarLookoutItems([tm], input("Tim Maia Racional", null))).toHaveLength(1);
  });
  test("mesmo artista, disco claramente diferente → não pergunta", () => {
    expect(similarLookoutItems([tm], input("Nobre Vagabundo", 1980))).toHaveLength(0);
  });
  test("outro artista → não pergunta", () => {
    expect(
      similarLookoutItems([tm], {
        artist: "Jorge Ben",
        album: "Tim Maia",
        year: 1972,
        lotId: "9-9",
      }),
    ).toHaveLength(0);
  });
});

describe("artistas juntados na página (v0.120.0)", () => {
  const groups = {
    "elis regina e tom jobim": { to: "Elis Regina", label: "Elis Regina e Tom Jobim" },
  };
  test("o nome de quem recebe permanece", () => {
    expect(resolveLookoutArtist("Elis Regina e Tom Jobim", groups)).toBe("Elis Regina");
    expect(resolveLookoutArtist("Elis Regina", groups)).toBe("Elis Regina");
  });
  test("segue cadeias e não entra em ciclo", () => {
    const chain = {
      ...groups,
      "elis regina": { to: "Elis", label: "Elis Regina" },
      elis: { to: "Elis Regina", label: "Elis" },
    };
    expect(resolveLookoutArtist("Elis Regina e Tom Jobim", groups)).toBe("Elis Regina");
    expect(() => resolveLookoutArtist("Elis", chain)).not.toThrow();
  });
});

describe("parseLookoutBulk", () => {
  test("numeração é opcional e o ano vira pista", () => {
    const r = parseLookoutBulk(
      "\\01. The Dark Side of the Moon (1973) - Pink Floyd\nAbbey Road (1969) - The Beatles\n\n- Tim Maia Racional\n02) Abbey Road (1969) - The Beatles",
    );
    expect(r.map((e) => e.text)).toEqual([
      "The Dark Side of the Moon (1973) - Pink Floyd",
      "Abbey Road (1969) - The Beatles",
      "Tim Maia Racional",
    ]);
    expect(r[0]!.year).toBe(1973);
    expect(r[2]!.year).toBeNull();
  });
});

describe("lookoutOwnedInCollection", () => {
  const mk = (id: string, artist: string, album: string, year: number | null) =>
    item({ id, lotId: `manual-${id}`, artist, album, year, status: "active" });
  const col = [
    { id: "c1", artist: "The Beatles", album: "Abbey Road", year: 1969 },
    { id: "c2", artist: "Pink Floyd", album: "The Wall", year: 1979 },
  ];
  test("acha o disco que já está na Coleção e ignora outro álbum do mesmo artista", () => {
    const hits = lookoutOwnedInCollection(
      [
        mk("a", "The Beatles", "Abbey Road", 1969),
        mk("b", "The Beatles", "Let It Be", 1970),
        mk("c", "Radiohead", "OK Computer", 1997),
      ],
      col,
    );
    expect(hits.map((h) => h.itemId)).toEqual(["a"]);
    expect(hits[0]!.owned.id).toBe("c1");
    expect(hits[0]!.confident).toBe(true);
  });
  test("ignora itens que não estão ativos", () => {
    const arch = { ...mk("a", "The Beatles", "Abbey Road", 1969), status: "acquired" as const };
    expect(lookoutOwnedInCollection([arch], col)).toEqual([]);
  });
});
