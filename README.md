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
