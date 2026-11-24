# UI — Agendamentos de lance

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Agendamentos de lance (`/agendamentos`, v0.191.0)

**Criação pelo martelo** (`components/vinyl/lot-bid-schedule-button.tsx`): ícone de martelo ao lado do
olho (que passou a ser só ícone) nos cards do desktop, do celular e na Análise; abre um modal com o lote
alvo já preenchido (gatilho padrão = lote anterior, teto obrigatório, valor atual esperado opcional) e
mostra/cancela o agendamento já existente do lote. Sem número do lote ou sem pregão presencial, o
martelo fica desabilitado. Com agendamento `waiting` para o lote (mesma consulta `["bid-schedules"]`
compartilhada), o martelo fica AMARELO como o olho de "vigiando" (v0.191.1). Na lista, o item `waiting` mostra o `LiveLotNow` da casa (lote em pregão agora + "peça x de y · %", mesma consulta `["presencial-now", url]`). A tela `/agendamentos` (botão no cabeçalho; item no menu do celular) é a
LISTA de acompanhamento: agrupada por dia → casa (semáforo `HouseLight`), com editar/cancelar, modo
simulação/real e "Rodar agora". Código: `bid-schedule.ts` (regras puras, testadas em
`tests/bid-schedule.test.ts`), `bid-schedule.server.ts` (estado + acompanhamento + envio),
`bid-schedule.functions.ts` (server functions), `routes/_authenticated/agendamentos.tsx`.

- **Regra:** leilão + lote gatilho X + lote alvo Y + valor atual esperado Z (opcional) + teto W
  (obrigatório). Dispara quando o lote em pregão (`fetchPresencialNow`) é ≥ X e ≤ Y (se o pregão
  pular o X o disparo não se perde; passou de Y = `expired`). O lance é SEMPRE o próximo valor
  (`NOVO_VALOR`) e só sai se valor atual = Z (quando informado) e próximo ≤ W; já ganhando
  (`VENCENDO`, página lida logada) = não envia.
- **Estado:** `app_state.bid_schedules` via `mutateAppState`. Status: `waiting` → `firing`
  (reserva atômica na transação com `FOR UPDATE`, nunca volta) → `fired`/`simulated`/`skipped`/
  `failed`; `expired`/`cancelled`. Só `waiting` edita/cancela. Modo em `app_state.bid_schedule_live`
  (padrão false = SIMULAÇÃO: registra "teria enviado R$ X"). A tela liga o envio real com confirmação.
- **Envio (modelo novo das casas, ex.: Escafandro):** antes, `verifica_temcartela.asp?leilao=` deve
  devolver `1` (termos aceitos; o app não aceita termos). Depois GET
  `<casa>/modulos/lance/asp/fazerlance.asp` com `ValorMinimo`=`valor`=próximo lance, `ID`=idPeca,
  `IdLeilao`, `qtdlances`=`QTDLANCE`, `lanceautomatico=0`, `lanceclicado=1`, `vendaposflag=0`
  (campos do formulário `frmLancesDireto`). Resposta JSON: `NUM_ERRO` 0 ou 4 = aceito. UMA tentativa
  (`attempts: 1`); resposta incerta = `failed` ("confira no site"). Sessão por casa: `authFetchFor`.
- **Template ANTIGO (ex.: RT Leilões):** sem JSON `loadData`/`Lance.*`; formulário `frmLances` com
  POST em `peca.asp?ID=…` (campos `IdLeilao`, `IdPeca`, `ValorMinimo`, `lanceclicado`, `vold`,
  `valor`). `parseLivePeca` detecta o template (`new`/`old`/`null`); valor atual vem de
  `<span class="is-valor">`, próximo lance de `ValorMinimo`. O formato da resposta é desconhecido,
  então o sucesso é CONFIRMADO relendo a página (valor atual = lance). ⚠️ Envio real do template
  antigo ainda não exercitado (`lanceclicado` é repetido como veio da página). Página que não é de
  nenhum dos dois modelos = não envia e marca `failed`.
