import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalisePhone,
  parseMetaWebhook,
  parseTwilioWebhook,
  signMetaBody,
  twilioSignature,
  twiml,
  verifyMetaSignature,
  verifyTwilioSignature,
} from '../src/whatsapp.js';

const metaBody = (messages, contacts = [{ wa_id: '919876543210', profile: { name: 'Priya' } }]) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, contacts, messages } }] }],
});

test('parses a Meta location message', () => {
  const [m] = parseMetaWebhook(
    metaBody([
      {
        from: '919876543210',
        id: 'wamid.1',
        timestamp: '1700000000',
        type: 'location',
        location: { latitude: 17.4, longitude: 78.5, name: 'Charminar', address: 'Hyderabad' },
      },
    ]),
    1800000000000,
  );
  assert.deepEqual(m, {
    provider: 'whatsapp',
    messageId: 'wamid.1',
    phone: '+919876543210',
    name: 'Priya',
    sharedAt: 1700000000000,
    replyContext: { phoneNumberId: 'PN1', to: '919876543210' },
    kind: 'location',
    lat: 17.4,
    lng: 78.5,
    label: 'Charminar',
    address: 'Hyderabad',
  });
});

test('Meta: text, other types, statuses and bad coordinates', () => {
  const out = parseMetaWebhook(
    metaBody([
      { from: '919876543210', id: 'a', timestamp: '1', type: 'text', text: { body: 'help' } },
      { from: '919876543210', id: 'b', timestamp: '1', type: 'sticker', sticker: {} },
      { from: '919876543210', id: 'c', timestamp: '1', type: 'location', location: { latitude: 200, longitude: 0 } },
    ]),
  );
  assert.deepEqual(out.map((m) => m.kind), ['text', 'other']);
  assert.equal(out[0].text, 'help');
  assert.deepEqual(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{}] } }] }] }), []);
  assert.deepEqual(parseMetaWebhook({ object: 'page' }), []);
});

test('Meta timestamps in the future are clamped to now', () => {
  const [m] = parseMetaWebhook(
    metaBody([{ from: '1', id: 'x', timestamp: '9999999999', type: 'text', text: { body: 'hi' } }]),
    5000,
  );
  assert.equal(m.sharedAt, 5000);
});

test('parses Twilio location and text', () => {
  const [loc] = parseTwilioWebhook(
    { From: 'whatsapp:+919876543210', ProfileName: 'Ana', Latitude: '12.97', Longitude: '77.59', Address: 'MG Road', MessageSid: 'SM1' },
    42,
  );
  assert.equal(loc.kind, 'location');
  assert.equal(loc.phone, '+919876543210');
  assert.equal(loc.lat, 12.97);
  assert.equal(loc.address, 'MG Road');
  assert.equal(loc.sharedAt, 42);
  assert.equal(loc.provider, 'twilio-whatsapp');
  const [txt] = parseTwilioWebhook({ From: '+15555550100', Body: 'SOS', MessageSid: 'SM2' });
  assert.equal(txt.kind, 'text');
  assert.equal(txt.provider, 'sms', 'a Twilio number without the whatsapp: prefix is plain SMS');
  assert.deepEqual(parseTwilioWebhook({}), []);
});

test('phone normalisation', () => {
  assert.equal(normalisePhone('whatsapp:+91 98765-43210'), '+919876543210');
  assert.equal(normalisePhone('919876543210'), '+919876543210');
  assert.equal(normalisePhone(''), null);
  // National formats from Indian SMS gateways
  assert.equal(normalisePhone('9876543210', '91'), '+919876543210');
  assert.equal(normalisePhone('09876543210', '91'), '+919876543210');
  assert.equal(normalisePhone('919876543210', '91'), '+919876543210');
  assert.equal(normalisePhone('+447700900123', '91'), '+447700900123');
  assert.equal(normalisePhone('00447700900123', '91'), '+447700900123');
});

test('Meta signature verification', () => {
  const raw = Buffer.from('{"a":1}');
  const sig = signMetaBody(raw, 'secret');
  assert.ok(verifyMetaSignature(raw, sig, 'secret'));
  assert.ok(!verifyMetaSignature(raw, sig, 'other'));
  assert.ok(!verifyMetaSignature(Buffer.from('{"a":2}'), sig, 'secret'));
  assert.ok(!verifyMetaSignature(raw, undefined, 'secret'));
});

test('Twilio signature verification', () => {
  const params = { From: 'whatsapp:+1', Body: 'hi' };
  const sig = twilioSignature('https://x.test/webhook/twilio', params, 'tok');
  assert.ok(verifyTwilioSignature('https://x.test/webhook/twilio', params, sig, 'tok'));
  assert.ok(!verifyTwilioSignature('https://x.test/webhook/twilio', { ...params, Body: 'no' }, sig, 'tok'));
  assert.ok(!verifyTwilioSignature('https://evil.test/webhook/twilio', params, sig, 'tok'));
});

test('TwiML escapes message text', () => {
  assert.match(twiml('a < b & c'), /<Message>a &lt; b &amp; c<\/Message>/);
});
