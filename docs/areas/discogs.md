# Discogs / preço de mercado (`lot_market`)

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Discogs / preço de mercado (`lot_market`)

- **API Discogs** (`api.discogs.com`, grátis; 60 req/min **com token** `DISCOGS_TOKEN`,
  opcional → no-op sem ele). `discogs.server.ts` sem SDK, `fetch` + **throttle ~1.1s**, parsing
  defensivo.
- **Casamento estruturado:** `parseAlbum` quebra o `album` da IA em `{artista, título, ano}`;
  `fetchMarket(album, title)` busca `artist=…&release_title=…&format=Vinyl&per_page=25` (cai
  para texto livre só se não achar); `pickBestRelease` pontua cobertura do álbum + artista +
  ano + vinil, **penaliza coletâneas** ("1967-1970"/"greatest hits") e **rejeita (null)** sem
  cobertura mínima (melhor não casar que casar errado).
- **Faixa BR (preço + frete):** a API oficial não dá faixa nem país/frete → **scraping da
  página de venda** `www.discogs.com/sell/release/<id>?ships_from=Brazil&currency=BRL&sort=price,asc`
  (`fetchBrListings` + `parseSellPage`, soma preço + frete por anúncio; `summarizeListings` →
  menor/maior total + contagem). Best-effort: se o HTML mudar, a faixa some (fallback no
  `stats`).
- **Persistência** `lot-market.server.ts`, tabela `lot_market`, cache por `basis`
  (hash `album||título`; `matched=false` não reconsulta). Colunas BR
  `price_low_br`/`price_high_br`/`num_for_sale_br`; `getAllLotMarket`/`upsertLotMarket`
  **toleram coluna ausente** (`isMissingColumn`, código `42703`/`PGRST204`) e caem para as
  colunas base. Cron `step=market`.
- **Reprocessar:** o `basis` não muda, então matches errados já gravados **não** são
  reconsultados sozinhos → `DELETE FROM lot_market` (ou só os suspeitos) e rodar o `refresh.yml`.
