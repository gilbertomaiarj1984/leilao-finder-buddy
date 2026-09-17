#!/usr/bin/env bash
# Fase 5 da migração para VPS (docs/economia-fase-2-vps-unico.md): dump noturno do
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
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    | gzip -9 > "$file"
  aws s3 cp "$file" "s3://${R2_BUCKET}/${file##*/}" --endpoint-url "$R2_ENDPOINT" --no-progress
  echo "[backup] concluído $ts"
}

# Loop simples (o container fica de pé o tempo todo) em vez de cron dentro do container —
# um serviço a menos pra instalar/manter na imagem.
while true; do
  dump_once || echo "[backup] falhou, tenta de novo no próximo ciclo" >&2
  sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
