/* Live-sharing page: streams this phone's GPS to the safety desk while it stays open. */
(() => {
  'use strict';
  const token = location.pathname.split('/').pop();
  const api = `/api/track/${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);

  const MIN_INTERVAL_MS = 5000; // never more often than this
  const HEARTBEAT_MS = 30000; // and at least this often, even when standing still
  const MIN_MOVE_M = 15;

  let watchId = null;
  let heartbeat = null;
  let wakeLock = null;
  let lastSent = null; // { lat, lng, at }
  let pending = null;
  let count = 0;
  let sending = false;

  function setStatus(state, text) {
    $('status').dataset.state = state;
    $('status').textContent = text;
  }

  function metres(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function send(fix) {
    if (sending) {
      pending = fix;
      return;
    }
    sending = true;
    try {
      const battery = await batteryLevel();
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fix, battery }),
        keepalive: true,
      });
      if (res.status === 410) {
        sending = false;
        return expired();
      }
      if (!res.ok) throw new Error(String(res.status));
      lastSent = { lat: fix.lat, lng: fix.lng, at: Date.now() };
      count++;
      $('count').textContent = count;
      $('last').textContent = new Date().toLocaleTimeString();
      $('accuracy').textContent = fix.accuracy ? `±${Math.round(fix.accuracy)} m` : '—';
      setStatus('live', 'Sharing live with the safety desk');
      sending = false;
      flush();
    } catch {
      sending = false;
      pending = pending ?? fix; // retry, preferring a newer fix if one arrived meanwhile
      setStatus('retry', 'No connection. Will keep retrying…');
      setTimeout(flush, 4000);
    }
  }

  function flush() {
    if (pending && !sending) {
      const fix = pending;
      pending = null;
      send(fix);
    }
  }

  let batteryManager = null;
  async function batteryLevel() {
    try {
      batteryManager = batteryManager ?? (navigator.getBattery ? await navigator.getBattery() : null);
      return batteryManager ? Math.round(batteryManager.level * 100) : undefined;
    } catch {
      return undefined;
    }
  }

  function onPosition(pos, force = false) {
    const fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: Math.round(pos.timestamp),
    };
    const since = lastSent ? Date.now() - lastSent.at : Infinity;
    const moved = lastSent ? metres(lastSent, fix) : Infinity;
    if (force || since >= HEARTBEAT_MS || (since >= MIN_INTERVAL_MS && moved >= MIN_MOVE_M)) send(fix);
  }

  function onError(err) {
    if (err.code === err.PERMISSION_DENIED) {
      stop();
      setStatus('error', 'Location permission is blocked. Allow location for this site, then tap Start sharing.');
    } else {
      setStatus('retry', 'Waiting for a GPS signal…');
    }
  }

  async function keepAwake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {}
  }

  function start() {
    if (!('geolocation' in navigator)) {
      setStatus('error', 'This browser cannot share location. Send your location from WhatsApp instead.');
      return;
    }
    setStatus('retry', 'Getting your location…');
    $('start').hidden = true;
    $('stop').hidden = false;
    $('facts').hidden = false;
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
    navigator.geolocation.getCurrentPosition((p) => onPosition(p, true), onError, opts);
    watchId = navigator.geolocation.watchPosition((p) => onPosition(p), onError, opts);
    heartbeat = setInterval(
      () => navigator.geolocation.getCurrentPosition((p) => onPosition(p), () => {}, opts),
      HEARTBEAT_MS,
    );
    keepAwake();
  }

  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    clearInterval(heartbeat);
    watchId = null;
    wakeLock?.release?.();
    $('start').hidden = false;
    $('start').textContent = 'Start sharing again';
    $('stop').hidden = true;
    setStatus('idle', 'Sharing stopped');
  }

  function expired() {
    stop();
    for (const id of ['start', 'stop', 'sos']) $(id).hidden = true;
    setStatus('error', 'This link has expired. Send TRACK to the safety number for a new one.');
  }

  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', stop);
  $('sos').addEventListener('click', async () => {
    $('sos').disabled = true;
    try {
      const res = await fetch(`${api}/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (res.status === 410) return expired();
      const { emergencyNumber } = await res.json();
      $('sos').textContent = 'SOS sent. The desk has been alerted';
      $('sos-note').hidden = false;
      $('sos-note').textContent = `Keep this page open so they can follow you. In immediate danger call ${emergencyNumber}.`;
      if (watchId == null) start();
    } catch {
      $('sos').disabled = false;
      $('sos-note').hidden = false;
      $('sos-note').textContent = 'Could not send. Check your connection and try again, or send SOS on WhatsApp/SMS.';
    }
  });

  // The screen wake lock is dropped whenever the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && watchId != null) {
      keepAwake();
      navigator.geolocation.getCurrentPosition((p) => onPosition(p, true), () => {}, { enableHighAccuracy: true });
    }
  });

  fetch(api)
    .then((res) => (res.status === 410 ? expired() : res.json()))
    .then((info) => {
      if (!info) return;
      if (info.name) $('greeting').textContent = `Hi ${info.name.split(' ')[0]}, share your live location`;
      if (info.expiresAt) {
        $('intro').textContent += ` This link works until ${new Date(info.expiresAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}.`;
      }
    })
    .catch(() => {});
})();
