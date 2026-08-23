// ==UserScript==
// @name         Leilão presencial — Assistente de lance no fechamento
// @namespace    garimpo-de-vinil
// @version      2.0.0
// @description  Dá o lance automaticamente no último instante ("VOU BATER"/"FECHANDO"), ou cobre sempre até um teto, usando a SUA conta já logada. Reusa a função de lance do próprio site. Funciona em qualquer casa que use a plataforma "presencial". Use por sua conta e risco (ver termos/edital do leilão).
// @match        *://*/presencial/presencial.asp*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// COMO FUNCIONA
// ------------
// A página do pregão mantém um objeto global `novoPresencial` que:
//   - faz polling (~1s) do estado e guarda `statusatual`, `valorpecaatual`
//     (o PRÓXIMO lance já calculado) e `lancevencedor` (quem está ganhando);
//   - envia o lance com `Fazerlance()` (POST lote_fazerlance.asp), usando o
//     cookie da sua sessão. Ele só bloqueia se statusatual == 'F' ou se você
//     já é o vencedor.
//
// STATUS do fechamento: P (pregão) -> X (prestes a fechar) -> 1/2/3 (dou-lhe
// uma/duas / "VOU BATER") -> 4 (FECHANDO) -> F (fechado). O site desabilita o
// BOTÃO em 4/S/F, mas Fazerlance() em si só recusa 'F' — por isso dá para
// TESTAR o lance no 4 chamando a função direto.
//
// TURBO: opcionalmente o script faz o SEU próprio polling rápido (~250ms) no
// mesmo endpoint do site (defineLeRegistro) para detectar a virada de status
// antes do loop de 1s da página — reduz a latência de reação, que é o fator #1.
//
// ESTRATÉGIA: no soft-close, quem ganha é quem tem o maior teto. Lance no último
// instante serve para PAGAR MENOS, não para ganhar mais. Para MÁXIMA chance de
// ganhar, use o modo "Garantir" (cobre sempre até o teto).
//
// IMPORTANTE: automatizar lance pode violar os termos/edital da plataforma. É a
// sua conta e o seu dinheiro; a decisão e o risco são seus. Teste num lote barato.

