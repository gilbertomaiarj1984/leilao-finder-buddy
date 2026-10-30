#!/usr/bin/env bash
# Roda NO VPS (copiado e chamado por .github/workflows/deploy.yml). Ordem pensada para um deploy
# que não deixa o app novo falar com um schema meio migrado:
#   1. grava as tags das imagens no .env (um `docker compose up` manual depois não volta a :latest);
#   2. puxa as imagens e sobe só o Postgres, esperando ficar saudável;
#   3. faz um dump de segurança (`backups/pre-deploy-*.sql.gz`, guarda os 5 últimos);
#   4. aplica supabase/setup.sql numa ÚNICA transação com lock_timeout (falha no meio = nada muda,
#      e o app antigo segue no ar);
#   5. só então sobe o resto (app novo) e recarrega o Caddy.
# Antes de tudo (passo 0) o Caddyfile NOVO, já copiado pelo deploy.yml (o anterior fica em Caddyfile.prev),
# é validado junto com sites/ no mesmo container/volumes/env do Caddy real: config inválida aborta o deploy
# sem tocar em nenhum serviço e devolve o Caddyfile anterior — um restart do host nunca cai num crash-loop
# do Caddy que derrubaria TODOS os sites do VPS (garimpo, AgendaBoa, pdf, painel de preços).
# Entradas: APP_IMAGE e BACKUP_IMAGE no ambiente.
set -euo pipefail
cd "$(dirname "$0")"

: "${APP_IMAGE:?defina APP_IMAGE}"
: "${BACKUP_IMAGE:?defina BACKUP_IMAGE}"
export APP_IMAGE BACKUP_IMAGE

touch .env
sed -i '/^APP_IMAGE=/d;/^BACKUP_IMAGE=/d' .env
[ -z "$(tail -c1 .env)" ] || echo >> .env
printf 'APP_IMAGE=%s\nBACKUP_IMAGE=%s\n' "$APP_IMAGE" "$BACKUP_IMAGE" >> .env

# Passo 0: valida o Caddyfile + sites/ ANTES de qualquer outra coisa. O storage do Caddy vai para /tmp do
# container descartável (XDG_*): a validação não toca nos certificados do volume `caddy_data`.
mkdir -p sites
if ! docker compose run --rm --no-deps -T \
    -e XDG_DATA_HOME=/tmp/caddy-validate-data -e XDG_CONFIG_HOME=/tmp/caddy-validate-config \
    caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  echo "Caddyfile/sites inválido: deploy abortado antes de mexer em qualquer serviço" >&2
  if [ -f Caddyfile.prev ]; then
    # `cat >` (e não mv/cp): mantém o inode que o container do Caddy enxerga no bind mount.
    cat Caddyfile.prev > Caddyfile
    echo "Caddyfile anterior restaurado (Caddyfile.prev)" >&2
  fi
  exit 1
fi

docker compose pull
docker compose up -d --wait postgres

mkdir -p backups
dump="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$dump"
if [ "$(stat -c %s "$dump")" -lt 2048 ]; then
  echo "dump pré-deploy suspeito (menos de 2 KB), abortando antes de migrar" >&2
  rm -f "$dump"
  exit 1
fi
ls -1t backups/pre-deploy-*.sql.gz | tail -n +6 | xargs -r rm -f

docker compose exec -T -e PGOPTIONS="-c lock_timeout=5s" postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f /docker-entrypoint-initdb.d/01-setup.sql'

docker compose up -d --remove-orphans
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "deploy concluído: $APP_IMAGE"