- **Lista (v0.191.2):** cancelados escondidos por padrão (`ui-state:agendamentos-cancelados`); clicar no agendamento abre `ScheduledLotDialog` (o `LotCard` completo; lote do banco por leilão + nº via `getScheduledLot`; dados do card em `useLotCardData`, compartilhado com `LookoutLotDialog`); a linha da casa tem o link "pregão presencial".
- **Login antecipado (v0.191.2):** com o pregão em andamento (`fetchPresencialNow` devolve lote) e o gatilho ainda por vir, `warmLogin` chama `ensureSessionFor(origem da casa)` (sessão em cache por casa, mesmo login automático do vigia/lance com `LEILOESBR_EMAIL`/`LEILOESBR_SENHA`) e grava na mensagem do agendamento se o login deu certo ou o erro; só grava quando muda.
- **Limpar e sacolas (v0.192.0):** o botão "Limpar (n)" marca `archived: true` em `expired`/`skipped`/`failed` (`archiveFinished`, puro); a lista principal esconde os guardados e eles aparecem em "Sacolas" (um `<details>` por tipo, com casa e dia em cada item). Nada é apagado; cancelados continuam no botão próprio.
- **Login em casa do modelo antigo (v0.191.3):** `performLogin` tenta o login da plataforma; se der 404 (Trem das 7), faz `POST /ajax/le_login_cliente.asp` com `campoeml`/`campopwd` e aceita resposta `0|id|nome` (outro número na frente = recusado). Sessão = `ASPSESSIONID` semeado por GET em `/default.asp`.

#### Login e lance nas casas: descobertas (v0.191.3)

Levantado em testes reais (Console/Network do Chrome do dono; o site bloqueia acesso automatizado com 403, não contornar). Cada casa pode ter páginas diferentes: sempre conferir o formulário/endpoint antes de assumir.

- **Login (sessão por origem):** cookie `ASPSESSIONID` só nasce num GET; por isso `seedSession` faz GET em `/default.asp` antes do POST. Dois modelos de login:
  - **Plataforma** (LeilõesBR, Escafandro, RT Leilões…): `POST {origem}/portal/assets/modulos/login/asp/login.asp`, campos `campoeml`, `campopwd`, `refererclick`, `AuthenticationMethod`; resposta JSON `{NUM_ERRO, MENSAGEM_ERRO}`.
  - **Modelo antigo (Trem das 7):** o caminho acima dá 404. O login é `POST {origem}/ajax/le_login_cliente.asp` (urlencoded, `campoeml`/`campopwd`, Referer `/login_site.asp`, `X-Requested-With: XMLHttpRequest`). Resposta de sucesso: texto `0|<nº da cartela>|<nome>` (ex.: `0|15357|Gilberto`; 15357 é a "minha cartela", fixa por usuário, não é senha nem sessão). Seta `Cliente=<nome>` (expira no dia seguinte) e a sessão ASP. Número diferente de 0 na frente = recusado. `/login_site.asp` não tem `<form>` (o login é por JS); logado, é a página da conta (`conta_site.asp`, `?l=out` desloga, `online.asp` é um ping periódico de "estou online").
  - O app tenta o login da plataforma e, se vier 404, cai no modelo antigo (`performLogin`).
- **Pregão da Trem das 7:** a página `presencial.asp?Num=<id>` consulta sem parar `le_registro_pregao_cfbr_v1.asp?i=<id>&j=<lote>&p=<n>`; o lote em pregão pode ser algo que o app não lista (ex.: revistas), então o gatilho é só um número (não precisa existir card). A casa está em `CATALOG_ONLY_HOSTS`: `peca.asp` pode não abrir por link direto.
- **Lance pela página da peça (antecipado, 1 lote antes do pregão):** modelo novo (Escafandro) usa `verifica_temcartela` (termos) e `fazerlance.asp` com `IdPeca`, `IdLeilao`, `ValorMinimo`, `qtdl`, `valor`; resposta `0` ou `4` = aceito. Modelo antigo (RT Leilões) faz POST do formulário em `peca.asp` e o app confirma relendo a página. Os valores vivos vêm de `parseLivePeca`; página que não for dos dois modelos = não envia, status Falhou.
- **Lance pelo presencial (alternativa):** a tela do pregão tem função própria de lance (`Fazerlance`) que depende de objetos da página (`novoPresencial`), logo não dá para chamá-la solta no Console; o app usa a página da peça.
- **Ainda NÃO validado contra o site:** envio real do lance (aceite no modelo novo, `lanceclicado` e formato da resposta no antigo); leitura da peça em casas só-catálogo; login antecipado na Trem das 7 com o novo caminho (testar com teto R$ 1,00 + "Rodar agora").
- **Operação:** acompanhamento automático só com `BID_SCHEDULER=1` no `.env` do VPS (precisa recriar o container do app); a preview usa o mesmo banco e nunca deve ligar isso.
- **Erro no disparo (v0.191.2):** exceção dentro de `processFired` vira `failed` com a ETAPA (`Progress.stage`: banco, login/leitura da página, termos, envio) e a mensagem do erro (200 caracteres); o stack vai para o log do servidor (`[bid-schedule] falha ao processar o disparo`).
- **Acompanhamento automático:** `ensureBidSchedulerStarted` (chamado em `server.ts`) só liga com
  `BID_SCHEDULER=1` no `.env` do VPS (ciclo de 15 s; o preview compartilha o banco e NÃO deve
  disparar). "Rodar agora" na tela executa um ciclo manual (útil no preview, em simulação).
