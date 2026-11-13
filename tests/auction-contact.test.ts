import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  contactKeys,
  describeKey,
  matchStore,
  parseAuctionPage,
  type KnownAuction,
} from "../src/lib/auction-contact";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("contactKeys", () => {
  test("telefone em formatos diferentes vira a mesma chave", () => {
    expect(contactKeys("Telefone : (21) 98228-9851")).toEqual(["tel:21982289851"]);
    expect(contactKeys("PELO TEL: 21 982289851")).toEqual(["tel:21982289851"]);
    expect(contactKeys("+55 11 94549-5706")).toEqual(["tel:11945495706"]);
  });
  test("e-mail, CEP e endereço", () => {
    const keys = contactKeys(
      "Rua Daniel Carneiro 142\nCEP 03132-040\nE-mail: JM.Antiguidades12@gmail.com",
    );
    expect(keys).toContain("email:jm.antiguidades12@gmail.com");
    expect(keys).toContain("cep:03132040");
    expect(keys).toContain("end:rua daniel carneiro 142");
  });
  test("datas e horários não viram telefone", () => {
    expect(contactKeys("Dias 05 e 06 de Outubro de 2026 às 19h30")).toEqual([]);
  });
  test("descreve a chave para o Giba", () => {
    expect(describeKey("tel:21982289851")).toBe("telefone (21) 98228-9851");
    expect(describeKey("email:a@b.com")).toBe("e-mail a@b.com");
  });
});

describe("parseAuctionPage — casos conhecidos", () => {
  test("JM Antiguidades via Alberto Lopes (V7.1): contato da loja no Local, sem o do leiloeiro", () => {
    const p = parseAuctionPage(fixture("auction-v71-jm-antiguidades.html"));
    expect(p.model).toBe("v71");
    expect(p.strong).toContain("email:jm.antiguidades12@gmail.com");
    expect(p.strong).toContain("tel:21982289851");
    expect(p.strong).toContain("end:rua daniel carneiro 142");
    // cabeçalho do site = leiloeiro: nunca entra
    const all = [...p.strong, ...p.weak];
    expect(all).not.toContain("tel:21970181515");
    expect(all).not.toContain("email:albertolopes.leiloeiro@gmail.com");
  });

  test("Escafandro (loja = leiloeiro, V8.9): sem contato no Local, nada a aprender", () => {
    const p = parseAuctionPage(fixture("auction-v89-escafandro.html"));
    expect(p.model).toBe("v89");
    expect(p.siteName).toBe("Escafandro Discos - Antiguidades e Colecionáveis");
    expect(p.siteId).toBe("1024");
    expect(p.strong).toEqual([]);
    expect(p.weak).toEqual([]);
  });

  test("Acervo do Garimpeiro (V8.9): CEP forte e WhatsApp fraco", () => {
    const p = parseAuctionPage(fixture("auction-v89-garimpeiro.html"));
    expect(p.siteName).toBe("Acervo do Garimpeiro");
    expect(p.siteId).toBe("1185");
    expect(p.strong).toEqual(["cep:03132040"]);
    expect(p.weak).toEqual(["tel:11945495706"]);
  });

  test("Discorama do Alberto (recriado da captura): Local sem contato; WhatsApp de fora só como fraco", () => {
    const html = `
      <div class="four columns telefone-topo border-right"><span><p>Telefone:<br/>
      <a href='tel:(21) 97018-1515'>(21) 97018-1515</a></p></span></div>
      <div class="four columns mail-topo border-right"><a href="mailto:albertolopes.leiloeiro@gmail.com">
      <p>Email:<br/>albertolopes.leiloeiro@gmail.com</p></a></div>
      <!-- Topo do Header End -->
      <div class="cntblck"><div class="section-title"><h2><span><i class="fa fa-calendar" aria-hidden="true"></i> Exposição</span></h2></div>
      <span><p>Sexta-feira, 2 de outubro (online),<br />mediante agendamento prévio pelo WhatsApp: (21) 98808-1600</p></span></div>
      <div class="cntblck"><div class="section-title"><h2><span><i class="fa fa-map-marker" aria-hidden="true"></i> Local</span></h2></div>
      <span><p>POR MOTIVOS DE FORÇA MAIOR, NESTE LEILÃO NÃO TEREMOS RETIRADAS NO LOCAL</p></span></div>`;
    const p = parseAuctionPage(html);
    expect(p.strong).toEqual([]);
    expect(p.weak).toEqual(["tel:21988081600"]);
  });

  test("página sem nada reconhecível não quebra", () => {
    const p = parseAuctionPage("<html><body>403</body></html>");
    expect(p.model).toBe("unknown");
    expect(p.strong).toEqual([]);
    expect(p.weak).toEqual([]);
  });
});

