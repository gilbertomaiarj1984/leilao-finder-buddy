// ==UserScript==
// @name         Leilão presencial — Lance único no FECHANDO (status 4)
// @namespace    garimpo-de-vinil
// @version      3.0.0
// @description  Dispara UM lance no momento exato do FECHANDO (status 4), usando a SUA conta já logada, para tentar arrematar no menor valor possível no último instante. Faz um único lance e desarma. Reusa a função de lance do próprio site. Use por sua conta e risco (ver termos/edital do leilão).
// @match        *://*/presencial/presencial.asp*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// PROPÓSITO
// ---------
// UM lance certeiro no último instante. A escalada até um teto você já faz pelo
// LANCE AUTOMÁTICO do próprio site — este script NÃO cobre repetidamente. Ele só
// espera o lote entrar em FECHANDO (status "4") e, se você não estiver vencendo,
// dispara UM lance (o incremento mínimo do momento) e desarma.
//
// COMO FUNCIONA
// ------------
// A página mantém o objeto global `novoPresencial`:
//   - status do lote em `statusatual` (P -> X -> 1/2/3 -> 4 FECHANDO -> F fechado);
//   - o próximo lance já calculado em `valorpecaatual`;
//   - quem está ganhando em `lancevencedor`;
//   - envia o lance com `Fazerlance()` (POST lote_fazerlance.asp) com o seu cookie.
// O site DESABILITA o botão no status 4, mas `Fazerlance()` em si só recusa 'F' —
// por isso conseguimos TESTAR o lance no 4 chamando a função diretamente. Se o
// servidor aceitar, a confirmação no log mostra "✓ você está vencendo".
//
// TURBO (recomendado, ligado por padrão): faz um polling próprio (~250ms) no mesmo
// endpoint do site para detectar a virada para o status 4 antes do loop de ~1s da
// página — essencial para pegar o 4 a tempo.
//
// IMPORTANTE: automatizar lance pode violar os termos/edital do leilão. É a sua
// conta e o seu dinheiro; a decisão e o risco são seus. Teste num lote barato.

