# croche-search-crawler (Cloudflare Worker)

Worker independente que mantém a base D1 (`tutoriais-croche`) enriquecida em
segundo plano, via Cron Trigger — sem depender de uma requisição de usuário
disparando a busca (que é como a API funciona hoje).

## Por que isso existe

Hoje, toda leitura/escrita no D1 feita pela API (`api-croche-search`) passa
pela REST API pública da Cloudflare (`api.cloudflare.com/.../d1/database/.../query`),
um round-trip HTTPS completo por chamada. Persistir um lote grande de resultados
(ex: uma busca com `provedor=mix`) significa dezenas de chamadas sequenciais —
foi exatamente isso que causou o timeout de persistência (`aborted due to
timeout`) visto em produção.

Este Worker roda **dentro** da rede da Cloudflare com um **binding nativo de
D1** (`env.DB`), e usa `db.batch([...])` para gravar todos os lotes de uma
consulta numa única viagem de rede, independente do volume.

## Arquitetura: fila no D1, uma query por invocação

**Isto não é opcional, é uma correção de um problema real observado em
produção.** A primeira versão deste worker tentava processar várias queries
num só disparo (cron ou `/run`), delegando o trabalho de fundo pro
`ctx.waitUntil()`. Um teste real mostrou isto no log:

```
"waitUntil() tasks did not complete within the allowed time after
invocation end and have been cancelled."
```

O Cloudflare mata tarefas de `waitUntil()` que não terminam em ~30 segundos
após a resposta ser enviada — não importa o quanto o cron rode em segundo
plano, esse teto é da plataforma, não configurável pelo `wrangler.toml`.
Qualquer ciclo com várias queries sequenciais (Pinterest + ValueSerp, várias
páginas cada) estoura isso quase sempre.

A correção: uma tabela `CRAWL_QUEUE` no próprio D1 guarda a fila de queries
pendentes. **Cada invocação (cron ou `/run`) processa UM único item da fila**
e espera terminar antes de responder — sem `waitUntil()` pra trabalho que
importa, só o suficiente pra caber com folga no tempo de uma resposta HTTP
normal. Quando a fila esvazia, a próxima invocação recarrega automaticamente
com um novo lote derivado de `SEARCH_RESULTS`. O cron, rodando a cada poucos
minutos, é o que faz a fila avançar ao longo do tempo — não uma única
execução monolítica.

## Isolamento de propósito

Este worker é **totalmente autocontido num único arquivo**, `worker.js`.
Nada fora de `workers/crawler/` foi alterado. Toda a lógica que ele precisa
(dedupe, rank, normalização de URL/texto, providers de Pinterest e ValueSerp,
persistência) foi **portada/duplicada** para dentro desse arquivo a partir do
código já existente em `../../src/`, não importada de lá. Isso foi uma
escolha deliberada — trade-off:

- **Vantagem**: zero risco de quebrar a API; deploy do worker é 100%
  independente; um único arquivo é tudo que o Cloudflare Worker precisa.
- **Risco a monitorar**: lógica duplicada pode divergir com o tempo. Se você
  corrigir um bug de dedupe/rank/persistência na API (`src/`), replique aqui
  também. Cada seção de `worker.js` tem um comentário indicando de qual
  arquivo da API foi portada, pra facilitar comparar.

## De onde vêm as queries que o cron mantém atualizadas

`SEARCH_QUERIES` (tabela que logaria buscas de usuários) existe no schema mas
nada no código da API grava nela hoje. Em vez de depender disso,
`deriveTrackedQueries()` deriva os termos a partir do que **já existe** em
`SEARCH_RESULTS`:

1. Lê uma amostra recente de títulos/tags já persistidos.
2. Extrai bigramas/trigramas de títulos, e tags individuais, que contenham um
   marcador de domínio (crochê/crochet/amigurumi/etc) — termos genéricos
   (`general`, `yarn` solto, etc.) são descartados mesmo que apareçam como
   tag, pra não poluir a fila com buscas irrelevantes.
3. Completa com uma lista-semente pequena de queries fixas quando o banco
   ainda tem pouco dado (garante que o primeiro deploy, com banco raso, não
   fique sem nada pra fazer).

`TRACKED_QUERIES_LIMIT` tem um teto de segurança de 20 no código
(`MAX_TRACKED_QUERIES_LIMIT`), mesmo que a variável de ambiente venha
configurada com um valor maior por engano.

## Deploy

```bash
cd workers/crawler
npm install
npx wrangler login          # uma vez, se ainda não estiver autenticado
npx wrangler secret put VALUESERP_API_KEY
npx wrangler secret put WORKER_ADMIN_KEY   # opcional, protege o endpoint manual /run
npx wrangler deploy
```

O binding D1 (`tutoriais-croche`, mesmo banco usado pela API) e as variáveis
de configuração já estão declaradas em `wrangler.toml`. O cron padrão roda a
cada 2 minutos (`*/2 * * * *`) — como cada tick processa só uma query, isso
gira um lote de 5 queries em ~10 minutos. Ajuste conforme a cota do
ValueSerp e a frequência que fizer sentido.

## Testar localmente sem esperar o cron

```bash
npx wrangler dev
# noutro terminal, dispare manualmente (processa 1 item da fila e responde):
curl "http://127.0.0.1:8787/run?key=SEU_WORKER_ADMIN_KEY"

# ver quantos itens estão pending/done/failed na fila:
curl "http://127.0.0.1:8787/queue"
```

Ou simule o disparo do cron diretamente:

```bash
npx wrangler dev --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*/2+*+*+*+*"
```

## Observabilidade

`npx wrangler tail` (ou "Real-time Logs" no dashboard) mostra os logs em
tempo real — cada etapa (derivação de queries, cada página de Pinterest/
ValueSerp, persistência) loga o que está fazendo. `/run` responde com o
resultado do item processado nessa chamada; `/queue` mostra a contagem por
status (`pending`/`done`/`failed`) — útil pra ver o progresso sem vasculhar
logs.

