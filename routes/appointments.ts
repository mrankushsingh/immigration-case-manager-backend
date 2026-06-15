import { FastifyPluginAsync } from 'fastify';
import { db } from '../utils/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  findConflicts,
  getAppointmentEnd,
  isValidAppointmentColor,
  localDateKey,
  parseLocalDateTime,
} from '../utils/appointmentUtils.js';

function validateAppointmentBody(body: any, requireAll = true) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const client_name = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const appointment_date = body.appointment_date;
  const duration_minutes = Number(body.duration_minutes ?? 30);
  const color = typeof body.color === 'string' ? body.color : 'blue';

  if (requireAll && (!title || !client_name || !appointment_date)) {
    return { error: 'title, client_name, and appointment_date are required' };
  }
  if (body.duration_minutes !== undefined && (!Number.isFinite(duration_minutes) || duration_minutes < 5 || duration_minutes > 480)) {
    return { error: 'duration_minutes must be between 5 and 480' };
  }
  if (body.color !== undefined && color && !isValidAppointmentColor(color)) {
    return { error: 'color must be one of: red, blue, green, yellow' };
  }
  if (appointment_date !== undefined) {
    const start = new Date(appointment_date);
    if (Number.isNaN(start.getTime())) {
      return { error: 'appointment_date must be a valid ISO datetime' };
    }
  }

  return {
    data: {
      ...(title ? { title } : {}),
      ...(client_name ? { client_name } : {}),
      ...(body.client_surname !== undefined
        ? { client_surname: typeof body.client_surname === 'string' ? body.client_surname.trim() : undefined }
        : {}),
      ...(body.phone !== undefined ? { phone: typeof body.phone === 'string' ? body.phone.trim() : undefined } : {}),
      ...(body.email !== undefined ? { email: typeof body.email === 'string' ? body.email.trim() : undefined } : {}),
      ...(appointment_date !== undefined ? { appointment_date: new Date(appointment_date).toISOString() } : {}),
      ...(body.duration_minutes !== undefined ? { duration_minutes } : {}),
      ...(body.color !== undefined ? { color } : {}),
      ...(body.notes !== undefined ? { notes: typeof body.notes === 'string' ? body.notes : undefined } : {}),
    },
  };
}

const appointmentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const query = request.query as { from?: string; to?: string };
      const appointments = await db.getAppointments({
        from: query.from,
        to: query.to,
      });
      return reply.send(appointments);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to get appointments' });
    }
  });

  fastify.get('/availability', async (request: AuthenticatedRequest, reply) => {
    try {
      const query = request.query as {
        date?: string;
        duration_minutes?: string;
        start_time?: string;
      };
      if (!query.date) {
        return reply.status(400).send({ error: 'date query parameter is required (YYYY-MM-DD)' });
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

      const { generateDaySlots } = await import('../utils/appointmentUtils.js');
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
        slots,
        appointments: dayAppointments,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to check availability' });
    }
  });

  fastify.post('/', async (request: AuthenticatedRequest, reply) => {
    try {
      const validated = validateAppointmentBody(request.body);
      if ('error' in validated) {
        return reply.status(400).send({ error: validated.error });
      }
      const data = validated.data!;
      if (!data.title || !data.client_name || !data.appointment_date) {
        return reply.status(400).send({ error: 'title, client_name, and appointment_date are required' });
      }
      const start = new Date(data.appointment_date);
      const duration = data.duration_minutes ?? 30;
      const end = getAppointmentEnd(start, duration);
      const existing = await db.getAppointments();
      const conflicts = findConflicts(existing, start, end);
      if (conflicts.length) {
        return reply.status(409).send({
          error: 'Time slot is not available',
          conflicts,
        });
      }

      const appointment = await db.insertAppointment({
        title: data.title,
        client_name: data.client_name,
        client_surname: data.client_surname,
        phone: data.phone,
        email: data.email,
        appointment_date: data.appointment_date,
        duration_minutes: duration,
        color: data.color,
        notes: data.notes,
        source: 'manual',
      });
      return reply.status(201).send(appointment);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to create appointment' });
    }
  });

  fastify.put('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const validated = validateAppointmentBody(body, false);
      if ('error' in validated && validated.error) {
        return reply.status(400).send({ error: validated.error });
      }

      const existing = await db.getAppointments();
      const current = existing.find((a) => a.id === id);
      if (!current) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }

      const patch = validated.data || {};
      const nextStart = new Date(patch.appointment_date || current.appointment_date);
      const nextDuration = patch.duration_minutes ?? current.duration_minutes ?? 30;
      const nextEnd = getAppointmentEnd(nextStart, nextDuration);
      const conflicts = findConflicts(existing, nextStart, nextEnd, id);
      if (conflicts.length) {
        return reply.status(409).send({ error: 'Time slot is not available', conflicts });
      }

      const updated = await db.updateAppointment(id, {
        ...patch,
        appointment_date: nextStart.toISOString(),
        duration_minutes: nextDuration,
      });

      if (!updated) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }
      return reply.send(updated);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to update appointment' });
    }
  });

  fastify.delete('/:id', async (request: AuthenticatedRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await db.deleteAppointment(id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }
      return reply.send({ success: true });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || 'Failed to delete appointment' });
    }
  });
};

export default appointmentsRoutes;
