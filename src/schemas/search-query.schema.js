import { z } from 'zod';
import { env } from '../config/env.js';
import { SUPPORTED_SOURCES } from '../classification/source.js';
import { SUPPORTED_TYPES } from '../classification/type.js';

const csv = z.string().transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
const sources = csv.refine((values) => values.every((value) => SUPPORTED_SOURCES.includes(value)), {
  message: `fontes permitidas: ${SUPPORTED_SOURCES.join(', ')}`
});
const types = csv.refine((values) => values.every((value) => SUPPORTED_TYPES.includes(value)), {
  message: `tipos permitidos: ${SUPPORTED_TYPES.join(', ')}`
});
const provider = z.enum(['auto', 'searxng', 'valueserp', 'scraping', 'mix']).default('auto');

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(env.SEARCH_MAX_QUERY_LENGTH),
  tipo: types.optional(),
  fonte: sources.optional(),
  idioma: z.string().trim().max(12).optional(),
  nivel: z.enum(['iniciante', 'intermediario', 'avancado']).optional(),
  tecnica: z.string().trim().max(80).optional(),
  material: z.string().trim().max(80).optional(),
  duracao_maxima: z.coerce.number().int().positive().optional(),
  data_inicio: z.coerce.date().optional(),
  data_fim: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  limit_por_fonte: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['relevancia', 'recente', 'popular']).default('relevancia'),
  safe_search: z.enum(['0', '1', '2']).default('1'),
  provedor: provider,
  provider: provider.optional(),
  todas_paginas: z.enum(['0', '1']).transform((value) => value === '1').default(true),
  valueserp_tipo: z.enum(['images', 'search', 'news', 'shopping']).optional(),
  max_paginas: z.coerce.number().int().min(1).max(100).optional(),
  lote_paginas: z.coerce.number().int().min(1).max(10).optional(),
  pinterest_bookmark: z.string().trim().min(1).max(4096).optional(),
  // Só tem efeito com provedor=auto (o padrão): soma o ValueSerp aos demais
  // provedores da busca automática, em vez de substituí-los como
  // provedor=valueserp/mix fazem. Pensado para pesquisa manual do usuário
  // (uma expressão digitada), não para varreduras de acervo completo —
  // sujeito ao teto diário compartilhado (ver valueserp-usage.service.js).
  incluir_valueserp: z.enum(['0', '1']).transform((value) => value === '1').default(false)
});
