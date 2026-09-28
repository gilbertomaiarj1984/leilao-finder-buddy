# Infra, deploy, histórico de migração e ferramentas avulsas

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Infra (migração Lovable → Supabase próprio + Vercel, 2026-08)

- **Deploy Vercel** (não mais Cloudflare). Nitro é plugin Vite (`import { nitro } from
'nitro/vite'`), **auto-detecta a Vercel** por `process.env.VERCEL`; build gera
  `.vercel/output` (Build Output API v3). `vercel.json`: `bun run build` / `bun install` /
  `framework: null`. `bunfig.toml` → npm público; `bun.lock` regenerado.
- **Auth Supabase nativo** (Google, **PKCE**). Fluxo em `src/routes/auth.tsx`:
  `signInWithOAuth({redirectTo: origin + '/auth'})` → `/auth?code=…` →
  `exchangeCodeForSession(code)`. Client com `flowType:'pkce'`, `detectSessionInUrl:false`.
  Acesso restrito ao e-mail `LEILOESBR_EMAIL` (`src/lib/access.server.ts`).
- **Supabase**: projeto `rjqzzxhgcelixlgnfcic`. RLS mantém tudo só para `service_role` (o front
  não lê o banco direto; server functions usam `supabaseAdmin`).
- **Produção**: `https://leilao-finder-buddy.vercel.app` (branch `main`). Previews de PR usam
  URL com hash que **muda a cada deploy** (o rodapé mostra a `APP_VERSION` no ar).
- **Auth URLs (Supabase → Authentication → URL Configuration):** Site URL de produção; Redirect
  URLs incluem `…vercel.app/**`, o padrão de preview `…-gilbertomaiarj1984s-projects.vercel.app/**`
  e `http://localhost:3000/**`. Google OAuth: redirect URI
  `https://rjqzzxhgcelixlgnfcic.supabase.co/auth/v1/callback`.
