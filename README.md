# Tutoriais Crochê Search API

API vertical em JavaScript/Node.js para unificar conteúdos internos, YouTube, SearXNG e Meilisearch, usando Cloudflare D1 como persistência.

## Estado

A base estrutural é funcional e não retorna dados inventados. Provedores sem credenciais aparecem como `not_configured`; falhas de um provedor não derrubam a busca completa.

## Executar

```bash
cp .env.example .env
npm install
npm test
npm start
```

Health check: `GET http://127.0.0.1:3200/api/health`

Busca: `GET http://127.0.0.1:3200/api/busca?q=amigurumi+para+iniciante`

## Segurança

Nunca versionar `.env`. Tokens do Cloudflare, YouTube e Meilisearch permanecem exclusivamente no servidor.

## Próximas fases

1. Validar arquitetura e contratos.
2. Aplicar migration no D1 e implementar repositórios.
3. Configurar SearXNG e Meilisearch.
4. Completar endpoints de conteúdo, favoritos, avaliações e administração.
5. Implantar na VPS com systemd, Nginx, TLS, health check e rollback.
