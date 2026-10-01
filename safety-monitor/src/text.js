// Reading intent out of free text, the same way for WhatsApp, SMS and Telegram.
import { isValidCoordinate } from './whatsapp.js';

const LAT = '([-+]?\\d{1,2}(?:\\.\\d+)?)';
const LNG = '([-+]?\\d{1,3}(?:\\.\\d+)?)';
const SEP = '\\s*(?:,|%2C)\\s*\\+?';

// Most specific first: an exact pin beats a map's viewport centre.
const COORDINATE_PATTERNS = [
  new RegExp(`!3d${LAT}!4d${LNG}`), // .../place/...!3d17.38!4d78.48
  new RegExp(`[?&](?:q|query|ll|sll|destination|daddr|center|location)=(?:loc:)?${LAT}${SEP}${LNG}`, 'i'),
  new RegExp(`/maps/(?:search|place|dir)/(?:[^/@]*/)?${LAT}${SEP}${LNG}`, 'i'),
  new RegExp(`geo:${LAT}${SEP}${LNG}`, 'i'),
  new RegExp(`@${LAT},${LNG}`),
  // Bare "17.3850, 78.4867". At least four decimals so amounts and times are not mistaken for a place.
  /(?<![\d.])([-+]?\d{1,2}\.\d{4,})\s*[,\s]\s*([-+]?\d{1,3}\.\d{4,})(?![\d.])/,
];

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Finds coordinates in a Google Maps / geo: link or plain "lat, lng" text. */
export function extractCoordinates(text) {
  if (!text) return null;
  // Twice, because Google nests the real URL, encoded, inside consent and redirect pages.
  for (const candidate of [String(text), safeDecode(String(text)), safeDecode(safeDecode(String(text)))]) {
    for (const re of COORDINATE_PATTERNS) {
      const m = re.exec(candidate);
      if (!m) continue;
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (isValidCoordinate(lat, lng) && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}

const SHORT_LINK = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\/[\w-]+/i;

export function findShortMapLink(text) {
  return SHORT_LINK.exec(String(text ?? ''))?.[0] ?? null;
}

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co)$/i;

/**
 * Follows a maps.app.goo.gl short link (Google hosts only) and reads the coordinates from
 * where it redirects. Returns null on any failure: the message is still stored as text.
 */
export async function expandShortMapLink(url, { fetchImpl = fetch, maxHops = 5, timeoutMs = 5000 } = {}) {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !GOOGLE_HOSTS.test(parsed.hostname)) return null;
    const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const next = res.headers.get('location');
    if (!next) {
      // Final page: coordinates are sometimes only in the HTML.
      const body = res.ok ? (await res.text()).slice(0, 200_000) : '';
      return extractCoordinates(current) ?? extractCoordinates(body);
    }
    current = new URL(next, current).href;
    const coords = extractCoordinates(current);
    if (coords) return coords;
  }
  return null;
}

/**
 * Commands people can text. Keywords stay deliberately short and familiar:
 *   TRACK / LIVE    get a live-sharing link
 *   STOP            end live-sharing links
 *   CODE / MYCODE   ask for your personal code
 *   SOS <code>      raise an alert for the person who owns <code> (e.g. from a borrowed phone)
 */
export function parseText(text, sosKeywords) {
  const raw = String(text ?? '').trim();
  const words = raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const isSos = words.some((w) => sosKeywords.includes(w));

  let command = null;
  const first = words[0];
  if (['track', 'live', 'start'].includes(first)) command = 'track';
  else if (
    ['stop', 'end'].includes(first) &&
    (words.length === 1 || (words.length === 2 && ['tracking', 'sharing', 'track', 'live'].includes(words[1])))
  ) command = 'stop';
  else if (['code', 'mycode'].includes(first) && words.length === 1) command = 'code';

  // A code only counts next to a keyword (or alone), so a 6-digit PIN code in an
  // address is never mistaken for someone's personal code.
  const keywords = [...sosKeywords, 'code', 'id', 'track', 'live'].map((k) => k.replace(/\W/g, ''));
  const codeRe = new RegExp(`(?:^|\\b(?:${keywords.join('|')})\\b\\s*[:#-]?\\s*)([1-9]\\d{5})\\b`, 'i');
  const code = /^[1-9]\d{5}$/.test(raw) ? raw : (codeRe.exec(raw)?.[1] ?? null);

  return { isSos, command, code };
}
