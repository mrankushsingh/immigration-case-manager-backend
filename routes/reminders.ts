import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const memoryDb = db;

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
      const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = request.body as any;

      if (!client_name || !client_surname || !reminder_date) {
        return reply.status(400).send({ error: 'client_name, client_surname, and reminder_date are required' });
      }

      const reminder = await memoryDb.insertReminder({
        client_id,
        client_name,
        client_surname,
        phone,
        reminder_date,
        notes,
        reminder_type,
      });

      return reply.status(201).send(reminder);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create reminder' });
    }
  });

  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { client_id, client_name, client_surname, phone, reminder_date, notes, reminder_type } = request.body as any;

      const updated = await memoryDb.updateReminder(id, {
        client_id,
        client_name,
        client_surname,
        phone,
        reminder_date,
        notes,
        reminder_type,
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
