# Fase 2 — VPS único: plano de migração (aprovado, não iniciado)

> **Status: plano fechado, execução não iniciada.** Provedor escolhido, escopo decidido,
> estratégia de branches definida. Este documento é autossuficiente — uma sessão nova consegue
> começar a Fase 1 lendo só ele + `AGENTS.md`.
>
> Contexto, telemetria e alternativas descartadas: `docs/economia-migracao.md`.
> Correções já feitas no padrão de leitura: `docs/economia-fase-1-egress-e-cpu.md`.

## Por que migrar

Vercel Hobby + Supabase Free custam US$ 0, mas as duas cotas estouraram ou estão colando:
**egress do Supabase 9,14/5 GB (183%)** e **Fluid Active CPU da Vercel 3h09/4h (79%)**, com o
banco folgado em **49/500 MB**. As correções da Fase 1 (v0.48.4, v0.60.1–v0.60.4) entraram em
código mas **nunca foram remedidas** — o "passo 5" segue em aberto — e o usuário confirma que o
estouro persiste e que bloqueio/cobrança é questão de pouco tempo.

Quando a cota fechar, ficar onde está custa **Supabase Pro US$ 25 + Vercel Pro US$ 20 =
US$ 45/mês (~R$ 250)** para um app de **um usuário** e **49 MB de banco**.

Além do custo, quatro defeitos que dinheiro não resolve:

1. **Sem backup nenhum** (Supabase Free não faz). O `lot_sales` — arquivo permanente de vendas,
   nunca podado — existe num lugar só.
2. **Teto de 60 s por função**, que moldou todo o desenho do cron (chunking, `GEMINI_SYNC_CAP`,
   laços no shell do workflow).
3. **Instância efêmera**: os caches TTL 30 s da v0.60.2/3 são best-effort e só valem com
   instância quente; o cookie jar do leiloesbr (`Map` em memória) se perde a frio e força
   re-login no site de leilões.
4. **Cláusula de uso não comercial** do Hobby e **pausa por inatividade** do Supabase Free.

**Alvo:** uma máquina, ~R$ 38/mês, sem egress medido, sem pausa, sem teto de 60 s, **com
backup**, mantendo cron no GitHub Actions, IA e Discogs intactos.

## Arquitetura alvo

```
Caddy  ──┬──► app (Node, SERVER_PRESET=node-server)  ──► postgres:17
 TLS     │
 auto    └──► /collection/*  (volume em disco, Cache-Control 7d)
```

**Não muda:** cron no GitHub Actions (só o secret `APP_URL`), IA Anthropic/Gemini com Batches
API e failover, Discogs, e **nenhum componente de UI** — porque a RLS está ligada sem policy
nenhuma e `anon`/`authenticated` têm `REVOKE ALL`, o navegador nunca fala com o Postgres. A
migração de dados é 100% server-side.

## Estratégia de execução: ambiente paralelo, sem fork

`main` fica **intocada e sempre deployável na Vercel** enquanto o ambiente novo nasce em
paralelo; o banco migra por último.

**Branch longa no mesmo repo, não fork.** O que protege a `main` é ninguém mesclar nela — vale
igual nos dois casos. Fork duplica secrets do Actions, workflows e issues, e transforma cada
sincronização com a `main` num PR entre repositórios. Só atrito.

- Branch de integração **`vps`**, criada a partir de `origin/main`.
- Cada fase entra como **um PR para `vps`**. O CI `version-bump.yml` compara com a base, então
  continua funcionando e cada fase segue com seu bump.
- O workflow de deploy da Fase 4 dispara **na `vps`**. É isso que faz o ambiente paralelo
  existir de verdade, rodando e navegável, enquanto produção segue na Vercel.
- **Absorver a `main` a cada fase concluída** (`git merge origin/main` na `vps`). Atenção a
  `docs/notas-desenvolvimento.md`, que o `AGENTS.md` já aponta como propenso a conflito add/add.
- No fim, **um PR `vps` → `main`** depois do cutover.

### Duas regras que o modelo paralelo exige

