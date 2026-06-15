import { FastifyReply, FastifyRequest } from 'fastify';

export async function authenticateAiApiKey(request: FastifyRequest, reply: FastifyReply) {
  const expectedKey = process.env.AI_APPOINTMENTS_API_KEY;
  if (!expectedKey) {
    return reply.status(503).send({
      error: 'AI appointments API is not configured',
      message: 'Set AI_APPOINTMENTS_API_KEY on the server to enable AI access.',
    });
  }

  const provided =
    (request.headers['x-ai-api-key'] as string | undefined) ||
    (request.headers['x-api-key'] as string | undefined);

  if (!provided || provided !== expectedKey) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid or missing AI API key. Send X-AI-API-Key header.',
    });
  }
}
