import { prisma } from '../../lib/prisma.js';
import { DEFAULT_SCHEDULER_CONFIG, mergeConfig, type SchedulerConfig } from '../scheduler/index.js';

// A configuração ativa do algoritmo = padrão do código + sobrescritas guardadas
// na tabela algorithm_configs (chave "spaced-repetition"). Assim os parâmetros
// podem ser ajustados direto no banco, sem novo deploy.

export const CONFIG_KEY = 'spaced-repetition';
const CACHE_MS = 60_000;
let cache: { at: number; config: SchedulerConfig } | null = null;

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.config;
  let config = DEFAULT_SCHEDULER_CONFIG;
  try {
    const row = await prisma.algorithmConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (row && typeof row.config === 'object' && row.config !== null && !Array.isArray(row.config)) {
      config = mergeConfig(DEFAULT_SCHEDULER_CONFIG, row.config as Partial<SchedulerConfig>);
    }
  } catch (err) {
    console.warn('Falha ao carregar configuração do algoritmo; usando padrão.', err);
  }
  cache = { at: Date.now(), config };
  return config;
}

export function clearSchedulerConfigCache() {
  cache = null;
}
