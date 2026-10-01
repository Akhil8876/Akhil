import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startServer } from './helpers.js';

const SMS_KEY = 'sms-key';
const TG_SECRET = 'tg-secret';
const telegramSent = [];

let s;
before(async () => {
  s = await startServer({
    env: {
      SMS_WEBHOOK_KEY: SMS_KEY,
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_WEBHOOK_SECRET: TG_SECRET,
      PUBLIC_BASE_URL: 'https://desk.example.org',
    },
    sendTelegram: async (_token, chatId, text, keyboard) => telegramSent.push({ chatId, text, keyboard }),
    sendReply: async () => {},
    fetchImpl: async (url) => {
      if (url === 'https://maps.app.goo.gl/short1') {
        return new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/search/17.3616,+78.4747' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });
});
after(() => s.close());

let smsSeq = 0;
async function sms(from, text) {
  const res = await fetch(`${s.base}/webhook/sms?key=${SMS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sender: from, message: text, id: `m${smsSeq++}` }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).reply;
}

const tokenFrom = (reply) => /https:\/\/desk\.example\.org\/t\/([\w-]+)/.exec(reply)?.[1];

describe('SMS', () => {
  test('rejects calls without the shared key', async () => {
    const res = await fetch(`${s.base}/webhook/sms?key=wrong`, { method: 'POST', body: new URLSearchParams({ from: '1', text: 'x' }) });
    assert.equal(res.status, 401);
  });

  test('first message introduces the helpline and the personal code', async () => {
    const reply = await sms('9811111111', 'hello');
    const user = s.store.getUser('+919811111111');
    assert.ok(user, 'a 10-digit Indian number gets +91');
    assert.match(reply, /safety helpline/);
    assert.match(reply, new RegExp(`personal safety code is ${user.code}`));
    assert.match(user.code, /^[1-9]\d{5}$/);
  });
});

describe('live-sharing link', () => {
  test('TRACK by SMS -> link -> GPS from the page appears live on the dashboard', async () => {
    const stream = await s.openStream();
    const reply = await sms('9822222222', 'TRACK');
    const token = tokenFrom(reply);
    assert.ok(token, reply);
    await stream.next(); // the TRACK message itself

    const page = await fetch(`${s.base}/t/${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Start sharing/);
    const info = await (await fetch(`${s.base}/api/track/${token}`)).json();
    assert.ok(info.expiresAt > Date.now());

    const post = (body) =>
      fetch(`${s.base}/api/track/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r1 = await post({ lat: 17.44, lng: 78.35, accuracy: 9, timestamp: Date.now(), battery: 71 });
    assert.deepEqual(await r1.json(), { ok: true });
    const ev = await stream.next();
    assert.equal(ev.event, 'location');
    assert.equal(ev.data.user.phone, '+919822222222');
    assert.equal(ev.data.location.provider, 'web-link');
    assert.equal(ev.data.location.accuracy, 9);
    assert.equal(ev.data.location.battery, 71);

    // Bursts from the browser are absorbed.
    assert.equal((await (await post({ lat: 17.441, lng: 78.35, timestamp: Date.now() })).json()).throttled, true);

    // The page's SOS button raises an alert for the link owner.
    const sos = await fetch(`${s.base}/api/track/${token}/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await sos.json()).emergencyNumber, '112');
    const alert = await stream.next();
    assert.equal(alert.event, 'message');
    assert.equal(alert.data.message.isSos, true);
    assert.ok(alert.data.user.sosAt);

    // STOP ends the link.
    assert.match(await sms('9822222222', 'STOP'), /stopped/);
    assert.equal((await post({ lat: 1, lng: 1 })).status, 410);
    assert.equal((await fetch(`${s.base}/api/track/${token}`)).status, 410);
    stream.close();
  });

  test('an SOS reply always carries a live-sharing link', async () => {
    const reply = await sms('9833333333', 'help me');
    assert.match(reply, /SOS received/);
    assert.ok(tokenFrom(reply));
  });

  test('bad tokens and bad coordinates are refused', async () => {
    assert.equal((await fetch(`${s.base}/api/track/nope`)).status, 410);
    const reply = await sms('9844444444', 'track');
    const res = await fetch(`${s.base}/api/track/${tokenFrom(reply)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 'x', lng: 1 }),
    });
    assert.equal(res.status, 400);
  });
});

describe('personal codes', () => {
  test('desk registers a person; "SOS <code>" from a borrowed phone alerts for them', async () => {
    const res = await s.api('/api/people', { body: { name: 'Meera Joshi', phone: '98 5555 5555' } });
    const { user } = await res.json();
    assert.equal(user.phone, '+919855555555');
    assert.equal(user.name, 'Meera Joshi');

    const stream = await s.openStream();
    const reply = await sms('9866666666', `SOS ${user.code} I am near the station`);
    assert.match(reply, new RegExp(`SOS received for code ${user.code}`));
    const ev = await stream.next();
    assert.equal(ev.data.user.phone, '+919855555555', 'attributed to the code owner');
    assert.equal(ev.data.user.name, 'Meera Joshi', 'owner keeps their name');
    assert.equal(ev.data.message.sentFrom, '+919866666666');
    assert.ok(ev.data.user.sosAt);

    // TRACK <code> gives a link that shares as the owner.
    const token = tokenFrom(await sms('9866666666', `TRACK ${user.code}`));
    assert.equal(s.store.resolveLink(token, 'web', Date.now()).phone, '+919855555555');
    stream.close();
  });

  test('an unknown code still raises the alert for the sender', async () => {
    const reply = await sms('9877777777', 'SOS 999999');
    assert.match(reply, /SOS received/);
    assert.match(reply, /999999 was not recognised/);
    assert.ok(s.store.getUser('+919877777777').sosAt);
  });

  test('rejects an invalid phone number', async () => {
    assert.equal((await s.api('/api/people', { body: { phone: '12' } })).status, 400);
  });
});

describe('map links in messages', () => {
  test('a pasted Google Maps link becomes a point', async () => {
    const stream = await s.openStream();
    await sms('9888888888', 'I am here https://maps.google.com/?q=17.385044,78.486671');
    assert.equal((await stream.next()).event, 'message');
    const ev = await stream.next();
    assert.equal(ev.event, 'location');
    assert.equal(ev.data.location.lat, 17.385044);
    assert.equal(ev.data.location.label, 'From a map link');
    assert.equal(ev.data.location.provider, 'sms');
    stream.close();
  });

  test('a maps.app.goo.gl short link is expanded', async () => {
    const reply = await sms('9899999999', 'https://maps.app.goo.gl/short1');
    assert.match(reply, /Location received from your map link/);
    const latest = s.store.getUser('+919899999999').latest;
    assert.deepEqual([latest.lat, latest.lng], [17.3616, 78.4747]);
  });
});

describe('tracker app / GPS device', () => {
  test('device key -> OsmAnd fixes appear live; replacing the key cuts off the old one', async () => {
    const { user } = await (await s.api('/api/people', { body: { name: 'Riya Das', phone: '9800012345' } })).json();
    const { identifier, serverUrl } = await (await s.api(`/api/users/${encodeURIComponent(user.phone)}/device-key`, { body: {} })).json();
    assert.equal(serverUrl, 'https://desk.example.org/track/osmand');

    const stream = await s.openStream();
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(`${s.base}/track/osmand?id=${identifier}&lat=17.45&lon=78.38&timestamp=${ts}&accuracy=6&batt=55`);
    assert.equal(res.status, 200);
    const ev = await stream.next();
    assert.equal(ev.data.user.phone, user.phone);
    assert.equal(ev.data.location.provider, 'tracker');
    assert.equal(ev.data.location.battery, 55);

    // Trackers resend buffered points after losing signal: no duplicates.
    await fetch(`${s.base}/track/osmand?id=${identifier}&lat=17.45&lon=78.38&timestamp=${ts}`);
    // Traccar Client 9 JSON
    await fetch(`${s.base}/track/osmand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: identifier, location: { timestamp: new Date().toISOString(), coords: { latitude: 17.46, longitude: 78.39, accuracy: 3 } } }),
    });
    const ev2 = await stream.next();
    assert.equal(ev2.data.location.lat, 17.46, 'the resent point was not broadcast again');

    await s.api(`/api/users/${encodeURIComponent(user.phone)}/device-key`, { body: {} });
    assert.equal((await fetch(`${s.base}/track/osmand?id=${identifier}&lat=1&lon=1`)).status, 401);
    assert.equal((await fetch(`${s.base}/track/osmand?id=guess&lat=1&lon=1`)).status, 401);
    stream.close();
  });

  test('desk can hand out a live-sharing link', async () => {
    const { url } = await (await s.api(`/api/users/${encodeURIComponent('+919800012345')}/tracking-link`, { body: {} })).json();
    assert.match(url, /^https:\/\/desk\.example\.org\/t\/[\w-]+$/);
    assert.equal((await s.api(`/api/users/${encodeURIComponent('+1000')}/tracking-link`, { body: {} })).status, 404);
  });
});

