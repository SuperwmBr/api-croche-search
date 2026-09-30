import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTrackedQueries } from '../workers/crawler/worker.js';

test('crawler prioriza buscas recentes de gráficos e filtra consultas fora do nicho', async () => {
  const queryRows = [
    { query_normalized: 'biquini', filters_json: '{"types":["grafico"]}' },
    { query_normalized: 'biquini', filters_json: '{"types":["grafico"]}' },
    { query_normalized: 'receita de bolo', filters_json: '{}' },
    { query_normalized: 'blusa crochet', filters_json: '{}' }
  ];
  const db = {
    prepare(sql) {
      return {
        all: async () => ({
          results: sql.includes('FROM SEARCH_QUERIES') ? queryRows : []
        })
      };
    }
  };

  const queries = await deriveTrackedQueries(db, 3);
  assert.deepEqual(queries, [
    'biquini croche grafico',
    'blusa crochet',
    'grafico de croche'
  ]);
});
