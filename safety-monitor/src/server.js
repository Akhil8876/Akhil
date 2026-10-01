import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { openStore } from './store.js';

const config = loadConfig();

if (!config.dashboardPassword) {
  config.dashboardPassword = randomBytes(9).toString('base64url');
  console.warn(`[auth] DASHBOARD_PASSWORD is not set. Generated one for this run: ${config.dashboardPassword}`);
}
if (!config.sessionSecret) {
  console.warn('[auth] SESSION_SECRET is not set: sessions will not survive a restart.');
}
if (!config.meta.appSecret) {
  console.warn('[webhook] WHATSAPP_APP_SECRET is not set: Meta webhook signatures are NOT verified.');
}
if (!config.twilio.authToken) {
  console.warn('[webhook] TWILIO_AUTH_TOKEN is not set: Twilio webhook signatures are NOT verified.');
}

const store = openStore(config.dbPath);
const { app, live } = createApp({ config, store });

const purge = () => {
  const removed = store.purgeOlderThan(Date.now() - config.retentionDays * 86_400_000);
  if (removed.locations || removed.messages) {
    console.log(`[retention] removed ${removed.locations} locations, ${removed.messages} messages`);
  }
};
purge();
setInterval(purge, 3600_000).unref();

const server = app.listen(config.port, () => {
  console.log(`Safety monitor listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  live.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Browsers hold keep-alive sockets open; without this close() would wait on them.
  server.closeAllConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
