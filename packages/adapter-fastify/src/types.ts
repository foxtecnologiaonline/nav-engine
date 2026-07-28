import type { FastifyRequest } from 'fastify';
import type { NavEngine } from '@nav-engine/core';

export interface RegisterNavEngineRoutesConfig {
  engine: NavEngine;
  /** Deriva o userId autenticado a partir do request do host — nunca confiamos em userId vindo do body. */
  getUserId: (req: FastifyRequest) => string;
  /** Contexto adicional do host (tenant, papéis, locale...) mesclado com o hostContext do body/campo. */
  resolveHostContext?: (req: FastifyRequest) => Promise<Record<string, unknown>> | Record<string, unknown>;
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