1. **O banco do ambiente novo é descartável.** O `pg_restore` inicial é uma foto; a produção
   continua escrevendo no Supabase 2×/dia durante o desenvolvimento. Ele serve para validar
   código, nunca para acumular dado. O que vale é o dump da Fase 6.
2. **Os dois ambientes não podem rodar o cron ao mesmo tempo.** Duas máquinas varrendo o
   leiloesbr com a mesma conta dobram a carga e podem brigar pela sessão (cookie por origem, e o
   app mexe em vigias e lances). No ambiente novo o cron roda **apenas por `workflow_dispatch`
   manual** até o cutover.

## Passo 0 — Provedor: decidido

**HostGator "VPS Cloud / VPS OCI NVMe 4" — 2 vCPU · 4 GB RAM · 100 GB NVMe · Brasil (São Paulo),
latência 13 ms · R$ 451,10/ano (R$ 37,59/mês), renovação R$ 939,80/ano (R$ 78,32/mês).**

Alternativas avaliadas e preteridas: o **OCI NVMe 2** da mesma casa (1 vCPU / 2 GB, R$ 27,89/mês)
e uma máquina de **4 vCPU / 8 GB na Europa** por US$ 6,60/mês (~R$ 36) — esta última, folgada mas
com **222 ms** de latência.

| | Ano 1 | Ano 2+ | Latência | Specs |
|---|---|---|---|---|
| **HostGator SP NVMe 4 (escolhido)** | **R$ 37,59/mês** | R$ 78,32/mês | **13 ms** | 2 vCPU / 4 GB / 100 GB |
| HostGator SP NVMe 2 | R$ 27,89/mês | R$ 45/mês | 13 ms | 1 vCPU / 2 GB / 50 GB |
| VPS Europa US$ 6,60 | R$ 36/mês | R$ 36/mês | 222 ms | 4 vCPU / 8 GB / 100 GB |

**Por que a latência ganhou dos cores.** Ela pesa duas vezes neste app: no cron, que faz centenas
de requisições **sequenciais** a sites de leilão brasileiros, e na navegação, onde cada server
function é uma ida e volta. 13 ms é melhor até que a Vercel de hoje (~120 ms). Cores ociosos não
compram nada equivalente para um banco de 49 MB e um usuário. No ano 1 o preço empata com a
máquina europeia, então os 209 ms a menos saem de graça. Como efeito colateral, o **Cloudflare
deixa de ser necessário como remendo de latência** — vira opcional, só para esconder o IP do VPS.

**Por que subir do NVMe 2 para o NVMe 4 foi acerto.** Os dois apertos reais do plano de 1 vCPU /
2 GB somem por ~R$ 10/mês:

- **4 GB em vez de 2** tira o risco de OOM no `sharp`, que decodifica imagens de até 8 MB
  (`MAX_IMAGE_BYTES`, `collection.server.ts:957`) e reencoda a 1600px — o pico curto e alto que
  poderia derrubar o Postgres. A conta de memória sai de "cabe apertado" para folgada: Node SSR
  ~250 MB + Postgres ~400 MB + Caddy ~20 MB + Docker ~100 MB ≈ 800 MB, sobrando >3 GB.
- **2 vCPU em vez de 1** tira a disputa entre o parsing HTML do cron (CPU-bound) e o Postgres.

Restam duas regras, agora por higiene e não por sobrevivência:

1. **Confirmar a arquitetura antes de escrever o Dockerfile** (`uname -m`). "VPS OCI" é Oracle
   Cloud Infrastructure, que na região Brasil oferece x86 **e** ARM (Ampere). Se for `aarch64`, a
   imagem precisa ser construída para `arm64` ou o `sharp` quebra o upload de foto e o step
   `compressimages`. **Continua sendo a primeira checagem pós-contratação.**
2. **Construir a imagem no GitHub Actions, não no VPS** (→ GHCR → `docker compose pull`). Com
   2 vCPU / 4 GB um `docker build` do Vite já não trava a máquina, mas manter o build fora deixa
   o deploy rápido e reproduzível.
3. **1 GB de swap** como rede de segurança barata. Deixou de ser crítico.

