# Tutoriais Crochê Search API

API vertical em JavaScript/Node.js para unificar conteúdos internos, YouTube e busca pública via SearXNG, usando Cloudflare D1 como persistência. Meilisearch permanece opcional.

## Estado

A API está publicada em `https://api.tutoriaiscroche.com.br`. Provedores sem credenciais aparecem como `not_configured`; falhas isoladas não derrubam a busca completa.

## Executar

```bash
cp .env.example .env
npm install
npm test
npm start
```

Health check: `GET http://127.0.0.1:3200/api/health`

Busca geral: `GET /api/busca?q=amigurumi+para+iniciante`

## Provedores de descoberta

O parâmetro `provedor` (ou `provider`) permite escolher o mecanismo usado:

- `auto`: comportamento padrão, combinando D1, YouTube, SearXNG e Meilisearch quando configurado;
- `searxng`: busca pública pelo SearXNG;
- `valueserp`: busca pela ValueSerp, com `search_type=images` por padrão;
- `scraping`: leitura direta de resultados do Pinterest pelo fluxo de `BaseSearchResource`, inspirado no projeto `crochet-chart-scraping`;
- `mix`: dispara `scraping` (Pinterest) e `valueserp` em paralelo na mesma requisição e devolve o resultado unificado, já ranqueado e deduplicado junto. Diferente de `provedor=scraping` sozinho, o `mix` não usa o fluxo de crawl em segundo plano (bookmark persistido em `SEARCH_CRAWL_JOBS`) — cada chamada busca as páginas do Pinterest de forma síncrona, limitada por `lote_paginas`/`max_paginas`, exatamente como o ValueSerp.

Exemplos:

```text
GET /api/busca?q=icroche+grafico+de+croche&provedor=valueserp&fonte=web&todas_paginas=1
GET /api/busca?q=grafico+de+croche&provedor=scraping&fonte=pinterest&todas_paginas=1
GET /api/busca?q=flor+de+croche&provedor=valueserp&valueserp_tipo=images&max_paginas=100
GET /api/busca?q=grafico+de+croche&provedor=mix&todas_paginas=1&limit=50
```

Para o ValueSerp, `todas_paginas=1` é o padrão. **Se `max_paginas` não for informado, a API usa `VALUESERP_SYNC_DEFAULT_MAX_PAGES` (5 por padrão) em vez de `VALUESERP_MAX_PAGES` (100)** — isso evita que uma chamada síncrona (via `provedor=valueserp` ou `provedor=mix`) percorra 100 páginas sequenciais na mesma requisição HTTP e estoure o gateway timeout do Cloudflare (504) bem antes do timeout interno (`VALUESERP_TOTAL_TIMEOUT_MS`, 120s por padrão). Para buscar mais páginas, informe `max_paginas` explicitamente (até 100) — nesse caso a requisição pode demorar bastante e é sua responsabilidade garantir que o proxy na frente aguente esse tempo. A chave deve ficar somente no ambiente do servidor, em `VALUESERP_API_KEY`.

O scraping do Pinterest usa `bookmark` para percorrer as páginas disponíveis e extrai a imagem original do pin (`images.orig.url`) quando fornecida.

A persistência no D1 (`SEARCH_URLS`/`SEARCH_RESULTS`) grava os resultados em lotes (limite de 100 parâmetros por statement do D1), disparados com concorrência limitada (8 lotes simultâneos) e timeout próprio via `SEARCH_PERSISTENCE_TIMEOUT_MS` (30s por padrão) — separado do `SEARCH_PROVIDER_TIMEOUT_MS` usado nas buscas leves (D1 interno/YouTube), já que lotes de centenas de itens (comuns em `provedor=mix`) tomam bem mais tempo que uma única consulta.

