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

## Vigiar sincronizado com o LeilõesBR

- Cada card tem um botão "Vigiar" que grava o lote na SUA conta do LeilõesBR, usando
  login feito no servidor com suas credenciais guardadas como segredos do projeto
  (`LEILOESBR_EMAIL` e `LEILOESBR_SENHA`) — nunca expostas ao navegador.
- Fluxo no servidor: POST em `portal/assets/modulos/login/asp/login.asp`, guarda o
  cookie de sessão ASP em memória e o reutiliza; se a sessão expirar, refaz o login
  automaticamente e repete a ação uma vez.
- Botão alterna vigiar/desvigiar e mostra estado de carregando. Se a gravação no
  LeilõesBR falhar, aparece um erro claro e o lote **não** é marcado no app — as duas
  listas nunca ficam divergentes (conforme sua escolha).
- Aba "Vigiados" lê a lista real da sua conta no LeilõesBR (página de vigiados do
  portal, raspada com a mesma sessão), com contador no topo e opção de desvigiar dali.
- Não guardo lista local nem duplicada: a fonte da verdade é a sua conta no site.

## Detalhes técnicos

- `src/lib/leiloesbr.functions.ts` — `createServerFn` com o scraper de busca, parser e
  cache de listagem.
- `src/lib/leiloesbr-auth.server.ts` — login, cache do cookie de sessão, `fetch`
  autenticado com re-login automático.
- `src/lib/leiloesbr-watch.functions.ts` — server functions `toggleWatch` e
  `listWatched`, que só rodam server-side e devolvem DTOs simples.
- `src/lib/vinyl-parse.ts` — funções puras de classificação (vinil sim/não, extração de
  artista, normalização de data) para manter os server fns enxutos.
- `src/routes/index.tsx` — página com abas de dia + aba Vigiados, blocos por casa,
  grupos por artista, estados de carregando/vazio/erro, e `head()` próprio.
- Vigiar usa `useMutation` + invalidação da query de vigiados; toasts via sonner.
- Componentes shadcn (Tabs, Card, Badge, Button, Skeleton) e tokens do design system.
- Sem banco de dados: scraping ao vivo com cache curto e vigiar direto na sua conta.

## Primeiro passo da implementação

O botão de vigiar do site só aparece para usuário logado, então o endpoint exato de
vigiar precisa ser descoberto com uma sessão real. Ao começar, vou pedir suas
credenciais pelo formulário seguro de segredos, fazer o login pelo servidor,
identificar a chamada de vigiar/desvigiar e a página de vigiados, e então implementar.
Se o login exigir algo que não dá para automatizar (captcha, 2FA, bloqueio), eu paro e
te aviso antes de seguir.

## Limitações

- Depende do HTML e do fluxo de login atuais do LeilõesBR; mudanças no site exigem
  ajuste no scraper ou no login.
- A identificação de artista é heurística — títulos mal escritos cairão na seção
  "não classificado".
- A varredura faz várias requisições ao site por atualização; o cache existe para
  manter o uso leve e responsável.
- Como as credenciais são do projeto, qualquer pessoa que acessar o app publicado
  vigiaria na sua conta. Recomendo manter o app privado ou, depois, adicionar login
  próprio com Lovable Cloud.
