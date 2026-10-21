import { describe, expect, test } from "bun:test";

import { checkGoogleUser } from "@/lib/access.server";
import { isDebugCall } from "@/lib/cron.server";

describe("checkGoogleUser", () => {
  const allowed = "dono@example.com";
  test("e-mail verificado e igual ao cadastrado entra, ignorando caixa e espaços", () => {
    expect(checkGoogleUser({ email: " Dono@Example.com ", email_verified: true }, allowed)).toEqual(
      {
        ok: true,
        email: "dono@example.com",
      },
    );
  });
  test("e-mail_verified ausente ou falso não ganha sessão", () => {
    expect(checkGoogleUser({ email: allowed }, allowed)).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect(checkGoogleUser({ email: allowed, email_verified: false }, allowed)).toEqual({
      ok: false,
      reason: "unverified",
    });
  });
  test("outra conta Google, mesmo verificada, é recusada no callback", () => {
    expect(checkGoogleUser({ email: "x@example.com", email_verified: true }, allowed)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
  test("sem e-mail cadastrado no servidor ninguém entra", () => {
    expect(checkGoogleUser({ email: allowed, email_verified: true }, null)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("isDebugCall", () => {
  const q = (s: string) => new URLSearchParams(s);
  test("steps de diagnóstico e ações destrutivas dependem da trava", () => {
    expect(isDebugCall("catalogdebug", q("domain=x&idLeilao=1"))).toBe(true);
    expect(isDebugCall("salesdebug", q(""))).toBe(true);
    expect(isDebugCall("cleannonvinyl", q("apply=1"))).toBe(true);
    expect(isDebugCall("sales", q("reset=1"))).toBe(true);
  });
  test("o uso normal do cron não é afetado", () => {
    expect(isDebugCall("chunk", q("fromPage=null"))).toBe(false);
    expect(isDebugCall("sales", q("max=8"))).toBe(false);
    expect(isDebugCall("cleannonvinyl", q(""))).toBe(false);
    expect(isDebugCall("aieval", q(""))).toBe(false);
  });
});
