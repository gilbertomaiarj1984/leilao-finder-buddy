// ==UserScript==
// @name         Miss Leilões — Assistente de lance no fechamento
// @namespace    garimpo-de-vinil
// @version      1.0.0
// @description  Dá o lance automaticamente no último instante ("VOU BATER"/"DOU-LHE"), até um teto que você define, usando a SUA própria conta já logada no site. Reusa a função de lance do próprio site. Use por sua conta e risco (ver termos/edital do leilão).
// @match        https://www.missleiloes.com.br/presencial/presencial.asp*
// @match        https://missleiloes.com.br/presencial/presencial.asp*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * COMO FUNCIONA
 * -------------
 * A página do pregão mantém um objeto global `novoPresencial` que:
 *   - faz polling (~1s) do estado do lote e guarda em `novoPresencial.statusatual`,
 *     `novoPresencial.valorpecaatual` (o PRÓXIMO lance já calculado) e
 *     `novoPresencial.lancevencedor` (quem está ganhando);
 *   - envia o lance com `novoPresencial.Fazerlance()` (POST lote_fazerlance.asp).
 *
 * Os STATUS do fechamento são: P (em pregão) -> X (prestes a fechar) ->
 * 1/2/3 (dou-lhe uma/duas / "VOU BATER") -> 4 (FECHANDO, botão desabilitado) ->
 * F (fechado). O último instante que aceita lance é o "3" (VOU BATER).
 *
 * Este script observa esse estado e, quando você está ARMADO e NÃO está vencendo,
 * dispara UM lance (um incremento) no status escolhido, desde que o próximo valor
 * não passe do seu teto. Se te cobrirem, repete — como um lance automático que só
 * se revela no último momento. Nunca passa do teto; para ao vencer.
 *
 * IMPORTANTE: automatizar lances pode violar os termos/edital da plataforma. É a sua
 * conta e o seu dinheiro; a decisão e o risco são seus. Teste primeiro num lote barato.
 */

