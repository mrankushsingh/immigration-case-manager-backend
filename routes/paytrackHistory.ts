import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const SETTINGS_KEY = 'paytrack_history';
const MAX_ENTRIES = 500;

type PaytrackHistoryEntry = {
  id: string;
  action: string;
  detail: string;
  at: string;
  by?: string;
  clientId?: string;
  clientName?: string;
};

async function readHistory(): Promise<PaytrackHistoryEntry[]> {
  const raw = await db.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(entries: PaytrackHistoryEntry[]): Promise<void> {
  await db.setSetting(SETTINGS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

const paytrackHistoryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request: AuthenticatedRequest, reply) => {
    try {
      const entries = await readHistory();
      return reply.send({ entries });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to load PayTrack history' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const body = request.body as Partial<PaytrackHistoryEntry> | undefined;
      const action = typeof body?.action === 'string' ? body.action.trim() : '';
      const detail = typeof body?.detail === 'string' ? body.detail.trim() : '';
      if (!action || !detail) {
        return reply.status(400).send({ error: 'action and detail are required' });
      }

      const entry: PaytrackHistoryEntry = {
        id:
          typeof body?.id === 'string' && body.id.trim()
            ? body.id.trim()
            : `pth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        action,
        detail,
        at:
          typeof body?.at === 'string' && body.at.trim()
            ? body.at.trim()
            : new Date().toISOString(),
        by: typeof body?.by === 'string' && body.by.trim() ? body.by.trim() : undefined,
        clientId:
          typeof body?.clientId === 'string' && body.clientId.trim()
            ? body.clientId.trim()
            : undefined,
        clientName:
          typeof body?.clientName === 'string' && body.clientName.trim()
            ? body.clientName.trim()
            : undefined,
      };

      const existing = await readHistory();
      const next = [entry, ...existing].slice(0, MAX_ENTRIES);
      await writeHistory(next);
      return reply.status(201).send(entry);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to save PayTrack history' });
    }
  });
};

export default paytrackHistoryRoutes;