Quando `provedor=valueserp` ou `provedor=scraping` é usado com `todas_paginas=1`, `limit` define o tamanho solicitado por página. No Pinterest, a API limita cada lote a `PINTEREST_BATCH_MAX_PAGES` páginas (3 por padrão), grava o bookmark internamente e continua a coleta em segundo plano, evitando que o cliente precise conhecer ou enviar qualquer cursor do Pinterest.

```text
GET /api/busca?q=grafico+de+croche&provedor=scraping&todas_paginas=1&limit=100
```

A resposta contém `crawl.id` e `crawl.statusUrl`. Consulte esse endereço até `crawl.collectionComplete=true` para acompanhar a coleta e ler os resultados já persistidos. `lote_paginas` permite reduzir o lote e `max_paginas` limita o total da coleta. Cada lote é persistido imediatamente e a unicidade no D1 impede duplicações.

## Persistência e idempotência

Resultados externos são persistidos no Cloudflare D1 em `SEARCH_RESULTS`. A URL é normalizada e protegida pela chave única `canonical_url`. O registro complementar `SEARCH_URLS` mantém uma única linha por URL canônica e atualiza metadados sem criar duplicatas.

O campo `persistence` da resposta informa o estado da persistência. A migração adicional está em `migrations/0002_search_url_registry.sql`.

## Tipos de conteúdo

O parâmetro `tipo` aceita um ou mais valores separados por vírgula:

- `artigo`
- `video`
- `imagem`
- `pdf`
- `grafico`

`grafico` representa fichas, diagramas, esquemas, receitas gráficas, coleções de gráficos e materiais com símbolos/instruções visuais para desenvolver peças de crochê. Quando esse tipo é solicitado, a API expande a consulta com termos especializados como `gráfico de crochê`, `diagrama de crochê`, `receita gráfica` e `crochet chart`, e aplica o filtro em todos os provedores.

```text
GET /api/busca?q=biquini&tipo=grafico
GET /api/busca?q=toalha+redonda&tipo=grafico&fonte=pinterest,pdf,web&limit_por_fonte=20
GET /api/busca?q=square+floral&tipo=grafico,imagem
```

Um vídeo que ensina a interpretar gráficos continua sendo `video`. Um artigo explicativo continua sendo `artigo`. O tipo `grafico` é reservado ao recurso técnico em si ou a uma coleção claramente dedicada a gráficos.

## Busca por fonte

O parâmetro `fonte` aceita uma ou mais fontes separadas por vírgula:

- `internal`
- `youtube`
- `web`
- `pdf`
- `instagram`
- `tiktok`
- `pinterest`

Quando `fonte` é informado, `limit_por_fonte` define quantos resultados finais serão retornados por fonte, entre 1 e 20. A API consulta até três páginas do SearXNG e coleta mais candidatos antes de filtrar, ranquear e limitar.

```text
GET /api/busca?q=flor+de+croche&fonte=youtube,instagram,tiktok,pinterest,pdf,web&limit_por_fonte=20
```

Exemplos:

```text
GET /api/busca?q=amigurumi+coelho&fonte=youtube&limit_por_fonte=20
GET /api/busca?q=bolsa+granny+square&fonte=instagram,tiktok&limit_por_fonte=20
GET /api/busca?q=flor+de+croche&fonte=pinterest&limit_por_fonte=20
GET /api/busca?q=receita+tapete+redondo&fonte=pdf,web&limit_por_fonte=20
```

Resultados obtidos pelo SearXNG incluem:

- `origin`: plataforma ou tipo do conteúdo (`instagram`, `tiktok`, `pinterest`, `pdf`, `web`);
- `provider`: provedor utilizado (`searxng`);
- `engine`: mecanismo que efetivamente encontrou a página, como `google cse` ou `bing`;
- `type`: classificação semântica, incluindo o tipo especializado `grafico`.

A presença de uma fonte não garante 20 resultados: Instagram e TikTok dependem da indexação pública disponível nos mecanismos configurados no SearXNG.

## Segurança

Nunca versionar `.env`. Tokens do Cloudflare e YouTube permanecem exclusivamente no servidor.