describe('Telegram', () => {
  let updateId = 0;
  const tg = (message, edited = false, secret = TG_SECRET) =>
    fetch(`${s.base}/webhook/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify({
        update_id: updateId++,
        [edited ? 'edited_message' : 'message']: {
          message_id: 10,
          from: { id: 4242, is_bot: false, first_name: 'Aisha' },
          chat: { id: 4242, type: 'private' },
          date: Math.floor(Date.now() / 1000) - 60,
          ...message,
        },
      }),
    });
  const until = async (stream, event) => {
    for (;;) {
      const ev = await stream.next();
      if (ev.event === event) return ev;
    }
  };

  test('rejects updates without the webhook secret', async () => {
    assert.equal((await tg({ text: 'hi' }, false, 'wrong')).status, 401);
  });

  test('live location streams; linking the phone number merges the history', async () => {
    const stream = await s.openStream();
    await tg({ text: '/start' });
    assert.match(telegramSent.at(-1).text, /personal safety code/);
    assert.ok(telegramSent.at(-1).keyboard.keyboard, 'offers the location / phone buttons');

    await tg({ location: { latitude: 17.5, longitude: 78.6, live_period: 900 } });
    const first = await until(stream, 'location');
    assert.equal(first.data.user.phone, 'tg:4242');
    assert.equal(first.data.location.provider, 'telegram');
    assert.match(telegramSent.at(-1).text, /Live location received/);
    const sentBefore = telegramSent.length;

    const now = Math.floor(Date.now() / 1000);
    await tg({ edit_date: now, location: { latitude: 17.501, longitude: 78.601, live_period: 900 } }, true);
    const moved = await until(stream, 'location');
    assert.equal(moved.data.location.lat, 17.501);
    assert.equal(telegramSent.length, sentBefore, 'no reply to each live update');

    await tg({ message_id: 11, contact: { phone_number: '+919812312312', user_id: 4242 } });
    await until(stream, 'refresh');
    assert.equal(s.store.getUser('tg:4242'), null);
    const merged = s.store.getUser('+919812312312');
    assert.equal(merged.locationCount, 2, 'Telegram history moved to the phone number');
    assert.equal(merged.name, 'Aisha');

    // Later Telegram messages land on the phone number directly.
    await tg({ message_id: 12, text: 'SOS' });
    assert.ok(s.store.getUser('+919812312312').sosAt);
    assert.equal(s.store.getUser('tg:4242'), null);
    stream.close();
  });

  test('someone else\'s contact card is not accepted as their number', async () => {
    await tg({ message_id: 20, contact: { phone_number: '+919000000001', user_id: 1 } });
    assert.match(telegramSent.at(-1).text, /share your own phone number/);
    assert.equal(s.store.getUser('+919000000001'), null);
  });
});

test('existing databases gain the new columns and every person gets a code', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { openStore } = await import('../src/store.js');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'sm-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE users (phone TEXT PRIMARY KEY, name TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      sos_at INTEGER, sos_ack_at INTEGER, sos_ack_by TEXT);
    CREATE TABLE locations (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL REFERENCES users(phone),
      lat REAL NOT NULL, lng REAL NOT NULL, label TEXT, address TEXT, provider TEXT NOT NULL, message_id TEXT UNIQUE,
      shared_at INTEGER NOT NULL, received_at INTEGER NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL REFERENCES users(phone),
      body TEXT NOT NULL, is_sos INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL, message_id TEXT UNIQUE,
      shared_at INTEGER NOT NULL, received_at INTEGER NOT NULL);
    INSERT INTO users VALUES ('+911', 'Old', 1, 1, NULL, NULL, NULL);
    INSERT INTO locations (phone, lat, lng, provider, shared_at, received_at) VALUES ('+911', 1, 2, 'meta', 1, 1);
  `);
  old.close();
  const store = openStore(path);
  const user = store.getUser('+911');
  assert.match(user.code, /^[1-9]\d{5}$/);
  assert.equal(user.latest.accuracy, null);
  store.close();
});
