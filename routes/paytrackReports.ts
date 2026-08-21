import { FastifyPluginAsync } from 'fastify';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { isTelegramConfigured } from '../utils/telegram.js';
import {
  sendPaytrackReportToTelegram,
  type SendPaytrackTelegramResult,
} from '../utils/paytrackTelegramJobs.js';
import type { PaytrackReportPeriod } from '../utils/paytrackReport.js';

const PERIODS: PaytrackReportPeriod[] = ['daily', 'weekly', 'monthly', 'all'];

function parsePeriod(value: unknown): PaytrackReportPeriod | null {
  if (typeof value !== 'string') return null;
  const period = value.trim().toLowerCase() as PaytrackReportPeriod;
  return PERIODS.includes(period) ? period : null;
}

const paytrackReportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/telegram-status', async (_request: AuthenticatedRequest, reply) => {
    return reply.send({
      configured: isTelegramConfigured(),
      dailyEnabled: process.env.PAYTRACK_DAILY_TELEGRAM_ENABLED !== 'false',
      dailyHour: Number(process.env.PAYTRACK_DAILY_TELEGRAM_HOUR) || 9,
      dailyTz: process.env.PAYTRACK_DAILY_TELEGRAM_TZ?.trim() || 'Europe/Madrid',
    });
  });

  fastify.post('/send-telegram', async (request: AuthenticatedRequest, reply) => {
    try {
      if (!isTelegramConfigured()) {
        return reply.status(503).send({
          error: 'Telegram is not configured',
          message: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.',
        });
      }

      const body = (request.body || {}) as { period?: unknown };
      const period = parsePeriod(body.period) || 'daily';

      const result: SendPaytrackTelegramResult = await sendPaytrackReportToTelegram(period);
      return reply.send(result);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: error?.message || 'Failed to send PayTrack report to Telegram',
      });
    }
  });
};

export default paytrackReportsRoutes;
