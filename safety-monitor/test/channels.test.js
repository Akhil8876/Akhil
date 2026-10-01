import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGenericSms } from '../src/sms.js';
import { parseTelegramUpdate } from '../src/telegram.js';
import { parseTrackerRequest } from '../src/tracker.js';

const tgMsg = (extra, edited = false) => ({
  update_id: 1,
  [edited ? 'edited_message' : 'message']: {
    message_id: 7,
    from: { id: 555, is_bot: false, first_name: 'Kavya', last_name: 'Rao' },
    chat: { id: 555, type: 'private' },
    date: 1700000000,
    ...extra,
  },
});

test('Telegram: live location start and its updates', () => {
  const first = parseTelegramUpdate(tgMsg({ location: { latitude: 17.4, longitude: 78.5, live_period: 3600, horizontal_accuracy: 12 } }));
  assert.equal(first.kind, 'location');
  assert.equal(first.live, true);
  assert.equal(first.edited, false);
  assert.equal(first.accuracy, 12);
  assert.equal(first.name, 'Kavya Rao');
  const move = parseTelegramUpdate(tgMsg({ edit_date: 1700000060, location: { latitude: 17.41, longitude: 78.5 } }, true));
  assert.equal(move.edited, true);
  assert.equal(move.sharedAt, 1700000060000);
  assert.notEqual(move.messageId, first.messageId, 'every live update is its own point');
});

test('Telegram: text, /start, contact; ignores groups, bots and edited text', () => {
  assert.equal(parseTelegramUpdate(tgMsg({ text: '/start' })).kind, 'start');
  assert.equal(parseTelegramUpdate(tgMsg({ text: 'SOS' })).text, 'SOS');
  const own = parseTelegramUpdate(tgMsg({ contact: { phone_number: '919876543210', user_id: 555 } }));
  assert.equal(own.ownContact, true);
  assert.equal(own.contactPhone, '+919876543210');
  const other = parseTelegramUpdate(tgMsg({ contact: { phone_number: '919000000000', user_id: 1 } }));
  assert.equal(other.ownContact, false);
  assert.equal(parseTelegramUpdate(tgMsg({ text: 'fixed typo' }, true)), null);
  const group = tgMsg({ text: 'hi' });
  group.message.chat.type = 'group';
  assert.equal(parseTelegramUpdate(group), null);
  const bot = tgMsg({ text: 'hi' });
  bot.message.from.is_bot = true;
  assert.equal(parseTelegramUpdate(bot), null);
});

test('generic SMS gateways with different field names', () => {
  const a = parseGenericSms({ sender: '9876543210', message: 'SOS 482913', id: 'x1' }, { defaultCountryCode: '91', now: 5 });
  assert.deepEqual(
    { phone: a.phone, text: a.text, messageId: a.messageId, provider: a.provider, sharedAt: a.sharedAt },
    { phone: '+919876543210', text: 'SOS 482913', messageId: 'sms:x1', provider: 'sms', sharedAt: 5 },
  );
  assert.equal(parseGenericSms({ mobile: '919876543210', content: 'track' }, { defaultCountryCode: '91' }).phone, '+919876543210');
  assert.equal(parseGenericSms({ from: '9876543210' }, { defaultCountryCode: '91' }), null);
});

test('tracker apps: OsmAnd query string and Traccar Client JSON', () => {
  const now = 1_800_000_000_000;
  const osm = parseTrackerRequest({ id: 'KEY', lat: '17.4', lon: '78.5', timestamp: '1700000000', accuracy: '8', batt: '64' }, {}, now);
  assert.deepEqual(osm, { id: 'KEY', lat: 17.4, lng: 78.5, accuracy: 8, battery: 64, sharedAt: 1700000000000 });
  const json = parseTrackerRequest({}, {
    device_id: 'KEY',
    location: { timestamp: '2023-11-14T22:13:20.000Z', coords: { latitude: 17.4, longitude: 78.5, accuracy: 4 }, battery: { level: 0.5 } },
  }, now);
  assert.deepEqual(json, { id: 'KEY', lat: 17.4, lng: 78.5, accuracy: 4, battery: 50, sharedAt: 1700000000000 });
  assert.equal(parseTrackerRequest({ id: 'KEY', location: '17.4,78.5' }, {}, now).lat, 17.4);
  assert.equal(parseTrackerRequest({ id: 'KEY', lat: '95', lon: '0' }, {}, now), null);
  assert.equal(parseTrackerRequest({ lat: '17', lon: '78' }, {}, now), null);
  assert.equal(parseTrackerRequest({ id: 'K', lat: '17', lon: '78', timestamp: String(now / 1000 + 9999) }, {}, now).sharedAt, now, 'future clamped');
});
