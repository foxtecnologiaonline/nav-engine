import type { FastifyRequest } from 'fastify';
import type { NavEngine } from '@nav-engine/core';
import type { RateLimiter } from './rate-limiter.js';

export interface RateLimiterOptions {
  limiter: RateLimiter;
  /** Default: usa o userId (via `getUserId`) como chave — disponível antes de qualquer parsing de body. */
  keyFor?: (req: FastifyRequest) => string;
}

export interface RegisterNavEngineRoutesConfig {
  engine: NavEngine;
  /** Deriva o userId autenticado a partir do request do host — nunca confiamos em userId vindo do body. */
  getUserId: (req: FastifyRequest) => string;
  /** Contexto adicional do host (tenant, papéis, locale...) mesclado com o hostContext do body/campo. */
  resolveHostContext?: (req: FastifyRequest) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Opcional — protege `/message` e `/audio` contra abuso. Sem isso, sem limite algum (fica a critério do host). */
  rateLimiter?: RateLimiterOptions;
  /** Default: '/nav-engine'. */
  prefix?: string;
}

export interface NavEngineHttpResponse {
  reply: string;
  status: string;
  action?: { key: string; description: string } | null;
  executionOk?: boolean;
  navigateTo?: string;
  audioBase64?: string;
  audioMimeType?: string;
}
