import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { authenticateAiApiKey } from '../middleware/aiAuth.js';
import {
  findConflicts,
  generateDaySlots,
  getAppointmentEnd,
  isValidAppointmentColor,
  localDateKey,
  parseLocalDateTime,
} from '../utils/appointmentUtils.js';

const aiAppointmentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', authenticateAiApiKey);

  fastify.get('/', async (request, reply) => {
    try {
      const query = request.query as { from?: string; to?: string; date?: string };
      let from = query.from;
      let to = query.to;
      if (query.date && !from && !to) {
        from = `${query.date}T00:00:00.000Z`;
        to = `${query.date}T23:59:59.999Z`;
      }
      const appointments = await db.getAppointments({ from, to });
      return reply.send({ appointments, count: appointments.length });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to list appointments' });
    }
  });

  fastify.get('/availability', async (request, reply) => {
    try {
      const query = request.query as {
        date?: string;
        duration_minutes?: string;
        start_time?: string;
      };
      if (!query.date) {
        return reply.status(400).send({ error: 'date is required (YYYY-MM-DD)' });
      }

      const duration = Number(query.duration_minutes ?? 30);
      const all = await db.getAppointments();
      const dayAppointments = all.filter((a) => localDateKey(a.appointment_date) === query.date);

      if (query.start_time) {
        const start = parseLocalDateTime(query.date, query.start_time);
        if (!start) {
          return reply.status(400).send({ error: 'Invalid date or start_time' });
        }
        const end = getAppointmentEnd(start, duration);
        const conflicts = findConflicts(dayAppointments, start, end);
        return reply.send({
          date: query.date,
          start_time: query.start_time,
          duration_minutes: duration,
          available: conflicts.length === 0,
          conflicts,
        });
      }

      const slots = generateDaySlots(query.date, duration).map((slot) => {
        const conflicts = findConflicts(dayAppointments, slot.startDate, slot.endDate);
        return {
          start: slot.start,
          end: slot.end,
          available: conflicts.length === 0,
        };
      });

      return reply.send({
        date: query.date,
        duration_minutes: duration,
        available_slots: slots.filter((s) => s.available),
        all_slots: slots,
        booked: dayAppointments,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to check availability' });
    }
  });

  fastify.post('/check-availability', async (request, reply) => {
    try {
      const body = request.body as {
        date?: string;
        start_time?: string;
        duration_minutes?: number;
      };
      if (!body.date || !body.start_time) {
        return reply.status(400).send({ error: 'date and start_time are required' });
      }
      const duration = Number(body.duration_minutes ?? 30);
      const start = parseLocalDateTime(body.date, body.start_time);
      if (!start) {
        return reply.status(400).send({ error: 'Invalid date or start_time' });
      }
      const end = getAppointmentEnd(start, duration);
      const all = await db.getAppointments();
      const dayAppointments = all.filter((a) => localDateKey(a.appointment_date) === body.date);
      const conflicts = findConflicts(dayAppointments, start, end);
      return reply.send({
        date: body.date,
        start_time: body.start_time,
        duration_minutes: duration,
        available: conflicts.length === 0,
        conflicts,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to check availability' });
    }
  });

  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body as {
        title?: string;
        client_name?: string;
        client_surname?: string;
        phone?: string;
        email?: string;
        date?: string;
        start_time?: string;
        appointment_date?: string;
        duration_minutes?: number;
        color?: string;
        notes?: string;
      };

      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const client_name = typeof body.client_name === 'string' ? body.client_name.trim() : '';
      let appointment_date = body.appointment_date;

      if (!appointment_date && body.date && body.start_time) {
        const start = parseLocalDateTime(body.date, body.start_time);
        if (!start) {
          return reply.status(400).send({ error: 'Invalid date or start_time' });
        }
        appointment_date = start.toISOString();
      }

      if (!title || !client_name || !appointment_date) {
        return reply.status(400).send({
          error: 'title, client_name, and appointment_date (or date + start_time) are required',
        });
      }

      const duration = Number(body.duration_minutes ?? 30);
      const color = body.color || 'blue';
      if (!isValidAppointmentColor(color)) {
        return reply.status(400).send({ error: 'color must be one of: red, blue, green, yellow' });
      }

      const start = new Date(appointment_date);
      const end = getAppointmentEnd(start, duration);
      const existing = await db.getAppointments();
      const conflicts = findConflicts(existing, start, end);
      if (conflicts.length) {
        return reply.status(409).send({
          error: 'Requested time slot is not available',
          available: false,
          conflicts,
        });
      }

      const appointment = await db.insertAppointment({
        title,
        client_name,
        client_surname: body.client_surname,
        phone: body.phone,
        email: body.email,
        appointment_date: start.toISOString(),
        duration_minutes: duration,
        color,
        notes: body.notes,
        source: 'ai',
      });

      return reply.status(201).send({ success: true, available: true, appointment });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create appointment' });
    }
  });
};

export default aiAppointmentsRoutes;
