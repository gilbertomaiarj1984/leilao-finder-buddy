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
if [[ "$*" == *"caddy validate"* ]] && [ "${FAKE_CADDY_INVALID:-0}" = 1 ]; then echo "Error: adapting config: ambiguous site definition" >&2; exit 1; fi
if [[ "$*" == *pg_dump* ]]; then head -c "${FAKE_DUMP_BYTES:-6000}" /dev/urandom | base64; [ "${FAKE_DUMP_FAIL:-0}" = 1 ] && exit 1; fi
exit 0
D
chmod +x "$t/bin/docker"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado '$3', veio '$2')"; fail=1; fi; }
deploy() { : > "$t/log"; rm -rf "$t/dep/backups"; printf 'A=1\nAPP_IMAGE=old' > "$t/dep/.env"
  echo NOVO > "$t/dep/Caddyfile"; echo ANTERIOR > "$t/dep/Caddyfile.prev"
  (cd "$t/dep" && env T_LOG="$t/log" PATH="$t/bin:$PATH" APP_IMAGE=ghcr.io/x:abc BACKUP_IMAGE=ghcr.io/y:abc "$@" bash remote-deploy.sh >/dev/null 2>&1); echo $?; }
rc="$(deploy FAKE_DUMP_BYTES=6000)"
check "deploy normal termina bem" "$rc" 0
check ".env troca só as tags e mantém o resto" "$(tr '\n' ' ' < "$t/dep/.env")" "A=1 APP_IMAGE=ghcr.io/x:abc BACKUP_IMAGE=ghcr.io/y:abc "
check "ordem: postgres, dump, migração, resto" "$(grep -o 'up -d --wait postgres\|pg_dump\|setup.sql\|up -d --remove-orphans' "$t/log" | tr '\n' ' ')" "up -d --wait postgres pg_dump setup.sql up -d --remove-orphans "
rc="$(deploy FAKE_DUMP_BYTES=10)"
check "dump pequeno aborta antes de migrar" "$rc $(grep -c setup.sql "$t/log")" "1 0"
rc="$(deploy FAKE_DUMP_FAIL=1)"
check "pg_dump que falha aborta antes de migrar" "$rc $(grep -c setup.sql "$t/log")" "1 0"
rc="$(deploy FAKE_DUMP_BYTES=6000)"
check "Caddyfile válido: valida ANTES do Postgres e segue" "$(grep -n 'caddy validate\|up -d --wait postgres' "$t/log" | sed 's/:.*\(caddy validate\|up -d --wait postgres\).*/ \1/' | tr '\n' ';')" "1 caddy validate;3 up -d --wait postgres;"
check "Caddyfile válido continua o novo" "$(cat "$t/dep/Caddyfile")" "NOVO"
check "validação usa storage isolado (não toca nos certificados)" "$(grep -c 'XDG_DATA_HOME=/tmp/caddy-validate-data' "$t/log")" 1
rc="$(deploy FAKE_CADDY_INVALID=1)"
check "Caddyfile inválido: aborta (rc 1)" "$rc" 1
check "Caddyfile inválido: nenhum serviço é tocado (sem pull/up/dump/migração)" "$(grep -c 'pull\|up -d\|pg_dump\|setup.sql\|caddy reload' "$t/log")" 0
check "Caddyfile inválido: volta ao anterior" "$(cat "$t/dep/Caddyfile")" "ANTERIOR"
check "cria sites/ para o bind mount não nascer root" "$([ -d "$t/dep/sites" ] && echo sim)" "sim"
mkdir -p "$t/dep/backups"; for i in 1 2 3 4 5 6 7; do touch -d "2026-01-0$i" "$t/dep/backups/pre-deploy-2026010${i}T000000Z.sql.gz"; done
(cd "$t/dep" && env T_LOG="$t/log" PATH="$t/bin:$PATH" APP_IMAGE=a:b BACKUP_IMAGE=c:d bash remote-deploy.sh >/dev/null 2>&1)
check "guarda só os 5 dumps mais recentes" "$(ls "$t/dep/backups" | wc -l | tr -d ' ')" 5
rm -rf "$t"; exit $fail
