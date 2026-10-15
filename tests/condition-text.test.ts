import { describe, expect, test } from "bun:test";

import { auctionFreight } from "../src/lib/auction-freight";
import { parseConditionFromText } from "../src/lib/grading";

const media = (t: string) => parseConditionFromText(t).media;

describe("texto brasileiro → grau", () => {
  test("ótimo estado vale VG+; estado regular vale G+", () => {
    expect(media("LP Fulano | Em ótimo estado")).toBe("VG+");
    expect(media("LP Fulano | Em estado regular")).toBe("G+");
    expect(media("LP Fulano | Em muito bom estado")).toBe("VG+");
    expect(media("LP Fulano | Em bom estado")).toBe("VG");
  });

  test("riscos que afetam a audição limitam o disco a G+", () => {
    expect(media("Disco VG+ com riscos que podem afetar a audição")).toBe("G+");
    expect(media("Disco apresenta riscos que prejudicam a audição")).toBe("G+");
    expect(media("Disco em ótimo estado, mas pula na faixa 3")).toBe("G+");
    expect(media("Disco com riscos profundos")).toBe("G+");
  });

  test("um defeito audível só rebaixa: disco pior que G+ continua pior", () => {
    expect(media("Disco G, pula em alguns trechos")).toBe("G");
  });

  test("negação não rebaixa", () => {
    expect(media("Disco VG+, sem pulos")).toBe("VG+");
    expect(media("Disco NM, não pula e sem riscos que afetem a audição")).toBe("NM");
  });

  test("a capa continua independente do aviso de audição", () => {
    const c = parseConditionFromText("Capa VG+. Disco com riscos que afetam a audição");
    expect(c.sleeve).toBe("VG+");
    expect(c.media).toBe("G+");
  });
});

describe("frete do leilão", () => {
  test("Sudeste R$ 25, resto R$ 35, UF desconhecida usa o maior", () => {
    expect(auctionFreight("SP")).toBe(25);
    expect(auctionFreight("rj")).toBe(25);
    expect(auctionFreight("MG")).toBe(25);
    expect(auctionFreight("ES")).toBe(25);
    expect(auctionFreight("RS")).toBe(35);
    expect(auctionFreight("BA")).toBe(35);
    expect(auctionFreight(null)).toBe(35);
    expect(auctionFreight("")).toBe(35);
  });
});
