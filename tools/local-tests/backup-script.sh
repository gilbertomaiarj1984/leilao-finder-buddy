#!/usr/bin/env bash
# Testa docker/backup/backup.sh com pg_dump/aws/curl FALSOS (sem banco nem R2): o dump que falha,
# o dump minúsculo e o dump bom, mais o sync das fotos. Não roda no CI; uso: bash tools/local-tests/backup-script.sh
set -u
here="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"; mkdir -p "$tmp/bin" "$tmp/photos"; echo foto > "$tmp/photos/a.webp"
cat > "$tmp/bin/aws" <<'AWS'
#!/bin/sh
echo "aws $*" >> "$T_LOG"
[ "${AWS_FAIL:-}" = "1" ] && exit 1
exit 0
AWS
cat > "$tmp/bin/curl" <<'CURL'
#!/bin/sh
echo "curl $*" >> "$T_LOG"
CURL
chmod +x "$tmp/bin/aws" "$tmp/bin/curl"
# Mesmo script, só sem o laço infinito: roda UM ciclo (`run_backup`) e imprime o resultado.
sed 's|^while true; do|while false; do|' "$here/docker/backup/backup.sh" > "$tmp/b.sh"
echo 'run_backup && echo RESULT=ok || echo RESULT=falhou' >> "$tmp/b.sh"
fail=0
run() { # $1 nome, $2 comportamento do pg_dump, $3 esperado, $4 chamadas aws esperadas, $5 ping esperado, $6 env extra
  printf '#!/bin/sh\n%s\n' "$2" > "$tmp/bin/pg_dump"; chmod +x "$tmp/bin/pg_dump"
  : > "$tmp/log"
  out="$(env T_LOG="$tmp/log" PATH="$tmp/bin:$PATH" POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d \
    R2_ENDPOINT=e R2_BUCKET=b R2_ACCESS_KEY_ID=a R2_SECRET_ACCESS_KEY=s MIN_DUMP_BYTES=100 \
    COLLECTION_DIR="$tmp/photos" BACKUP_PING_URL=http://ping ${6:-} bash "$tmp/b.sh" 2>&1)"
  got="$(echo "$out" | grep -o 'RESULT=.*')"; aws_n="$(grep -c '^aws ' "$tmp/log")"; ping_n="$(grep -c 'http://ping' "$tmp/log")"
  if [ "$got" = "RESULT=$3" ] && [ "$aws_n" = "$4" ] && [ "$ping_n" = "$5" ]; then echo "PASS  $1"; else echo "FAIL  $1 (resultado=$got aws=$aws_n ping=$ping_n)"; echo "$out" | tail -3; fail=1; fi
}
run "pg_dump que falha não envia nada" 'head -c 5000 /dev/urandom | base64; exit 1' falhou 0 0
run "dump minúsculo não é enviado" 'echo x; exit 0' falhou 0 0
run "dump bom sobe o dump e sincroniza as fotos, e só então pinga" 'head -c 5000 /dev/urandom | base64; exit 0' ok 2 1
run "falha do sync das fotos reprova o ciclo e não pinga" 'head -c 5000 /dev/urandom | base64; exit 0' falhou 1 0 "AWS_FAIL=1"
rm -rf "$tmp"
exit $fail
