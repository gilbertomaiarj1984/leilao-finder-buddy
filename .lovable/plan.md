# Vitrine de Discos de Vinil em Leilão (próximos 3 dias)

## O que será construído

Uma página única que varre a categoria "Disco de Vinil" do LeilõesBR e mostra apenas
lotes de vinil (LP, Disco de Vinil, Compacto) dos próximos 3 dias de leilão, com
navegação por dia e agrupamento por Casa de Leilão e Artista.

```text
[ Hoje 20/08 ]  [ 21/08 ]  [ 22/08 ]        (abas de dia)

  Leo Antiguidade e coleções · 19:30h · MG
    ├─ Roberto Carlos            (3 lotes)
    ├─ Beatles                   (1 lote)
    └─ Novelas / Coletâneas / Não classificado  (7 lotes)

  Antonio Ferreira Leiloeiro · 20h · RJ
    └─ ...
```

Cada lote aparece como card: imagem, título completo, preço, horário, UF e link
"Ver no site" abrindo a peça no LeilõesBR.

## O que já foi verificado na fonte

- A URL da categoria responde HTML público, sem login e sem JavaScript — o conteúdo
  vem renderizado pelo servidor, então é raspável com `fetch`.
- Cada lote é um card com título, preço (`R$ ...`), linha `dd/m/aaaa - HHh - UF` e link
  da casa de leilão.
- A listagem aceita `v=126` (126 itens por página) e `pag=N`, e o ordenador
  `op=2` traz os leilões de hoje e `op=3` os próximos, em ordem decrescente de data —
  ou seja, os dias mais próximos ficam nas últimas páginas (hoje há ~99 páginas).

## Como a varredura vai funcionar

1. Uma server function `getVinylLots()` calcula a janela de 3 dias (hoje + 2).
2. Busca `op=2` (leilões de hoje) e depois percorre `op=3` a partir da última página
   para trás, em lotes paralelos pequenos, parando assim que as datas saem da janela
   de 3 dias. Limite de segurança de páginas para não varrer o site inteiro.
3. Filtra apenas títulos de vinil: contêm `LP`, `DISCO(S) DE VINIL`, `VINIL`,
   `COMPACTO`, `BOLACHA` (e descarta CD/DVD/fita).
4. Faz o parse com `node-html-parser`, deduplica por ID do lote e devolve DTOs simples.
5. Resultado fica em cache no servidor por ~15 minutos (memória) e no cliente via
   TanStack Query, para não repetir a varredura em cada acesso.

## Regras de agrupamento

- **Dia**: pela data do leilão; abas com "Hoje", "Amanhã" e a terceira data.
- **Casa de leilão**: nome + horário + UF como cabeçalho de bloco.
- **Artista**: heurística sobre o título — remove prefixos (`LP`, `DISCO DE VINIL`,
  `COMPACTO`, `VINIL`, `LOTE`, numerações) e usa o trecho antes de `-`/`–`/`"`
  como artista, normalizando maiúsculas/acentos para agrupar variações.
- **Seção especial "Novelas, coletâneas e não classificados"**: títulos com
  `novela`, `trilha sonora`, `coletânea`, `sucessos`, `vol.`, `internacional`,
  `lote com`, ou sem artista identificável.
- Dentro de cada casa, artistas em ordem alfabética; a seção especial sempre por último.

## Detalhes técnicos

- `src/lib/leiloesbr.functions.ts` — `createServerFn` com o scraper, parser e cache.
- `src/lib/vinyl-parse.ts` — funções puras de classificação (vinil sim/não, extração de
  artista, normalização de data) para manter o server fn enxuto.
- `src/routes/index.tsx` — página com abas de dia, blocos por casa, grupos por artista,
  estados de carregando/vazio/erro, e `head()` próprio com título e descrição.
- Componentes shadcn (Tabs, Card, Badge, Skeleton) e tokens de cor do design system.
- Sem banco de dados; tudo ao vivo com cache curto.

## Limitações

- Depende do HTML atual do LeilõesBR; mudanças de layout exigem ajuste no parser.
- A identificação de artista é heurística — títulos mal escritos cairão na seção
  "não classificado".
- A varredura faz várias requisições ao site por atualização; o cache existe para
  manter o uso leve e responsável.
