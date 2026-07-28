import { z } from 'zod';

export const messageBodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  hostContext: z.record(z.unknown()).optional(),
});

export type MessageBody = z.infer<typeof messageBodySchema>;
