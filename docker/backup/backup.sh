#!/usr/bin/env bash
# Fase 5 da migração para VPS (docs/arquivo/economia-fase-2-vps-unico.md): dump noturno do
# Postgres -> Cloudflare R2 (S3-compatible). Retenção de 14 dias é uma REGRA DE LIFECYCLE
# no bucket do R2 (configurada uma vez no painel/API da Cloudflare) — este script só
# manda o dump; não apaga nada, então nunca corre o risco de podar backup por engano.
set -euo pipefail

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:?defina POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}"
: "${POSTGRES_DB:?defina POSTGRES_DB}"
: "${R2_ENDPOINT:?defina R2_ENDPOINT (ex.: https://<account_id>.r2.cloudflarestorage.com)}"
: "${R2_BUCKET:?defina R2_BUCKET}"
: "${BACKUP_INTERVAL_HOURS:=24}"
# Um dump de um banco real tem alguns KB mesmo vazio; abaixo disso algo deu errado.
: "${MIN_DUMP_BYTES:=2048}"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?defina R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?defina R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION=auto

dump_once() {
  local ts file
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/tmp/garimpo-${ts}.sql.gz"
  # RETURN (não só o fim normal da função) garante a limpeza mesmo se o `aws s3 cp`
  # falhar no meio — senão o .sql.gz fica pra sempre no /tmp do container de vida longa.
  trap 'rm -f "$file"' RETURN
  echo "[backup] iniciando dump $ts"
  # Dentro de `dump_once || ...` o `set -e` fica desligado, então o status do pipeline precisa ser
  # checado na mão: sem isto, um `pg_dump` que falha deixa um .gz truncado que subiria ao R2 como o
  # backup mais recente.
  local pipe_status
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    | gzip -9 > "$file"
  pipe_status=("${PIPESTATUS[@]}")
  if [ "${pipe_status[0]}" -ne 0 ] || [ "${pipe_status[1]}" -ne 0 ]; then
    echo "[backup] pg_dump/gzip falhou (status ${pipe_status[*]}), nada enviado" >&2
    return 1
  fi
  if ! gzip -t "$file"; then
    echo "[backup] gzip -t reprovou o dump, nada enviado" >&2
    return 1
  fi
  local size
  size="$(stat -c %s "$file")"
  if [ "$size" -lt "$MIN_DUMP_BYTES" ]; then
    echo "[backup] dump com só $size bytes (mínimo $MIN_DUMP_BYTES), nada enviado" >&2
    return 1
  fi
  aws s3 cp "$file" "s3://${R2_BUCKET}/${file##*/}" --endpoint-url "$R2_ENDPOINT" --no-progress || return 1
  echo "[backup] concluído $ts ($size bytes)"
  # Ping de sucesso (opcional): o healthchecks.io avisa quando o backup DEIXA de chegar.
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    curl -fsS --retry 2 --max-time 10 "$BACKUP_PING_URL" >/dev/null || true
  fi
}

# Loop simples (o container fica de pé o tempo todo) em vez de cron dentro do container —
# um serviço a menos pra instalar/manter na imagem.
while true; do
  dump_once || echo "[backup] falhou, tenta de novo no próximo ciclo" >&2
  sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
