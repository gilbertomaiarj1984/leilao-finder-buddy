# Fase 4 da migração para VPS (docs/economia-fase-2-vps-unico.md): build multi-stage.
# SERVER_PRESET=node-server (vite.config.ts:9 já honra a env, sem tocar em código) faz o
# Nitro gerar `.output/server` já com um `node_modules` próprio, rastreado por dependência
# (inclui o binário nativo do `sharp` para a plataforma do build) — não precisa reinstalar
# nada na imagem final, só copiar o `.output`.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
ENV SERVER_PRESET=node-server
RUN bun run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
