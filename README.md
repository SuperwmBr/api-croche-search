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
- `scraping`: leitura direta de resultados do Pinterest pelo fluxo de `BaseSearchResource`, inspirado no projeto `crochet-chart-scraping`.

Exemplos:

```text
GET /api/busca?q=icroche+grafico+de+croche&provedor=valueserp&fonte=web&todas_paginas=1
GET /api/busca?q=grafico+de+croche&provedor=scraping&fonte=pinterest&todas_paginas=1
GET /api/busca?q=flor+de+croche&provedor=valueserp&valueserp_tipo=images&max_paginas=100
```

Para o ValueSerp, `todas_paginas=1` é o padrão. A API continua avançando enquanto houver resultados/paginação disponível, interrompendo quando não houver novos resultados ou quando atingir `max_paginas`/`VALUESERP_MAX_PAGES`. A chave deve ficar somente no ambiente do servidor, em `VALUESERP_API_KEY`.

O scraping do Pinterest usa `bookmark` para percorrer as páginas disponíveis e extrai a imagem original do pin (`images.orig.url`) quando fornecida.

Quando `provedor=valueserp` ou `provedor=scraping` é usado com `todas_paginas=1`, `limit` define o tamanho solicitado por página, mas não limita a resposta final: todos os resultados coletados e deduplicados são retornados e persistidos. `max_paginas` limita o número de páginas processadas.

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
