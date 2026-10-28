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

- **AgendaBoa no mesmo VPS (v0.99.4):** app separado (compose em `/opt/agendaboa`, rede externa
  `proxy`) servido pelo Caddy em `agenda.143-95-214-240.sslip.io` → `agendaboa-app:3000`
  (health check em `/login`). O `postgres` daqui entra também na rede externa `agendaboa_db`
  (`external: true`, criada à mão: `docker network create agendaboa_db`) com o alias
  `agendaboa-postgres`, mantendo a `default` (sem ela `app`/`backup` perderiam o banco). Só o
  Postgres e o app do AgendaBoa participam dessa rede; o AgendaBoa deve usar banco e role próprios.
  ⚠️ O deploy recria o container do Postgres (breve indisponibilidade) — mesclar fora do cron/backup.

## Ferramenta separada: `tools/missleiloes-sniper.user.js`

Userscript (Tampermonkey/bookmarklet) que roda **na página do pregão ao vivo** do missleiloes
(`@match */presencial/presencial.asp*`). **NÃO faz parte do app.** Pregão **soft-close** (cada
lance reinicia o cronômetro). Objeto global `novoPresencial`: polling (~1s) via `LePregao`,
estado em `statusatual` (P→X→1/2/3→4 FECHANDO→F), `valorpecaatual` (próximo lance),
`lancevencedor`; lance por `Fazerlance()` → `POST lote_fazerlance.asp`. v3: **um lance no
status 4 (FECHANDO)**, Turbo (polling ~250ms) + confirmação. Sniping clássico não existe no
soft-close; a vantagem é reagir mais rápido no último instante. (`tools/` é ignorado no
ESLint/Prettier.)

- **Endurecimento de infra e segurança (v0.165.0):**
  - **Backup:** `docker/backup/backup.sh` checa o status do `pg_dump | gzip`, valida com `gzip -t` e recusa dump menor que `MIN_DUMP_BYTES` (2048) — antes um `pg_dump` que falhava (o `set -e` fica desligado dentro de `dump_once || ...`) subia um arquivo truncado ao R2 como o mais recente. `BACKUP_PING_URL` (opcional, um check do healthchecks.io) recebe um ping a cada backup bom; crie com período de ~26 h para ser avisado quando o backup deixar de chegar. Imagem ganhou `curl`.
  - **Cron:** `refresh.yml` tem `timeout-minutes: 90` e manda `…/start` ao healthchecks.io (distingue "não começou" de "começou e não terminou"); o `salesdebug` saiu da rotina (os logs do Actions são públicos). Steps de diagnóstico e destrutivos (`catalogdebug`, `catdebug`, `findlot*`, `pagedebug`, `windowaudit`, `salesdebug`, `resetnosourcethumbs`, `cleannonvinyl&apply=1`, `sales&reset=1`) respondem 403 a menos que `CRON_ENABLE_DEBUG=1` esteja no `.env` do servidor (necessário também para o workflow manual `debug-cron.yml`). As respostas 400/500 do `/api/cron` não ecoam mais query, pid, hostname.
  - **Login:** o callback do Google só emite sessão para e-mail com `email_verified === true` e igual a `LEILOESBR_EMAIL` (`checkGoogleUser` em `access.server.ts`); antes qualquer conta Google recebia cookie e só era barrada depois, em cada chamada.
  - **Caddy:** domínio do app com `Strict-Transport-Security` (sem `includeSubDomains`), `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` e `encode zstd gzip`. CSP de script/estilo fica de fora (o SSR injeta scripts inline; exigiria nonces).
  - **Rollback:** `deploy.yml` → "Run workflow" com `image_sha` (SHA completo de um commit já publicado no GHCR) pula o build e sobe as imagens desse commit; o deploy grava `APP_IMAGE`/`BACKUP_IMAGE` no `.env` do VPS, então um `docker compose up` manual não volta mais para `:latest`. `compose/Caddyfile/setup.sql` vêm do ref escolhido no workflow.
