import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAuth } from './auth.js';
import { createLiveHub } from './live.js';
import {
  isSosText,
  parseMetaWebhook,
  parseTwilioWebhook,
  replyText,
  sendMetaText,
  twiml,
  verifyMetaSignature,
  verifyTwilioSignature,
} from './whatsapp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const HOUR = 3600_000;

export function createApp({ config, store, now = Date.now, sendReply = sendMetaText, log = console }) {
  const app = express();
  const live = createLiveHub();
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

  /** Stores one inbound message, pushes it to every dashboard, and returns the reply to send. */
  function ingest(inbound) {
    const receivedAt = now();
    let isSos = false;
    if (inbound.kind === 'location') {
      const saved = store.addLocation({ ...inbound, receivedAt });
      if (saved) live.broadcast('location', saved);
    } else {
      // Anything that is not a location (text, voice note, sticker...) is logged so the desk sees it.
      const body = inbound.kind === 'text' ? inbound.text : '[non-text message]';
      isSos = inbound.kind === 'text' && isSosText(inbound.text, config.sosKeywords);
      const saved = store.addMessage({ ...inbound, body, isSos, receivedAt });
      if (saved) live.broadcast('message', saved);
      else isSos = false; // duplicate delivery: already handled and replied to
    }
    return replyText(inbound, { isSos, emergencyNumber: config.emergencyNumber });
  }

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
    (req, res) => {
      if (
        config.meta.appSecret &&
        !verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'), config.meta.appSecret)
      ) {
        return res.sendStatus(401);
      }
      for (const inbound of parseMetaWebhook(req.body, now())) {
        const text = ingest(inbound);
        Promise.resolve(sendReply(config.meta, inbound.replyContext, text)).catch((err) =>
          log.warn(`[reply] ${inbound.phone}: ${err.message}`),
        );
      }
      res.sendStatus(200);
    },
  );

  // --- Twilio WhatsApp ----------------------------------------------------------------------
  app.post('/webhook/twilio', express.urlencoded({ extended: false, limit: '1mb' }), (req, res) => {
    if (config.twilio.authToken) {
      const base = config.twilio.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
      const ok = verifyTwilioSignature(
        base + req.originalUrl,
        req.body ?? {},
        req.get('x-twilio-signature'),
        config.twilio.authToken,
      );
      if (!ok) return res.sendStatus(401);
    }
    const [inbound] = parseTwilioWebhook(req.body, now());
    if (!inbound) return res.type('text/xml').send('<Response/>');
    res.type('text/xml').send(twiml(ingest(inbound)));
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

  app.get('/api/users/:phone/history', auth.requireApi, (req, res) => {
    if (!store.getUser(req.params.phone)) return res.status(404).json({ error: 'unknown user' });
    res.json({
      locations: store.history(req.params.phone, {
        since: windowStart(req.query.hours),
        limit: config.maxSnapshotPoints,
      }),
    });
  });

  app.post('/api/users/:phone/acknowledge', auth.requireApi, express.json(), (req, res) => {
    // JSON-only so a cross-site form post cannot trigger it.
    if (!req.is('application/json')) return res.status(415).json({ error: 'expected JSON' });
    const user = store.acknowledgeSos(req.params.phone, req.operator, now());
    if (!user) return res.status(409).json({ error: 'no open SOS for this user' });
    live.broadcast('user', { user });
    res.json({ user });
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true, dashboards: live.size }));

  return { app, live };
}