const known = (over: Partial<KnownAuction> & { id: string }): KnownAuction => ({
  store: "",
  source: "",
  strong: [],
  weak: [],
  ...over,
});

describe("matchStore", () => {
  const jm = known({
    id: "67003",
    store: "JM Antiguidades",
    source: "manual",
    strong: ["email:jm@x.com", "tel:21982289851"],
  });

  test("chave forte que bate com uma só loja ensinada vincula sozinho", () => {
    const r = matchStore({ id: "68000", strong: ["email:jm@x.com"], weak: [], known: [jm] });
    expect(r).toEqual({ kind: "auto", store: "JM Antiguidades", via: "email:jm@x.com" });
  });

  test("sem contato (leilão do próprio leiloeiro) não vincula nada", () => {
    const r = matchStore({ id: "68000", strong: [], weak: [], known: [jm] });
    expect(r.kind).toBe("none");
  });

  test("telefone fora do Local só sugere, nunca vincula", () => {
    const r = matchStore({ id: "68000", strong: [], weak: ["tel:21982289851"], known: [jm] });
    expect(r).toEqual({ kind: "suggest", store: "JM Antiguidades", via: "tel:21982289851" });
  });

  test("contato que aparece em pregão sem loja é do leiloeiro: não vincula", () => {
    const own = known({ id: "64856", strong: ["email:jm@x.com"] });
    const r = matchStore({ id: "68000", strong: ["email:jm@x.com"], weak: [], known: [jm, own] });
    expect(r.kind).toBe("none");
  });

  test("mesmo contato em duas lojas diferentes: não vincula", () => {
    const outra = known({
      id: "67100",
      store: "Outra Loja",
      source: "manual",
      strong: ["email:jm@x.com"],
    });
    const r = matchStore({ id: "68000", strong: ["email:jm@x.com"], weak: [], known: [jm, outra] });
    expect(r.kind).toBe("none");
  });

  test('"Não é" bloqueia o par loja + chave', () => {
    const r = matchStore({
      id: "68000",
      strong: [],
      weak: ["tel:21982289851"],
      known: [jm],
      blocked: new Set(["JM Antiguidades|tel:21982289851"]),
    });
    expect(r.kind).toBe("none");
  });

  test("vínculo automático não ensina (erro não se propaga)", () => {
    const auto = known({
      id: "67500",
      store: "Loja Errada",
      source: "auto",
      strong: ["email:z@z.com"],
    });
    const r = matchStore({ id: "68000", strong: ["email:z@z.com"], weak: [], known: [auto] });
    expect(r.kind).toBe("none");
  });

  test("Família Sardinha via Claudio Firmino e Leilão Meier via Bruce Angeiras aprendem por contato", () => {
    const sardinha = known({
      id: "66721",
      store: "Família Sardinha",
      source: "manual",
      strong: ["tel:21911112222"],
    });
    const meier = known({
      id: "65419",
      store: "Leilão Meier",
      source: "confirmado",
      strong: ["email:meier@x.com"],
    });
    expect(
      matchStore({ id: "70001", strong: ["tel:21911112222"], weak: [], known: [sardinha, meier] }),
    ).toEqual({ kind: "auto", store: "Família Sardinha", via: "tel:21911112222" });
    expect(
      matchStore({
        id: "70002",
        strong: ["email:meier@x.com"],
        weak: [],
        known: [sardinha, meier],
      }),
    ).toEqual({ kind: "auto", store: "Leilão Meier", via: "email:meier@x.com" });
  });
});
