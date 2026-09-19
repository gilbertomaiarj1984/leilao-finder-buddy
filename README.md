# Garimpo de Vinil (Leilão Finder)

App que garimpa discos de vinil em leilões (leiloesbr.com.br), com busca,
acompanhamento de lotes e lances.

Stack: **TanStack Start** (React 19 + SSR) · **Postgres** próprio (`postgres.js`) ·
deploy em **VPS** via **Docker Compose + Caddy** · atualização periódica via
**GitHub Actions**.

## Desenvolvimento local

Requer [Bun](https://bun.sh) (ou Node 18+).

```sh
bun install
cp .env.example .env   # preencha os valores
bun run dev
```

App em http://localhost:3000

## Variáveis de ambiente

Veja `.env.example`. Resumo:

| Variável                                | Onde                      | Para quê                                                     |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                          | servidor                  | conexão com o Postgres — **segredo**                          |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | servidor              | login Google OAuth (authorization code + PKCE)                |
| `SESSION_SECRET`                        | servidor                  | assina o cookie de sessão — **segredo**                       |
| `LEILOESBR_EMAIL`                       | servidor                  | único e-mail Google autorizado                                 |
| `LEILOESBR_SENHA`                       | servidor                  | login no site de leilões (scraper)                             |
| `CRON_TOKEN`                            | servidor + GitHub Actions | protege o endpoint `/api/cron`                                 |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`  | servidor                  | IA (avaliação/identificação) — Claude e/ou Gemini, opcional    |
| `DISCOGS_TOKEN`                         | servidor                  | âncora de preço/mercado, opcional                              |
| `COLLECTION_DIR` / `PUBLIC_BASE_URL`    | servidor                  | fotos da Coleção em disco (ver `.env.example`)                 |

Lista completa e comentada em `.env.example`.

## Deploy (VPS, Docker Compose + Caddy)

Arquitetura: `Caddy` (TLS automático + reverse proxy + `/collection/*` do volume) →
`app` (imagem Node, build multi-stage no `Dockerfile`) → `postgres:17`. Detalhes,
riscos e o roteiro completo das 6 fases da migração (Supabase/Vercel → VPS único) em
`docs/economia-fase-2-vps-unico.md`.

1. No VPS: `docker network create proxy` (rede externa compartilhada, permite outros
   apps no mesmo host) e uma pasta com `docker-compose.yml` + `Caddyfile` (copiados
   pelo workflow de deploy) + um `.env` (a partir de `.env.example`, permissão `600`).
2. `.github/workflows/deploy.yml` builda a imagem no Actions, publica no GHCR e faz
   `docker compose pull && docker compose up -d` no VPS via SSH, a cada push nas
   branches `main` (produção) ou `vps` (ainda usada pela Fase 7/preview deployments).
   Secrets necessários no repositório: `VPS_HOST`, `VPS_USER`,
   `VPS_SSH_KEY`, `VPS_DEPLOY_PATH`; `VPS_SSH_PORT` (opcional — só se o SSH não estiver
   na porta 22 padrão).
3. Postgres sem porta publicada (acesso administrativo só por túnel SSH); UFW liberando
   só 22/80/443 — ver "Endurecimento da máquina" no plano de migração.

## Backup e monitoramento

Serviço `backup` no compose (imagem própria em `docker/backup/`, também publicada pelo
`deploy.yml`): `pg_dump` a cada 24h para o Cloudflare R2 (S3-compatible, free 10 GB) — ver
`R2_*` em `.env.example`. A retenção (14 dias) é configurada como regra de **lifecycle no
bucket** do R2, não no script. Backup não testado não é backup: restaurar o dump baixado
num Postgres descartável de vez em quando.

Monitoramento: `HEALTHCHECKS_PING_URL` (opcional, `.github/workflows/refresh.yml`) — ping
de sucesso no fim da execução, `/fail` se qualquer chamada do cron falhar. Sem esse secret,
os pings viram no-op.

## Painel de containers (Portainer)

Serviço `portainer` no compose, exposto pelo Caddy num subdomínio **próprio e separado**
do app (`PORTAINER_DOMAIN`, ver `.env.example`) — lista visual dos containers/imagens,
logs e status de cada deploy. ⚠️ Tem acesso ao socket do Docker do **host inteiro**: em
um VPS com mais de um app, ele enxerga e controla todos, não só o Garimpo. Definir a
senha do admin **imediatamente** no primeiro acesso (o Portainer expira o cadastro
inicial em alguns minutos) e considerar restringir o acesso ao subdomínio (Cloudflare
Access, allowlist de IP, ou VPN) — ver o checklist manual em
`docs/economia-fase-2-vps-unico.md`.

## Banco de dados

Postgres próprio (sem serviço gerenciado). Schema consolidado em
`supabase/setup.sql` (nome histórico, mantido — schema puro, sem nada específico
do Supabase); histórico incremental em `supabase/migrations/`.

## Atualização periódica

`.github/workflows/refresh.yml` chama `/api/cron` 2×/dia. Configure os secrets
`APP_URL` (domínio do app no VPS) e `CRON_TOKEN` no repositório.
