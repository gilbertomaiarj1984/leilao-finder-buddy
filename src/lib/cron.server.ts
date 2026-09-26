/**
 * Endpoint de atualização periódica (chamado por um agendador externo, ex.: GitHub
 * Actions 4x/dia). Fica FORA do fluxo de server functions do TanStack (que exige
 * sessão Supabase + CSRF): é tratado direto no `server.ts` e protegido por um token
 * compartilhado (`CRON_TOKEN`).
 *
 * Trabalha em BLOCOS (como o botão "Atualizar tudo"): o agendador chama
 *   /api/cron?step=chunk&fromPage=<n|null>&size=15   → varre um bloco de páginas
 *   /api/cron?step=enrich&max=6                       → preenche nº de lote (catálogo)
 * em laço até terminar. A varredura geral e o catálogo são PÚBLICOS (sem login).
 * Vigias/lances continuam sendo lidos ao vivo quando o usuário abre o app.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Teto de lotes processados por rodada quando a IA roda de forma SÍNCRONA (Gemini, que não
 * tem Batches aqui, ou failover do Claude). Mantém a chamada dentro do tempo do servidor; o
 * laço do cron chama de novo até esgotar (os já processados saem pela chave de cache).
 */
const GEMINI_SYNC_CAP = 25;

/**
 * Compara dois tokens em tempo constante (não vaza o tamanho do prefixo comum por
 * timing). Só o header `x-cron-token` é aceito — nunca a querystring, que costuma
 * ir parar em logs de acesso.
 */
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleCron(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cron") return null;

  const token = process.env["CRON_TOKEN"];
  const provided = request.headers.get("x-cron-token") ?? "";
  if (!token) return json({ error: "CRON_TOKEN não configurado no servidor" }, 503);
  if (!tokensMatch(provided, token)) return json({ error: "unauthorized" }, 401);

  const step = url.searchParams.get("step") ?? "";
  try {
    const { scrapeVinylChunk, enrichMissingLotes } = await import("./leiloesbr-scrape.server");

    if (step === "chunk") {
      const raw = url.searchParams.get("fromPage");
      const fromPage = raw == null || raw === "" || raw === "null" ? null : Number(raw);
      const size = Math.min(Math.max(Number(url.searchParams.get("size")) || 15, 1), 40);
      return json(await scrapeVinylChunk(Number.isNaN(fromPage as number) ? null : fromPage, size));
    }

    if (step === "enrich") {
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 6, 1), 20);
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      return json(await enrichMissingLotes(max, offset));
    }

    // Avaliação da IA. O PROVEDOR é o padrão em `app_state` (Claude/Gemini):
    // - Claude → **Batches API** (assíncrona, ~50% mais barata): coleta o batch anterior
    //   e/ou submete o próximo (idempotente por chamada).
    // - Gemini → **síncrono** em bloco (não há Batches aqui): avalia e grava na hora.
    // Failover: se o Claude estiver sem créditos, cai para o Gemini síncrono. Sem NENHUM
    // provedor configurado → no-op explícito (nunca quebra o cron de scraping).
    if (step === "aieval") {
      const {
        aiConfigured,
        selectLotsToEvaluate,
        submitEvalBatch,
        collectEvalBatch,
        evalLotsSync,
      } = await import("./ai-eval.server");
      if (!aiConfigured()) return json({ skipped: "nenhum provedor de IA configurado" });
      const { getPendingAiBatch, setPendingAiBatch, getAiMode, getAiProvider } =
        await import("./app-state.server");
      const { providerSupportsBatch, providerConfigured, isQuotaError } =
        await import("./ai-provider.server");
      const { getAllLotAi, upsertLotAi } = await import("./lot-ai.server");

      // Modo escolhido pelo usuário (controla o gasto de créditos da rodada automática).
      // "off" → não coleta nem submete; a análise sob demanda (botões) continua funcionando.
      const mode = await getAiMode();
      if (mode === "off") return json({ skipped: "IA desligada", mode });

      // 1) Há batch (Claude) em andamento? Tenta coletar — independe do provedor atual.
      const pending = await getPendingAiBatch();
      if (pending) {
        const { done, rows } = await collectEvalBatch(pending.batchId, pending.hashes);
        if (!done) return json({ pending: true, batchId: pending.batchId });
        const collected = await upsertLotAi(rows);
        await setPendingAiBatch(null);
        return json({ collected, batchId: pending.batchId });
      }

      // Provedor efetivo: o padrão, ou o primeiro configurado se o padrão não tiver chave.
      const preferred = await getAiProvider();
      const provider = providerConfigured(preferred)
        ? preferred
        : providerConfigured("anthropic")
          ? "anthropic"
          : "gemini";

      // 2) Sem pendente: seleciona os lotes sem avaliação (ou com título mudado).
      const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
      const [snapshot, aiRows] = await Promise.all([scrapeVinylLots(false), getAllLotAi()]);
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 800, 1), 2000);

      // Modo "watched": só avalia lotes que o usuário VIGIA ou já deu LANCE (união). As
      // contas são lidas com a sessão de servidor (credenciais de ambiente). Best-effort:
      // se a leitura falhar, cai para conjunto vazio (nada a submeter nesta rodada).
      let candidates = snapshot.lots;
      if (mode === "watched") {
        const ids = new Set<string>();
        try {
          const { listWatchedFromSite } = await import("./leiloesbr-watch.server");
          for (const w of await listWatchedFromSite()) ids.add(w.id);
        } catch (error) {
          console.error("[cron] aieval: falha ao ler vigiados (modo watched)", error);
        }
        try {
          const { listMyBidsFromSite } = await import("./leiloesbr-bids.server");
          for (const b of await listMyBidsFromSite()) ids.add(b.id);
        } catch (error) {
          console.error("[cron] aieval: falha ao ler lances (modo watched)", error);
        }
        candidates = snapshot.lots.filter((lot) => ids.has(lot.id));
      }

      const toEval = selectLotsToEvaluate(candidates, aiRows, max);
      if (!toEval.length) return json({ done: true, submitted: 0, mode, provider });

      // 3a) Claude → Batches API. Se estiver sem créditos e houver Gemini, cai p/ o síncrono.
      if (providerSupportsBatch(provider)) {
        try {
          const { batchId, hashes, count } = await submitEvalBatch(toEval);
          await setPendingAiBatch({ batchId, submittedAt: new Date().toISOString(), hashes });
          return json({ submitted: count, batchId, mode, provider });
        } catch (error) {
          if (!isQuotaError(error) || !providerConfigured("gemini")) throw error;
          console.error("[cron] aieval: Claude sem créditos — failover síncrono p/ Gemini", error);
        }
      }

      // 3b) Gemini (ou failover do Claude): síncrono em bloco (cap por rodada p/ caber no
      // tempo do servidor; o laço do cron chama de novo até esgotar).
      const toEvalSync = toEval.slice(0, GEMINI_SYNC_CAP);
      const { rows, served, switched } = await evalLotsSync(toEvalSync, "gemini");
      const collected = await upsertLotAi(rows);
      return json({
        collected,
        mode,
        provider: served ?? "gemini",
        switched,
        sync: true,
        done: toEval.length <= GEMINI_SYNC_CAP,
      });
    }

    // Identificação SIMPLIFICADA (camada `lot_ident`): roda para TODOS os lotes, SEM gate
    // de modo. Idempotente por chamada (estado próprio `ai_ident_batch`). Provedor = padrão
    // em `app_state`: Claude via Batches, Gemini síncrono em bloco (failover por quota).
    // Sem NENHUM provedor configurado → no-op. 1ª passada só por título; escala para a capa
    // nos de baixa confiança. Alimenta exibição/busca/filtro por artista e o Discogs. Lógica
    // em `ai-ident-step.server.ts` (extraída em v0.84.0 pra ser reaproveitada também pelo
    // botão manual "Atualizar tudo", ver `leiloesbr.functions.ts`/`runAiident`).
    if (step === "aiident") {
      const { runAiIdentStep } = await import("./ai-ident-step.server");
      const max = url.searchParams.get("max") ? Number(url.searchParams.get("max")) : undefined;
      return json(await runAiIdentStep(max));
    }

    // Âncora de mercado (Discogs). Chunked como o enrich: cada chamada consulta até
    // `max` lotes ainda não casados (throttle interno respeita o rate limit). Sem
    // DISCOGS_TOKEN → no-op explícito.
    if (step === "market") {
      const { discogsConfigured, fetchMarket } = await import("./discogs.server");
      if (!discogsConfigured()) return json({ skipped: "DISCOGS_TOKEN não configurado" });
      const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
      const { getAllLotAi } = await import("./lot-ai.server");
      const { getAllLotIdent } = await import("./lot-ident.server");
      const { getAllLotMarket, upsertLotMarket, selectLotsForMarket, marketBasis } =
        await import("./lot-market.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 12, 1), 40);
      const [snapshot, aiRows, identRows, marketRows] = await Promise.all([
        scrapeVinylLots(false),
        getAllLotAi(),
        getAllLotIdent(),
        getAllLotMarket(),
      ]);
      // Álbum por lote: prefere a avaliação completa (`lot_ai`); senão a identificação
      // simplificada (`lot_ident`). Assim o Discogs casa também lotes só identificados.
      const albumMap = new Map<string, string | null>();
      for (const r of identRows) if (r.album) albumMap.set(r.id, r.album);
      for (const r of aiRows) if (r.album) albumMap.set(r.id, r.album);
      const albumRows = [...albumMap.entries()].map(([id, album]) => ({ id, album }));
      const targets = selectLotsForMarket(snapshot.lots, albumRows, marketRows, max);
      if (!targets.length) return json({ done: true, updated: 0 });

      const rows = [];
      for (const t of targets) {
        const basis = marketBasis(t.album, t.title);
        const m = await fetchMarket(t.album, t.title);
        rows.push({
          id: t.id,
          basis,
          matched: m.matched,
          release_id: m.releaseId,
          release_title: m.releaseTitle,
          year: m.year,
          num_for_sale: m.numForSale,
          lowest_price: m.lowestPrice,
          currency: m.currency,
          suggested_price: m.suggestedPrice,
          suggested_condition: m.suggestedCondition,
          have: m.have,
          want: m.want,
          price_low_br: m.priceLowBr,
          price_high_br: m.priceHighBr,
          num_for_sale_br: m.numForSaleBr,
        });
      }
      const updated = await upsertLotMarket(rows);
      // Ainda há mais? (a seleção pega os primeiros `max`; se veio cheio, provavelmente há resto)
      return json({ updated, done: targets.length < max });
    }

    // Enriquecimento de ESTADO (Disco/Capa) dos lotes PRÉ-leilão (`lot_condition`).
    // Busca o catálogo da casa (1 req/leilão) e parseia o descritivo do card (tooltip),
    // gravando o estado por lote. Chunked: repete até `done=true`. Regex é gratuito; o
    // fallback de IA (só p/ lotes indefinidos com texto, até um teto/rodada) só roda quando
    // algum provedor está configurado — sem chave configurada, custo de IA continua zero.
    if (step === "condition") {
      const { enrichConditions } = await import("./lot-condition.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 8, 1), 20);
      return json(await enrichConditions(max));
    }

    // Captura de VENDAS pós-leilão (histórico `lot_sales`, base do Vinil Analytics).
    // Varre o catálogo da casa (1 req/leilão) dos leilões JÁ CONHECIDOS que terminaram e
    // ainda não foram capturados (cursor em `app_state.sales_captured`). Chunked: repete
    // até `done=true`. Também faz o BACKFILL do que já está na base. Regex é gratuito; o
    // fallback de IA (só p/ vendas sem estado com texto, até um teto/rodada) só roda quando
    // algum provedor está configurado — sem chave configurada, custo de IA continua zero.
    if (step === "sales") {
      const { captureFinishedSales } = await import("./lot-sales.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 8, 1), 20);
      // `reset=1`: limpa o checkpoint e re-captura TUDO (ex.: após ajustar o parser). Use uma vez.
      if (url.searchParams.get("reset") === "1") {
        const { clearSalesCaptured } = await import("./app-state.server");
        await clearSalesCaptured();
      }
      return json(await captureFinishedSales(max));
    }

    // Reidentificação por IA de TODO o histórico de vendas (`lot_sales`): ajusta artista/álbum
    // (título+descrição → "Artista - Álbum") e PADRONIZA a grafia dos nomes (evita registros
    // duplicados por diferenças mínimas). Provedor = padrão em `app_state` (Gemini quando
    // selecionado). Chunked: repete até `done=true`. Sem provedor de IA, só a padronização roda.
    if (step === "reident") {
      const { reidentifyAllSales } = await import("./lot-sales.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 25, 1), 50);
      return json(await reidentifyAllSales(max));
    }

    // ÚNICA VEZ (não faz parte do laço do cron): calcula `bundle` para as vendas já gravadas
    // ANTES dessa coluna existir (backfill). Lê `orig_text` (custo de egress ÚNICO, não repetido)
    // e grava só as que mudam. Depois disso, `getVinylSales` nunca mais precisa de `orig_text`.
    if (step === "backfillbundle") {
      const { backfillBundleFlag } = await import("./lot-sales.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 1000, 1), 5000);
      return json(await backfillBundleFlag(max));
    }

    // Backfill de thumbnail em `lot_sales` (histórico + o que passou do teto por rodada da
    // captura em si). Chunked como `compressimages`: cada chamada processa até `max` vendas
    // ainda sem `image`; repete até `done=true`. Duas fontes: `lots.image` (barata, só enquanto
    // o lote ainda tiver linha em `lots`) e, quando essa já não existe, a página do lote
    // (`fetchLotPageImage`, 1 req por lote, throttled) — só quando NENHUMA das duas acha
    // imagem é que a venda ganha o marcador `""` (sem fonte, definitivo).
    if (step === "salesthumbs") {
      const { backfillSaleThumbnails } = await import("./lot-sales.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 15, 1), 30);
      return json(await backfillSaleThumbnails(max));
    }

    // ÚNICA VEZ (não faz parte do laço do cron): as vendas marcadas `""` ANTES de
    // `fetchLotPageImage` existir foram julgadas "sem fonte" sem checar a página do lote —
    // volta pra `NULL` pra `salesthumbs` reavaliar com a lógica completa. Rode uma vez.
    if (step === "resetnosourcethumbs") {
      const { resetNoSourceThumbnails } = await import("./lot-sales.server");
      return json(await resetNoSourceThumbnails());
    }

    // Backfill (v0.57.0): recomprime fotos da coleção enviadas antes da compressão automática
    // existir (Storage é a maior fonte de egress do plano free, não leituras de banco). Chunked
    // como `enrich`/`condition`: cada chamada processa até `max` fotos ainda não `.webp`; repete
    // até `done=true`. NÃO faz parte do laço 4x/dia do `refresh.yml` — dispare manualmente
    // (`curl -H "x-cron-token: $CRON_TOKEN" "$APP_URL/api/cron?step=compressimages&max=10"` em
    // loop) uma vez, até `done=true`. Sem estado entre chamadas: uma foto que falha (ex.: URL
    // morta) volta na próxima chamada — se `failed` não cair a zero em algumas rodadas, pare e
    // resolva a linha manualmente (`collection_items`) em vez de repetir pra sempre.
    if (step === "compressimages") {
      const { listUncompressedCollectionImages, backfillCompressCollectionImage } =
        await import("./collection.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 10, 1), 30);
      const targets = await listUncompressedCollectionImages(max);
      let originalBytes = 0;
      let compressedBytes = 0;
      let failed = 0;
      for (const row of targets) {
        try {
          const r = await backfillCompressCollectionImage(row);
          originalBytes += r.originalBytes;
          compressedBytes += r.compressedBytes;
        } catch (error) {
          failed++;
          console.error("[cron] compressimages: falhou", row.id, error);
        }
      }
      return json({
        processed: targets.length,
        failed,
        originalBytes,
        compressedBytes,
        done: targets.length < max,
      });
    }

    // Sync incremental de compras (vinil) para a tabela `purchases` (menu Compras).
    // Descobre leilões vencidos via `wonAuctionIdsFromBids` (l=4) e varre só esses
    // (`l=6&id=<idLeilao>`), upsert por `lot_id`. Barato — 1 chamada por rodada do cron
    // (sem paginação cega). Independente da varredura de compras da Coleção
    // (`collection.server.ts`) — tabelas separadas, mesma descoberta.
    if (step === "purchases") {
      const { syncPurchasesIncremental } = await import("./purchases.server");
      return json(await syncPurchasesIncremental());
    }

    // Diagnóstico da captura de vendas: sinais crus do catálogo dos leilões terminados
    // (não grava, não marca). Útil quando `sales` volta 0 — confirma se é legítimo.
    if (step === "salesdebug") {
      const { debugSales } = await import("./lot-sales.server");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 3, 1), 10);
      const num = url.searchParams.get("num")?.trim() || undefined;
      return json(await debugSales(limit, num));
    }

    // Diagnóstico: sonda os catálogos das casas dos primeiros leilões sem nº de lote.
    if (step === "catdebug") {
      const { listMissingAuctions } = await import("./leiloesbr-scrape.server");
      const UA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
      const probe = async (target: string) => {
        try {
          const resp = await fetch(target, {
            headers: { "User-Agent": UA, Accept: "text/html" },
            redirect: "follow",
          });
          const text = await resp.text();
          return {
            status: resp.status,
            len: text.length,
            prodBox: (text.match(/class="prod-box/g) ?? []).length,
            ocItem: (text.match(/class="oc-item/g) ?? []).length,
            pecaHit: text.match(/peca\.asp\?ID=(\d+)/i)?.[1] ?? null,
            loteHit: text.match(/LoteProd[\s\S]{0,120}?lote:?\s*([0-9]+)/i)?.[1] ?? null,
          };
        } catch (error) {
          return { status: "ERR", error: (error as Error)?.message ?? "fetch failed" };
        }
      };
      const auctions = await listMissingAuctions(3);
      const probes = [];
      for (const a of auctions) {
        for (const path of [`/catalogo.asp?Num=${a.idLeilao}`, `/leilao.asp?Num=${a.idLeilao}`]) {
          const target = `${a.domain}${path}`;
          probes.push({
            idLeilao: a.idLeilao,
            sampleIds: a.ids,
            url: target,
            ...(await probe(target)),
          });
        }
      }
      return json({ missingAuctions: auctions.length, probes });
    }

    // Diagnóstico: procura um leilão/casa específico em TODA a listagem geral (categoria
    // "Disco de Vinil" travada por `tp=`, sem filtro de dia nem `looksNonVinyl`) — idLeilao
    // exato, ou substring do nome da casa/URL. Responde se o item está na categoria (e em
    // que página/dia) ou se nem aparece — distingue "categorização da LeilõesBR" de "bug
    // no nosso parser/filtro". Não persiste nada.
    if (step === "findlot") {
      const { findLotDebug } = await import("./leiloesbr-scrape.server");
      const q = url.searchParams.get("q")?.trim();
      if (!q) return json({ error: "informe ?q=<idLeilao ou parte do nome da casa/URL>" }, 400);
      return json(await findLotDebug(q));
    }

    // Diagnóstico nível 2 (`findlot` não achou nada na categoria vinil): busca por
    // texto livre (`pesquisa`, filtrado no servidor) e OPCIONALMENTE sem travar a
    // categoria (`lockToVinyl=0`) — acha o mesmo idLeilao em QUALQUER categoria da
    // LeilõesBR, pra confirmar se está categorizado fora de "Disco de Vinil".
    if (step === "findlot2") {
      const { findLotSearch } = await import("./leiloesbr-scrape.server");
      const idLeilao = url.searchParams.get("idLeilao")?.trim();
      const pesquisa = url.searchParams.get("pesquisa")?.trim() ?? "";
      const lockToVinyl = url.searchParams.get("lockToVinyl") !== "0";
      if (!idLeilao) return json({ error: "informe ?idLeilao=<...>&pesquisa=<termo>" }, 400);
      return json(await findLotSearch(idLeilao, pesquisa, lockToVinyl));
    }

    // Diagnóstico nível 3: HTML bruto (truncado) do(s) card(s) que batem o idLeilao —
    // pra inspecionar onde/como a categoria de cada item aparece na listagem geral
    // (VinylLot/parseCard não capturam nenhum campo de categoria hoje).
    if (step === "findlotraw") {
      const { findLotRawCard } = await import("./leiloesbr-scrape.server");
      const idLeilao = url.searchParams.get("idLeilao")?.trim();
      const pesquisa = url.searchParams.get("pesquisa")?.trim() ?? "";
      const lockToVinyl = url.searchParams.get("lockToVinyl") !== "0";
      if (!idLeilao) return json({ error: "informe ?idLeilao=<...>&pesquisa=<termo>" }, 400);
      return json(await findLotRawCard(idLeilao, pesquisa, lockToVinyl));
    }

    // Diagnóstico nível 4: testa um `tp=` CRU qualquer (ex.: o código numérico
    // `|129|` que o catálogo da CASA usa pra "Disco de vinil") direto na busca geral
    // da LeilõesBR — vê se esse código também filtra por lá.
    if (step === "findlotcat") {
      const { findLotByCategory } = await import("./leiloesbr-scrape.server");
      const idLeilao = url.searchParams.get("idLeilao")?.trim();
      const pesquisa = url.searchParams.get("pesquisa")?.trim() ?? "";
      const tp = url.searchParams.get("tp")?.trim();
      if (!idLeilao || !tp)
        return json({ error: "informe ?idLeilao=<...>&tp=<...>&pesquisa=<termo>" }, 400);
      return json(await findLotByCategory(idLeilao, pesquisa, tp));
    }

    // Diagnóstico (Fase 1 da investigação por "galeria" — ver notas-desenvolvimento.md,
    // Pendências): tenta extrair a seção "GALERIAS" (casas + código `ga=`) da página 1 de
    // busca_andamento.asp. ?tp=none → sem filtro de categoria; ?tp=<...> → categoria custom;
    // sem `tp` → categoria vinil padrão.
    if (step === "galleries") {
      const { listGalleries } = await import("./leiloesbr-scrape.server");
      const tpParam = url.searchParams.get("tp");
      if (tpParam === "none") return json(await listGalleries(null));
      return json(await listGalleries(tpParam ?? undefined));
    }

    // Fase 2 da descoberta por galeria (ver notas-desenvolvimento.md, Pendências): varre em
    // blocos as galerias devolvidas por listGalleries, achando leilões que a categoria "Disco
    // de Vinil" da LeilõesBR não pega (gap que motivou toda a investigação). Chunked como
    // step=chunk/enrich — offset é o cursor, count quantas galerias por chamada.
    if (step === "galleryscan") {
      const { scanGalleries } = await import("./leiloesbr-scrape.server");
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const count = Math.min(Math.max(Number(url.searchParams.get("count")) || 3, 1), 10);
      const tpParam = url.searchParams.get("tp");
      const tp = tpParam === "none" ? null : (tpParam ?? undefined);
      return json(await scanGalleries(offset, count, tp));
    }

    // Diagnóstico por PÁGINA da listagem geral (v0.85.1 — casa "Miss leilões" ausente;
    // a maioria das páginas da categoria vinil não rende lote e o motivo era engolido em
    // silêncio). ?pages=1,2,40,last,last-1 (até 12); ?ga=<código> filtra uma galeria;
    // ?tp=none tira a categoria; ?cookie=1 reaproveita a sessão ASP da 1ª página;
    // ?delayMs=<n> pausa entre páginas. Devolve status/URL final/cards/dias/casas por página.
    if (step === "pagedebug") {
      const { debugListingPages } = await import("./leiloesbr-scrape.server");
      const tpParam = url.searchParams.get("tp");
      return json(
        await debugListingPages({
          pages: url.searchParams.get("pages") ?? "1,2,3,last-1,last",
          ga: url.searchParams.get("ga")?.trim() || undefined,
          tp: tpParam === "none" ? null : (tpParam ?? undefined),
          pesquisa: url.searchParams.get("pesquisa") ?? "",
          useCookie: url.searchParams.get("cookie") === "1",
          delayMs: Number(url.searchParams.get("delayMs")) || 0,
        }),
      );
    }

    // Diagnóstico (v0.85.3): lotes da janela por casa/leilão, com e sem sinal de vinil no
    // título — pra calibrar o filtro de lixo de casas generalistas. ?house=<parte do nome>
    // filtra; ?sample=<n> amostras por grupo (padrão 8). Só leitura.
    if (step === "windowaudit") {
      const { auditWindowLots } = await import("./leiloesbr-scrape.server");
      return json(
        await auditWindowLots({
          house: url.searchParams.get("house") ?? undefined,
          sample: Number(url.searchParams.get("sample")) || undefined,
        }),
      );
    }

    // Diagnóstico: chama fetchCatalogData(domain, idLeilao) direto (já usado por
    // enrich/condition/sales) — confirma que, uma vez conhecido o idLeilao, o catálogo da
    // casa já traz os itens certos (isola "descoberta" de "extração").
    if (step === "catalogdebug") {
      const { fetchCatalogData } = await import("./leiloesbr-catalog.server");
      const domain = url.searchParams.get("domain")?.trim();
      const idLeilao = url.searchParams.get("idLeilao")?.trim();
      if (!domain || !idLeilao) return json({ error: "informe ?domain=<...>&idLeilao=<...>" }, 400);
      const map = await fetchCatalogData(domain, idLeilao);
      const entries = [...map.entries()];
      return json({
        domain,
        idLeilao,
        total: entries.length,
        sample: entries.slice(0, 5).map(([id, lot]) => ({ id, ...lot })),
      });
    }

    // Fase 5 da migração para VPS (docs/economia-fase-2-vps-unico.md): poda
    // `seen_auctions` (leilões com vendas já capturadas e fora da janela de retenção).
    // Barato — 1 SELECT + 1 DELETE por rodada; roda 1x por execução do cron.
    if (step === "prune") {
      const { pruneSeenAuctions } = await import("./leiloesbr-auctions.server");
      return json(await pruneSeenAuctions());
    }

    // Limpeza retroativa (v0.69.45): apaga da janela atual os lotes que NÃO deveriam ter
    // entrado (joalheria/colecionismo geral capturados antes dos fixes de v0.69.42–44,
    // em especial pelo `galleryscan`). `lots` só recebe upsert (nunca apaga sozinho), então
    // isso não se resolve sem uma limpeza manual. `dryRun` por padrão (só lista os títulos
    // que SERIAM removidos, sem apagar nada) — `apply=1` de fato apaga.
    if (step === "cleannonvinyl") {
      const { pruneNonVinylLots } = await import("./leiloesbr-scrape.server");
      const apply = url.searchParams.get("apply") === "1";
      const { scanned, removed, removedTitles } = await pruneNonVinylLots(!apply);
      return json({ dryRun: !apply, scanned, removed, sample: removedTitles });
    }

    return json(
      {
        error:
          "step inválido (use chunk|enrich|aieval|aiident|market|condition|sales|salesthumbs|resetnosourcethumbs|reident|purchases|backfillbundle|compressimages|prune|cleannonvinyl|salesdebug|catdebug|findlot|findlot2|findlotraw|findlotcat|galleries|galleryscan|pagedebug|windowaudit|catalogdebug)",
        // Diagnóstico (v0.69.4): step=prune vinha falhando com 400 só quando chamado pelo
        // GitHub Actions (curl direto do VPS sempre respondia 200). Sem log de acesso no
        // Caddy nem log de aplicação chegando no `docker logs` (Nitro usa logger próprio,
        // não captura `console.log` cru), a única forma de provar o que o servidor recebeu
        // é ecoar de volta no corpo — remover depois que o caso for entendido.
        receivedStep: step,
        receivedSearch: url.search,
      },
      400,
    );
  } catch (error) {
    console.error("[cron] falha", error);
    // Diagnóstico (v0.69.16): step=aieval vem voltando 500 "Missing DATABASE_URL" só
    // via GitHub Actions, mesmo com a var confirmada presente no container (printenv) e
    // um teste direto no localhost do mesmo container funcionando logo antes/depois —
    // intermitente, sem explicação ainda. PID/uptime/hostname ajudam a saber se é sempre
    // o MESMO processo/container respondendo (contra a teoria de request batendo em
    // outro container por engano) — remover depois que o caso for entendido.
    return json(
      {
        error: (error as Error)?.message ?? "cron failed",
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        hostname: (await import("node:os")).hostname(),
        hasDatabaseUrl: Boolean(process.env["DATABASE_URL"]),
      },
      500,
    );
  }
}
