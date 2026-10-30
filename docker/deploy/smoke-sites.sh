#!/usr/bin/env bash
# Confere, de fora (como um visitante), que cada site servido pelo Caddy do VPS responde com um dos códigos
# esperados. Rodado pelo deploy.yml depois do deploy (não bloqueia o deploy, só deixa o aviso no log) e
# utilizável à mão:
#
#   bash docker/deploy/smoke-sites.sh [arquivo]        # padrão: docker/deploy/smoke-sites.txt
#   APP_URL=https://meu-dominio bash docker/deploy/smoke-sites.sh
#
# Sai com 0 se todos responderam como esperado, 1 se algum falhou. Tenta de novo (o Caddy leva alguns
# segundos para servir um bloco recém-recarregado e emitir certificado novo).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
list="${1:-$here/smoke-sites.txt}"
tries="${SMOKE_TRIES:-6}"
wait_s="${SMOKE_WAIT:-10}"

targets=()
if [ -n "${APP_URL:-}" ]; then targets+=("${APP_URL%/}/api/health 200"); fi
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  targets+=("$line")
done < "$list"

fail=0
for t in "${targets[@]}"; do
  url="${t%% *}"; ok="${t#* }"; got=""
  for i in $(seq 1 "$tries"); do
    got="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$url" 2>/dev/null || true)"
    case ",$ok," in *",$got,"*) break ;; esac
    [ "$i" -lt "$tries" ] && sleep "$wait_s"
  done
  case ",$ok," in
    *",$got,"*) echo "OK    $url -> $got" ;;
    *) echo "FALHA $url -> ${got:-sem resposta} (esperado: $ok)"; fail=1 ;;
  esac
done
exit $fail