**Sistema operacional: "SO Simples" com Ubuntu LTS puro** (24.04 se disponível — suporte até
2029; o 22.04 pré-selecionado também serve, mas vence antes). As outras duas opções do checkout
atrapalham:

- **"SO com Painel"** (cPanel/Plesk/CyberPanel) é feito para hospedagem compartilhada e PHP. O
  painel assume as portas 80/443 e o firewall — justamente o que o Caddy precisa — e o cPanel
  sozinho consome mais de 1 GB de RAM.
- **"Aplicação"** entrega um stack pré-montado, com versões e opiniões de terceiros. Como todo o
  ambiente vive num `docker-compose.yml` versionado no repo, partir de um SO limpo é mais
  previsível. Instalar Docker + Compose no Ubuntu são dois comandos.

Do catálogo de Aplicações da HostGator, três merecem nota:

- **"Docker"** — aceitável como atalho, já que é exatamente o que instalaríamos. Economiza dois
  comandos em troca de herdar uma versão de Docker e uma base de Ubuntu não escolhidas. Se usar,
  conferir `lsb_release -a` e `docker --version` antes de seguir; base antiga → voltar ao SO
  Simples.
- **"Supabase" — NÃO usar, apesar de tentador.** É a pergunta óbvia ("instalo o Supabase
  self-hosted e não mudo nenhuma linha de código"), e a resposta é a mesma que já descartou essa
  opção, agora com número: o stack são 12+ containers (Postgres, GoTrue, PostgREST, Realtime,
  Storage, Kong, Studio, imgproxy, meta, analytics) consumindo **~3–4 GB sozinho** — não sobra
  máquina para o app nos 4 GB contratados. Podar serviços até caber significa manter um compose
  customizado, que é justo o trabalho que a instalação prometia evitar, e sem o ganho de
  simplicidade do `postgres.js` falando direto com o Postgres na mesma rede Docker. Lembrando que
  o app **não usa** Realtime nem Edge Functions, e usa RLS apenas como "negar tudo" — quase todo
  esse stack seria peso morto.
- **"Kubernetes K3S" — não.** Orquestrador para um único container de app é complexidade sem
  contrapartida.

**Backup continua obrigatório** (Fase 5, junto com a Fase 4): não há data protection gerenciada.

> ⏰ **Marcar lembrete antes da renovação — agora importa mais.** A R$ 78,32/mês você estaria
> pagando **mais que o dobro** da máquina europeia de 4 vCPU / 8 GB por metade dos recursos.
> Segue muito abaixo dos ~R$ 250 de Supabase Pro + Vercel Pro, então não é urgência; mas é o
> momento natural de reavaliar. Como todo o stack vive num `docker-compose.yml` versionado,
> trocar de máquina é restaurar um dump e apontar o DNS.

## Alívio imediato (antes de qualquer código)

1. **Cortar o cron para 1×/dia.** O `schedule` do Actions só é lido da branch padrão, então isso
   exige um commit na `main` — **única exceção** à regra de não mexer nela, e é um PR de uma
   linha (`10 3,17 * * *` → `10 3 * * *`). Alternativa sem tocar na `main`: desabilitar o
   workflow pela UI do Actions e disparar `workflow_dispatch` uma vez por dia à mão.
2. Rodar `GET /api/cron?step=compressimages` até zerar. A v0.57.0 rastreou o egress até as
   **fotos da Coleção servidas em resolução cheia**, não às leituras de banco; o backfill de
   compressão pode não ter sido concluído. Não exige mudança de código.

---

## Fase 1 — Camada de dados: shim `postgres.js`

O ponto mais arriscado do projeto, porque **não há suite de testes** e só o usuário testa contra
os sites reais. A estratégia é trocar a implementação **sem tocar em nenhum dos 15 arquivos de
lógica de negócio**.

### Surface real (medido, não estimado)

Grep sobre as cadeias a partir de `supabaseAdmin`: `from` 73, `select` 30, `eq` 24, `upsert` 20,
`maybeSingle` 11, `range` 10, `order` 8, `update` 7, `insert` 6, `delete` 6, `single` 3, `not` 3,
`gte` 3, `lte` 2, `rpc` 1, `or` 1, `limit` 1, `like` 1, `in` 1. Storage: `getPublicUrl` 4,
`upload` 2, `remove` 1.

⚠️ O grep bruto do repo conta 141 `.filter(` e 57 `.match(` — quase tudo é
`Array.prototype.filter` / `String.prototype.match`, **não** PostgREST. Não dimensionar o shim
por esse número.

### Como

1. **`src/lib/db.server.ts`** — conexão `postgres.js` singleton lazy (mesmo padrão de Proxy já
   usado em `src/integrations/supabase/client.server.ts`), lendo `DATABASE_URL`.

2. **`src/lib/db-query.server.ts`** — o shim. Um `from(tabela)` que devolve um builder
   encadeável e *thenable*, resolvendo para o mesmo `{ data, error }` que o código já trata.
   Cobre só os operadores acima. Semânticas que precisam bater exatamente:
   - `upsert(rows, { onConflict })` → `INSERT ... ON CONFLICT (cols) DO UPDATE SET ...`,
     **omitindo colunas ausentes**. Há um caso real em `lot-sales.server.ts` onde mandar `""` em
     `orig_text` apagaria o texto já gravado — o upsert omite a coluna de propósito.
   - `select(cols, { count: "exact", head: true })` → `SELECT count(*)`, sem devolver linhas.
   - `single()` / `maybeSingle()` → erro vs. `null` quando não há linha.
   - `range(a, b)` → `LIMIT b-a+1 OFFSET a` (inclusivo nos dois extremos, como o PostgREST).

3. **`rpc("get_unidentified_lot_sales", { p_limit })`** → chamada SQL direta à função, que já
   existe em `supabase/setup.sql`.

4. **Chave de reversão.** Em `src/integrations/supabase/client.server.ts`, manter o nome
   exportado `supabaseAdmin` e decidir a implementação por env: com `DATABASE_URL` presente usa o
   shim, sem ela cai no cliente Supabase. **Nenhum import muda em lugar nenhum**, e voltar atrás é
   apagar uma variável de ambiente.

5. **`.storage` continua no Supabase nesta fase** — é independente e sai na Fase 3.

### Como testar

Não expor o Postgres do VPS à internet. Túnel SSH (`ssh -L 5432:localhost:5432 vps`) e
`bun run dev` **local** com `DATABASE_URL` apontando para o túnel — assim as telas reais
(Analytics, Coleção, Wantlist, Ao vivo) são exercitadas contra o Postgres novo, com a UI
idêntica, antes de qualquer deploy.

Carga inicial: `pg_dump` do Supabase → `pg_restore` no VPS; conferir contra `supabase/setup.sql`
(re-executável, tudo `IF NOT EXISTS`).

**Arquivos:** novos `src/lib/db.server.ts`, `src/lib/db-query.server.ts`; alterado
`src/integrations/supabase/client.server.ts`. Nova dep: `postgres`.

## Fase 2 — Auth: Supabase Auth → Google OAuth direto

O app libera **exatamente um e-mail** (`src/lib/access.server.ts`, 19 linhas). Não precisa de um
serviço de auth.

O contrato a preservar é estreito e já isolado: **o middleware injeta `context.claims.email`**.
Os **60 call sites** de `assertAllowed(context.claims?.["email"])` em
`leiloesbr.functions.ts` (44), `collection.functions.ts` (13) e `leiloesbr-watch.functions.ts` (3)
**não mudam uma linha**.

- **`src/lib/auth.server.ts`** (novo) — authorization code flow + PKCE contra o Google, validação
  do e-mail, cookie de sessão HttpOnly assinado. **Reaproveitar o HMAC que já existe** em
  `src/lib/leiloesbr-live.server.ts` (cookie `lp_auth`, `timingSafeEqual` na linha 66) em vez de
  escrever criptografia nova.
- **Rotas `/api/auth/google/start`, `/api/auth/google/callback`, `/api/auth/logout`** tratadas
  direto em `src/server.ts`, ao lado de `handleCron` e `handleLiveProxy` — fora das server
  functions, como já é a convenção para endpoints sem Bearer/CSRF.
- **`src/start.ts`** — trocar `attachSupabaseAuth` por um middleware que lê o cookie e injeta
  `{ claims: { email } }`.
- **`src/routes/auth.tsx`** — `signInWithOAuth` vira link para `/api/auth/google/start`.
- **`src/routes/_authenticated/route.tsx`** — hoje `ssr: false` + `supabase.auth.getUser()` no
  cliente; passa a checar a sessão no servidor no `beforeLoad`.
- **`src/routes/__root.tsx`** — `signOut()` vira POST para `/api/auth/logout`.
- **Somem:** `src/integrations/supabase/auth-middleware.ts`, `auth-attacher.ts`, `api-fetch.ts`,
  `client.ts`.

**Fora do código:** no Google Cloud Console, adicionar a redirect URI do novo domínio. Novas env:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`.

## Fase 3 — Storage: bucket → disco servido pelo Caddy

Bucket `collection`, público, pequeno (0/1 GB usado). Sete call sites, todos em
`src/lib/collection.server.ts:1014-1082`.

- Gravar em `COLLECTION_DIR` (volume, ex. `/data/collection`); URL pública passa a ser
  `${PUBLIC_BASE_URL}/collection/<path>`.
- Caddy serve `/collection/*` do volume com `Cache-Control: public, max-age=604800`, preservando
  o comportamento do `cacheControl: 604800` de hoje.
- **Manter `compressCollectionImage` como está** — o resize ≤1600px + WEBP q82 continua certo.
- Script de mudança: baixar os objetos do bucket para o volume e reescrever as URLs gravadas em
  `collection_items`.
- Com isso, `@supabase/supabase-js` sai do `package.json`.

## Fase 4 — Host: Vercel → VPS

`vite.config.ts:9` já honra `SERVER_PRESET` / `NITRO_PRESET`, então `SERVER_PRESET=node-server`
gera o servidor Node **sem tocar em código**.

- **`Dockerfile`** multi-stage: `bun install` → `bun run build` → runtime Node com o output do
  Nitro.
- **`docker-compose.yml`**: `caddy`, `app`, `postgres:17`, volumes para dados do Postgres e para
  `collection`.
- **`Caddyfile`**: TLS automático, reverse proxy para o app, `file_server` para `/collection/*`.
- **Cloudflare free na frente — opcional.** Com o VPS em São Paulo a 13 ms, ele deixa de ser
  remendo de latência; o motivo que sobra é esconder o IP do VPS. Se usar, proxy laranja ligado e
  modo **Full (strict)**, para o Caddy continuar emitindo o certificado de origem.
- **`.github/workflows/deploy.yml`** (novo): no push em **`vps`**, build da imagem → GHCR → SSH no
  VPS → `docker compose pull && docker compose up -d`.
- **Secret `APP_URL`** → novo domínio (só no cutover; ver Fase 6). O `refresh.yml` não muda em
  mais nada.
- Ajustar o User-Agent do Discogs (`src/lib/discogs.server.ts:16`, hoje aponta para
  `leilao-finder-buddy.vercel.app`).
- Atualizar `.env.example`, `README.md`, `AGENTS.md` e `CLAUDE.md` — todos descrevem Supabase +
  Vercel hoje.

### Endurecimento da máquina (obrigatório — IP público sem rede privada)

O VPS passa a guardar `LEILOESBR_SENHA`, `SUPABASE_SERVICE_ROLE_KEY` (até a Fase 3 terminar), as
chaves de IA, o `DISCOGS_TOKEN` e o banco inteiro:

- **Postgres sem porta publicada** — nada de `ports:` no serviço `postgres`, só a rede interna do
  Docker. Acesso administrativo exclusivamente por túnel SSH.
- **UFW** fechando tudo menos 22, 80 e 443. Atenção: o Docker escreve direto no `iptables` e
  contorna o UFW se você publicar portas — a regra acima é a defesa real.
- **SSH por chave**, `PasswordAuthentication no`, root login desabilitado, `fail2ban`.
- Se optar pelo Cloudflare, restringir 80/443 aos ranges de IP dele.
- `.env` do compose com permissão `600`, fora do repositório, e **rotacionar as chaves** que hoje
  vivem no painel da Vercel ao movê-las.

### O que essa fase destrava de graça

Somem o teto de 60 s e a instância efêmera. Consequências a revisitar depois (não neste PR): os
caches TTL 30 s passam a acertar sempre; o cookie jar do leiloesbr para de se perder e some o
re-login; `GEMINI_SYNC_CAP = 25` e o chunking agressivo do `refresh.yml` deixam de ser
necessários.

## Fase 5 — Backup, monitoramento e faxina

> ⚠️ **Sai junto com a Fase 4.** O plano contratado não tem data protection e o snapshot único
> não substitui backup de banco.

- **`pg_dump` noturno** num serviço `backup` do compose → Cloudflare R2 (free 10 GB), retenção de
  14 dias. **Ganho líquido**: hoje não existe backup nenhum.
- **Tirar o snapshot do provedor** com a máquina configurada e estável.
- **Monitoramento**: ping ao healthchecks.io (free) no fim do job do `refresh.yml` — avisa se o
  cron parar, que é a falha silenciosa mais provável.
- **Faxina de órfãos + FKs.** `supabase/setup.sql` não tem nenhum `REFERENCES` nem
  `ON DELETE CASCADE`; `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` acumulam órfãos quando
  `lots` é podada por `pruneOutOfWindow`. Agora que o banco é seu: limpar e criar as FKs com
  `ON DELETE CASCADE` para `lots(id)`.
  ⚠️ **Nunca cascatear `lot_sales` → `lots`** — é o arquivo permanente de vendas.
- **Podar `seen_auctions`**, que hoje nunca é podada e só cresce.

## Fase 6 — Cutover (a migração do banco, por último)

O dump usado é **novo**, não o da Fase 1. Janela estimada: **~30 min** para 49 MB.

1. **Congelar a produção.** Desabilitar o schedule do `refresh.yml` e não usar o app durante a
   janela. Sem escrita nova, o dump é consistente.
2. **Dump final** do Supabase → restaurar por cima do Postgres do VPS (schema recriado do zero,
   não por cima do banco de teste envelhecido).
3. **Sincronizar as fotos** da Coleção que entraram depois da Fase 3 e reconferir as URLs em
   `collection_items`.
4. **Apontar o DNS** para o VPS e trocar o secret `APP_URL`.
5. **Reabilitar o cron** e rodar um `workflow_dispatch` completo, acompanhando o log.
6. **Validar** com a lista da seção Verificação, agora contra os dados reais.
7. **Não desligar nada ainda.** Supabase e Vercel ficam de pé, intocados, como rollback de um
   comando (DNS de volta) por pelo menos uma semana.
8. Mesclar `vps` → `main` e desligar os serviços antigos só depois desse período — exportando um
   último dump do Supabase para guardar antes de encerrar o projeto lá.

**Ponto de não-retorno:** o passo 8. Até lá tudo reverte apontando o DNS de volta, porque o
Supabase segue com os dados do momento do congelamento.

## Custo comparado

| Cenário | Mensal | Backup | Teto de função | Egress medido |
|---|---|---|---|---|
| Hoje (free, estourado) | R$ 0 → bloqueio | ❌ | 60 s | 🔴 sim |
| Ficar e pagar (Supabase Pro + Vercel Pro) | ~R$ 250 | ✅ | 60 s | sim, com folga |
| **VPS único — HostGator SP NVMe 4, o escolhido** | **R$ 37,59** (R$ 78,32 na renovação) | ✅ (pg_dump → R2) | nenhum | ❌ não |

Economia de ~R$ 212/mês contra ficar e pagar — e, mais relevante, sai da rota de colisão com as
cotas sem trocar o problema de lugar. De quebra, 13 ms de latência contra os ~120 ms da Vercel
de hoje.

## Verificação

**Por fase, antes de mesclar:** `bun run build`, `bunx tsc --noEmit`, `bun run lint` (verde salvo
os 2 warnings pré-existentes de shadcn).

**Fase 1** — com o túnel SSH e `bun run dev` local contra o Postgres do VPS:
- Vinil Analytics com os mesmos números de hoje.
- Coleção, Wantlist e a listagem por dia → casa → artista carregam iguais.
- `GET /api/cron?step=salesdebug&limit=5` e `step=catdebug` respondem o mesmo.
- `step=reident&max=25` e `step=condition&max=8` identificam **as mesmas** vendas — a troca é de
  camada de acesso, não pode mudar resultado.

**Fase 2** — a conta Google autorizada entra; **qualquer outra é recusada** (é o teste que
importa); logout limpa a sessão; recarregar mantém a sessão; server function sem cookie dá erro.

**Fase 3** — subir foto nova na Coleção, conferir que aparece, que o arquivo está no volume e que
o `Cache-Control` vem com 7 dias; trocar a foto e conferir que a antiga foi removida.

**Fase 4** — `workflow_dispatch` do `refresh.yml` contra o novo host completa; o rodapé mostra a
`APP_VERSION` esperada; `/api/live` (proxy do pregão) funciona.

**Fase 5** — forçar um backup, baixar o dump do R2 e **restaurá-lo num Postgres descartável**.
Backup não testado não é backup.

**Depois de ~1 semana:** conferir uso zero no Supabase e na Vercel antes de desligar.

## Riscos e reversão

| Risco | Mitigação |
|---|---|
| Regressão silenciosa na camada de dados (sem testes) | Shim mantém o nome `supabaseAdmin` e é ligado por `DATABASE_URL` — reverter é apagar uma env var. Os 15 arquivos de lógica não mudam. |
| Semântica sutil do PostgREST mal reproduzida (upsert, count, range) | Enumerada explicitamente na Fase 1; validada pelo teste de "mesmas vendas identificadas". |
| Perda da máquina (sem data protection do provedor) | `pg_dump` noturno para o R2 **entregue junto com a Fase 4**, restauração testada, snapshot tirado, compose versionado no repo. |
| Máquina exposta: 1 IP público, sem rede privada, guardando senha do leiloesbr e chaves de API | Postgres sem porta publicada, UFW, SSH só por chave, fail2ban, Cloudflare na frente, chaves rotacionadas ao sair da Vercel. |
| Arquitetura ARM inesperada quebrar o `sharp` | `uname -m` como primeira checagem pós-contratação, antes de escrever o Dockerfile. |
| Pico de memória do `sharp` | Coberto pelos 4 GB; 1 GB de swap como margem extra. |
| Renovação a R$ 78,32/mês | Lembrete antes do vencimento — ali vale reavaliar. Stack em `docker-compose.yml` versionado torna a troca de máquina um restore + DNS. |
| Virar administrador de servidor | Tudo em um `docker-compose.yml` versionado, `unattended-upgrades`, e ping de healthcheck que avisa quando o cron para. |
| Branch `vps` divergir da `main` por semanas | `git merge origin/main` na `vps` a cada fase concluída, não só no fim. Atenção a `docs/notas-desenvolvimento.md` (conflito add/add conhecido). |
| Banco de teste do VPS envelhecer e alguém confiar nele | Regra explícita: é descartável. O que vale é o dump da Fase 6. |

## Lembretes do projeto (AGENTS.md)

- **A branch base é `vps`, não `main`.** Criar `vps` a partir de `origin/main` uma vez; depois
  cada fase sai de `vps` atualizada e volta como PR para `vps`. Nada é mesclado na `main` até a
  Fase 6 (exceto o corte de cron do "Alívio imediato", se optado).
- **Bump de versão em dois arquivos**: `src/lib/version.ts` (`APP_VERSION`) **e** `package.json`.
  O CI `version-bump.yml` reprova o PR sem isso. Versão no título do PR.
- **Atualizar `docs/notas-desenvolvimento.md` antes de mesclar** — esta migração reescreve a
  seção de infra, e cada PR precisa de uma linha no Histórico de versões.
- Corrigir de passagem as inconsistências já detectadas: `README.md:48` e os docs de economia
  ainda dizem cron "4×/dia" e `reident` "60×" (o real é 2×/dia e 15×), e `AGENTS.md` ainda marca
  a Fase 1 como "não iniciada".
- Módulo `*.server.ts` **não importa de módulo client-safe** (nem `import type`) — causou 404 de
  chunk em produção na v0.24.0.
