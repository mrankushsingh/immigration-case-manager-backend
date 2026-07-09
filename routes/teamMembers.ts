import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { cache } from '../utils/cache.js';
import { validateMemberName, normalizeMemberInput } from '../utils/teamMembers.js';

const teamMembersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request: AuthenticatedRequest, reply) => {
    try {
      const members = await db.getTeamMembers();
      return reply.send({ members });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to get team members' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const { name } = request.body as { name?: string };
      const member = validateMemberName(name || '');
      if (!member) {
        return reply.status(400).send({
          error: 'Invalid name. Use letters, numbers, spaces (max 50 characters).',
        });
      }

      const members = await db.getTeamMembers();
      if (members.includes(member)) {
        return reply.status(409).send({ error: 'This team member already exists.' });
      }

      const updated = [...members, member].sort((a, b) => a.localeCompare(b));
      await db.setTeamMembers(updated);
      await cache.delete('templates:all');

      return reply.status(201).send({ members: updated });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to add team member' });
    }
  });

  fastify.delete('/:name', async (request: AuthenticatedRequest, reply) => {
    try {
      const { name } = request.params as { name: string };
      const member = normalizeMemberInput(decodeURIComponent(name));
      const members = await db.getTeamMembers();

      if (!members.includes(member)) {
        return reply.status(404).send({ error: 'Team member not found' });
      }
      if (members.length <= 1) {
        return reply.status(400).send({ error: 'At least one team member is required.' });
      }

      const updated = members.filter((m) => m !== member);
      await db.setTeamMembers(updated);
      await db.clearTemplateAssignmentsForMember(member);
      await db.clearReminderAssignmentsForMember(member);
      await cache.delete('templates:all');

      return reply.send({ members: updated });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to remove team member' });
    }
  });
};

export default teamMembersRoutes;
