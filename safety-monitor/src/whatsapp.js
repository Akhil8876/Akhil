import { createHmac, timingSafeEqual } from 'node:crypto';

// Normalised inbound message, whichever provider delivered it:
// { provider, messageId, phone, name, sharedAt, kind: 'location'|'text'|'other',
//   lat, lng, label, address, text, replyContext }

/**
 * Turns any provider's sender format into E.164 (+919876543210). With a default country code,
 * national numbers (9876543210 or 09876543210, as Indian SMS gateways often send) get it added.
 */
export function normalisePhone(raw, defaultCountryCode = null) {
  const value = String(raw ?? '').replace(/^whatsapp:/i, '').trim();
  let digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (value.startsWith('00')) digits = digits.slice(2);
  else if (defaultCountryCode && !value.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
    else if (digits.length === 10) digits = defaultCountryCode + digits;
  }
  return `+${digits}`;
}

export function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const clean = (v, max = 300) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** WhatsApp Business Cloud API (Meta) webhook body -> normalised messages. */
export function parseMetaWebhook(body, now = Date.now()) {
  const out = [];
  if (body?.object !== 'whatsapp_business_account') return out;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const phone = normalisePhone(m.from);
        if (!phone) continue;
        const ts = Number(m.timestamp);
        const base = {
          provider: 'whatsapp',
          messageId: clean(m.id, 200),
          phone,
          name: clean(names.get(m.from), 100),
          sharedAt: Number.isFinite(ts) && ts > 0 ? Math.min(ts * 1000, now) : now,
          replyContext: { phoneNumberId: value.metadata?.phone_number_id, to: m.from },
        };
        if (m.type === 'location' && m.location) {
          const lat = Number(m.location.latitude);
          const lng = Number(m.location.longitude);
          if (!isValidCoordinate(lat, lng)) continue;
          out.push({
            ...base,
            kind: 'location',
            lat,
            lng,
            label: clean(m.location.name),
            address: clean(m.location.address),
          });
        } else if (m.type === 'text' && m.text?.body) {
          out.push({ ...base, kind: 'text', text: clean(m.text.body, 2000) });
        } else {
          out.push({ ...base, kind: 'other' });
        }
      }
    }
  }
  return out;
}

/** Twilio webhook form fields (WhatsApp or plain SMS, same format) -> normalised messages. */
export function parseTwilioWebhook(form, now = Date.now()) {
  const phone = normalisePhone(form?.From);
  if (!phone) return [];
  const base = {
    provider: /^whatsapp:/i.test(form.From) ? 'twilio-whatsapp' : 'sms',
    messageId: clean(form.MessageSid, 200),
    phone,
    name: clean(form.ProfileName, 100),
    sharedAt: now,
    replyContext: null,
  };
  if (form.Latitude != null && form.Longitude != null) {
    const lat = Number(form.Latitude);
    const lng = Number(form.Longitude);
    if (isValidCoordinate(lat, lng)) {
      return [{ ...base, kind: 'location', lat, lng, label: clean(form.Label), address: clean(form.Address) }];
    }
  }
  if (clean(form.Body)) return [{ ...base, kind: 'text', text: clean(form.Body, 2000) }];
  return [{ ...base, kind: 'other' }];
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!rawBody || !header) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, String(header));
}

export function signMetaBody(rawBody, appSecret) {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Twilio signs the full URL followed by each POST param (sorted by name) as key+value. */
export function twilioSignature(url, params, authToken) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilioSignature(url, params, header, authToken) {
  if (!header) return false;
  return safeEqual(twilioSignature(url, params, authToken), String(header));
}

/** Sends a text reply through the Cloud API. No-op without an access token. */
export async function sendMetaText(meta, replyContext, text) {
  if (!meta.accessToken || !replyContext?.phoneNumberId || !replyContext?.to) return false;
  const url = `https://graph.facebook.com/${meta.graphVersion}/${encodeURIComponent(replyContext.phoneNumberId)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${meta.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: replyContext.to,
      type: 'text',
      text: { body: text },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`WhatsApp reply failed: ${res.status} ${await res.text()}`);
  return true;
}

export function twiml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
