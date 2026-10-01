// Telegram bot channel. Unlike WhatsApp, Telegram forwards *live* location to bots: the
// first share arrives as a message and every movement after it as an edit of that message.
import { isValidCoordinate, normalisePhone } from './whatsapp.js';

const clean = (v, max = 300) => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Telegram Update -> one normalised event, or null when there is nothing to act on. */
export function parseTelegramUpdate(update, now = Date.now()) {
  const edited = Boolean(update?.edited_message);
  const msg = update?.message ?? update?.edited_message;
  if (!msg?.from || msg.from.is_bot || msg.chat?.type !== 'private') return null;
  const at = (msg.edit_date ?? msg.date) * 1000;
  const base = {
    provider: 'telegram',
    tgId: String(msg.from.id),
    chatId: msg.chat.id,
    name: clean([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), 100),
    sharedAt: Number.isFinite(at) && at > 0 ? Math.min(at, now) : now,
    edited,
  };
  if (msg.location) {
    const lat = Number(msg.location.latitude);
    const lng = Number(msg.location.longitude);
    if (!isValidCoordinate(lat, lng)) return null;
    return {
      ...base,
      kind: 'location',
      lat,
      lng,
      accuracy: Number.isFinite(msg.location.horizontal_accuracy) ? msg.location.horizontal_accuracy : null,
      live: Boolean(msg.location.live_period) || edited,
      // Each edit of a live location is a new point; the edit time makes it unique.
      messageId: `tg:${msg.chat.id}:${msg.message_id}:${msg.edit_date ?? msg.date}`,
    };
  }
  if (edited) return null; // an edited text message is not a new message
  const messageId = `tg:${msg.chat.id}:${msg.message_id}`;
  if (msg.contact) {
    return {
      ...base,
      kind: 'contact',
      messageId,
      ownContact: String(msg.contact.user_id) === base.tgId,
      contactPhone: normalisePhone(msg.contact.phone_number),
    };
  }
  if (msg.venue?.location) return null; // venues always carry a location field too
  const text = clean(msg.text ?? msg.caption, 2000);
  if (text && /^\/start\b/i.test(text)) return { ...base, kind: 'start', messageId };
  if (text) return { ...base, kind: 'text', text, messageId };
  return { ...base, kind: 'other', messageId };
}

export const TELEGRAM_KEYBOARD = {
  keyboard: [
    [{ text: '📍 Send my location', request_location: true }],
    [{ text: '📱 Share my phone number', request_contact: true }],
  ],
  resize_keyboard: true,
};

export async function sendTelegramText(botToken, chatId, text, replyMarkup) {
  if (!botToken) return false;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram reply failed: ${res.status} ${await res.text()}`);
  return true;
}
