#!/usr/bin/env bash
# Testa docker/deploy/remote-deploy.sh com um `docker` FALSO: ordem (Postgres → dump → migração → app),
# .env com as tags, aborto quando o dump falha ou é pequeno e rotação dos 5 últimos dumps.
# Uso: bash tools/local-tests/remote-deploy.sh
set -u
here="$(cd "$(dirname "$0")/../.." && pwd)"
t="$(mktemp -d)"; mkdir -p "$t/bin" "$t/dep"; cp "$here/docker/deploy/remote-deploy.sh" "$t/dep/"
cat > "$t/bin/docker" <<'D'
#!/bin/bash
echo "docker $*" >> "$T_LOG"
if [[ "$*" == *pg_dump* ]]; then head -c "${FAKE_DUMP_BYTES:-6000}" /dev/urandom | base64; [ "${FAKE_DUMP_FAIL:-0}" = 1 ] && exit 1; fi
exit 0
D
chmod +x "$t/bin/docker"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado '$3', veio '$2')"; fail=1; fi; }
deploy() { : > "$t/log"; rm -rf "$t/dep/backups"; printf 'A=1\nAPP_IMAGE=old' > "$t/dep/.env"
  (cd "$t/dep" && env T_LOG="$t/log" PATH="$t/bin:$PATH" APP_IMAGE=ghcr.io/x:abc BACKUP_IMAGE=ghcr.io/y:abc "$@" bash remote-deploy.sh >/dev/null 2>&1); echo $?; }
rc="$(deploy FAKE_DUMP_BYTES=6000)"
check "deploy normal termina bem" "$rc" 0
check ".env troca só as tags e mantém o resto" "$(tr '\n' ' ' < "$t/dep/.env")" "A=1 APP_IMAGE=ghcr.io/x:abc BACKUP_IMAGE=ghcr.io/y:abc "
check "ordem: postgres, dump, migração, resto" "$(grep -o 'up -d --wait postgres\|pg_dump\|setup.sql\|up -d --remove-orphans' "$t/log" | tr '\n' ' ')" "up -d --wait postgres pg_dump setup.sql up -d --remove-orphans "
rc="$(deploy FAKE_DUMP_BYTES=10)"
check "dump pequeno aborta antes de migrar" "$rc $(grep -c setup.sql "$t/log")" "1 0"
rc="$(deploy FAKE_DUMP_FAIL=1)"
check "pg_dump que falha aborta antes de migrar" "$rc $(grep -c setup.sql "$t/log")" "1 0"
mkdir -p "$t/dep/backups"; for i in 1 2 3 4 5 6 7; do touch -d "2026-01-0$i" "$t/dep/backups/pre-deploy-2026010${i}T000000Z.sql.gz"; done
(cd "$t/dep" && env T_LOG="$t/log" PATH="$t/bin:$PATH" APP_IMAGE=a:b BACKUP_IMAGE=c:d bash remote-deploy.sh >/dev/null 2>&1)
check "guarda só os 5 dumps mais recentes" "$(ls "$t/dep/backups" | wc -l | tr -d ' ')" 5
rm -rf "$t"; exit $fail