(function () {
  "use strict";

  var STATUS_LABEL = {
    P: "Em pregão", X: "Prestes a fechar", "1": "Dou-lhe uma", "2": "Dou-lhe duas",
    "3": "VOU BATER", "4": "FECHANDO", F: "Fechado/vendido", S: "Passa o lote",
    E: "Em exame", T: "Chamada telefônica", R: "Recarregar", "": "—",
  };

  // Conjuntos de status em que o disparo é permitido, por modo de agressividade.
  var MODES = {
    conservador: { label: "Conservador — só no \"VOU BATER\" (3)", set: ["3"] },
    agressivo: { label: "Agressivo — nos \"DOU-LHE\" (1, 2 e 3)", set: ["1", "2", "3"] },
    maximo: { label: "Máximo — inclui FECHANDO (X,1,2,3,4) — experimental", set: ["X", "1", "2", "3", "4"] },
  };

  var armed = false;
  var maxBid = 0;
  var mode = "conservador";
  var armedPeca = null;
  var cooldownUntil = 0;

  function np() { return window.novoPresencial; }

  function fmt(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "--";
  }

  function isWinning(o) {
    var w = o.lancevencedor && o.lancevencedor.IDCLIENTE;
    return o.sessaocli !== "" && o.sessaocli != null && parseInt(w, 10) === parseInt(o.sessaocli, 10);
  }

  function log(msg) {
    var box = document.getElementById("mlsniper-log");
    if (!box) return;
    var line = document.createElement("div");
    line.textContent = "[" + new Date().toLocaleTimeString("pt-BR") + "] " + msg;
    box.prepend(line);
    while (box.childNodes.length > 60) box.removeChild(box.lastChild);
  }

  // ---- UI ----------------------------------------------------------------
  function buildPanel() {
    if (document.getElementById("mlsniper")) return;

    var css = document.createElement("style");
    css.textContent = [
      "#mlsniper{position:fixed;z-index:99999;left:12px;bottom:12px;width:300px;",
      "font:12px/1.4 system-ui,Arial,sans-serif;color:#111;background:#fff;border:1px solid #cfcfcf;",
      "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);overflow:hidden}",
      "#mlsniper .hd{background:#111;color:#fff;padding:8px 10px;font-weight:600;display:flex;justify-content:space-between;align-items:center}",
      "#mlsniper .bd{padding:10px}",
      "#mlsniper .row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}",
      "#mlsniper .k{color:#666}",
      "#mlsniper .v{font-weight:600;text-align:right}",
      "#mlsniper input,#mlsniper select{width:100%;padding:6px;border:1px solid #cfcfcf;border-radius:6px;font:inherit;margin-top:2px}",
      "#mlsniper label{display:block;margin-top:8px;color:#444;font-weight:600}",
      "#mlsniper .btn{margin-top:10px;width:100%;padding:9px;border:0;border-radius:8px;font-weight:700;cursor:pointer}",
      "#mlsniper .btn.off{background:#127a2e;color:#fff}",
      "#mlsniper .btn.on{background:#b3261e;color:#fff}",
      "#mlsniper .btn:disabled{background:#bbb;cursor:not-allowed}",
      "#mlsniper .warn{margin-top:8px;color:#8a5300;font-size:11px}",
      "#mlsniper #mlsniper-log{margin-top:8px;max-height:110px;overflow:auto;background:#f6f6f6;border:1px solid #eee;border-radius:6px;padding:6px;font-size:11px;color:#333}",
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

    el.querySelector("#mlsniper-arm").addEventListener("click", toggleArm);
    el.querySelector("#mlsniper-min").addEventListener("click", function () {
      el.classList.toggle("mini");
    });

    renderArm();
    log("Pronto. Defina o teto e clique ARMAR quando quiser disputar o lote atual.");
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
    log("ARMADO no lote " + (o.loteatual || "?") + " (peça " + armedPeca + "), teto R$ " + fmt(maxBid) + ".");
    renderArm();
  }

  function renderArm() {
    var btn = document.getElementById("mlsniper-arm");
    var dot = document.getElementById("mlsniper-dot");
    if (!btn) return;
    if (armed) {
      btn.textContent = "DESARMAR";
      btn.className = "btn on";
    } else {
      btn.textContent = "ARMAR";
      btn.className = "btn off";
    }
    btn.disabled = !armed && !(maxBid > 0);
    if (dot) dot.className = "dot" + (armed ? " g" : "");
  }

  function updatePanel(o) {
    var set = function (id, txt) { var n = document.getElementById(id); if (n) n.textContent = txt; };
    var logged = o.sessaocli !== "" && o.sessaocli != null;
    set("mlsniper-login", logged ? "logado" : "DESLOGADO");
    set("mlsniper-lote", String(o.loteatual || "--"));
    set("mlsniper-status", (STATUS_LABEL[o.statusatual] || o.statusatual || "--"));
    set("mlsniper-atual", "R$ " + fmt(o.lancevencedor && o.lancevencedor.VALOR));
    set("mlsniper-prox", "R$ " + fmt(o.valorpecaatual));
    set("mlsniper-sit", isWinning(o) ? "você está vencendo" : (armed ? "armado, aguardando" : "parado"));
  }

  // ---- Loop --------------------------------------------------------------
  function tick() {
    var o = np();
    if (!o) return;
    updatePanel(o);
    if (!armed) return;

    // Segurança: se o lote/peça mudou, desarma (você mira um lote específico).
    if (armedPeca !== null && String(o.pecaatual) !== String(armedPeca)) {
      armed = false;
      log("Novo lote detectado — desarmado por segurança.");
      renderArm();
      return;
    }
    if (o.sessaocli === "" || o.sessaocli == null) return; // deslogou
    if (isWinning(o)) return; // já estou vencendo: não cobre a si mesmo

    var val = Number(o.valorpecaatual);
    if (!Number.isFinite(val) || val <= 0) return;
    if (val > maxBid) {
      armed = false;
      log("Próximo lance R$ " + fmt(val) + " passaria do teto R$ " + fmt(maxBid) + ". Desarmado.");
      renderArm();
      return;
    }

    if (MODES[mode].set.indexOf(String(o.statusatual)) === -1) return; // status ainda não é gatilho

    var now = Date.now();
    if (now < cooldownUntil) return; // espera o estado atualizar antes de novo lance

    try {
      o.Fazerlance();
      cooldownUntil = now + 1500;
      log("LANCE enviado: R$ " + fmt(val) + " (status " + (STATUS_LABEL[o.statusatual] || o.statusatual) + ").");
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
