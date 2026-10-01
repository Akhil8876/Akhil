// GPS trackers and tracker apps. Speaks the OsmAnd protocol (query string or form) used by
// many devices and older Traccar Client versions, and the JSON body of Traccar Client 9+.
// The device identifier is a secret key issued from the dashboard, not a phone number.
import { isValidCoordinate } from './whatsapp.js';

function parseTime(value, now) {
  if (value == null || value === '') return now;
  const n = Number(value);
  let ms;
  if (Number.isFinite(n)) ms = n < 1e12 ? n * 1000 : n;
  else ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, now) : now;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function parseTrackerRequest(query = {}, body = {}, now = Date.now()) {
  let id, lat, lng, accuracy, battery, time;
  if (body && typeof body === 'object' && body.location) {
    const loc = body.location;
    id = body.device_id ?? body.deviceId;
    lat = num(loc.coords?.latitude);
    lng = num(loc.coords?.longitude);
    accuracy = num(loc.coords?.accuracy);
    const level = num(loc.battery?.level);
    battery = level == null ? null : level <= 1 ? Math.round(level * 100) : level;
    time = loc.timestamp;
  } else {
    const p = { ...(body && typeof body === 'object' ? body : {}), ...query };
    id = p.id ?? p.deviceid;
    if (p.location && !p.lat) [p.lat, p.lon] = String(p.location).split(',');
    lat = num(p.lat);
    lng = num(p.lon ?? p.lng);
    accuracy = num(p.accuracy ?? p.hdop);
    battery = num(p.batt ?? p.battery);
    time = p.timestamp;
  }
  if (!id || !isValidCoordinate(lat, lng)) return null;
  return { id: String(id), lat, lng, accuracy, battery, sharedAt: parseTime(time, now) };
}
