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

### A máquina comporta mais de um app — desenhar para isso desde o início

O VPS não é dedicado a este app, e o custo marginal de um segundo app é zero (diferente do modelo
Vercel/Supabase, onde cada projeto novo consome mais um free tier). Isso muda uma decisão de
desenho na Fase 4: o compose deve nascer já preparado, em vez de monolítico.

- **Uma rede Docker externa compartilhada** (ex. `proxy`), criada fora do compose. O Caddy é o
  único serviço com portas 80/443 publicadas e roteia **por domínio**; cada app é um projeto
  Compose separado que se conecta a essa rede sem publicar porta nenhuma.
- **Um Postgres só, com bancos e usuários separados** por app, em vez de uma instância por app —
  cada instância extra custa 200–400 MB à toa. O job de backup da Fase 5 deve usar `pg_dumpall`
  (ou iterar os bancos), não só o banco do Garimpo.
- **`mem_limit` por serviço no compose.** Sem isso, um app vizinho com vazamento de memória
  derruba o Postgres deste app junto. É a diferença entre "um app caiu" e "o servidor caiu".

**Orçamento de memória:** o stack deste app consome ~800 MB, deixando ~3,2 GB livres — espaço
confortável para mais dois ou três apps pequenos (Node/Go/Python, 100–300 MB cada). Atenção aos
devoradores: outra instância de Postgres, n8n (400 MB–1 GB), e qualquer coisa com JVM ou
Elasticsearch. **Não planejar passar de ~3 GB usados**: a folga não é desperdício, é cache de
páginas do Postgres e margem para os picos do `sharp`.

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

## Checklist manual — o que só você pode fazer (fora deste repo)

Tudo até aqui (Fases 1–5) é código, já mesclado/revisável por PR. **Nada disso roda de
verdade até estes passos serem feitos à mão**, com acesso ao VPS contratado, ao DNS do
domínio, ao Google Cloud Console e às contas do Cloudflare R2/healthchecks.io — nenhuma
sessão remota consegue fazer isso sozinha. Siga na ordem; cada bloco diz o que fazer, onde
clicar/rodar, e como confirmar que deu certo antes de ir pro próximo.

> ⚠️ **Estes passos são executados FORA deste repositório** (SSH no VPS, painéis externos)
> — nenhuma sessão consegue confirmar sozinha o que já rodou. Por isso o progresso é
> marcado aqui, **manualmente, a cada passo concluído** (trocar `[ ]` por `[x]` e commitar).
> Uma sessão nova lê este bloco antes de perguntar "o que já foi feito" ou repetir passos.

### Progresso

