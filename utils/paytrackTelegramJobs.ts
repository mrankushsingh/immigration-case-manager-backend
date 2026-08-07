import { db } from './database.js';
import {
  buildPaytrackReport,
  paytrackReportFilename,
  paytrackReportSummaryText,
  paytrackReportToPdfBuffer,
  type PaytrackReportPeriod,
} from './paytrackReport.js';
import { isTelegramConfigured, sendTelegramDocument, sendTelegramMessage } from './telegram.js';

export type SendPaytrackTelegramResult = {
  ok: true;
  period: PaytrackReportPeriod;
  clientCount: number;
  filename: string;
};

export async function sendPaytrackReportToTelegram(
  period: PaytrackReportPeriod
): Promise<SendPaytrackTelegramResult> {
  if (!isTelegramConfigured()) {
    throw new Error(
      'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.'
    );
  }

  const clients = (await db.getClients()).filter((c) => {
    const totalFee = Number(c.payment?.totalFee) || 0;
    const paidAmount = Number(c.payment?.paidAmount) || 0;
    const payments = Array.isArray(c.payment?.payments) ? c.payment.payments : [];
    return totalFee > 0 || paidAmount > 0 || payments.length > 0;
  });
  const report = buildPaytrackReport(clients, period);
  const pdf = await paytrackReportToPdfBuffer(report);
  const filename = paytrackReportFilename(report);

  // Short text notification first, then PDF attachment.
  await sendTelegramMessage(paytrackReportSummaryText(report));
  await sendTelegramDocument({
    filename,
    buffer: pdf,
    caption: `PayTrack PDF · ${report.range.period} · ${report.totals.clientCount} clients`,
    contentType: 'application/pdf',
  });

  return {
    ok: true,
    period,
    clientCount: report.totals.clientCount,
    filename,
  };
}

/** Hour (0–23) in PAYTRACK_DAILY_TELEGRAM_TZ (default Europe/Madrid). */
function configuredDailyHour(): number {
  const raw = Number(process.env.PAYTRACK_DAILY_TELEGRAM_HOUR);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 23) return Math.floor(raw);
  return 9;
}

function configuredTimeZone(): string {
  return process.env.PAYTRACK_DAILY_TELEGRAM_TZ?.trim() || 'Europe/Madrid';
}

function hourInTimeZone(date: Date, timeZone: string): { hour: number; dayKey: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';
  const hour = Number(get('hour')) % 24;
  const dayKey = `${get('year')}-${get('month')}-${get('day')}`;
  return { hour, dayKey };
}

let lastDailySendDayKey: string | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export async function runDailyPaytrackTelegramJob(log?: {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}): Promise<void> {
  if (!isTelegramConfigured()) {
    log?.info('PayTrack daily Telegram skipped — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
    return;
  }

  try {
    const result = await sendPaytrackReportToTelegram('daily');
    log?.info(
      `PayTrack daily Telegram sent (${result.clientCount} clients, ${result.filename})`
    );
  } catch (err) {
    log?.error('PayTrack daily Telegram failed', err);
    try {
      await sendTelegramMessage(
        `⚠️ PayTrack daily report failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } catch {
      // ignore secondary failure
    }
  }
}

/**
 * Checks every minute; sends once per local day at the configured hour.
 * Daily report = last 24 hours of PayTrack activity as PDF + text.
 */
export function startPaytrackDailyTelegramScheduler(log?: {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}): void {
  if (process.env.PAYTRACK_DAILY_TELEGRAM_ENABLED === 'false') {
    log?.info('PayTrack daily Telegram scheduler disabled (PAYTRACK_DAILY_TELEGRAM_ENABLED=false)');
    return;
  }

  if (!isTelegramConfigured()) {
    log?.info(
      'PayTrack daily Telegram scheduler idle — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable'
    );
    return;
  }

  const hour = configuredDailyHour();
  const tz = configuredTimeZone();
  log?.info(`PayTrack daily Telegram scheduler armed (hour=${hour}, tz=${tz})`);

  const tick = async () => {
    const now = new Date();
    const { hour: localHour, dayKey } = hourInTimeZone(now, tz);
    if (localHour !== hour) return;
    if (lastDailySendDayKey === dayKey) return;
    lastDailySendDayKey = dayKey;
    await runDailyPaytrackTelegramJob(log);
  };

  // Run shortly after boot in case we missed the window (only if already past hour today — skip).
  // Minute poller handles the scheduled send.
  void tick();
  schedulerTimer = setInterval(() => {
    void tick();
  }, 60_000);
  if (typeof schedulerTimer === 'object' && 'unref' in schedulerTimer) {
    schedulerTimer.unref?.();
  }
}
