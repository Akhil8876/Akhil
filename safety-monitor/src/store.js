import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// `users.phone` is the identity key: an E.164 number (+91...) for WhatsApp/SMS, or
// `tg:<id>` for a Telegram user who has not shared their phone number yet.
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    phone       TEXT PRIMARY KEY,
    name        TEXT,
    code        TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    sos_at      INTEGER,
    sos_ack_at  INTEGER,
    sos_ack_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS locations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE ON UPDATE CASCADE,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    accuracy     REAL,
    battery      REAL,
    label        TEXT,
    address      TEXT,
    provider     TEXT NOT NULL,
    sent_from    TEXT,
    message_id   TEXT UNIQUE,
    shared_at    INTEGER NOT NULL,
    received_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_locations_phone_time ON locations(phone, shared_at);
  CREATE INDEX IF NOT EXISTS idx_locations_time ON locations(shared_at);

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE ON UPDATE CASCADE,
    body         TEXT NOT NULL,
    is_sos       INTEGER NOT NULL DEFAULT 0,
    provider     TEXT NOT NULL,
    sent_from    TEXT,
    message_id   TEXT UNIQUE,
    shared_at    INTEGER NOT NULL,
    received_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(shared_at);

  -- Secret tokens: 'web' links open the live-sharing page, 'device' keys identify tracker apps.
  CREATE TABLE IF NOT EXISTS tracking_links (
    token        TEXT PRIMARY KEY,
    phone        TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE ON UPDATE CASCADE,
    kind         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,
    revoked_at   INTEGER,
    last_used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_links_phone ON tracking_links(phone, kind);

  CREATE TABLE IF NOT EXISTS telegram_links (
    tg_id  TEXT PRIMARY KEY,
    phone  TEXT NOT NULL
  );
`;

// Columns added after the first release; existing databases get them on open.
const MIGRATIONS = [
  ['users', 'code', 'TEXT'],
  ['locations', 'accuracy', 'REAL'],
  ['locations', 'battery', 'REAL'],
  ['locations', 'sent_from', 'TEXT'],
  ['messages', 'sent_from', 'TEXT'],
];

const toLocation = (r) => ({
  id: r.id,
  phone: r.phone,
  lat: r.lat,
  lng: r.lng,
  accuracy: r.accuracy,
  battery: r.battery,
  label: r.label,
  address: r.address,
  provider: r.provider,
  sentFrom: r.sent_from,
  sharedAt: r.shared_at,
  receivedAt: r.received_at,
});

const toMessage = (r) => ({
  id: r.id,
  phone: r.phone,
  body: r.body,
  isSos: Boolean(r.is_sos),
  provider: r.provider,
  sentFrom: r.sent_from,
  sharedAt: r.shared_at,
  receivedAt: r.received_at,
});

const toUser = (r) => ({
  phone: r.phone,
  name: r.name,
  code: r.code,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  sosAt: r.sos_at,
  sosAckAt: r.sos_ack_at,
  sosAckBy: r.sos_ack_by,
});

/** Six digits, never starting with 0, so it cannot be mistaken for a shortened number. */
const newCode = () => String(randomInt(100000, 1000000));
const newToken = () => randomBytes(18).toString('base64url');

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const [table, column, type] of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_code ON users(code)');

  const q = {
    upsertUser: db.prepare(`
      INSERT INTO users (phone, name, code, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = COALESCE(excluded.name, users.name),
        code = COALESCE(users.code, excluded.code),
        last_seen = MAX(users.last_seen, excluded.last_seen)`),
    getUser: db.prepare('SELECT * FROM users WHERE phone = ?'),
    userByCode: db.prepare('SELECT * FROM users WHERE code = ?'),
    usersWithoutCode: db.prepare('SELECT phone FROM users WHERE code IS NULL'),
    setCode: db.prepare('UPDATE users SET code = ? WHERE phone = ?'),
    insertLocation: db.prepare(`
      INSERT OR IGNORE INTO locations
        (phone, lat, lng, accuracy, battery, label, address, provider, sent_from, message_id, shared_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertMessage: db.prepare(`
      INSERT OR IGNORE INTO messages
        (phone, body, is_sos, provider, sent_from, message_id, shared_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getLocation: db.prepare('SELECT * FROM locations WHERE id = ?'),
    getMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
    latestForUser: db.prepare('SELECT * FROM locations WHERE phone = ? ORDER BY shared_at DESC, id DESC LIMIT 1'),
    countForUser: db.prepare('SELECT COUNT(*) AS n FROM locations WHERE phone = ?'),
    raiseSos: db.prepare(`
      UPDATE users SET sos_at = MAX(COALESCE(sos_at, 0), ?), sos_ack_at = NULL, sos_ack_by = NULL
      WHERE phone = ?`),
    ackSos: db.prepare(`
      UPDATE users SET sos_at = NULL, sos_ack_at = ?, sos_ack_by = ?
      WHERE phone = ? AND sos_at IS NOT NULL`),
    allUsers: db.prepare('SELECT * FROM users'),
    latestPerUser: db.prepare(`
      SELECT * FROM (
        SELECT l.*, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY shared_at DESC, id DESC) AS rn
        FROM locations l
      ) WHERE rn = 1`),
    countsPerUser: db.prepare('SELECT phone, COUNT(*) AS n FROM locations GROUP BY phone'),
    locationsSince: db.prepare(`
      SELECT * FROM (
        SELECT * FROM locations WHERE shared_at >= ? ORDER BY shared_at DESC, id DESC LIMIT ?
      ) ORDER BY shared_at ASC, id ASC`),
    messagesSince: db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE shared_at >= ? ORDER BY shared_at DESC, id DESC LIMIT ?
      ) ORDER BY shared_at ASC, id ASC`),
    userHistory: db.prepare(`
      SELECT * FROM locations WHERE phone = ? AND shared_at >= ? ORDER BY shared_at ASC, id ASC LIMIT ?`),
    purgeLocations: db.prepare('DELETE FROM locations WHERE shared_at < ?'),
    purgeMessages: db.prepare('DELETE FROM messages WHERE shared_at < ?'),
    purgeLinks: db.prepare('DELETE FROM tracking_links WHERE expires_at IS NOT NULL AND expires_at < ?'),
    insertLink: db.prepare(
      'INSERT INTO tracking_links (token, phone, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    getLink: db.prepare('SELECT * FROM tracking_links WHERE token = ?'),
    touchLink: db.prepare('UPDATE tracking_links SET last_used_at = ? WHERE token = ?'),
    revokeLinks: db.prepare(
      'UPDATE tracking_links SET revoked_at = ? WHERE phone = ? AND kind = ? AND revoked_at IS NULL',
    ),
    getTelegram: db.prepare('SELECT phone FROM telegram_links WHERE tg_id = ?'),
    setTelegram: db.prepare(
      'INSERT INTO telegram_links (tg_id, phone) VALUES (?, ?) ON CONFLICT(tg_id) DO UPDATE SET phone = excluded.phone',
    ),
  };

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function ensureUser(phone, name, at) {
    for (let attempt = 0; ; attempt++) {
      try {
        q.upsertUser.run(phone, name ?? null, newCode(), at, at);
        return;
      } catch (err) {
        // A freshly drawn code collided with someone else's; draw again.
        if (attempt > 20 || !/UNIQUE constraint failed: users\.code/.test(err.message)) throw err;
      }
    }
  }

  function assignMissingCodes() {
    for (const { phone } of q.usersWithoutCode.all()) {
      for (let attempt = 0; ; attempt++) {
        try {
          q.setCode.run(newCode(), phone);
          break;
        } catch (err) {
          if (attempt > 20 || !/UNIQUE/.test(err.message)) throw err;
        }
      }
    }
  }
  assignMissingCodes();

  function userWithLatest(phone) {
    const row = q.getUser.get(phone);
    if (!row) return null;
    const latest = q.latestForUser.get(phone);
    return { ...toUser(row), latest: latest ? toLocation(latest) : null, locationCount: q.countForUser.get(phone).n };
  }

  return {
    /** Creates the person (with a personal code) if new; returns the user. */
    ensureUser(phone, name, at) {
      ensureUser(phone, name, at);
      return userWithLatest(phone);
    },

    /** Returns { location, user }, or null when the message was already stored (a webhook retry). */
    addLocation({ phone, name, lat, lng, accuracy, battery, label, address, provider, sentFrom, messageId, sharedAt, receivedAt }) {
      return transaction(() => {
        ensureUser(phone, name, sharedAt);
        const res = q.insertLocation.run(
          phone, lat, lng, accuracy ?? null, battery ?? null, label ?? null, address ?? null,
          provider, sentFrom ?? null, messageId ?? null, sharedAt, receivedAt,
        );
        if (res.changes === 0) return null;
        return { location: toLocation(q.getLocation.get(res.lastInsertRowid)), user: userWithLatest(phone) };
      });
    },

    /** Returns { message, user }, or null on a duplicate. An SOS message raises the user's alert. */
    addMessage({ phone, name, body, isSos, provider, sentFrom, messageId, sharedAt, receivedAt }) {
      return transaction(() => {
        ensureUser(phone, name, sharedAt);
        const res = q.insertMessage.run(
          phone, body, isSos ? 1 : 0, provider, sentFrom ?? null, messageId ?? null, sharedAt, receivedAt,
        );
        if (res.changes === 0) return null;
        if (isSos) q.raiseSos.run(sharedAt, phone);
        return { message: toMessage(q.getMessage.get(res.lastInsertRowid)), user: userWithLatest(phone) };
      });
    },

    /** Returns the updated user, or null when there was no open SOS. */
    acknowledgeSos(phone, by, at) {
      const res = q.ackSos.run(at, by, phone);
      return res.changes === 0 ? null : userWithLatest(phone);
    },

    getUser: userWithLatest,

    userByCode(code) {
      const row = q.userByCode.get(String(code));
      return row ? userWithLatest(row.phone) : null;
    },

    /** Issues a secret token. 'web' links expire; a new 'device' key replaces the previous one. */
    createLink(phone, kind, { at, ttlMs = null }) {
      return transaction(() => {
        if (kind === 'device') q.revokeLinks.run(at, phone, kind);
        const token = newToken();
        q.insertLink.run(token, phone, kind, at, ttlMs ? at + ttlMs : null);
        return { token, phone, kind, createdAt: at, expiresAt: ttlMs ? at + ttlMs : null };
      });
    },

    /** Returns the live link for a token, or null if unknown, revoked or expired. */
    resolveLink(token, kind, at) {
      const row = token ? q.getLink.get(String(token)) : null;
      if (!row || row.kind !== kind || row.revoked_at || (row.expires_at && row.expires_at < at)) return null;
      return { token: row.token, phone: row.phone, kind: row.kind, expiresAt: row.expires_at, lastUsedAt: row.last_used_at };
    },

    touchLink(token, at) {
      q.touchLink.run(at, token);
    },

    revokeLinks(phone, kind, at) {
      return q.revokeLinks.run(at, phone, kind).changes;
    },

    telegramPhone(tgId) {
      return q.getTelegram.get(String(tgId))?.phone ?? null;
    },

    /**
     * Links a Telegram account to a phone number. Anything stored under the temporary
     * `tg:<id>` identity moves to the phone number so the person has one history.
     */
    linkTelegram(tgId, phone, name, at) {
      return transaction(() => {
        const temp = `tg:${tgId}`;
        q.setTelegram.run(String(tgId), phone);
        const old = q.getUser.get(temp);
        ensureUser(phone, name, at);
        if (old) {
          for (const table of ['locations', 'messages', 'tracking_links']) {
            db.prepare(`UPDATE ${table} SET phone = ? WHERE phone = ?`).run(phone, temp);
          }
          db.prepare(`
            UPDATE users SET
              first_seen = MIN(first_seen, ?),
              last_seen = MAX(last_seen, ?),
              sos_at = NULLIF(MAX(COALESCE(sos_at, 0), COALESCE(?, 0)), 0)
            WHERE phone = ?`).run(old.first_seen, old.last_seen, old.sos_at, phone);
          db.prepare('DELETE FROM users WHERE phone = ?').run(temp);
        }
        return { user: userWithLatest(phone), merged: Boolean(old) };
      });
    },

    snapshot({ since, limit }) {
      const latest = new Map(q.latestPerUser.all().map((r) => [r.phone, toLocation(r)]));
      const counts = new Map(q.countsPerUser.all().map((r) => [r.phone, r.n]));
      const users = q.allUsers.all().map((r) => ({
        ...toUser(r),
        latest: latest.get(r.phone) ?? null,
        locationCount: counts.get(r.phone) ?? 0,
      }));
      return {
        users,
        locations: q.locationsSince.all(since, limit).map(toLocation),
        messages: q.messagesSince.all(since, 500).map(toMessage),
      };
    },

    history(phone, { since, limit }) {
      return q.userHistory.all(phone, since, limit).map(toLocation);
    },

    purgeOlderThan(cutoff, now = Date.now()) {
      return transaction(() => ({
        locations: q.purgeLocations.run(cutoff).changes,
        messages: q.purgeMessages.run(cutoff).changes,
        links: q.purgeLinks.run(now).changes,
      }));
    },

    close() {
      db.close();
    },
  };
}
