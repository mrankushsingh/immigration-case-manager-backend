import { db } from './database.js';
import { isTelegramConfigured, sendTelegramMessage } from './telegram.js';

const SETTINGS_KEY = 'inactive_client_telegram_notified';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

type NotifiedMap = Record<string, string>; // clientId -> ISO timestamp of last notify

type ClientLike = {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  case_template_id?: string;
  case_type?: string;
  created_at?: string;
  required_documents?: Array<{ submitted?: boolean; fileUrl?: string }>;
  additional_documents?: Array<{ fileUrl?: string }>;
  aportar_documentacion?: Array<{ fileUrl?: string }>;
  requerimiento?: Array<{ fileUrl?: string }>;
  resolucion?: Array<{ fileUrl?: string }>;
  justificante_presentacion?: Array<{ fileUrl?: string }>;
  requested_documents?: Array<{ submitted?: boolean; fileUrl?: string }>;
};

function clientName(c: ClientLike): string {
  return `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unnamed client';
}

function hasCaseTemplate(c: ClientLike): boolean {
  return Boolean(c.case_template_id && String(c.case_template_id).trim());
}

function hasAnyUploadedDocument(c: ClientLike): boolean {
  const required = c.required_documents || [];
  if (required.some((d) => Boolean(d?.submitted) || Boolean(d?.fileUrl))) return true;

  for (const arr of [
    c.additional_documents,
    c.aportar_documentacion,
    c.requerimiento,
    c.resolucion,
    c.justificante_presentacion,
  ]) {
    if ((arr || []).some((d) => Boolean(d?.fileUrl))) return true;
  }

  if ((c.requested_documents || []).some((d) => Boolean(d?.submitted) || Boolean(d?.fileUrl))) {
    return true;
  }

  return false;
}

/** New client with no progress: no template and no uploaded docs, created ≥ 14 days ago. */
export function isStaleNewClient(c: ClientLike, now: Date = new Date()): boolean {
  if (!c.created_at) return false;
  const created = new Date(c.created_at).getTime();
  if (Number.isNaN(created)) return false;
  if (now.getTime() - created < TWO_WEEKS_MS) return false;
  return !hasCaseTemplate(c) && !hasAnyUploadedDocument(c);
}

function daysSinceCreated(c: ClientLike, now: Date): number {
  const created = new Date(c.created_at || '').getTime();
  if (Number.isNaN(created)) return 0;
  return Math.floor((now.getTime() - created) / (24 * 60 * 60 * 1000));
}

async function readNotifiedMap(): Promise<NotifiedMap> {
  const raw = await db.getSetting(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeNotifiedMap(map: NotifiedMap): Promise<void> {
  // Keep map from growing forever — drop entries for clients no longer stale / missing.
  await db.setSetting(SETTINGS_KEY, JSON.stringify(map));
}

function configuredDailyHour(): number {
  const raw = Number(
    process.env.INACTIVE_CLIENT_TELEGRAM_HOUR || process.env.PAYTRACK_DAILY_TELEGRAM_HOUR
  );
  if (Number.isFinite(raw) && raw >= 0 && raw <= 23) return Math.floor(raw);
  return 9;
}

function configuredTimeZone(): string {
  return (
    process.env.INACTIVE_CLIENT_TELEGRAM_TZ?.trim() ||
    process.env.PAYTRACK_DAILY_TELEGRAM_TZ?.trim() ||
    'Europe/Madrid'
  );
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

function buildDigestMessage(clients: ClientLike[], now: Date): string {
  const lines = [
    '⚠️ Inactive new clients (2+ weeks)',
    'No case template and no documents uploaded.',
    '',
  ];

  for (const c of clients.slice(0, 25)) {
    const days = daysSinceCreated(c, now);
    const bits = [
      `• ${clientName(c)}`,
      `(${days} days)`,
    ];
    if (c.phone) bits.push(`· ${c.phone}`);
    lines.push(bits.join(' '));
  }

  if (clients.length > 25) {
    lines.push(`… and ${clients.length - 25} more`);
  }

  lines.push('', 'Assign a template or upload a document to clear the alert.');
  return lines.join('\n');
}

export async function runInactiveClientTelegramJob(log?: {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}): Promise<{ sent: number; clients: number }> {
  if (!isTelegramConfigured()) {
    log?.info('Inactive-client Telegram skipped — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
    return { sent: 0, clients: 0 };
  }

  if (process.env.INACTIVE_CLIENT_TELEGRAM_ENABLED === 'false') {
    log?.info('Inactive-client Telegram disabled (INACTIVE_CLIENT_TELEGRAM_ENABLED=false)');
    return { sent: 0, clients: 0 };
  }

  const now = new Date();
  const allClients = (await db.getClients()) as ClientLike[];
  const stale = allClients.filter((c) => isStaleNewClient(c, now));
  const notified = await readNotifiedMap();

  // Notify once when first eligible; re-notify every 14 days while still stale.
  const due = stale.filter((c) => {
    const last = notified[c.id];
    if (!last) return true;
    const lastMs = new Date(last).getTime();
    if (Number.isNaN(lastMs)) return true;
    return now.getTime() - lastMs >= TWO_WEEKS_MS;
  });

  // Prune notified map: drop clients that are no longer stale (got template/docs).
  const staleIds = new Set(stale.map((c) => c.id));
  const nextMap: NotifiedMap = {};
  for (const [id, at] of Object.entries(notified)) {
    if (staleIds.has(id)) nextMap[id] = at;
  }

  if (due.length === 0) {
    await writeNotifiedMap(nextMap);
    log?.info('Inactive-client Telegram: no new alerts');
    return { sent: 0, clients: 0 };
  }

  try {
    await sendTelegramMessage(buildDigestMessage(due, now));
    const stamp = now.toISOString();
    for (const c of due) {
      nextMap[c.id] = stamp;
    }
    await writeNotifiedMap(nextMap);
    log?.info(`Inactive-client Telegram sent for ${due.length} client(s)`);
    return { sent: 1, clients: due.length };
  } catch (err) {
    log?.error('Inactive-client Telegram failed', err);
    throw err;
  }
}

let lastDailySendDayKey: string | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Daily check: clients created 2+ weeks ago with no template and no uploads → Telegram reminder.
 */
export function startInactiveClientTelegramScheduler(log?: {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}): void {
  if (process.env.INACTIVE_CLIENT_TELEGRAM_ENABLED === 'false') {
    log?.info('Inactive-client Telegram scheduler disabled');
    return;
  }

  if (!isTelegramConfigured()) {
    log?.info(
      'Inactive-client Telegram scheduler idle — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable'
    );
    return;
  }

  const hour = configuredDailyHour();
  const tz = configuredTimeZone();
  log?.info(`Inactive-client Telegram scheduler armed (hour=${hour}, tz=${tz}, after=14d)`);

  const tick = async () => {
    const now = new Date();
    const { hour: localHour, dayKey } = hourInTimeZone(now, tz);
    if (localHour !== hour) return;
    if (lastDailySendDayKey === dayKey) return;
    lastDailySendDayKey = dayKey;
    try {
      await runInactiveClientTelegramJob(log);
    } catch (err) {
      log?.error('Inactive-client Telegram daily job failed', err);
    }
  };

  void tick();
  schedulerTimer = setInterval(() => {
    void tick();
  }, 60_000);
  if (typeof schedulerTimer === 'object' && 'unref' in schedulerTimer) {
    schedulerTimer.unref?.();
  }
}