- **Backup das fotos e deploy seguro (v0.170.0):**
  - **Fotos da Coleção no R2:** o serviço `backup` monta o volume `collection_data` (só leitura) e, depois do dump, roda `aws s3 sync` para `s3://<bucket>/collection/` (só acrescenta; os arquivos têm nome UUID e não mudam). O ping `BACKUP_PING_URL` só sai quando dump E fotos deram certo. Se o ciclo falha (ex.: Postgres subindo), tenta de novo em 10 min, até 3 vezes (`BACKUP_RETRIES`, `BACKUP_RETRY_SECONDS`) antes de esperar 24 h. O `.env` (segredos) NÃO vai para o R2 de propósito: guarde uma cópia no seu gerenciador de senhas. Teste: `bash tools/local-tests/backup-script.sh`.
  - **Postgres com healthcheck** (`pg_isready`); `app` e `backup` só sobem com o banco saudável.
  - **Deploy (`docker/deploy/remote-deploy.sh`, copiado e executado pelo `deploy.yml`):** grava as tags no `.env` → `compose pull` → sobe só o Postgres e espera ficar saudável → dump `backups/pre-deploy-*.sql.gz` (guarda 5; aborta o deploy se o dump falhar ou tiver menos de 2 KB) → `setup.sql` numa ÚNICA transação com `lock_timeout=5s` (falha no meio = nada muda e o app antigo segue no ar) → sobe o resto → `caddy reload`. Antes, o app novo subia antes da migração e uma falha deixava o schema pela metade. Teste: `bash tools/local-tests/remote-deploy.sh`. ⚠️ O primeiro deploy depois desta versão recria o container do Postgres (o healthcheck é config nova): breve indisponibilidade; mesclar fora do cron.
  - **Restaurar:** banco: `aws s3 cp s3://<bucket>/garimpo-<data>.sql.gz . --endpoint-url <R2_ENDPOINT>` → `gunzip -c arquivo | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` (num banco vazio). Fotos: `aws s3 sync s3://<bucket>/collection/ <volume collection_data> --endpoint-url <R2_ENDPOINT>`. Faça um ensaio de restauração por trimestre num Postgres descartável e anote a data aqui.
