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
consulta numa única viagem de rede, independente do volume. E por rodar via
Cron (não via requisição HTTP de usuário), não existe timeout de gateway
esperando resposta — o trabalho pode demorar o quanto precisar.

## Isolamento de propósito

Este worker é **totalmente autocontido** dentro de `workers/crawler/`. Nada
fora desta pasta foi alterado. Toda a lógica que ele precisa (dedupe, rank,
normalização de URL/texto, providers de Pinterest e ValueSerp, persistência)
foi **portada/duplicada** aqui a partir do código já existente em
`../../src/`, não importada de lá. Isso foi uma escolha deliberada — trade-off:

- **Vantagem**: zero risco de quebrar a API; deploy do worker é 100%
  independente.
- **Risco a monitorar**: lógica duplicada pode divergir com o tempo. Se você
  corrigir um bug de dedupe/rank/persistência na API (`src/`), replique aqui
  também. Os arquivos citam explicitamente de qual arquivo da API foram
  portados, pra facilitar comparar.

## De onde vêm as queries que o cron mantém atualizadas

`SEARCH_QUERIES` (tabela que logaria buscas de usuários) existe no schema mas
nada no código da API grava nela hoje. Em vez de depender disso, `src/queries.js`
deriva os termos a partir do que **já existe** em `SEARCH_RESULTS`:

1. Lê uma amostra recente de títulos/tags já persistidos.
2. Extrai bigramas/trigramas que contenham um marcador de domínio
   (crochê/crochet/amigurumi/etc) e conta frequência.
3. Completa com uma lista-semente pequena de queries fixas quando o banco
   ainda tem pouco dado (garante que o primeiro deploy, com banco raso, não
   fique sem nada pra fazer).

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
de configuração (`PINTEREST_MAX_PAGES`, `VALUESERP_MAX_PAGES`, etc.) já estão
declarados em `wrangler.toml`. Ajuste o cron (`[triggers].crons`) e os limites
conforme a cota do ValueSerp e o volume desejado.

## Testar localmente sem esperar o cron

```bash
npx wrangler dev
# noutro terminal, dispare manualmente (precisa do WORKER_ADMIN_KEY configurado):
curl -H "x-admin-key: SEU_WORKER_ADMIN_KEY" http://127.0.0.1:8787/run
```

Ou simule o disparo do cron diretamente:

```bash
npx wrangler dev --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*"
```

## Observabilidade

`npx wrangler tail` mostra os logs em tempo real (inclusive erros de
providers e resumo por query de cada ciclo). O endpoint `/run` retorna o
resumo do ciclo em JSON — útil pra depurar sem esperar o próximo cron.
