import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'sm_session';

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth({ password, secret, sessionHours, now = Date.now }) {
  const key = secret || randomBytes(32).toString('hex');
  const failures = new Map(); // ip -> { count, until }

  function issue(operator) {
    const payload = Buffer.from(
      JSON.stringify({ op: operator, exp: now() + sessionHours * 3600_000 }),
    ).toString('base64url');
    return `${payload}.${sign(payload, key)}`;
  }

  function verify(token) {
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload, key))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return data.exp > now() ? data : null;
    } catch {
      return null;
    }
  }

  function session(req) {
    return verify(parseCookies(req.headers.cookie)[COOKIE]);
  }

  return {
    COOKIE,
    session,

    checkPassword(ip, candidate) {
      const f = failures.get(ip);
      if (f && f.count >= 10 && f.until > now()) return { ok: false, locked: true };
      if (safeEqual(candidate ?? '', password)) {
        failures.delete(ip);
        return { ok: true };
      }
      const next = { count: (f && f.until > now() ? f.count : 0) + 1, until: now() + 15 * 60_000 };
      failures.set(ip, next);
      return { ok: false, locked: false };
    },

    cookie(operator, secure) {
      return [
        `${COOKIE}=${encodeURIComponent(issue(operator))}`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${sessionHours * 3600}`,
        secure ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; ');
    },

    clearCookie() {
      return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
    },

    /** For pages: redirect to the login screen. */
    requirePage(req, res, next) {
      const s = session(req);
      if (!s) return res.redirect('/login');
      req.operator = s.op;
      next();
    },

    /** For the API: 401 instead of a redirect. */
    requireApi(req, res, next) {
      const s = session(req);
      if (!s) return res.status(401).json({ error: 'not signed in' });
      req.operator = s.op;
      next();
    },
  };
}
