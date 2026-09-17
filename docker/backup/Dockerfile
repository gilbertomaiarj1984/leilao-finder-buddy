# Fase 5 da migração para VPS (docs/economia-fase-2-vps-unico.md): backup noturno
# (pg_dump -> Cloudflare R2, S3-compatible). Base Alpine do próprio Postgres 17 já traz
# o `pg_dump` na versão certa para falar com o serviço `postgres` do compose.
FROM postgres:17-alpine

RUN apk add --no-cache bash tzdata py3-pip && \
    pip install --no-cache-dir --break-system-packages awscli

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
