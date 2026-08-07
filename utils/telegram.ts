/**
 * Thin Telegram Bot API helpers (sendMessage / sendDocument).
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 */

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!id) throw new Error('TELEGRAM_CHAT_ID is not configured');
  return id;
}

async function callTelegramApi(method: string, body: FormData | Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken()}/${method}`;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(url, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? (body as FormData) : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed (${response.status})`);
  }
  return data;
}

export async function sendTelegramMessage(
  text: string,
  options?: { parseMode?: 'HTML' | 'Markdown' }
): Promise<void> {
  await callTelegramApi('sendMessage', {
    chat_id: chatId(),
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
    ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
  });
}

export async function sendTelegramDocument(params: {
  filename: string;
  buffer: Buffer;
  caption?: string;
  contentType?: string;
}): Promise<void> {
  const form = new FormData();
  form.append('chat_id', chatId());
  if (params.caption) {
    form.append('caption', params.caption.slice(0, 1024));
  }
  const blob = new Blob([new Uint8Array(params.buffer)], {
    type: params.contentType || 'application/pdf',
  });
  form.append('document', blob, params.filename);
  await callTelegramApi('sendDocument', form);
}
