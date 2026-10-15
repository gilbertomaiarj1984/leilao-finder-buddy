#!/bin/sh
# Sobe o build de produção (.output) contra um Postgres de teste. Rode `bun run build` antes.
cd "$(dirname "$0")/../.."
export DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres@127.0.0.1:54329/garimpo}" \
  SESSION_SECRET="${SESSION_SECRET:-segredo-de-teste-local}" LEILOESBR_EMAIL="teste@example.com" \
  PUBLIC_BASE_URL="http://localhost:3999" PORT=3999 HOST=127.0.0.1 NITRO_PORT=3999 \
  GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x CRON_TOKEN=cron-teste LIVE_PROXY_SECRET=x PUBLIC_ANALYTICS_SECRET=x
exec node .output/server/index.mjs
