---
name: validar-caddyfile
description: Valida o Caddyfile (sintaxe e roteamento) antes de qualquer push. Use sempre que editar Caddyfile, docker/ do caddy ou sites/*.caddy neste repo.
---

# Validar Caddyfile antes do push

O `deploy.yml` aplica o Caddyfile direto em produção a cada push na `main`; um arquivo inválido já derrubou produção duas vezes. Contexto: `docs/areas/infra.md` ("Editar o Caddyfile com segurança").

1. **Baixar o binário oficial** (não precisa de Docker), em uma pasta temporária:

   ```sh
   mkdir -p /tmp/caddy && cd /tmp/caddy
   curl -fsSL -o caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz"
   tar xzf caddy.tar.gz caddy
   ```

   (Usar a versão do `Caddyfile`/`docker-compose.yml`, se diferir.)

2. **Validar a sintaxe**, com as variáveis de ambiente que o Caddyfile usa na frente do comando (veja `grep -n '{\$' Caddyfile`):

   ```sh
   VAR=valor /tmp/caddy/caddy validate --config Caddyfile --adapter caddyfile
   ```

   Deve terminar com `Valid configuration`.

3. **Se mexeu em matcher, expressão ou roteamento**, teste de verdade: ponha `http_port`/`https_port` alternativos no bloco global (numa cópia do arquivo) e rode `caddy run --config <cópia> --adapter caddyfile`, depois `curl` nas rotas afetadas.

4. **Não remover** o `caddy reload` do `deploy.yml`.

Só faça o push depois que o passo 2 (e o 3, quando couber) passar.
