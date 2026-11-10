import { describe, expect, test } from "bun:test";

import {
  decideBid,
  decideTrigger,
  parseBrl,
  parseLoteNumber,
  parseSchedules,
  validateScheduleInput,
} from "../src/lib/bid-schedule";

const base = {
  idLeilao: "66081",
  house: "Escafandro",
  presencialUrl: "https://x.com.br/presencial/presencial.asp?Num=66081",
  triggerLote: 118,
  targetLote: 120,
  expectedValue: null,
  maxValue: 150,
};

describe("bid-schedule", () => {
  test("parseLoteNumber / parseBrl", () => {
    expect(parseLoteNumber("118A")).toBe(118);
    expect(parseLoteNumber("--")).toBeNull();
    expect(parseBrl("R$ 1.050,50")).toBe(1050.5);
    expect(parseBrl("25")).toBe(25);
    expect(parseBrl("abc")).toBeNull();
  });

  test("validação do formulário", () => {
    expect(validateScheduleInput({ ...base }).ok).toBe(true);
    expect(validateScheduleInput({ ...base, maxValue: "" })).toMatchObject({ ok: false });
    expect(validateScheduleInput({ ...base, triggerLote: 130 })).toMatchObject({ ok: false });
    const r = validateScheduleInput({ ...base, expectedValue: "20" });
    expect(r.ok && r.value.expectedValue).toBe(20);
  });

  test("gatilho: espera, dispara sem perder o lote pulado, expira", () => {
    expect(decideTrigger(base, 117)).toBe("wait");
    expect(decideTrigger(base, null)).toBe("wait");
    expect(decideTrigger(base, 118)).toBe("fire");
    expect(decideTrigger(base, 119)).toBe("fire");
    expect(decideTrigger(base, 120)).toBe("fire");
    expect(decideTrigger(base, 121)).toBe("expire");
  });

  test("regra de valor: próximo lance, valor esperado e teto", () => {
    expect(decideBid(base, { currentValue: 20, nextBid: 25 })).toEqual({
      action: "bid",
      value: 25,
    });
    expect(
      decideBid({ ...base, expectedValue: 20 }, { currentValue: 30, nextBid: 35 }),
    ).toMatchObject({
      action: "skip",
    });
    expect(
      decideBid({ ...base, expectedValue: 20 }, { currentValue: 20, nextBid: 25 }).action,
    ).toBe("bid");
    expect(decideBid(base, { currentValue: 150, nextBid: 160 })).toMatchObject({ action: "skip" });
    expect(decideBid(base, { currentValue: 20, nextBid: null })).toMatchObject({ action: "skip" });
  });

  test("parseSchedules descarta itens inválidos", () => {
    const ok = { ...base, id: "a", status: "waiting", createdAt: "", updatedAt: "", message: "" };
    expect(parseSchedules([ok, { id: 1 }, null, { ...ok, status: "x" }])).toHaveLength(1);
    expect(parseSchedules("lixo")).toEqual([]);
  });
});

import { parseLivePeca } from "../src/lib/leiloesbr-lot-details.server";

describe("parseLivePeca", () => {
  test("template novo (loadData)", () => {
    const html =
      '{"QTDLANCE":"1","NOVO_VALOR":"25","VALOR_VALUE":"20","VENCENDO":false,"MOSTRABTN_CLASS":"is-naovendido"}';
    expect(parseLivePeca(html)).toMatchObject({
      template: "new",
      currentValue: 20,
      nextBid: 25,
      qtdLances: "1",
      winning: false,
    });
    expect(parseLivePeca('{"NOVO_VALOR":"25","VENCENDO":true}').winning).toBe(true);
  });

  test("template antigo (formulário POST em peca.asp)", () => {
    const html = `<form name="frmLances"><label>Valor  Atual: </label>
      <span class="is-rs">R$</span> <span class="is-valor">3,00</span>
      <input type="hidden" name="IdLeilao" value="66844">
      <input type="hidden" name="IdPeca" value="33274159">
      <input type="hidden" name="ValorMinimo" value="6.00">
      <input type="hidden" name="lanceclicado" value="0">
      <input type="hidden" name="vold" value="3"></form>`;
    expect(parseLivePeca(html)).toMatchObject({
      template: "old",
      currentValue: 3,
      nextBid: 6,
      oldForm: { valorMinimo: "6.00", lanceclicado: "0", vold: "3" },
    });
  });

  test("página desconhecida", () => {
    expect(parseLivePeca("<html></html>").template).toBeNull();
  });
});