(function () {
  "use strict";

  var STATUS_LABEL = {
    P: "Em pregão", X: "Prestes a fechar", "1": "Dou-lhe uma", "2": "Dou-lhe duas",
    "3": "VOU BATER", "4": "FECHANDO", F: "Fechado/vendido", S: "Passa o lote",
    E: "Em exame", T: "Chamada telefônica", R: "Recarregar", "": "—",
  };

  var MODES = {
    conservador: { label: "Conservador — só \"VOU BATER\" (3)", set: ["3"] },
    agressivo: { label: "Agressivo — \"DOU-LHE\" (1, 2 e 3)", set: ["1", "2", "3"] },
    fechando: { label: "Testar FECHANDO — só o (4)", set: ["4"] },
    maximo: { label: "Máximo — X, 1, 2, 3 e 4", set: ["X", "1", "2", "3", "4"] },
    garantir: { label: "Garantir — cobrir sempre até o teto", set: ["P", "X", "1", "2", "3", "4"] },
  };

  var armed = false;
  var maxBid = 0;
  var mode = "conservador";
  var turbo = false;
  var armedPeca = null;
  var cooldownUntil = 0;
  var lastBid = null; // { val, at, confirmed } — para confirmar se o lance foi aceito
  var fast = { status: null, winnerId: null, peca: null, at: 0 };
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
        if (msg === "np" || msg === "invalido" || typeof msg !== "string") return;
        var arr = msg.split("*|*");
        var info = JSON.parse(arr[1]).INFOLEILAO;
        var lances = JSON.parse(arr[0]).LANCES;
        fast.status = info.STATUS;
        fast.peca = info.ID_PECA;
        fast.winnerId = (lances && lances.length) ? parseInt(lances[0].IDCLIENTE, 10) : null;
        fast.at = Date.now();
      } catch (e) { /* resposta inesperada: ignora este ciclo */ }
    });
  }

  function setTurbo(on) {
    turbo = on;
    if (on && !fastTimer) {
      fastTimer = setInterval(fastPollOnce, 250);
      log("Turbo ligado: detecção rápida (~250ms) via polling próprio.");
    } else if (!on && fastTimer) {
      clearInterval(fastTimer);
      fastTimer = null;
      fast.at = 0;
      log("Turbo desligado: usando o estado da própria página (~1s).");
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
      "#mlsniper input[type=number],#mlsniper select{width:100%;padding:6px;border:1px solid #cfcfcf;border-radius:6px;font:inherit;margin-top:2px}",
      "#mlsniper label{display:block;margin-top:8px;color:#444;font-weight:600}",
      "#mlsniper .chk{display:flex;align-items:center;gap:6px;margin-top:8px;font-weight:600;color:#444}",
      "#mlsniper .chk input{width:auto;margin:0}",
      "#mlsniper .btn{margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;font-weight:700;cursor:pointer}",
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
      '<div class="hd"><span><span class="dot" id="mlsniper-dot"></span>Lance no fechamento</span>' +
      '<span class="min" id="mlsniper-min" title="Recolher/expandir">—</span></div>' +
      '<div class="bd">' +
      '<div class="row"><span class="k">Login</span><span class="v" id="mlsniper-login">verificando…</span></div>' +
      '<div class="row"><span class="k">Lote</span><span class="v" id="mlsniper-lote">--</span></div>' +
      '<div class="row"><span class="k">Status</span><span class="v" id="mlsniper-status">--</span></div>' +
      '<div class="row"><span class="k">Valor atual</span><span class="v" id="mlsniper-atual">--</span></div>' +
      '<div class="row"><span class="k">Próximo lance</span><span class="v" id="mlsniper-prox">--</span></div>' +
      '<div class="row"><span class="k">Situação</span><span class="v" id="mlsniper-sit">--</span></div>' +
      '<label>Teto do meu lance (R$)</label>' +
      '<input id="mlsniper-max" type="number" min="0" step="1" placeholder="ex.: 150" inputmode="numeric">' +
      '<label>Quando disparar</label>' +
      '<select id="mlsniper-mode"></select>' +
      '<div class="chk"><input type="checkbox" id="mlsniper-turbo"><label for="mlsniper-turbo" style="margin:0">Turbo — detecção rápida (~250ms)</label></div>' +
      '<button class="btn off" id="mlsniper-arm">ARMAR</button>' +
      '<div class="warn">Usa a sua conta logada e a função de lance do próprio site. Pode violar os termos do leilão — use por sua conta e risco e teste num lote barato.</div>' +
      '<div id="mlsniper-log"></div>' +
      '</div>';
    document.body.appendChild(el);

    var sel = el.querySelector("#mlsniper-mode");
    Object.keys(MODES).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = MODES[key].label;
      sel.appendChild(opt);
    });
    sel.value = mode;
    sel.addEventListener("change", function () {
      mode = sel.value;
      log("Modo: " + MODES[mode].label);
    });

    el.querySelector("#mlsniper-max").addEventListener("input", function (e) {
      maxBid = Number(e.target.value) || 0;
      renderArm();
    });
    el.querySelector("#mlsniper-turbo").addEventListener("change", function (e) {
      setTurbo(!!e.target.checked);
    });
    el.querySelector("#mlsniper-arm").addEventListener("click", toggleArm);
    el.querySelector("#mlsniper-min").addEventListener("click", function () {
      el.classList.toggle("mini");
    });

    renderArm();
    log("Pronto. Defina o teto, escolha o modo e clique ARMAR para disputar o lote atual.");
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
    if (!(maxBid > 0)) {
      log("Defina um teto de lance maior que zero antes de armar.");
      return;
    }
    var prox = Number(o.valorpecaatual);
    if (Number.isFinite(prox) && prox > maxBid) {
      log("O próximo lance (R$ " + fmt(prox) + ") já passa do teto (R$ " + fmt(maxBid) + ").");
      return;
    }
    armed = true;
    armedPeca = String(o.pecaatual);
    lastBid = null;
    log("ARMADO no lote " + (o.loteatual || "?") + " (peça " + armedPeca + "), teto R$ " + fmt(maxBid) +
      ", modo \"" + MODES[mode].label + "\"" + (turbo ? " + Turbo" : "") + ".");
    renderArm();
  }

  function renderArm() {
    var btn = document.getElementById("mlsniper-arm");
    var dot = document.getElementById("mlsniper-dot");
    if (!btn) return;
    btn.textContent = armed ? "DESARMAR" : "ARMAR";
    btn.className = "btn " + (armed ? "on" : "off");
    btn.disabled = !armed && !(maxBid > 0);
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
    set("mlsniper-sit", isWinning(o) ? "você está vencendo" : (armed ? "armado, aguardando" : "parado"));
  }

  // ---- Loop principal ----------------------------------------------------
  function tick() {
    var o = np();
    if (!o) return;
    updatePanel(o);

    // Confirmação pós-lance: descobre se o lance (inclusive no "4") foi aceito.
    if (lastBid && !lastBid.confirmed) {
      if (isWinning(o)) {
        lastBid.confirmed = true;
        log("✓ Lance confirmado: você está vencendo (R$ " + fmt(lastBid.val) + ").");
      } else if (Date.now() - lastBid.at > 2500) {
        log("✗ Lance ainda não confirmado (pode ter sido coberto, ou o status não aceitou).");
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
    if (isWinning(o)) return;

    var val = Number(o.valorpecaatual);
    if (!Number.isFinite(val) || val <= 0) return;
    if (val > maxBid) {
      armed = false;
      log("Próximo lance R$ " + fmt(val) + " passaria do teto R$ " + fmt(maxBid) + ". Desarmado.");
      renderArm();
      return;
    }

    if (MODES[mode].set.indexOf(currentStatus(o)) === -1) return;

    var now = Date.now();
    if (now < cooldownUntil) return;

    try {
      o.Fazerlance();
      cooldownUntil = now + (turbo ? 600 : 1500);
      lastBid = { val: val, at: now, confirmed: false };
      log("LANCE enviado: R$ " + fmt(val) + " (status " + (STATUS_LABEL[currentStatus(o)] || currentStatus(o)) + ").");
    } catch (e) {
      log("Falha ao enviar lance: " + (e && e.message ? e.message : e));
    }
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