- [x] 1. Contratar e preparar o VPS (`uname -m`, usuário `deploy`, Docker, UFW/fail2ban, rede `proxy`) — x86_64, Ubuntu 22.04.5 LTS; SSH na porta 22022 (só chave, sem senha/root); UFW ativo (22022/80/443); fail2ban ativo; rede `proxy` já existia
- [x] 2. Gerar a chave SSH do GitHub Actions (`deploy-garimpo-actions`, autorizada no VPS)
- [x] 3. Cadastrar os secrets no GitHub (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_DEPLOY_PATH`, `VPS_SSH_PORT=22022`)
- [x] 4. Preparar o `.env` no VPS — atenção: `.env` editado no Windows chegou com CRLF (quebrou o parser do compose, "unexpected character") e com uma aspa desbalanceada (`PORTAINER_DOMAIN="...` sem fechar) — `sed -i 's/\r$//'` resolveu o CRLF; `docker compose config --quiet` valida antes de subir
- [x] 5. Cloudflare R2 (backup) — bucket `garimpo-backup`, lifecycle "Expire objects" 14 dias confirmado
- [ ] 6. healthchecks.io (monitoramento) — pulado por ora (opcional), retomar antes do cutover
- [x] 7. Primeiro deploy (`workflow_dispatch` do `deploy.yml`) — precisou de 3 fixes de código achados só rodando de verdade: `docker/setup-buildx-action@v3` (cache-to exige driver `docker-container`), `VPS_SSH_KEY` gerada sem passphrase (PowerShell `-N '""'` gera passphrase de fato, não vazia — gerar interativo, Enter em branco), e CRLF/aspas do `.env` acima
- [x] 8. DNS + domínio do app — usando `sslip.io` (sem domínio próprio ainda): `143-95-214-240.sslip.io`, TLS automático do Caddy funcionou de primeira
- [x] 9. Portainer (DNS próprio + primeiro acesso) — `painel-143-95-214-240.sslip.io`; setup token pego em `docker compose logs portainer`; Edge Compute pulado (não precisa, Docker é local)
- [x] 10. Google OAuth para o novo domínio — precisou de um fix de código: atrás do Caddy o Nitro/h3 não confia em `X-Forwarded-Proto`, então `redirect_uri` saía como `http://` e o Google recusava mesmo com a URI certa cadastrada; `auth.server.ts` passou a priorizar `PUBLIC_BASE_URL` sobre `url.origin` (v0.68.2)
- [x] 11. Validar antes do cutover — login Google, sessão LeilõesBR (vigias/lances ao vivo), upload de foto na Coleção (disco + Caddy servindo) e um ciclo completo do `backup` (dump → upload pro R2) confirmados funcionando. Achado nesta passada: o Postgres novo nunca recebe o schema sozinho — corrigido (`docker-entrypoint-initdb.d` + `supabase/setup.sql` copiado pelo `deploy.yml`, v0.68.4); banco desta instância aplicado manualmente uma vez, já que o volume tinha nascido antes do fix. Falta só o teste de restauração do backup ("backup não testado não é backup")
- [ ] 12. Fase 6 — cutover (banco de produção, ponto de não-retorno no passo 8 dele)

### 1. Contratar e preparar o VPS

1. Contratar o **HostGator "VPS Cloud / VPS OCI NVMe 4"** (2 vCPU / 4 GB / 100 GB, São Paulo),
   SO **"SO Simples" → Ubuntu 24.04 LTS** (22.04 se 24.04 não estiver disponível).
2. Assim que a máquina estiver de pé, conectar por SSH (`ssh root@<ip-do-vps>`, senha/chave
   que o provedor mandou) e **checar a arquitetura antes de qualquer coisa**:
   ```sh
   uname -m
   ```
   - `x86_64` → segue tudo como está (as imagens do Dockerfile/`docker/backup` são x86_64).
   - `aarch64` → **pare aqui e avise**: as imagens precisam ser rebuildadas para `arm64`
     (o `sharp` do Dockerfile quebra em ARM se a imagem for x86_64). Não prossiga sem isso.
3. Criar um usuário não-root com sudo (não usar root no dia a dia):
   ```sh
   adduser deploy
   usermod -aG sudo deploy
   ```
   Se criar o `deploy` **sem senha** (só acesso por chave SSH), o `sudo` dele vai pedir uma
   senha que não existe. Resolver como root, uma vez:
   ```sh
   echo 'deploy ALL=(ALL) NOPASSWD:ALL' | tee /etc/sudoers.d/90-deploy-nopasswd
   chmod 440 /etc/sudoers.d/90-deploy-nopasswd
   visudo -c   # valida a sintaxe — deve responder "parsed OK"
   ```
   Seguro numa máquina de admin único cujo `deploy` só aceita SSH por chave (é exatamente o
   estado depois do passo 5 abaixo).
4. Instalar Docker + Compose plugin (script oficial):
   ```sh
   curl -fsSL https://get.docker.com | sh
   usermod -aG docker deploy
   ```
   Confirmar: `docker --version` e `docker compose version`.
5. **Endurecer a máquina** (IP público, sem rede privada). Nesta ordem exata, testando a
   cada passo arriscado **numa segunda sessão, sem fechar a atual** — é o que evita se
   trancar pra fora:
   1. **(Opcional) Trocar a porta do SSH** — dificulta scans automatizados. Se for fazer,
      faça ANTES do resto:
      ```sh
      sed -i 's/^#\?Port .*/Port 22022/' /etc/ssh/sshd_config   # escolha sua porta
      ufw allow 22022/tcp   # libera a NOVA porta antes de reiniciar
      systemctl restart sshd
      ```
      Teste numa segunda sessão (`ssh -p 22022 deploy@<ip-do-vps>`) antes de seguir. Só
      depois de confirmar, remova a regra da porta 22 antiga (`ufw status numbered` +
      `ufw delete <nº da regra 22/tcp>` — a 22/tcp costuma sobreviver separada para IPv6,
      confirme as duas). Guarde esse número: vira o secret `VPS_SSH_PORT` no passo 3.
   2. **SSH só por chave, sem senha, sem root** — só desative depois de confirmar que o
      `deploy` entra por chave (`ssh deploy@<ip-do-vps>`, ou na porta nova se trocou):
      ```sh
      sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
      sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
      systemctl restart sshd
      ```
      ⚠️ **Pegadinha comum em imagens cloud-init** (a maioria dos provedores usa):
      `/etc/ssh/sshd_config` normalmente tem `Include /etc/ssh/sshd_config.d/*.conf` bem no
      topo, e um arquivo `50-cloud-init.conf` ali dentro costuma forçar
      `PasswordAuthentication yes` de novo — como esse `Include` vem ANTES da edição acima
      no arquivo principal, e o `sshd` usa o **primeiro valor encontrado** (não o último),
      o cloud-init vence e a edição acima parece não ter feito efeito. Sintoma:
      `sshd -T | grep -i passwordauthentication` continua respondendo `yes` mesmo depois do
      `sed`. Diagnosticar com `sudo cat /etc/ssh/sshd_config.d/50-cloud-init.conf`
      (permissão 600, precisa de `sudo` pra ler) e, se for isso, resolver com um drop-in que
      entra ANTES na ordem alfabética (garantindo que seja o primeiro valor lido):
      ```sh
      printf 'PasswordAuthentication no\nPermitRootLogin no\n' | tee /etc/ssh/sshd_config.d/00-hardening.conf
      chmod 600 /etc/ssh/sshd_config.d/00-hardening.conf
      sshd -t && systemctl restart sshd   # sshd -t valida ANTES de reiniciar
      ```
      Confirme com `sshd -T | grep -iE "^(passwordauthentication|permitrootlogin)"` — as
      duas devem responder `no` — e só então teste a reconexão por chave numa segunda
      sessão.
   3. **UFW**: só a porta do SSH (22 ou a que você escolheu), 80 e 443 (Caddy) — o Docker
      escreve direto no iptables, então NUNCA publicar outras portas no compose (o Postgres
      já não publica nenhuma). Se o `ufw` já vinha instalado mas **inativo** (comum em
      imagens de VPS — confirme com `ufw status`), as regras abaixo não bastam sozinhas, é
      preciso **habilitar**:
      ```sh
      apt-get update && apt-get install -y ufw fail2ban
      ufw allow 22/tcp    # ou a porta escolhida no passo i
      ufw allow 80/tcp
      ufw allow 443/tcp
      ufw default deny incoming
      ufw default allow outgoing
      ufw enable          # sem isso, "active" nunca aparece e NADA é filtrado
      systemctl enable --now fail2ban
      ufw status verbose  # confirma "Status: active" e só as portas esperadas
      ```
6. Criar a rede Docker externa compartilhada (uma vez só, serve para outros apps no mesmo
   VPS também):
   ```sh
   docker network create proxy
   ```
7. Criar a pasta de deploy (o caminho que você vai usar no secret `VPS_DEPLOY_PATH`, passo 3):
   ```sh
   mkdir -p /home/deploy/garimpo
   chown deploy:deploy /home/deploy/garimpo
   ```

### 2. Gerar a chave SSH que o GitHub Actions vai usar

No **seu computador** (não no VPS):

```sh
ssh-keygen -t ed25519 -C "deploy-garimpo" -f ./deploy_garimpo -N ""
```

Isso gera dois arquivos: `deploy_garimpo` (chave **privada**) e `deploy_garimpo.pub`
(**pública**).

1. Copiar a **pública** para o VPS:
   ```sh
   ssh-copy-id -i deploy_garimpo.pub deploy@<ip-do-vps>
   ```
   (ou, sem `ssh-copy-id`: `cat deploy_garimpo.pub | ssh deploy@<ip-do-vps> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`)
2. Confirmar que funciona: `ssh -i deploy_garimpo deploy@<ip-do-vps>` deve entrar sem pedir
   senha.
3. Guardar o conteúdo de `deploy_garimpo` (a **privada**, arquivo inteiro incluindo as linhas
   `-----BEGIN...-----`/`-----END...-----`) para o secret `VPS_SSH_KEY` no passo 3. **Depois
   de cadastrar o secret, apague o arquivo `deploy_garimpo` local** (ou guarde num cofre de
   senhas) — ele não precisa mais existir em texto plano no seu disco.

### 3. Cadastrar os secrets no GitHub (Settings → Secrets and variables → Actions)

No repositório, `Settings → Secrets and variables → Actions → New repository secret`,
um de cada vez:

| Secret | Valor |
| --- | --- |
| `VPS_HOST` | IP ou hostname do VPS (ex.: `123.45.67.89`) |
| `VPS_USER` | `deploy` (o usuário criado no passo 1.3) |
| `VPS_SSH_KEY` | conteúdo INTEIRO do arquivo `deploy_garimpo` (chave privada, passo 2) |
| `VPS_DEPLOY_PATH` | `/home/deploy/garimpo` (a pasta criada no passo 1.7) |
| `VPS_SSH_PORT` | só se o SSH não estiver na porta 22 padrão (ex.: `22022`, se você trocou a porta por segurança) — sem esse secret, o `deploy.yml` cai pra 22 |
| `HEALTHCHECKS_PING_URL` | opcional, ver seção 6 abaixo — pode deixar para depois |

`APP_URL` e `CRON_TOKEN` (usados pelo `refresh.yml`) **já existem** desde antes da
migração — não mexer neles ainda; `APP_URL` só troca no cutover (Fase 6, passo 4 abaixo).

### 4. Preparar o `.env` no VPS

O `.env` **não é versionado** e **não** é copiado pelo `deploy.yml` — precisa existir na
pasta de deploy (`VPS_DEPLOY_PATH`) ANTES do primeiro deploy, porque o `docker-compose.yml`
(esse sim, copiado automaticamente) lê esse arquivo.

1. No seu computador, copiar `.env.example` para `.env` e preencher **todos** os valores
   (Postgres, Google OAuth, `LEILOESBR_EMAIL`/`LEILOESBR_SENHA`, chaves de IA, Discogs,
   `POSTGRES_*`, `R2_*` — ver seção 5 abaixo para os valores do R2). `SESSION_SECRET` e
   `CRON_TOKEN`: gerar com `openssl rand -hex 32` cada.
2. Copiar esse `.env` preenchido para o VPS:
   ```sh
   scp -i deploy_garimpo .env deploy@<ip-do-vps>:/home/deploy/garimpo/.env
   ```
3. Ajustar a permissão (só o dono lê):
   ```sh
   ssh -i deploy_garimpo deploy@<ip-do-vps> "chmod 600 /home/deploy/garimpo/.env"
   ```
4. **Confirme que `DATABASE_URL` bate com `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`**
   no mesmo arquivo — é o erro mais comum aqui (ex.:
   `DATABASE_URL="postgresql://garimpo:SENHA@postgres:5432/garimpo"` com a mesma `SENHA` em
   `POSTGRES_PASSWORD`).

### 5. Cloudflare R2 (backup, Fase 5)

1. No painel da Cloudflare → **R2 Object Storage** → criar um bucket (ex.: `garimpo-backup`).
2. **Manage API Tokens → Create API Token**, permissão "Object Read & Write", escopo só
   nesse bucket. Anote o **Access Key ID** e a **Secret Access Key** (só aparecem uma vez).
3. O **endpoint** fica em `https://<account_id>.r2.cloudflarestorage.com` — o `<account_id>`
   aparece na URL do painel do R2 (ou em Account Home → API → Account ID).
4. Preencher no `.env` (passo 4 acima): `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`.
5. **Configurar a retenção de 14 dias como regra de lifecycle do bucket** (o script de
   backup não apaga nada sozinho, de propósito): no bucket → **Settings → Object Lifecycle
   Rules → Add rule** → "Expire objects" após 14 dias, aplicar a todos os objetos.

### 6. healthchecks.io (monitoramento, opcional mas recomendado)

1. Criar conta free em https://healthchecks.io.
2. **Add Check**, nome "Garimpo cron", período (schedule) um pouco maior que o intervalo
   entre execuções do `refresh.yml` (hoje 2×/dia, ~12h de intervalo — configurar 13-14h de
   "Period" ou "Grace Time" generoso, para não disparar alerta falso por atraso do runner).
3. Copiar a **Ping URL** do check (formato `https://hc-ping.com/<uuid>`).
4. Cadastrar como secret `HEALTHCHECKS_PING_URL` no GitHub (passo 3 acima).

### 7. Primeiro deploy

1. Com os secrets (passo 3) e o `.env` no VPS (passo 4) prontos, disparar o deploy manualmente:
   no GitHub → **Actions → Deploy (VPS) → Run workflow** (branch `vps`).
2. Acompanhar o log do workflow. Se falhar no SSH, confira `VPS_HOST`/`VPS_USER`/
   `VPS_SSH_KEY` (passo 3) e se a chave pública foi mesmo copiada (passo 2.1).
3. No VPS, confirmar que os containers subiram:
   ```sh
   ssh -i deploy_garimpo deploy@<ip-do-vps> "cd garimpo && docker compose ps"
   ```
   Espera-se `caddy`, `app`, `postgres`, `backup` todos `running`/`healthy`.
4. **Ainda sem domínio/DNS apontado**, testar direto pelo IP não vai funcionar (o Caddy só
   emite certificado TLS para o domínio configurado em `APP_DOMAIN`) — é normal, segue pro
   próximo passo.
5. O `deploy.yml` copia `supabase/setup.sql` pro VPS e o Postgres aplica sozinho **só quando
   o volume de dados nasce vazio** (mecanismo `docker-entrypoint-initdb.d` da imagem oficial).
   Se o volume já existia de uma tentativa anterior (por exemplo, você rodou `docker compose
   up` antes deste PR existir), aplique à mão uma vez — é seguro rodar de novo, o script é
   idempotente (`IF NOT EXISTS`):
   ```sh
   docker compose exec -T postgres psql -U garimpo -d garimpo < supabase-init/01-setup.sql
   ```
   Confirma com `docker compose exec postgres psql -U garimpo -d garimpo -c '\dt'` — espera-se
   12 tabelas (`lots`, `collection_items`, `purchases`, etc.). Os erros `role "anon"/
   "service_role" does not exist` e `relation "storage.buckets" does not exist` são
   esperados e inofensivos — resíduo do tempo do Supabase, sem efeito no Postgres próprio.

### 8. DNS + domínio

1. No provedor de DNS do seu domínio, criar um registro **A** apontando o subdomínio
   escolhido (ex.: `garimpo.seudominio.com`) para o **IP do VPS**.
   - Se for usar Cloudflare na frente (opcional, só para esconder o IP): proxy **laranja**
     ligado, modo SSL/TLS **"Full (strict)"** — senão o Caddy não consegue emitir o
     certificado de origem.
2. Preencher `APP_DOMAIN` no `.env` do VPS (passo 4) com esse mesmo domínio e rodar
   `docker compose up -d` de novo no VPS (ou disparar o workflow de novo) para o Caddy
   reler o `Caddyfile` com o domínio certo.
3. Esperar a propagação do DNS (minutos a poucas horas) e então abrir
   `https://garimpo.seudominio.com` no navegador — deve carregar a tela de login,
   com certificado válido (cadeado verde).

### 9. Portainer (painel de containers, Fase 5)

1. Criar **outro** registro DNS **A** — um subdomínio **separado** do app (ex.:
   `painel.seudominio.com`) apontando para o mesmo IP do VPS. Nunca reusar o domínio do
   app: o Caddyfile já espera dois hosts distintos (`APP_DOMAIN` e `PORTAINER_DOMAIN`).
2. Preencher `PORTAINER_DOMAIN` no `.env` do VPS (passo 4) com esse subdomínio e rodar
   `docker compose up -d` de novo (ou disparar o workflow) para o Caddy e o Portainer
   subirem com o domínio certo.
3. Assim que o DNS propagar, abrir `https://painel.seudominio.com` — a PRIMEIRA coisa que
   o Portainer pede é criar a senha do usuário `admin`. **Faça isso na hora**: por padrão
   ele trava esse cadastro inicial depois de alguns minutos, e o único jeito de destravar é
   reiniciar o container (`docker compose restart portainer`), apagando qualquer conta
   parcialmente criada.
4. Na tela seguinte, escolher "Get Started" / ambiente local (ele já enxerga o Docker do
   host via `docker.sock`) — nenhuma configuração extra de cluster é necessária, é um VPS
   único.
5. **Restringir o acesso** (recomendado, não obrigatório): como esse painel controla
   TODOS os containers da máquina (não só o Garimpo, se houver outros apps), considere uma
   camada a mais além da senha — Cloudflare Access (se já usa Cloudflare na frente) ou uma
   allowlist de IP no Caddyfile (`@allowed_ips remote_ip <seu-ip>` + `abort` fora dela) são
   as opções mais simples.

### 10. Google OAuth para o novo domínio

No [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services →
Credentials** → o OAuth Client ID já usado pelo app → **Authorized redirect URIs → Add URI**:

```
https://garimpo.seudominio.com/api/auth/google/callback
```

Não remover a URI antiga (da Vercel) ainda — só depois que o cutover (Fase 6) terminar e o
domínio antigo for descomissionado.

### 11. Validar antes do cutover

Com o domínio no ar, ainda em PARALELO com a produção na Vercel (o cron continua batendo só
na Vercel — não rode `workflow_dispatch` do `refresh.yml` contra os dois ao mesmo tempo):

- Login com a conta Google autorizada funciona; qualquer outra conta é recusada.
- Fotos da Coleção: subir uma foto de teste, conferir que aparece e que
  `https://garimpo.seudominio.com/collection/<arquivo>` responde com `Cache-Control` de
  7 dias.
- `docker compose logs backup` mostra pelo menos um ciclo de `[backup] concluído` e o
  arquivo aparece no bucket do R2.
- Se cadastrou o `HEALTHCHECKS_PING_URL`: **não** dispare o `refresh.yml` contra este VPS
  ainda (ele ainda não tem o banco de produção) — o ping real só faz sentido depois do
  cutover.
- **Backup restaurado de teste** (não pule isso): baixar o `.sql.gz` mais recente do bucket
  e restaurar num Postgres descartável (`docker run --rm -e POSTGRES_PASSWORD=x -p
  5433:5432 postgres:17-alpine` + `gunzip -c arquivo.sql.gz | psql -h localhost -p 5433 -U
  postgres`). Backup não testado não é backup.

### 12. Fase 6 — cutover (janela de ~30 min, banco de produção)

Só depois de tudo acima validado. Nesta ordem, sem pular etapas:

1. **Congelar a produção**: no repositório, `Actions → refresh.yml → ⋯ → Disable workflow`
   (ou remover o `schedule:` num commit na `main`). Avisar para não usar o app durante a
   janela.
2. **Dump final** do Supabase (Supabase Dashboard → Database → Backups, ou
   `pg_dump` direto na `DATABASE_URL` de produção) → copiar para o VPS → restaurar por
   cima do Postgres do VPS:
   ```sh
   # no VPS, dentro da pasta de deploy
   cat dump_final.sql | docker compose exec -T postgres psql -U garimpo -d garimpo
   ```
   (schema recriado do zero — não por cima do banco de teste da Fase 1-5; se precisar
   recriar: `docker compose exec -T postgres psql -U garimpo -d garimpo` rodando o
   conteúdo de `supabase/setup.sql` primeiro).
3. **Sincronizar as fotos da Coleção**: baixar do bucket antigo do Supabase Storage tudo
   que entrou depois do corte da Fase 3 e copiar para o volume `collection_data` do VPS;
   reconferir as URLs em `collection_items` (devem apontar para
   `https://garimpo.seudominio.com/collection/...`).
4. **Apontar `APP_URL`**: atualizar o secret `APP_URL` no GitHub para
   `https://garimpo.seudominio.com`.
5. **Reabilitar o cron**: reativar o `refresh.yml` (reverter o passo 1) e disparar um
   `workflow_dispatch` manual, acompanhando o log até o fim.
6. **Validar** com a lista da seção Verificação abaixo, agora contra os dados reais.
7. **Não desligar nada ainda.** Supabase e Vercel ficam de pé, intocados, por pelo menos
   **uma semana** — reverter é só apontar o DNS de volta e reabilitar o `refresh.yml` velho.
8. Depois desse período: mesclar `vps` → `main` (PR normal) e só então desligar
   Supabase/Vercel — exportando um último dump do Supabase para guardar antes de encerrar
   o projeto lá. Remover também a Authorized redirect URI antiga do Google Cloud Console.

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