- **Sites avulsos (v0.184.1):** o `Caddyfile` termina com `import /etc/caddy/sites/*.caddy` e o `caddy` monta `./sites:/etc/caddy/sites:ro`. `sites/` existe só no VPS (ao lado do compose; o `deploy.yml` não o copia nem o altera) e cada `*.caddy` ali é um bloco de site de outro projeto (ex.: `precos.caddy`). Glob sem arquivos é no-op. Conferir após o deploy: `docker exec garimpo-caddy-1 ls /etc/caddy/sites`. Mudança em `sites/*.caddy` só vale após `caddy reload` (o deploy já faz).
- **Superfície do VPS (v0.172.0):** no `Caddyfile`, `PORTAINER_ALLOWED_IPS` (no `.env` do VPS, IPs/CIDRs separados por espaço) restringe quem abre o Portainer (que controla o Docker do host); sem a variável o padrão libera todos, como antes. `PREVIEW_BASIC_AUTH_HASH` troca o hash bcrypt do Basic Auth dos previews (o do repo é o padrão; gerar outro com `docker run --rm caddy:2-alpine caddy hash-password` e pôr no `.env`). O secret opcional `VPS_KNOWN_HOSTS` faz o deploy conferir a chave do servidor em vez de confiar no `ssh-keyscan`. Buscas de imagem vindas de fora (capa do lote para a IA, miniatura de venda) passam por `fetchImageBytes` (`safe-fetch.server.ts`): host público, redirects revalidados a cada salto, timeout e teto de bytes lido em fluxo; `sharp` recusa imagem acima de 50 milhões de pixels (`image-limits.ts`; o padrão do sharp é 268 milhões e estouraria os 512 MB).
- **Aviso de pregão começando (v0.161.0):** `.github/workflows/watch-alert.yml` chama `step=watchalert` a cada 15 min entre 8h e 23h45 de Brasília (cron UTC `*/15 11-23,0-2 * * *`, grupo de concorrência próprio — não enfileira atrás das varreduras `refresh-lotes`). Web Push quando o pregão de um lote vigiado começa em até 30 min (`watch-alerts.server.ts`; dedupe em `app_state.watch_start_notified`); no-op sem `VAPID_*` ou sem aparelho inscrito. Usa os secrets `APP_URL` e `CRON_TOKEN` já existentes.
  - **Avisos mais confiáveis (v0.171.0):** a janela do `watch-alert.yml` passou a 6h–23h45 de Brasília (`*/15 9-23,0-2` UTC; antes pregões antes das 8h nunca eram avisados). O dedupe é por LOTE vigiado e em duas etapas: o pregão é RESERVADO em `app_state.watch_start_notified` antes do push (objeto `{ "idLeilao|dia": { at, state: "sending"|"sent", lotIds } }`; o formato antigo, lista de chaves, é lido como "tudo avisado") e confirmado depois; uma run cancelada no meio do envio não reavisa, uma reserva não confirmada vale por 10 min, push sem nenhum aparelho desfaz a reserva. Vigiar OUTRO lote do mesmo pregão depois do aviso gera um aviso só para ele.
  - **Aviso de teto de lance (v0.171.0):** o mesmo step lê os vigiados UMA vez e, além do pregão começando, avisa quando o valor atual de um lote vigiado (de hoje em diante) cruza o teto de "barato" (`lotEconomics.capCheap`: o maior lance que ainda fica ≤ 70% do Discogs com frete, âncora na condição do disco e frete pela UF — mesma conta do app). Avisa ao ENTRAR na faixa (inclusive o lote que já estava barato ao ser vigiado) e ao SAIR dela (lance passou do teto), nunca repete do mesmo lado. Estado em `app_state.bid_cap_state` (`{ idLote: "below"|"above" }`), gravado só depois do push. Sem mercado casado não há teto e não há aviso. O valor é o da página de vigiados da conta (ao vivo), não o da varredura geral. Puro: `bid-cap-alerts.ts`; teste com banco: `tools/local-tests/teto-alert.ts`.
  - **Resumo diário (v0.171.0):** o dia é RESERVADO em `daily_digest_sent` antes do envio e a reserva é desfeita se o e-mail falha (antes, um retry do `curl` durante um envio lento duplicava o e-mail). Segunda janela às 12:30 BRT (`30 11,15 * * *` UTC): o dia em que a das 8:30 não achou lotes avaliados ou falhou ganha outra chance; com o e-mail já enviado, vira "já enviado hoje".
- **E-mail pelo Gmail (v0.135.0):** `GMAIL_USER` + `GMAIL_APP_PASSWORD` (senha de app) e `EMAIL_TO` opcional no `.env` do VPS (recriar com `docker compose up -d --force-recreate app`); SMTP `smtp.gmail.com:465` via `nodemailer` (`email.server.ts`; templates puros em `email-templates.server.ts`). Usos: aviso do "De olho" (ver `colecao-sondagem-compras.md`) e **resumo diário** dos 30 melhores lotes dos próximos 5 dias (`daily-digest.server.ts`, `step=dailydigest`, ordenado pela nota da IA, sem os "caro"), disparado 1x/dia às 8:30 BRT por `.github/workflows/daily-digest.yml`; dedupe por dia em `app_state.daily_digest_sent`. Sem as envs é no-op.
- **Env opcional `NTFY_TOPIC` / `NTFY_SERVER` (v0.107.0):** aviso push do "De olho" via ntfy.sh, lido só pelo servidor (`.env` do VPS; não é secret do GitHub). O tópico funciona como senha — usar nome longo/aleatório. Mudança no `.env` exige recriar o serviço (`docker compose up -d app`).
