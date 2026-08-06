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
- `engine`: mecanismo que efetivamente encontrou a página, como `google cse` ou `bing`.

A presença de uma fonte não garante 20 resultados: Instagram e TikTok dependem da indexação pública disponível nos mecanismos configurados no SearXNG.

## Segurança

Nunca versionar `.env`. Tokens do Cloudflare e YouTube permanecem exclusivamente no servidor.
