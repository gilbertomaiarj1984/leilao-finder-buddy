import { describe, expect, test } from "bun:test";

import { parseBidCount } from "../src/lib/leiloesbr-lot-details.server";

describe("parseBidCount", () => {
  test("lê o histórico de lances da página do lote (RT Leilões e Artes)", () => {
    const html = `<li><p><label>Histórico de lances:</label>
      <a href="javascript:;" id="historico-trigger">10 lance(s)</a></p></li>`;
    expect(parseBidCount(html)).toBe(10);
  });

  test("lê QTDLANCE do JSON loadData quando existe", () => {
    expect(parseBidCount('{"QTDLANCE":"3","VALOR_VALUE":"60"}')).toBe(3);
    expect(parseBidCount('{"QTDLANCE":0}')).toBe(0);
  });

  test("sem rótulo nem campo: indefinido (nenhum lance conhecido)", () => {
    expect(parseBidCount("<p>Valor Atual: R$ 15,00</p>")).toBeUndefined();
  });
});
