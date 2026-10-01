import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { signMetaBody, twilioSignature } from '../src/whatsapp.js';

const config = {
  ...loadConfig({}),
  dashboardPassword: 'desk-pass',
  sessionSecret: 'test-secret',
  meta: { ...loadConfig({}).meta, verifyToken: 'vt', appSecret: 'app-secret' },
  twilio: { authToken: 'twilio-token' },
};

let server, base, store, live, cookie;
const replies = [];

before(async () => {
  store = openStore(':memory:');
  ({ app: server, live } = createApp({
    config,
    store,
    sendReply: async (_meta, ctx, text) => replies.push({ ctx, text }),
    log: { warn() {} },
  }));
  await new Promise((resolve) => {
    server = server.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ operator: 'Officer Rao', password: 'desk-pass' }),
  });
  assert.equal(res.status, 303);
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  live.close();
  server.close();
  store.close();
});

function metaPayload(waId, name, message) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN' },
          contacts: [{ wa_id: waId, profile: { name } }],
          messages: [{ from: waId, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  });
}

const postMeta = (body, sig = signMetaBody(body, 'app-secret')) =>
  fetch(`${base}/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
    body,
  });

/** Opens the dashboard stream and returns a reader yielding parsed SSE events. */
async function openStream(query = '') {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream${query}`, { headers: { cookie }, signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  const queue = [];
  async function next() {
    while (!queue.length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += value;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event) queue.push({ event, data: JSON.parse(data) });
      }
    }
    return queue.shift();
  }
  return { next, close: () => controller.abort() };
}

test('dashboard and API require sign-in', async () => {
  const page = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login');
  assert.equal((await fetch(`${base}/api/stream`)).status, 401);
  const bad = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ operator: 'x', password: 'nope' }),
  });
  assert.equal(bad.headers.get('location'), '/login?error=invalid');
  const ok = await fetch(`${base}/`, { headers: { cookie } });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Safety Desk/);
});

test('Meta webhook verification handshake', async () => {
  const ok = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123`);
  assert.equal(await ok.text(), '123');
  const bad = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`);
  assert.equal(bad.status, 403);
});

test('a shared WhatsApp location reaches an open dashboard live, once', async () => {
  const stream = await openStream();
  const snap = await stream.next();
  assert.equal(snap.event, 'snapshot');
  assert.equal(snap.data.operator, 'Officer Rao');

  const body = metaPayload('919000000001', 'Priya', {
    id: 'wamid.loc1',
    type: 'location',
    location: { latitude: 17.385, longitude: 78.4867, name: 'Bus stop' },
  });
  assert.equal((await postMeta(body)).status, 200);
  const ev = await stream.next();
  assert.equal(ev.event, 'location');
  assert.equal(ev.data.user.phone, '+919000000001');
  assert.equal(ev.data.user.name, 'Priya');
  assert.equal(ev.data.location.lat, 17.385);
  assert.equal(ev.data.location.label, 'Bus stop');
  assert.equal(ev.data.user.latest.id, ev.data.location.id);

  // WhatsApp retries deliveries; the retry must not create a second point.
  assert.equal((await postMeta(body)).status, 200);
  const second = metaPayload('919000000002', 'Ananya', {
    id: 'wamid.loc2',
    type: 'location',
    location: { latitude: 17.4, longitude: 78.5 },
  });
  await postMeta(second);
  const ev2 = await stream.next();
  assert.equal(ev2.data.user.phone, '+919000000002', 'duplicate was broadcast');
  assert.match(replies.at(-1).text, /Location received/);
  stream.close();
});

test('unsigned or tampered Meta webhooks are rejected', async () => {
  const body = metaPayload('919000000009', 'X', {
    id: 'wamid.evil',
    type: 'location',
    location: { latitude: 1, longitude: 1 },
  });
  assert.equal((await postMeta(body, 'sha256=deadbeef')).status, 401);
  assert.equal((await postMeta(body, signMetaBody(body + ' ', 'app-secret'))).status, 401);
  assert.equal(store.getUser('+919000000009'), null);
});

test('snapshot shows every user and every shared location in the window', async () => {
  const stream = await openStream('?hours=24');
  const { data } = await stream.next();
  const phones = data.users.map((u) => u.phone).sort();
  assert.deepEqual(phones, ['+919000000001', '+919000000002']);
  assert.equal(data.locations.length, 2);
  assert.ok(data.users.every((u) => u.latest));
  stream.close();
});

test('SOS text raises an alert that an operator acknowledges', async () => {
  const stream = await openStream();
  await stream.next(); // snapshot
  await postMeta(metaPayload('919000000001', 'Priya', { id: 'wamid.sos', type: 'text', text: { body: 'SOS help me' } }));
  const ev = await stream.next();
  assert.equal(ev.event, 'message');
  assert.equal(ev.data.message.isSos, true);
  assert.ok(ev.data.user.sosAt);
  assert.match(replies.at(-1).text, /SOS received/);

  const formPost = await fetch(`${base}/api/users/${encodeURIComponent('+919000000001')}/acknowledge`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(formPost.status, 415);

  const ack = await fetch(`${base}/api/users/${encodeURIComponent('+919000000001')}/acknowledge`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(ack.status, 200);
  const upd = await stream.next();
  assert.equal(upd.event, 'user');
  assert.equal(upd.data.user.sosAt, null);
  assert.equal(upd.data.user.sosAckBy, 'Officer Rao');

  const again = await fetch(`${base}/api/users/${encodeURIComponent('+919000000001')}/acknowledge`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(again.status, 409);
  stream.close();
});

test('Twilio location webhook is verified, stored and answered with TwiML', async () => {
  const stream = await openStream();
  await stream.next();
  const params = { From: 'whatsapp:+919000000003', ProfileName: 'Fatima', Latitude: '12.97', Longitude: '77.59', MessageSid: 'SM1' };
  const url = `${base}/webhook/twilio`;
  const bad = await fetch(url, { method: 'POST', body: new URLSearchParams(params), headers: { 'X-Twilio-Signature': 'nope' } });
  assert.equal(bad.status, 401);
  const res = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams(params),
    headers: { 'X-Twilio-Signature': twilioSignature(url, params, 'twilio-token') },
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<Message>Location received/);
  const ev = await stream.next();
  assert.equal(ev.data.user.name, 'Fatima');
  assert.equal(ev.data.location.provider, 'twilio-whatsapp');
  stream.close();
});

test('per-user history', async () => {
  const res = await fetch(`${base}/api/users/${encodeURIComponent('+919000000001')}/history?hours=0`, { headers: { cookie } });
  const { locations } = await res.json();
  assert.equal(locations.length, 1);
  const missing = await fetch(`${base}/api/users/${encodeURIComponent('+1')}/history`, { headers: { cookie } });
  assert.equal(missing.status, 404);
});
