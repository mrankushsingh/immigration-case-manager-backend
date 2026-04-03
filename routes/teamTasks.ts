import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const ALLOWED_MEMBERS = new Set(['YONA', 'LEDJANA', 'CAROLINA', 'MILAGROS', 'YUSTI']);

function normalizeMember(raw: string): string | null {
  const u = String(raw || '').trim().toUpperCase();
  return ALLOWED_MEMBERS.has(u) ? u : null;
}

function formatTimestamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  try {
    return new Date(v as string).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function rowToApi(row: any) {
  return {
    id: row.id,
    teamMember: row.team_member,
    title: row.title,
    notes: row.notes ?? '',
    done: !!row.done,
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
  };
}

const teamTasksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const rows = await db.getTeamTasks();
      return reply.send(rows.map(rowToApi));
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to get team tasks' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const body = request.body as { teamMember?: string; team_member?: string; title?: string; notes?: string };
      const memberRaw = body.teamMember ?? body.team_member;
      const member = normalizeMember(memberRaw || '');
      const title = typeof body.title === 'string' ? body.title.trim() : '';

      if (!member) {
        return reply.status(400).send({
          error: 'Invalid teamMember. Must be one of: YONA, LEDJANA, CAROLINA, MILAGROS, YUSTI',
        });
      }
      if (!title) {
        return reply.status(400).send({ error: 'title is required' });
      }

      const row = await db.insertTeamTask({
        team_member: member,
        title,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });

      return reply.status(201).send(rowToApi(row));
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create team task' });
    }
  });

  fastify.patch('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { title?: string; notes?: string; done?: boolean };

      const patch: { title?: string; notes?: string | null; done?: boolean } = {};
      if (body.title !== undefined) {
        const t = String(body.title).trim();
        if (!t) {
          return reply.status(400).send({ error: 'title cannot be empty' });
        }
        patch.title = t;
      }
      if (body.notes !== undefined) {
        patch.notes = body.notes === null || body.notes === '' ? null : String(body.notes);
      }
      if (body.done !== undefined) {
        patch.done = !!body.done;
      }

      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      const updated = await db.updateTeamTask(id, patch);
      if (!updated) {
        return reply.status(404).send({ error: 'Team task not found' });
      }

      return reply.send(rowToApi(updated));
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update team task' });
    }
  });

  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await db.deleteTeamTask(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Team task not found' });
      }
      return reply.send({ success: true });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete team task' });
    }
  });
};

export default teamTasksRoutes;
