// Generic inbound-SMS webhook for gateways other than Twilio (MSG91, Exotel, Textlocal,
// Gupshup, a GSM modem bridge...). They all post the sender and the text, under different names.
import { normalisePhone } from './whatsapp.js';

const pick = (obj, names) => {
  for (const n of names) {
    if (obj[n] != null && String(obj[n]).trim() !== '') return String(obj[n]);
  }
  return null;
};

export function parseGenericSms(fields, { defaultCountryCode, now = Date.now() }) {
  const from = pick(fields, ['from', 'From', 'sender', 'Sender', 'mobile', 'Mobile', 'msisdn', 'phone', 'number']);
  const text = pick(fields, ['text', 'Text', 'message', 'Message', 'body', 'Body', 'content', 'Content', 'sms', 'msg']);
  const phone = normalisePhone(from, defaultCountryCode);
  if (!phone || !text) return null;
  const id = pick(fields, ['id', 'messageId', 'message_id', 'MessageSid', 'sms_id', 'smsId', 'uuid']);
  return {
    provider: 'sms',
    messageId: id ? `sms:${id}` : null,
    phone,
    name: null,
    sharedAt: now,
    kind: 'text',
    text: text.trim().slice(0, 2000),
  };
}
