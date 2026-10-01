import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAuth } from './auth.js';
import { createIngest } from './ingest.js';
import { createLiveHub } from './live.js';
import { parseGenericSms } from './sms.js';
import { parseTelegramUpdate, sendTelegramText, TELEGRAM_KEYBOARD } from './telegram.js';
import { parseTrackerRequest } from './tracker.js';
import {
  isValidCoordinate,
  normalisePhone,
  parseMetaWebhook,
  parseTwilioWebhook,
  sendMetaText,
  twiml,
  verifyMetaSignature,
  verifyTwilioSignature,
} from './whatsapp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const HOUR = 3600_000;

export function createApp({
  config,
  store,
  now = Date.now,
  sendReply = sendMetaText,
  sendTelegram = sendTelegramText,
  fetchImpl = fetch,
  log = console,
}) {
  const app = express();
  const live = createLiveHub();
  const ingest = createIngest({ config, store, live, now, fetchImpl, log });
  const auth = createAuth({
    password: config.dashboardPassword,
    secret: config.sessionSecret,
    sessionHours: config.sessionHours,
    now,
  });

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  const baseUrl = (req) => config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  const deliver = (promise, who) =>
    Promise.resolve(promise).catch((err) => log.warn(`[reply] ${who}: ${err.message}`));

  // --- WhatsApp Cloud API (Meta) -------------------------------------------------------------
  app.get('/webhook/whatsapp', (req, res) => {
    const ok =
      req.query['hub.mode'] === 'subscribe' &&
      config.meta.verifyToken &&
      req.query['hub.verify_token'] === config.meta.verifyToken;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  });

  app.post(
    '/webhook/whatsapp',
    express.json({ limit: '1mb', verify: (req, _res, buf) => (req.rawBody = buf) }),
    async (req, res, next) => {
      try {
        if (
          config.meta.appSecret &&
          !verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), config.meta.appSecret)
        ) {
          return res.sendStatus(401);
        }
        for (const inbound of parseMetaWebhook(req.body, now())) {
          const { reply } = await ingest.handle(inbound, { baseUrl: baseUrl(req) });
          if (reply) deliver(sendReply(config.meta, inbound.replyContext, reply), inbound.phone);
        }
        res.sendStatus(200);
      } catch (err) {
        next(err);
      }
    },
  );

  // --- Twilio: WhatsApp and SMS share one webhook format -------------------------------------
  app.post('/webhook/twilio', express.urlencoded({ extended: false, limit: '1mb' }), async (req, res, next) => {
    try {
      if (config.twilio.authToken) {
        const ok = verifyTwilioSignature(
          baseUrl(req) + req.originalUrl,
          req.body ?? {},
          req.get('x-twilio-signature'),
          config.twilio.authToken,
        );
        if (!ok) return res.sendStatus(401);
      }
      const [inbound] = parseTwilioWebhook(req.body, now());
      const reply = inbound ? (await ingest.handle(inbound, { baseUrl: baseUrl(req) })).reply : null;
      res.type('text/xml').send(reply ? twiml(reply) : '<Response/>');
    } catch (err) {
      next(err);
    }
  });

  // --- Any other SMS gateway (MSG91, Exotel, Gupshup, a GSM modem bridge...) -------------------
  // Authenticated by a shared key in the URL: /webhook/sms?key=...
  app.all(
    '/webhook/sms',
    express.urlencoded({ extended: false, limit: '256kb' }),
    express.json({ limit: '256kb' }),
    async (req, res, next) => {
      try {
        if (!config.smsWebhookKey) return res.status(404).json({ error: 'SMS webhook not configured' });
        if (req.query.key !== config.smsWebhookKey) return res.sendStatus(401);
        const fields = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
        delete fields.key;
        const inbound = parseGenericSms(fields, { defaultCountryCode: config.defaultCountryCode, now: now() });
        if (!inbound) return res.status(400).json({ error: 'expected sender and text' });
        const { reply } = await ingest.handle(inbound, { baseUrl: baseUrl(req) });
        // Gateways that support it can send `reply` back; others need an outbound SMS API.
        res.json({ ok: true, reply });
      } catch (err) {
        next(err);
      }
    },
  );

  // --- Telegram bot ------------------------------------------------------------------------
  app.post('/webhook/telegram', express.json({ limit: '1mb' }), async (req, res, next) => {
    try {
      if (!config.telegram.botToken) return res.sendStatus(404);
      if (
        config.telegram.webhookSecret &&
        req.get('x-telegram-bot-api-secret-token') !== config.telegram.webhookSecret
      ) {
        return res.sendStatus(401);
      }
      const ev = parseTelegramUpdate(req.body, now());
      res.sendStatus(200); // Telegram only needs the acknowledgement; replies go through the API
      if (!ev) return;

      const linkedPhone = store.telegramPhone(ev.tgId);
      const phone = linkedPhone ?? `tg:${ev.tgId}`;
      const say = (text, keyboard = linkedPhone ? undefined : TELEGRAM_KEYBOARD) =>
        deliver(sendTelegram(config.telegram.botToken, ev.chatId, text, keyboard), phone);

      if (ev.kind === 'start') {
        const user = store.ensureUser(phone, ev.name, ev.sharedAt);
        say(
          'This is the safety helpline. Tap "Send my location", or for continuous tracking use ' +
            '📎 > Location > Share My Live Location. Send SOS for urgent help. ' +
            `Your personal safety code is ${user.code}. ` +
            (linkedPhone ? '' : 'Tap "Share my phone number" so the desk can call you back.'),
          TELEGRAM_KEYBOARD,
        );
        return;
      }
      if (ev.kind === 'contact') {
        if (!ev.ownContact || !ev.contactPhone) {
          say('Please share your own phone number with the button below.');
          return;
        }
        const { user, merged } = store.linkTelegram(ev.tgId, ev.contactPhone, ev.name, ev.sharedAt);
        if (merged) live.broadcast('refresh', {});
        else live.broadcast('user', { user });
        say(`Thank you. Your Telegram is now linked to ${ev.contactPhone}. Your personal safety code is ${user.code}.`, {
          remove_keyboard: true,
        });
        return;
      }
      const { reply } = await ingest.handle(
        { ...ev, phone },
        { baseUrl: baseUrl(req), liveUpdate: ev.kind === 'location' && ev.edited },
      );
      if (reply) say(reply);
    } catch (err) {
      if (res.headersSent) log.warn(`[telegram] ${err.message}`);
      else next(err);
    }
  });

  // --- Tracker apps and GPS devices (OsmAnd protocol / Traccar Client) -----------------------
  app.all(
    '/track/osmand',
    express.urlencoded({ extended: false, limit: '64kb' }),
    express.json({ limit: '64kb' }),
    (req, res) => {
      const fix = parseTrackerRequest(req.query, req.body, now());
      if (!fix) return res.sendStatus(400);
      const link = store.resolveLink(fix.id, 'device', now());
      if (!link) return res.sendStatus(401);
      store.touchLink(link.token, now());
      ingest.addLocation({
        phone: link.phone,
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        battery: fix.battery,
        provider: 'tracker',
        messageId: `dev:${link.phone}:${fix.sharedAt}`, // trackers resend buffered points
        sharedAt: fix.sharedAt,
      });
      res.sendStatus(200);
    },
  );

  // --- Live-sharing page (opened from a TRACK / SOS link; the token is the credential) --------
  const lastFix = new Map(); // token -> time of last accepted fix, to absorb bursts

  app.get('/t/:token', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(join(PUBLIC, 'track.html'));
  });

  app.get('/api/track/:token', (req, res) => {
    const link = store.resolveLink(req.params.token, 'web', now());
    if (!link) return res.status(410).json({ error: 'This link has expired. Send TRACK for a new one.' });
    const user = store.getUser(link.phone);
    res.json({ name: user?.name ?? null, expiresAt: link.expiresAt, serverTime: now() });
  });

  app.post('/api/track/:token', express.json({ limit: '16kb' }), (req, res) => {
    const link = store.resolveLink(req.params.token, 'web', now());
    if (!link) return res.status(410).json({ error: 'expired' });
    const { lat, lng, accuracy, timestamp, battery } = req.body ?? {};
    if (!isValidCoordinate(lat, lng)) return res.status(400).json({ error: 'bad coordinates' });
    const t = now();
    if (t - (lastFix.get(link.token) ?? 0) < 2000) return res.json({ ok: true, throttled: true });
    if (lastFix.size > 10_000) lastFix.clear();
    lastFix.set(link.token, t);
    store.touchLink(link.token, t);
    const sharedAt = Number.isFinite(timestamp) ? Math.min(timestamp, t) : t;
    ingest.addLocation({
      phone: link.phone,
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      battery: Number.isFinite(battery) ? battery : null,
      provider: 'web-link',
      messageId: `web:${link.phone}:${sharedAt}`,
      sharedAt,
    });
    res.json({ ok: true });
  });

  app.post('/api/track/:token/sos', express.json({ limit: '16kb' }), (req, res) => {
    const link = store.resolveLink(req.params.token, 'web', now());
    if (!link) return res.status(410).json({ error: 'expired' });
    const saved = store.addMessage({
      phone: link.phone,
      body: 'SOS button pressed on the live sharing page',
      isSos: true,
      provider: 'web-link',
      sharedAt: now(),
      receivedAt: now(),
    });
    live.broadcast('message', saved);
    res.json({ ok: true, emergencyNumber: config.emergencyNumber });
  });

  // --- Dashboard sign-in --------------------------------------------------------------------
  app.get('/login', (req, res) => {
    if (auth.session(req)) return res.redirect('/');
    res.sendFile(join(PUBLIC, 'login.html'));
  });

  app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    const operator = String(req.body?.operator ?? '').trim().slice(0, 60);
    const result = auth.checkPassword(req.ip, String(req.body?.password ?? ''));
    if (!result.ok || !operator) {
      const reason = result.locked ? 'locked' : operator ? 'invalid' : 'operator';
      return res.redirect(303, `/login?error=${reason}`);
    }
    res.set('Set-Cookie', auth.cookie(operator, req.secure));
    res.redirect(303, '/');
  });

  app.post('/logout', (req, res) => {
    res.set('Set-Cookie', auth.clearCookie());
    res.redirect(303, '/login');
  });

  app.get('/', auth.requirePage, (req, res) => res.sendFile(join(PUBLIC, 'index.html')));
  app.use('/vendor/leaflet', express.static(join(ROOT, 'node_modules/leaflet/dist')));
  app.use(express.static(PUBLIC, { index: false }));

  // --- Dashboard API ------------------------------------------------------------------------
  const windowStart = (hours) => {
    const h = Number(hours);
    return Number.isFinite(h) && h > 0 ? now() - h * HOUR : 0;
  };
  // State-changing calls are JSON-only, so a cross-site form post cannot trigger them.
  const jsonOnly = (req, res, next) =>
    req.is('application/json') ? next() : res.status(415).json({ error: 'expected JSON' });
  const knownUser = (req, res, next) => {
    req.user = store.getUser(req.params.phone);
    return req.user ? next() : res.status(404).json({ error: 'unknown user' });
  };

  app.get('/api/me', auth.requireApi, (req, res) => res.json({ operator: req.operator }));

  // Live stream: a full snapshot first, then every new location / message / alert change.
  // A reconnecting browser receives a fresh snapshot, so nothing is missed across drops.
  app.get('/api/stream', auth.requireApi, (req, res) => {
    const snapshot = store.snapshot({
      since: windowStart(req.query.hours ?? 24),
      limit: config.maxSnapshotPoints,
    });
    live.attach(req, res, {
      event: 'snapshot',
      data: {
        ...snapshot,
        serverTime: now(),
        operator: req.operator,
        config: {
          staleMinutes: config.staleMinutes,
          tileUrl: config.tileUrl,
          tileAttribution: config.tileAttribution,
          maxPoints: config.maxSnapshotPoints,
        },
      },
    });
  });

  app.post('/api/people', auth.requireApi, express.json(), jsonOnly, (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 100) || null;
    const phone = normalisePhone(req.body?.phone, config.defaultCountryCode);
    if (!phone || !/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number.' });
    const user = store.ensureUser(phone, name, now());
    live.broadcast('user', { user });
    res.json({ user });
  });

  app.get('/api/users/:phone/history', auth.requireApi, knownUser, (req, res) => {
    res.json({
      locations: store.history(req.params.phone, {
        since: windowStart(req.query.hours),
        limit: config.maxSnapshotPoints,
      }),
    });
  });

  app.post('/api/users/:phone/acknowledge', auth.requireApi, express.json(), jsonOnly, (req, res) => {
    const user = store.acknowledgeSos(req.params.phone, req.operator, now());
    if (!user) return res.status(409).json({ error: 'no open SOS for this user' });
    live.broadcast('user', { user });
    res.json({ user });
  });

  // A link the desk can read out or forward when the person cannot type TRACK themselves.
  app.post('/api/users/:phone/tracking-link', auth.requireApi, express.json(), jsonOnly, knownUser, (req, res) => {
    const url = ingest.trackingLink(req.user.phone, baseUrl(req));
    res.json({ url, expiresAt: now() + config.trackLinkHours * HOUR });
  });

  // Issues (and replaces) the secret identifier for a tracker app or GPS device.
  app.post('/api/users/:phone/device-key', auth.requireApi, express.json(), jsonOnly, knownUser, (req, res) => {
    const link = store.createLink(req.user.phone, 'device', { at: now() });
    res.json({ identifier: link.token, serverUrl: `${baseUrl(req)}/track/osmand` });
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true, dashboards: live.size }));

  app.use((err, _req, res, _next) => {
    log.error?.(err);
    res.status(500).json({ error: 'internal error' });
  });

  return { app, live };
}
