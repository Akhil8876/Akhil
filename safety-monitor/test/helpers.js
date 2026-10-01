import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';

export async function startServer({ env = {}, ...deps } = {}) {
  const config = loadConfig({ DASHBOARD_PASSWORD: 'desk-pass', SESSION_SECRET: 'test-secret', ...env });
  const store = openStore(':memory:');
  const { app, live } = createApp({ config, store, log: { warn() {}, error() {} }, ...deps });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ operator: 'Officer Rao', password: 'desk-pass' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const api = (path, { body, method = body ? 'POST' : 'GET' } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  /** Opens the dashboard stream; next() resolves with the next parsed SSE event. */
  async function openStream(query = '') {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/stream${query}`, { headers: { cookie }, signal: controller.signal });
    assert.equal(res.status, 200);
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
    const stream = { next, close: () => controller.abort() };
    const first = await next();
    assert.equal(first.event, 'snapshot');
    stream.snapshot = first.data;
    return stream;
  }

  return {
    base,
    cookie,
    store,
    config,
    api,
    openStream,
    close() {
      live.close();
      server.closeAllConnections();
      server.close();
      store.close();
    },
  };
}
