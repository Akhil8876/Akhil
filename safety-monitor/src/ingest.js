// One pipeline for every channel: store what arrived, push it to the dashboards, and work
// out what to tell the person. Channels only translate their payloads and deliver the reply.
import { expandShortMapLink, extractCoordinates, findShortMapLink, parseText } from './text.js';

const HOUR = 3600_000;

export function createIngest({ config, store, live, now = Date.now, fetchImpl = fetch, log = console }) {
  const lang = {
    emergency: `If you are in immediate danger, call ${config.emergencyNumber}.`,
    trackHint: 'Send TRACK for a link that shares your live location.',
  };

  function trackingLink(phone, baseUrl) {
    const link = store.createLink(phone, 'web', { at: now(), ttlMs: config.trackLinkHours * HOUR });
    return `${baseUrl}/t/${link.token}`;
  }

  function codeNote(user) {
    return `Your personal safety code is ${user.code}. From any other phone, send "SOS ${user.code}" and the desk will know it is you.`;
  }

  /** Stores a location from any source. Returns the saved record, or null for a duplicate. */
  function addLocation(loc) {
    const saved = store.addLocation({ ...loc, receivedAt: now() });
    if (saved) live.broadcast('location', saved);
    return saved;
  }

  async function coordinatesIn(text) {
    const direct = extractCoordinates(text);
    if (direct) return direct;
    const short = findShortMapLink(text);
    if (!short) return null;
    try {
      return await expandShortMapLink(short, { fetchImpl });
    } catch (err) {
      log.warn(`[maps] could not expand ${short}: ${err.message}`);
      return null;
    }
  }

  /**
   * inbound: normalised message ({ provider, phone, name, kind, messageId, sharedAt, ... }).
   * Returns { reply, user } where reply is null when nothing should be sent back
   * (duplicate deliveries, live-location updates).
   */
  async function handle(inbound, { baseUrl, liveUpdate = false } = {}) {
    const isNew = !store.getUser(inbound.phone);

    if (inbound.kind === 'location') {
      const saved = addLocation(inbound);
      if (!saved || liveUpdate) return { reply: null, user: saved?.user ?? null };
      const parts = [
        inbound.live
          ? 'Live location received. The safety desk can follow you for as long as you keep sharing.'
          : 'Location received. The safety desk can see where you are.',
      ];
      if (!inbound.live) parts.push(`Share again whenever you move. ${lang.trackHint}`);
      parts.push('Send SOS if you need urgent help.');
      if (isNew) parts.push(codeNote(saved.user));
      return { reply: parts.join(' '), user: saved.user };
    }

    const text = inbound.kind === 'text' ? inbound.text : '';
    const parsed = text ? parseText(text, config.sosKeywords) : { isSos: false, command: null, code: null };

    // "SOS 482913" from a borrowed phone is attributed to the owner of code 482913.
    let subject = inbound.phone;
    let sentFrom = null;
    let unknownCode = false;
    if (parsed.code) {
      const owner = store.userByCode(parsed.code);
      if (!owner) unknownCode = true;
      else if (owner.phone !== inbound.phone) {
        subject = owner.phone;
        sentFrom = inbound.phone;
      }
    }

    const saved = store.addMessage({
      ...inbound,
      phone: subject,
      name: sentFrom ? null : inbound.name, // never rename the owner after the borrowed phone
      body: text || '[non-text message]',
      isSos: parsed.isSos,
      sentFrom,
      receivedAt: now(),
    });
    if (!saved) return { reply: null, user: null }; // duplicate delivery: already handled
    live.broadcast('message', saved);
    let user = saved.user;

    const coords = text ? await coordinatesIn(text) : null;
    if (coords) {
      const loc = addLocation({
        ...inbound,
        ...coords,
        phone: subject,
        name: null,
        label: 'From a map link',
        sentFrom,
        messageId: inbound.messageId ? `${inbound.messageId}:loc` : null,
      });
      if (loc) user = loc.user;
    }

    const parts = [];
    const who = sentFrom ? ` for code ${parsed.code}` : '';
    if (parsed.isSos) {
      parts.push(`SOS received${who}. The safety desk has been alerted.`);
      parts.push(`Share your location live now: ${trackingLink(subject, baseUrl)}`);
      parts.push(lang.emergency);
    } else if (parsed.command === 'track') {
      parts.push(
        `Open this link and tap "Start sharing" to send your live location${who}: ${trackingLink(subject, baseUrl)}`,
      );
      parts.push(`It works for ${config.trackLinkHours} hours while the page stays open. Send STOP to end it.`);
    } else if (parsed.command === 'stop') {
      const n = store.revokeLinks(subject, 'web', now());
      parts.push(n ? 'Live sharing links stopped.' : 'You have no active live sharing link.');
    } else if (parsed.command === 'code') {
      parts.push(codeNote(user));
    } else if (coords) {
      parts.push(`Location received from your map link${who}. The safety desk can see it.`);
    } else {
      parts.push('This is the safety helpline. Share your location so the safety desk can see you.');
      parts.push(`${lang.trackHint} Send SOS for urgent help. ${lang.emergency}`);
    }
    if (unknownCode) parts.push(`(Code ${parsed.code} was not recognised.)`);
    if (isNew && !sentFrom && parsed.command !== 'code') parts.push(codeNote(user));
    return { reply: parts.join(' '), user };
  }

  return { handle, addLocation, trackingLink };
}