- **Env vars** (`.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEILOESBR_EMAIL`,
  `LEILOESBR_SENHA`, `CRON_TOKEN`, `ANTHROPIC_API_KEY`, `DISCOGS_TOKEN`. Na Vercel devem estar
  em **Production**; mudar env exige **Redeploy**. `.env` é gitignored. A `publishable`
  (`sb_publishable_`) é pública por design; senha do banco e `service_role` foram rotacionadas
  após a migração. Dados migrados via `pg_restore --data-only` (usuários do `auth` **não**
  migrados — login refeito com Google).

## Infra — economia / saída dos free tiers (migração para VPS concluída, Fase 6 feita)

Planos e telemetria em **`docs/economia-migracao.md`** (índice), fases em
`docs/economia-fase-1-egress-e-cpu.md` e `docs/economia-fase-2-vps-unico.md`. Resumo: banco
folgado (49/500 MB), mas **egress do Supabase já estourado** e **Active CPU da Vercel em 79%**
— o padrão de leitura, não o tamanho do banco, é o problema.

- **Causa raiz:** `reidentifyAllSales()` (`lot-sales.server.ts:511`) carrega `lot_sales` INTEIRA
  (com `orig_text`) + `lot_ident` INTEIRA a cada chamada, para processar 25 linhas — e o workflow
  chama isso em laço de até **60×** por execução, 4×/dia (`refresh.yml:120`). Leitura
  O(tabela) para O(25) de trabalho. Mesmo sem venda nova, a 1ª chamada baixa tudo só para
  descobrir que não há o que fazer. Isso é o egress do Supabase E o Active CPU da Vercel.
- **Secundário:** `getVinylSales` (`leiloesbr.functions.ts:542`) devolve o histórico inteiro ao
  browser a cada abertura do Vinil Analytics.
- **Correção (Fase 1, custo zero):** filtrar no banco (anti-join via RPC, `limit(max)`) em vez de
  baixar tudo e filtrar em memória; não pedir `orig_text` em quem não usa (o flag `withOrig` já
  existe); short-circuit quando não há trabalho; encolher os laços do workflow.
- **Netlify e Neon descartados.** Netlify: timeout de 10 s mata os steps do cron e o `/api/live`
  (confirmado — o projeto conectado ao repo falha o deploy em todo PR). Neon: o gargalo é egress,
  não storage, e o Neon cobra CU-horas que o mesmo padrão queima igual.
- **Fase 2 (VPS único em São Paulo, R$ 37,59/mês) — plano fechado em v0.60.5/6, Fases 1–6
  concluídas (v0.62.0–v0.69.13), cutover feito e `vps` mesclada em `main`.** Migração completa
  (Postgres + Auth + Storage + Host + backup/faxina) em 6 fases, executadas numa branch
  **`vps`** paralela enquanto a `main` ficou intocada na Vercel; a Fase 6 (cutover, v0.69.13)
  migrou o banco de produção real pro VPS e mesclou `vps` → `main` — `main` voltou a ser a
  branch de trabalho/produção padrão (v0.69.17), Supabase/Vercel mantidos de pé só como rede
  de reversão (sem prazo definido pra desligar). `vps` segue viva em paralelo só pelo trabalho
  experimental da Fase 7 (preview deployments via Dokploy, abaixo). A camada de dados saiu por
  um **shim `postgres.js`** que preserva o nome exportado `supabaseAdmin` e é ligado por
  `DATABASE_URL` —
  os 15 arquivos de lógica e toda a UI não mudaram. Auth virou OAuth Google direto (o contrato
  preservado é `context.claims.email`, então os 60 `assertAllowed` ficaram intactos); Storage
  virou volume em disco, servido pelo Node até a Fase 4 e pelo Caddy depois dela. `vite.config.ts:9`
  já honrava `SERVER_PRESET`, então trocar de host (Fase 4) foi env var, não código: `Dockerfile`
  multi-stage (`bun run build` com `SERVER_PRESET=node-server` → runtime `node:22-slim`, copiando
  só o `.output` do Nitro, que já vem com `node_modules` rastreado por dependência — inclui o
  binário nativo do `sharp`), `docker-compose.yml` (`caddy` + `app` + `postgres:17`, desenhado
  para multi-app desde o início — rede Docker externa `proxy`, `mem_limit` por serviço),
  `Caddyfile` (TLS automático, reverse proxy pro `app`, `file_server` pro volume de
  `/collection/*`) e `.github/workflows/deploy.yml` (build → GHCR → SSH no VPS → `docker compose
  pull && up -d`, disparado a cada push em `vps`). `version-bump.yml` passou a comparar também
  contra `vps` (`branches: [main, vps]`), não só `main`. Fase 5 entrou junto: serviço `backup`
  no compose (imagem própria em `docker/backup/`, também buildada/publicada pelo
  `deploy.yml` — `pg_dump` a cada 24h para o Cloudflare R2, S3-compatible; a retenção de 14
  dias é uma regra de lifecycle no bucket, não lógica no script); ping pro healthchecks.io no
  fim/erro do `refresh.yml` (`HEALTHCHECKS_PING_URL`, opcional); FKs `ON DELETE CASCADE` de
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` para `lots(id)` (nunca `lot_sales`, que é o
  arquivo permanente) — migração limpa os órfãos já acumulados antes de criar a constraint;
  novo `step=prune` no cron (`seen_auctions`, só remove leilões com vendas já capturadas,
  nunca perde backlog). Roteiro completo, riscos e verificação por fase em
  `docs/economia-fase-2-vps-unico.md`.
- **Órfãos (rebaixado a item secundário):** o schema não tem FK nem `CASCADE`, então
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` acumulam órfãos quando `lots` é podada. Com
  49/500 MB não é urgente, mas órfã em `lot_ident` é linha lida à toa pelo anti-join.
  ⚠️ **Nunca** cascatear `lot_sales` → `lots`.
- **Lição:** a v0.48.1 planejou a partir do schema e mirou o tamanho do banco — alvo errado.
  Schema mostra o que _pode_ crescer; só telemetria mostra o que _está_ doendo.

## Ferramenta separada: `tools/missleiloes-sniper.user.js`

Userscript (Tampermonkey/bookmarklet) que roda **na página do pregão ao vivo** do missleiloes
(`@match */presencial/presencial.asp*`). **NÃO faz parte do app.** Pregão **soft-close** (cada
lance reinicia o cronômetro). Objeto global `novoPresencial`: polling (~1s) via `LePregao`,
estado em `statusatual` (P→X→1/2/3→4 FECHANDO→F), `valorpecaatual` (próximo lance),
`lancevencedor`; lance por `Fazerlance()` → `POST lote_fazerlance.asp`. v3: **um lance no
status 4 (FECHANDO)**, Turbo (polling ~250ms) + confirmação. Sniping clássico não existe no
soft-close; a vantagem é reagir mais rápido no último instante. (`tools/` é ignorado no
ESLint/Prettier.)
