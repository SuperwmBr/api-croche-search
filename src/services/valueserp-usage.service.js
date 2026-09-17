import { queryD1 } from '../providers/d1/d1.client.js';
import { env } from '../config/env.js';

// Mesma tabela (nome e esquema) usada por workers/crawler/worker.js — o
// teto diário é COMPARTILHADO entre o crawl em segundo plano e as buscas
// manuais em tempo real (provedor=auto&incluir_valueserp=1). Ambos escrevem
// no mesmo D1 (tutoriais-croche), então um orçamento só, nunca dois
// contadores divergentes disputando o mesmo limite físico na ValueSerp.
let schemaReady = false;

async function ensureSchema() {
  if (schemaReady || !env.d1Configured) return;
  await queryD1(`CREATE TABLE IF NOT EXISTS VALUESERP_USAGE (
    day TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0
  )`);
  schemaReady = true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function valueSerpUsageToday() {
  if (!env.d1Configured) return 0;
  await ensureSchema();
  const { results } = await queryD1('SELECT calls FROM VALUESERP_USAGE WHERE day = ?', [todayKey()]);
  return Number(results?.[0]?.calls || 0);
}

// Quantas páginas ainda cabem no teto de hoje. Sem D1 configurado, não há
// como medir consumo real — nesse caso o teto não é aplicado (mesmo
// comportamento de "sem trava" que o restante da API já tem quando D1 está
// ausente), e cabe ao operador saber que está rodando sem essa proteção.
export async function valueSerpRemainingBudget() {
  if (!env.d1Configured) return env.valueserpDailyLimit;
  const used = await valueSerpUsageToday();
  return Math.max(0, env.valueserpDailyLimit - used);
}

export async function addValueSerpUsage(calls) {
  if (!calls || !env.d1Configured) return;
  await ensureSchema();
  await queryD1(
    `INSERT INTO VALUESERP_USAGE (day, calls) VALUES (?, ?)
     ON CONFLICT(day) DO UPDATE SET calls = calls + excluded.calls`,
    [todayKey(), calls],
  );
}
