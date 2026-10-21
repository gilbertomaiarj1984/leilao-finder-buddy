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
# Fotos da Coleção (volume `collection_data`, montado só leitura): não existem em nenhum outro lugar.
: "${COLLECTION_DIR:=/data/collection}"
# Se o dump falhar (ex.: Postgres ainda subindo depois de um deploy), tenta de novo em vez de esperar 24 h.
: "${BACKUP_RETRIES:=3}"
: "${BACKUP_RETRY_SECONDS:=600}"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?defina R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?defina R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION=auto

dump_once() {
  local ts file
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/tmp/garimpo-${ts}.sql.gz"
  # RETURN (não só o fim normal da função) garante a limpeza mesmo se o `aws s3 cp`
  # falhar no meio — senão o .sql.gz fica pra sempre no /tmp do container de vida longa.
  # O trap RETURN não é local à função: sem o `trap - RETURN` ele dispararia de novo no retorno de
  # `run_backup`/`sync_photos`, com `$file` já fora de escopo (`set -u` derrubava o ciclo).
  trap 'rm -f "${file:-}"; trap - RETURN' RETURN
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
}

# Envia as fotos novas da Coleção para o R2 (`sync` só acrescenta; nada é apagado no bucket).
# Os arquivos têm nome UUID e nunca mudam depois de gravados, então o sync incremental é barato.
sync_photos() {
  [ -d "$COLLECTION_DIR" ] || return 0
  echo "[backup] sincronizando fotos da Coleção"
  aws s3 sync "$COLLECTION_DIR" "s3://${R2_BUCKET}/collection/" --endpoint-url "$R2_ENDPOINT" --no-progress
}

# Um ciclo completo: dump do banco + fotos. O ping de sucesso só sai se os dois deram certo.
run_backup() {
  dump_once || return 1
  sync_photos || { echo "[backup] sync das fotos falhou" >&2; return 1; }
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    curl -fsS --retry 2 --max-time 10 "$BACKUP_PING_URL" >/dev/null || true
  fi
}

# Loop simples (o container fica de pé o tempo todo) em vez de cron dentro do container —
# um serviço a menos pra instalar/manter na imagem.
while true; do
  attempt=1
  until run_backup; do
    if [ "$attempt" -ge "$BACKUP_RETRIES" ]; then
      echo "[backup] falhou $attempt vezes, tenta de novo no próximo ciclo" >&2
      break
    fi
    echo "[backup] falhou (tentativa $attempt de $BACKUP_RETRIES), nova tentativa em ${BACKUP_RETRY_SECONDS}s" >&2
    attempt=$((attempt + 1))
    sleep "$BACKUP_RETRY_SECONDS"
  done
  sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
