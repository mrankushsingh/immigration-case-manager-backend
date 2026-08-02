import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { normalizeAssignedTeamMember } from '../utils/teamMembers.js';

const memoryDb = db;

async function resolveTeamMemberField(
  raw: unknown,
  allowed: readonly string[]
): Promise<{ value?: string | null; error?: string }> {
  if (raw === undefined) return {};
  try {
    return { value: normalizeAssignedTeamMember(raw, allowed) ?? null };
  } catch (error: any) {
    return { error: error.message || 'Invalid team member' };
  }
}

const remindersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const reminders = await memoryDb.getReminders();
      return reply.send(reminders);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to get reminders' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const body = request.body as any;
      const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = body;
      const rawTeamMember = body.team_member ?? body.teamMember;

      if (!client_name || !client_surname || !reminder_date) {
        return reply.status(400).send({ error: 'client_name, client_surname, and reminder_date are required' });
      }

      const allowed = await memoryDb.getTeamMembers();
      const teamMemberResult = await resolveTeamMemberField(rawTeamMember, allowed);
      if (teamMemberResult.error) {
        return reply.status(400).send({ error: teamMemberResult.error });
      }

      const reminder = await memoryDb.insertReminder({
        client_id,
        client_name,
        client_surname,
        phone,
        reminder_date,
        notes,
        reminder_type,
        team_member: teamMemberResult.value,
      });

      return reply.status(201).send(reminder);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create reminder' });
    }
  });

  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = body;
      const rawTeamMember = body.team_member ?? body.teamMember;
      const rawDone = body.done;
      const rawArchived = body.archived;

      const allowed = await memoryDb.getTeamMembers();
      const teamMemberResult = await resolveTeamMemberField(rawTeamMember, allowed);
      if (teamMemberResult.error) {
        return reply.status(400).send({ error: teamMemberResult.error });
      }

      const updated = await memoryDb.updateReminder(id, {
        client_id,
        client_name,
        client_surname,
        phone,
        reminder_date,
        notes,
        reminder_type,
        ...(rawTeamMember !== undefined ? { team_member: teamMemberResult.value ?? null } : {}),
        ...(rawDone !== undefined ? { done: Boolean(rawDone) } : {}),
        ...(rawArchived !== undefined ? { archived: Boolean(rawArchived) } : {}),
      });

      if (!updated) {
        return reply.status(404).send({ error: 'Reminder not found' });
      }

      return reply.send({ success: true, message: 'Reminder updated successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update reminder' });
    }
  });

  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await memoryDb.deleteReminder(id);

      if (!deleted) {
        return reply.status(404).send({ error: 'Reminder not found' });
      }

      return reply.send({ success: true, message: 'Reminder deleted successfully' });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete reminder' });
    }
  });
};

export default remindersRoutes;
