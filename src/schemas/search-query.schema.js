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
  limit_por_fonte: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['relevancia', 'recente', 'popular']).default('relevancia'),
  safe_search: z.enum(['0', '1', '2']).default('1')
});
