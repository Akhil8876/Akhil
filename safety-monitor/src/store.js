import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    phone       TEXT PRIMARY KEY,
    name        TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    sos_at      INTEGER,
    sos_ack_at  INTEGER,
    sos_ack_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS locations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    label        TEXT,
    address      TEXT,
    provider     TEXT NOT NULL,
    message_id   TEXT UNIQUE,
    shared_at    INTEGER NOT NULL,
    received_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_locations_phone_time ON locations(phone, shared_at);
  CREATE INDEX IF NOT EXISTS idx_locations_time ON locations(shared_at);

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    is_sos       INTEGER NOT NULL DEFAULT 0,
    provider     TEXT NOT NULL,
    message_id   TEXT UNIQUE,
    shared_at    INTEGER NOT NULL,
    received_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(shared_at);
`;

const toLocation = (r) => ({
  id: r.id,
  phone: r.phone,
  lat: r.lat,
  lng: r.lng,
  label: r.label,
  address: r.address,
  provider: r.provider,
  sharedAt: r.shared_at,
  receivedAt: r.received_at,
});

const toMessage = (r) => ({
  id: r.id,
  phone: r.phone,
  body: r.body,
  isSos: Boolean(r.is_sos),
  provider: r.provider,
  sharedAt: r.shared_at,
  receivedAt: r.received_at,
});

const toUser = (r) => ({
  phone: r.phone,
  name: r.name,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  sosAt: r.sos_at,
  sosAckAt: r.sos_ack_at,
  sosAckBy: r.sos_ack_by,
});

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const q = {
    upsertUser: db.prepare(`
      INSERT INTO users (phone, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = COALESCE(excluded.name, users.name),
        last_seen = MAX(users.last_seen, excluded.last_seen)`),
    getUser: db.prepare('SELECT * FROM users WHERE phone = ?'),
    insertLocation: db.prepare(`
      INSERT OR IGNORE INTO locations
        (phone, lat, lng, label, address, provider, message_id, shared_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertMessage: db.prepare(`
      INSERT OR IGNORE INTO messages
        (phone, body, is_sos, provider, message_id, shared_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    getLocation: db.prepare('SELECT * FROM locations WHERE id = ?'),
    getMessage: db.prepare('SELECT * FROM messages WHERE id = ?'),
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

  function userWithLatest(phone) {
    const user = toUser(q.getUser.get(phone));
    const latest = db
      .prepare('SELECT * FROM locations WHERE phone = ? ORDER BY shared_at DESC, id DESC LIMIT 1')
      .get(phone);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE phone = ?').get(phone);
    return { ...user, latest: latest ? toLocation(latest) : null, locationCount: n };
  }

  return {
    /** Returns { location, user }, or null when the message was already stored (a webhook retry). */
    addLocation({ phone, name, lat, lng, label, address, provider, messageId, sharedAt, receivedAt }) {
      return transaction(() => {
        q.upsertUser.run(phone, name ?? null, sharedAt, sharedAt);
        const res = q.insertLocation.run(
          phone, lat, lng, label ?? null, address ?? null, provider, messageId ?? null, sharedAt, receivedAt,
        );
        if (res.changes === 0) return null;
        return {
          location: toLocation(q.getLocation.get(res.lastInsertRowid)),
          user: userWithLatest(phone),
        };
      });
    },

    /** Returns { message, user }, or null on a duplicate. An SOS message raises the user's alert. */
    addMessage({ phone, name, body, isSos, provider, messageId, sharedAt, receivedAt }) {
      return transaction(() => {
        q.upsertUser.run(phone, name ?? null, sharedAt, sharedAt);
        const res = q.insertMessage.run(
          phone, body, isSos ? 1 : 0, provider, messageId ?? null, sharedAt, receivedAt,
        );
        if (res.changes === 0) return null;
        if (isSos) q.raiseSos.run(sharedAt, phone);
        return {
          message: toMessage(q.getMessage.get(res.lastInsertRowid)),
          user: userWithLatest(phone),
        };
      });
    },

    /** Returns the updated user, or null when there was no open SOS. */
    acknowledgeSos(phone, by, at) {
      const res = q.ackSos.run(at, by, phone);
      return res.changes === 0 ? null : userWithLatest(phone);
    },

    getUser(phone) {
      return q.getUser.get(phone) ? userWithLatest(phone) : null;
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

    purgeOlderThan(cutoff) {
      return transaction(() => ({
        locations: q.purgeLocations.run(cutoff).changes,
        messages: q.purgeMessages.run(cutoff).changes,
      }));
    },

    close() {
      db.close();
    },
  };
}