(function () {
  "use strict";

  var STATUS_LABEL = {
    P: "Em pregão", X: "Prestes a fechar", "1": "Dou-lhe uma", "2": "Dou-lhe duas",
    "3": "VOU BATER", "4": "FECHANDO", F: "Fechado/vendido", S: "Passa o lote",
    E: "Em exame", T: "Chamada telefônica", R: "Recarregar", "": "—",
  };

  var TRIGGER = "4"; // único gatilho: FECHANDO

  var armed = false;
  var tetoOpcional = 0; // 0 = sem teto (dispara qualquer que seja o valor)
  var turbo = true;
  var armedPeca = null;
  var lastBid = null; // { val, at, confirmed }
  var fast = { status: null, winnerId: null, at: 0 };
  var fastTimer = null;

  function np() { return window.novoPresencial; }
  function jq() { return window.jQuery || window.$; }

  function fmt(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "--";
  }

  function fastFresh() { return turbo && fast.at && (Date.now() - fast.at) < 1500; }

  function currentStatus(o) {
    if (fastFresh() && fast.status != null) return String(fast.status);
    return String(o.statusatual);
  }

  function currentWinnerId(o) {
    if (fastFresh()) return fast.winnerId;
    return o.lancevencedor ? parseInt(o.lancevencedor.IDCLIENTE, 10) : null;
  }

  function isWinning(o) {
    if (o.sessaocli === "" || o.sessaocli == null) return false;
    var w = currentWinnerId(o);
    return w != null && w === parseInt(o.sessaocli, 10);
  }

  function log(msg) {
    var box = document.getElementById("mlsniper-log");
    if (!box) return;
    var line = document.createElement("div");
    line.textContent = "[" + new Date().toLocaleTimeString("pt-BR") + "] " + msg;
    box.prepend(line);
    while (box.childNodes.length > 80) box.removeChild(box.lastChild);
  }

  // ---- Polling rápido próprio (Turbo) ------------------------------------
  function fastPollOnce() {
    var o = np();
    var $ = jq();
    if (!o || !$) return;
    var url;
    try { url = o.defineLeRegistro(o.site); } catch (e) { return; }
    $.ajax({
      url: url, type: "GET",
      data: { i: o.idleilao, j: o.idsite, p: o.pecaatual },
      crossDomain: true, dataType: "html",
    }).done(function (msg) {
      try {
        if (typeof msg !== "string" || msg === "np" || msg === "invalido") return;
        var arr = msg.split("*|*");
        var info = JSON.parse(arr[1]).INFOLEILAO;
        var lances = JSON.parse(arr[0]).LANCES;
        fast.status = info.STATUS;
        fast.winnerId = (lances && lances.length) ? parseInt(lances[0].IDCLIENTE, 10) : null;
        fast.at = Date.now();
      } catch (e) { /* resposta inesperada: ignora este ciclo */ }
    });
  }

  function setTurbo(on) {
    turbo = on;
    if (on && !fastTimer) {
      fastTimer = setInterval(fastPollOnce, 250);
      log("Turbo ligado: detecção rápida (~250ms).");
    } else if (!on && fastTimer) {
      clearInterval(fastTimer);
      fastTimer = null;
      fast.at = 0;
      log("Turbo desligado: usando o estado da página (~1s).");
    }
  }

  // ---- UI ----------------------------------------------------------------
  function buildPanel() {
    if (document.getElementById("mlsniper")) return;

    var css = document.createElement("style");
    css.textContent = [
      "#mlsniper{position:fixed;z-index:99999;left:12px;bottom:12px;width:310px;",
      "font:12px/1.4 system-ui,Arial,sans-serif;color:#111;background:#fff;border:1px solid #cfcfcf;",
      "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);overflow:hidden}",
      "#mlsniper .hd{background:#111;color:#fff;padding:8px 10px;font-weight:600;display:flex;justify-content:space-between;align-items:center}",
      "#mlsniper .bd{padding:10px}",
      "#mlsniper .row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}",
      "#mlsniper .k{color:#666}",
      "#mlsniper .v{font-weight:600;text-align:right}",
      "#mlsniper input[type=number]{width:100%;padding:6px;border:1px solid #cfcfcf;border-radius:6px;font:inherit;margin-top:2px}",
      "#mlsniper label{display:block;margin-top:8px;color:#444;font-weight:600}",
      "#mlsniper .chk{display:flex;align-items:center;gap:6px;margin-top:8px;font-weight:600;color:#444}",
      "#mlsniper .chk input{width:auto;margin:0}",
      "#mlsniper .btn{margin-top:10px;width:100%;padding:10px;border:0;border-radius:8px;font-weight:700;cursor:pointer}",
      "#mlsniper .btn.off{background:#127a2e;color:#fff}",
      "#mlsniper .btn.on{background:#b3261e;color:#fff}",
      "#mlsniper .btn:disabled{background:#bbb;cursor:not-allowed}",
      "#mlsniper .warn{margin-top:8px;color:#8a5300;font-size:11px}",
      "#mlsniper #mlsniper-log{margin-top:8px;max-height:120px;overflow:auto;background:#f6f6f6;border:1px solid #eee;border-radius:6px;padding:6px;font-size:11px;color:#333}",
      "#mlsniper .min{cursor:pointer;opacity:.85}",
      "#mlsniper.mini .bd{display:none}",
      "#mlsniper .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:#bbb;vertical-align:middle}",
      "#mlsniper .dot.g{background:#19a34a}",
    ].join("");
    document.head.appendChild(css);

    var el = document.createElement("div");
    el.id = "mlsniper";
    el.innerHTML =
      '<div class="hd"><span><span class="dot" id="mlsniper-dot"></span>Lance no FECHANDO (4)</span>' +
      '<span class="min" id="mlsniper-min" title="Recolher/expandir">—</span></div>' +
      '<div class="bd">' +
      '<div class="row"><span class="k">Login</span><span class="v" id="mlsniper-login">verificando…</span></div>' +
      '<div class="row"><span class="k">Lote</span><span class="v" id="mlsniper-lote">--</span></div>' +
      '<div class="row"><span class="k">Status</span><span class="v" id="mlsniper-status">--</span></div>' +
      '<div class="row"><span class="k">Valor atual</span><span class="v" id="mlsniper-atual">--</span></div>' +
      '<div class="row"><span class="k">Próximo lance</span><span class="v" id="mlsniper-prox">--</span></div>' +
      '<div class="row"><span class="k">Situação</span><span class="v" id="mlsniper-sit">--</span></div>' +
      '<label>Teto de segurança (R$ — opcional)</label>' +
      '<input id="mlsniper-max" type="number" min="0" step="1" placeholder="deixe vazio p/ sem teto" inputmode="numeric">' +
      '<div class="chk"><input type="checkbox" id="mlsniper-turbo" checked><label for="mlsniper-turbo" style="margin:0">Turbo — detecção rápida (~250ms)</label></div>' +
      '<button class="btn off" id="mlsniper-arm">ARMAR (lance único no 4)</button>' +
      '<div class="warn">Dispara UM lance no FECHANDO e desarma. Usa a sua conta logada e a função de lance do próprio site. Pode violar os termos do leilão — use por sua conta e risco e teste num lote barato.</div>' +
      '<div id="mlsniper-log"></div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector("#mlsniper-max").addEventListener("input", function (e) {
      tetoOpcional = Number(e.target.value) || 0;
    });
    el.querySelector("#mlsniper-turbo").addEventListener("change", function (e) {
      setTurbo(!!e.target.checked);
    });
    el.querySelector("#mlsniper-arm").addEventListener("click", toggleArm);
    el.querySelector("#mlsniper-min").addEventListener("click", function () {
      el.classList.toggle("mini");
    });

    setTurbo(true); // Turbo ligado por padrão (checkbox já vem marcado)
    renderArm();
    log("Pronto. (Opcional: teto de segurança.) Clique ARMAR no lote que você quer; ele dispara UM lance quando entrar em FECHANDO.");
  }

  function toggleArm() {
    var o = np();
    if (!o) return;
    if (armed) {
      armed = false;
      log("Desarmado manualmente.");
      renderArm();
      return;
    }
    if (o.sessaocli === "" || o.sessaocli == null) {
      log("Você precisa estar LOGADO no site para armar.");
      return;
    }
    armed = true;
    armedPeca = String(o.pecaatual);
    lastBid = null;
    log("ARMADO no lote " + (o.loteatual || "?") + " (peça " + armedPeca + ")" +
      (tetoOpcional > 0 ? ", teto R$ " + fmt(tetoOpcional) : ", sem teto") +
      (turbo ? " + Turbo" : "") + ". Aguardando o FECHANDO (4)…");
    renderArm();
  }

  function renderArm() {
    var btn = document.getElementById("mlsniper-arm");
    var dot = document.getElementById("mlsniper-dot");
    if (!btn) return;
    btn.textContent = armed ? "DESARMAR" : "ARMAR (lance único no 4)";
    btn.className = "btn " + (armed ? "on" : "off");
    if (dot) dot.className = "dot" + (armed ? " g" : "");
  }

  function updatePanel(o) {
    var set = function (id, txt) { var n = document.getElementById(id); if (n) n.textContent = txt; };
    var logged = o.sessaocli !== "" && o.sessaocli != null;
    var st = currentStatus(o);
    set("mlsniper-login", logged ? "logado" : "DESLOGADO");
    set("mlsniper-lote", String(o.loteatual || "--"));
    set("mlsniper-status", (STATUS_LABEL[st] || st || "--") + (fastFresh() ? " ⚡" : ""));
    set("mlsniper-atual", "R$ " + fmt(o.lancevencedor && o.lancevencedor.VALOR));
    set("mlsniper-prox", "R$ " + fmt(o.valorpecaatual));
    set("mlsniper-sit", isWinning(o) ? "você está vencendo" : (armed ? "armado, aguardando o 4" : "parado"));
  }

  // ---- Loop principal ----------------------------------------------------
  function tick() {
    var o = np();
    if (!o) return;
    updatePanel(o);

    // Confirmação pós-lance: descobre se o lance no 4 foi aceito.
    if (lastBid && !lastBid.confirmed) {
      if (isWinning(o)) {
        lastBid.confirmed = true;
        log("✓ Lance CONFIRMADO: você está vencendo (R$ " + fmt(lastBid.val) + "). O lance no 4 funcionou.");
      } else if (Date.now() - lastBid.at > 2500) {
        log("✗ Lance NÃO confirmado (o servidor pode recusar no status 4, ou você foi coberto).");
        lastBid = null;
      }
    }

    if (!armed) return;

    // Segurança: mira um lote específico; se trocou, desarma.
    if (armedPeca !== null && String(o.pecaatual) !== String(armedPeca)) {
      armed = false;
      log("Novo lote detectado — desarmado por segurança.");
      renderArm();
      return;
    }
    if (o.sessaocli === "" || o.sessaocli == null) return;

    if (isWinning(o)) {
      armed = false;
      log("Você já está vencendo este lote — nada a fazer. Desarmado.");
      renderArm();
      return;
    }

    // Só dispara no FECHANDO (4).
    if (currentStatus(o) !== TRIGGER) return;

    var val = Number(o.valorpecaatual);
    if (!Number.isFinite(val) || val <= 0) return;
    if (tetoOpcional > 0 && val > tetoOpcional) {
      armed = false;
      log("Lance no 4 seria R$ " + fmt(val) + ", acima do teto R$ " + fmt(tetoOpcional) + ". Não disparei. Desarmado.");
      renderArm();
      return;
    }

    // Dispara UM lance e desarma (lance único certeiro).
    try {
      o.Fazerlance();
      lastBid = { val: val, at: Date.now(), confirmed: false };
      log("LANCE ÚNICO enviado no FECHANDO: R$ " + fmt(val) + ". Verificando confirmação…");
    } catch (e) {
      log("Falha ao enviar lance: " + (e && e.message ? e.message : e));
    }
    armed = false;
    renderArm();
  }

  // ---- Boot --------------------------------------------------------------
  function waitForSite(attempt) {
    if (np() && typeof np().Fazerlance === "function") {
      buildPanel();
      setInterval(tick, 200);
      return;
    }
    if ((attempt || 0) > 100) return; // ~20s
    setTimeout(function () { waitForSite((attempt || 0) + 1); }, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { waitForSite(0); });
  } else {
    waitForSite(0);
  }
})();
