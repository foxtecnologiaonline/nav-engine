import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import type { EngineTurnResult } from '@nav-engine/core';
import { messageBodySchema } from './schemas.js';
import type { NavEngineHttpResponse, RegisterNavEngineRoutesConfig } from './types.js';

function toHttpResponse(result: EngineTurnResult): NavEngineHttpResponse {
  return {
    reply: result.reply,
    status: result.status,
    action: result.action ?? null,
    executionOk: result.executionOk,
    navigateTo: result.navigateTo,
    audioBase64: result.audio ? Buffer.from(result.audio.data).toString('base64') : undefined,
    audioMimeType: result.audio?.mimeType,
  };
}

/** Devolve `true` se a requisição foi barrada (429 já enviado) — o handler deve parar ali. */
async function rejectedByRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  config: RegisterNavEngineRoutesConfig,
): Promise<boolean> {
  if (!config.rateLimiter) return false;

  const key = config.rateLimiter.keyFor?.(req) ?? config.getUserId(req);
  const allowed = await config.rateLimiter.limiter.consume(key);
  if (!allowed) {
    await reply.status(429).send({ error: 'rate_limited', message: 'Muitas requisições — tente novamente em instantes.' });
    return true;
  }
  return false;
}

/**
 * Expõe `POST {prefix}/message` e `POST {prefix}/audio` sobre um `NavEngine`
 * já configurado pelo host. Registrado num escopo Fastify isolado
 * (encapsulamento de plugin) para que o `@fastify/multipart` interno nunca
 * colida com o que o host já tiver registrado na instância raiz.
 */
export async function registerNavEngineRoutes(
  app: FastifyInstance,
  config: RegisterNavEngineRoutesConfig,
): Promise<void> {
  const prefix = config.prefix ?? '/nav-engine';

  await app.register(
    async (scope) => {
      await scope.register(multipart);

      scope.post('/message', async (req, reply) => {
        if (await rejectedByRateLimit(req, reply, config)) return;

        const parsed = messageBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
        }

        const userId = config.getUserId(req);
        const hostContext = {
          ...(await config.resolveHostContext?.(req)),
          ...(parsed.data.hostContext ?? {}),
        };

        const result = await config.engine.handleMessage(
          { sessionId: parsed.data.sessionId, userId, hostContext },
          parsed.data.message,
        );
        return reply.send(toHttpResponse(result));
      });

      scope.post('/audio', async (req, reply) => {
        if (await rejectedByRateLimit(req, reply, config)) return;

        let sessionId: string | undefined;
        let hostContextRaw: string | undefined;
        let audioBuffer: Buffer | undefined;
        let mimeType = 'audio/webm';

        for await (const part of req.parts()) {
          if (part.type === 'file' && part.fieldname === 'audio') {
            audioBuffer = await part.toBuffer();
            mimeType = part.mimetype || mimeType;
          } else if (part.type === 'field' && part.fieldname === 'sessionId') {
            sessionId = String(part.value);
          } else if (part.type === 'field' && part.fieldname === 'hostContext') {
            hostContextRaw = String(part.value);
          }
        }

        if (!sessionId || !audioBuffer) {
          return reply
            .status(400)
            .send({ error: 'invalid_body', message: 'Campos "sessionId" e "audio" são obrigatórios.' });
        }

        let hostContextFromField: Record<string, unknown> = {};
        if (hostContextRaw) {
          try {
            hostContextFromField = JSON.parse(hostContextRaw);
          } catch {
            return reply
              .status(400)
              .send({ error: 'invalid_body', message: 'Campo "hostContext" deve ser um JSON válido.' });
          }
        }

        const userId = config.getUserId(req);
        const hostContext = {
          ...(await config.resolveHostContext?.(req)),
          ...hostContextFromField,
        };

        const result = await config.engine.handleAudio(
          { sessionId, userId, hostContext },
          { audio: audioBuffer, mimeType },
        );
        return reply.send(toHttpResponse(result));
      });
    },
    { prefix },
  );
}
