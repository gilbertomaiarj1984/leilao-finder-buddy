import { describe, expect, test } from "bun:test";

import { auctionFreight } from "../src/lib/auction-freight";
import { compileUserRules, effectiveTextRules } from "../src/lib/condition-text";
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

  test("a vírgula encerra o alcance da negação", () => {
    expect(media("LP Fulano | sem pulos, em ótimo estado")).toBe("VG+");
    expect(media("LP Fulano | sem encarte, mas pula na faixa 2")).toBe("G+");
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

describe("vocabulário reconhecido", () => {
  test("todo termo da lista vira um grau", async () => {
    const { VOCABULARY_TERMS } = await import("../src/lib/condition-text");
    const { normalizeGrade } = await import("../src/lib/grading");
    for (const t of VOCABULARY_TERMS) expect(normalizeGrade(t)).not.toBeNull();
    expect(normalizeGrade("bom")).toBe("VG");
    expect(normalizeGrade("muito bom")).toBe("VG+");
    expect(normalizeGrade("excelente")).toBe("EX");
    expect(normalizeGrade("regular")).toBe("G+");
  });
});

describe("regras do usuário (painel de IA)", () => {
  const user = [
    { id: "u1", phrase: "riscos * audição", grade: "G+" as const, effect: "cap" as const },
    {
      id: "u2",
      phrase: "estado de conservação regular",
      grade: "G+" as const,
      effect: "set" as const,
    },
    { id: "u3", phrase: "muito bem conservado", grade: "VG+" as const, effect: "set" as const },
  ];
  const rules = effectiveTextRules(user, []);
  const media = (t: string) => parseConditionFromText(t, rules).media;

  test("uma expressão nova passa a valer; * cobre um trecho curto", () => {
    expect(media("LP Fulano | muito bem conservado")).toBe("VG+");
    expect(media("LP Fulano | estado de conservação regular")).toBe("G+");
    expect(media("Disco VG+ com riscos leves que podem comprometer a audição")).toBe("G+");
  });

  test("frase curta demais ou só com * é ignorada", () => {
    expect(compileUserRules([{ id: "x", phrase: "ab", grade: "G", effect: "set" }])).toEqual([]);
    expect(compileUserRules([{ id: "y", phrase: " * ", grade: "G", effect: "set" }])).toEqual([]);
  });

  test("caracteres especiais da frase não quebram a regex", () => {
    const r = compileUserRules([
      { id: "z", phrase: "arranhões (leves)+", grade: "VG", effect: "set" },
    ]);
    expect(() => new RegExp(r[0]!.pattern)).not.toThrow();
  });

  test("desligar uma regra do app a remove", () => {
    expect(
      parseConditionFromText("LP Fulano | em bom estado", effectiveTextRules([], [])).media,
    ).toBe("VG");
    expect(
      parseConditionFromText("LP Fulano | em bom estado", effectiveTextRules([], ["bom-estado"]))
        .media,
    ).toBeNull();
  });
});

describe("revisão do leitor de texto (v0.143.1)", () => {
  const media = (t: string) => parseConditionFromText(t).media;

  test("negação dentro do trecho casado não rebaixa", () => {
    expect(media("Disco VG+. Riscos superficiais que não afetam a audição")).toBe("VG+");
    expect(media("Disco NM, riscos leves que nao interferem na reproducao")).toBe("NM");
  });

  test("a negação não atravessa 'em', 'com', 'e' e 'mas'", () => {
    expect(media("LP Fulano sem encarte em bom estado")).toBe("VG");
    expect(media("LP Fulano sem encarte mas em ótimo estado")).toBe("VG+");
    expect(media("LP Fulano sem encarte e com riscos que afetam a audição")).toBe("G+");
  });

  test("ex- colado a outra palavra não é grau EX", () => {
    expect(media("Disco do ex-Beatle Paul McCartney")).toBeNull();
    expect(media("Disco EX, capa VG")).toBe("EX");
  });

  test("frase do usuário terminada em símbolo e limite de asteriscos", async () => {
    const { compileUserRules, matchTextRules } = await import("../src/lib/condition-text");
    const sym = compileUserRules([{ id: "s", phrase: "disco vg+", grade: "G+", effect: "cap" }]);
    expect(matchTextRules("DISCO VG+ COM RISCOS", sym).length).toBe(1);
    expect(matchTextRules("DISCO VG+X", sym).length).toBe(0);
    const many = compileUserRules([{ id: "m", phrase: "a*b*c*d*e", grade: "G+", effect: "cap" }]);
    expect(many).toEqual([]); // mais de 3 asteriscos é ignorada (backtracking)
    const t0 = Date.now();
    const ok = compileUserRules([
      { id: "o", phrase: "riscos * * * audicao", grade: "G+", effect: "cap" },
    ]);
    matchTextRules("RISCOS ".repeat(40), ok);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("URL de capa enviada ao Gemini", () => {
  test("recusa rede interna, metadados e esquemas estranhos", async () => {
    const { isSafeImageUrl } = await import("../src/lib/ai-provider.server");
    expect(isSafeImageUrl("https://img.leiloesbr.com.br/a/b.jpg")).toBe(true);
    expect(isSafeImageUrl("http://i.discogs.com/x.jpeg")).toBe(true);
    for (const bad of [
      "http://localhost/a.jpg",
      "http://app/a.jpg",
      "http://postgres:5432/",
      "http://127.0.0.1/a.jpg",
      "http://10.0.0.5/a.jpg",
      "http://172.20.1.1/a.jpg",
      "http://192.168.1.2/a.jpg",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/a.jpg",
      "http://servico.internal/a.jpg",
      "file:///etc/passwd",
      "ftp://x.com/a.jpg",
      "lixo",
    ])
      expect(isSafeImageUrl(bad)).toBe(false);
    expect(isSafeImageUrl("http://172.32.0.1/a.jpg")).toBe(true); // fora da faixa 172.16/12
  });
});
