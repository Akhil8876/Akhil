/* Safety Desk dashboard: one EventSource keeps the map live, no page refresh needed. */
(() => {
  'use strict';

  const state = {
    users: new Map(), // phone -> user (with .latest)
    tracks: new Map(), // phone -> [location] in the history window, oldest first
    activity: [],
    config: { staleMinutes: 15 },
    skew: 0,
    hours: 24,
    selected: null,
    fitted: false,
    sound: false,
    unseenActivity: 0,
  };

  const $ = (id) => document.getElementById(id);
  const serverNow = () => Date.now() + state.skew;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // --- Formatting ------------------------------------------------------------------------
  function ago(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((serverNow() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }
  const clock = (ts) =>
    new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const displayName = (u) => u.name || u.phone;
  const initials = (u) =>
    (u.name || u.phone.slice(-2))
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  function hue(phone) {
    let h = 0;
    for (const ch of phone) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  const trackColour = (phone) => `hsl(${hue(phone)} 70% 42%)`;

  function status(u) {
    if (u.sosAt) return 'sos';
    const t = u.latest?.sharedAt ?? 0;
    const mins = (serverNow() - t) / 60000;
    if (mins <= state.config.staleMinutes) return 'active';
    if (mins <= 60) return 'recent';
    return 'stale';
  }

  // --- Map -------------------------------------------------------------------------------
  const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([20.59, 78.96], 5);
  let tiles = null;
  const pointsLayer = L.layerGroup().addTo(map);
  const trailsLayer = L.layerGroup().addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  const markers = new Map(); // phone -> { marker, status }
  const trails = new Map(); // phone -> polyline

  function setTiles(cfg) {
    if (tiles) return;
    tiles = L.tileLayer(cfg.tileUrl, { maxZoom: 19, attribution: cfg.tileAttribution }).addTo(map);
  }

  function icon(u, st) {
    return L.divIcon({
      className: '',
      html: `<div class="pin pin-${st}"><span></span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    });
  }

  function popupFor(u) {
    const loc = u.latest;
    const gmaps = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
    return el(
      'div',
      { class: 'popup' },
      el('strong', {}, displayName(u)),
      el('div', { class: 'muted' }, u.phone),
      u.sosAt ? el('div', { class: 'popup-sos' }, `SOS raised ${ago(u.sosAt)}`) : null,
      loc
        ? [
            el('div', {}, `Shared ${ago(loc.sharedAt)} · ${clock(loc.sharedAt)}`),
            loc.label || loc.address ? el('div', {}, [loc.label, loc.address].filter(Boolean).join(', ')) : null,
            el('div', { class: 'mono' }, `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`),
          ]
        : el('div', {}, 'No location shared yet'),
      el(
        'div',
        { class: 'popup-actions' },
        gmaps ? el('a', { href: gmaps, target: '_blank', rel: 'noopener' }, 'Open in Google Maps') : null,
        el('button', { type: 'button', class: 'ghost', onclick: () => loadFullHistory(u.phone) }, 'Full history'),
        u.sosAt ? el('button', { type: 'button', class: 'danger', onclick: () => acknowledge(u.phone) }, 'Acknowledge SOS') : null,
      ),
    );
  }

  function drawMarker(u) {
    if (!u.latest) return;
    const st = status(u);
    const latlng = [u.latest.lat, u.latest.lng];
    let m = markers.get(u.phone);
    if (!m) {
      const marker = L.marker(latlng, { icon: icon(u, st), riseOnHover: true })
        .bindPopup(() => popupFor(state.users.get(u.phone)), { minWidth: 220 })
        .bindTooltip(displayName(u), { direction: 'top', offset: [0, -16] })
        .on('click', () => select(u.phone, false));
      marker.addTo(markersLayer);
      m = { marker, status: st };
      markers.set(u.phone, m);
    } else {
      m.marker.setLatLng(latlng);
      m.marker.setTooltipContent(displayName(u));
      if (m.status !== st) {
        m.marker.setIcon(icon(u, st));
        m.status = st;
      }
      if (m.marker.isPopupOpen()) m.marker.setPopupContent(popupFor(u));
    }
    m.marker.getElement()?.querySelector('.pin span')?.replaceChildren(initials(u));
    m.marker.setZIndexOffset(st === 'sos' ? 1000 : 0);
  }

  function drawTrail(phone) {
    const track = state.tracks.get(phone) ?? [];
    let line = trails.get(phone);
    const latlngs = track.map((l) => [l.lat, l.lng]);
    if (!line) {
      line = L.polyline(latlngs, { color: trackColour(phone), weight: 3, opacity: 0.7 });
      trails.set(phone, line);
      line.addTo(trailsLayer);
    } else {
      line.setLatLngs(latlngs);
    }
  }

  function drawPoint(loc) {
    const u = state.users.get(loc.phone);
    L.circleMarker([loc.lat, loc.lng], {
      radius: 4,
      color: trackColour(loc.phone),
      weight: 1,
      fillOpacity: 0.6,
    })
      .bindTooltip(`${u ? displayName(u) : loc.phone} · ${clock(loc.sharedAt)}`)
      .addTo(pointsLayer);
  }

  function redrawUserPoints() {
    pointsLayer.clearLayers();
    for (const track of state.tracks.values()) track.forEach(drawPoint);
  }

  function redrawAll() {
    markersLayer.clearLayers();
    trailsLayer.clearLayers();
    markers.clear();
    trails.clear();
    redrawUserPoints();
    for (const phone of state.tracks.keys()) drawTrail(phone);
    for (const u of state.users.values()) drawMarker(u);
  }

  // --- Sidebar ---------------------------------------------------------------------------
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderPeople();
      renderStats();
      renderSosBanner();
    });
  }

  const rank = { sos: 0, active: 1, recent: 2, stale: 3 };
  function sortedUsers() {
    return [...state.users.values()].sort(
      (a, b) =>
        rank[status(a)] - rank[status(b)] ||
        (b.latest?.sharedAt ?? b.lastSeen) - (a.latest?.sharedAt ?? a.lastSeen),
    );
  }

  function renderPeople() {
    const q = $('filter').value.trim().toLowerCase();
    const list = sortedUsers().filter(
      (u) => !q || u.phone.includes(q) || (u.name ?? '').toLowerCase().includes(q),
    );
    $('empty').hidden = state.users.size > 0;
    $('people').replaceChildren(
      ...list.map((u) => {
        const st = status(u);
        return el(
          'li',
          {
            class: `person person-${st}${state.selected === u.phone ? ' selected' : ''}`,
            dataset: { phone: u.phone },
            tabindex: 0,
            onclick: () => select(u.phone, true),
            onkeydown: (e) => e.key === 'Enter' && select(u.phone, true),
          },
          el('span', { class: `dot ${st}`, 'aria-label': st }),
          el(
            'div',
            { class: 'person-main' },
            el('div', { class: 'person-name' }, displayName(u)),
            el('div', { class: 'muted small' }, u.name ? u.phone : ''),
            el(
              'div',
              { class: 'small' },
              u.latest ? `Location ${ago(u.latest.sharedAt)}` : `Messaged ${ago(u.lastSeen)}, no location yet`,
              u.latest ? ` · ${(state.tracks.get(u.phone) ?? []).length} in window` : '',
            ),
            u.sosAt
              ? el('div', { class: 'sos-line' }, `SOS ${ago(u.sosAt)}`)
              : u.sosAckBy
                ? el('div', { class: 'muted small' }, `SOS handled by ${u.sosAckBy} ${ago(u.sosAckAt)}`)
                : null,
          ),
          u.sosAt
            ? el(
                'button',
                {
                  type: 'button',
                  class: 'danger small-btn',
                  onclick: (e) => {
                    e.stopPropagation();
                    acknowledge(u.phone);
                  },
                },
                'Acknowledge',
              )
            : null,
        );
      }),
    );
  }

  function renderStats() {
    const counts = { sos: 0, active: 0 };
    for (const u of state.users.values()) {
      const st = status(u);
      if (st === 'sos') counts.sos++;
      if (st === 'active' || (st === 'sos' && u.latest && serverNow() - u.latest.sharedAt < state.config.staleMinutes * 60000)) counts.active++;
    }
    let points = 0;
    for (const t of state.tracks.values()) points += t.length;
    $('stat-sos').textContent = counts.sos;
    $('stat-active').textContent = counts.active;
    $('stat-users').textContent = state.users.size;
    $('stat-points').textContent = points;
    document.body.classList.toggle('has-sos', counts.sos > 0);
    document.title = counts.sos ? `(${counts.sos}) SOS · Safety Desk` : 'Safety Desk';
  }

  function renderSosBanner() {
    const open = sortedUsers().filter((u) => u.sosAt);
    const banner = $('sos-banner');
    banner.hidden = open.length === 0;
    banner.replaceChildren(
      ...open.map((u) =>
        el(
          'div',
          { class: 'sos-item' },
          el('strong', {}, `SOS: ${displayName(u)}`),
          ` ${u.name ? u.phone : ''} · raised ${ago(u.sosAt)}`,
          u.latest ? ` · last location ${ago(u.latest.sharedAt)}` : ' · no location yet',
          el('button', { type: 'button', onclick: () => select(u.phone, true) }, 'Locate'),
          el('button', { type: 'button', class: 'danger', onclick: () => acknowledge(u.phone) }, 'Acknowledge'),
        ),
      ),
    );
  }

  function addActivity(item) {
    state.activity.unshift(item);
    state.activity.length = Math.min(state.activity.length, 200);
    if ($('activity').hidden) {
      state.unseenActivity++;
      $('activity-badge').textContent = state.unseenActivity;
      $('activity-badge').hidden = false;
    }
    renderActivity();
  }

  function renderActivity() {
    $('activity').replaceChildren(
      ...state.activity.map((a) =>
        el(
          'li',
          { class: `activity-item${a.sos ? ' activity-sos' : ''}`, onclick: () => a.phone && select(a.phone, true) },
          el('div', { class: 'small muted' }, clock(a.at)),
          el('div', {}, el('strong', {}, a.who), ' ', a.text),
        ),
      ),
    );
  }

  function select(phone, pan) {
    state.selected = phone;
    const u = state.users.get(phone);
    const m = markers.get(phone);
    if (pan && u?.latest) map.flyTo([u.latest.lat, u.latest.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    if (m) m.marker.openPopup();
    for (const [p, line] of trails) line.setStyle({ weight: p === phone ? 6 : 3, opacity: p === phone ? 1 : 0.5 });
    trails.get(phone)?.bringToFront();
    scheduleRender();
  }

  function flash(phone) {
    requestAnimationFrame(() => {
      const li = document.querySelector(`.person[data-phone="${CSS.escape(phone)}"]`);
      li?.classList.add('flash');
      setTimeout(() => li?.classList.remove('flash'), 1500);
    });
  }

  function toast(text, kind = '') {
    const t = el('div', { class: `toast ${kind}` }, text);
    $('toasts').append(t);
    setTimeout(() => t.remove(), 8000);
  }

  // --- Alarm sound -----------------------------------------------------------------------
  let audio = null;
  function beep() {
    if (!state.sound || !audio) return;
    const t0 = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, t0 + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.35 + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + i * 0.35);
      osc.stop(t0 + i * 0.35 + 0.3);
    }
  }
  function setSound(on) {
    state.sound = on;
    if (on && !audio) audio = new AudioContext();
    if (on) audio.resume();
    $('sound').setAttribute('aria-pressed', String(on));
    $('sound').textContent = on ? 'Alarm sound on' : 'Turn on alarm sound';
    try {
      localStorage.setItem('sm-sound', on ? '1' : '0');
    } catch {}
  }
  $('sound').addEventListener('click', () => setSound(!state.sound));

  // --- Data ------------------------------------------------------------------------------
  function addToTrack(loc) {
    const track = state.tracks.get(loc.phone) ?? [];
    if (track.some((l) => l.id === loc.id)) return false;
    track.push(loc);
    track.sort((a, b) => a.sharedAt - b.sharedAt || a.id - b.id);
    state.tracks.set(loc.phone, track);
    return true;
  }

  function onSnapshot(snap) {
    state.skew = snap.serverTime - Date.now();
    state.config = snap.config;
    setTiles(snap.config);
    $('operator').textContent = snap.operator;
    state.users = new Map(snap.users.map((u) => [u.phone, u]));
    state.tracks = new Map();
    snap.locations.forEach(addToTrack);
    if (snap.locations.length >= snap.config.maxPoints) {
      toast(`Showing the latest ${snap.config.maxPoints} locations only. Narrow the history window to see all.`);
    }
    if (state.activity.length === 0) {
      const items = [
        ...snap.locations.map((l) => ({ at: l.sharedAt, phone: l.phone, kind: 'loc', loc: l })),
        ...snap.messages.map((m) => ({ at: m.sharedAt, phone: m.phone, kind: 'msg', msg: m })),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 200);
      state.activity = items.map((i) => activityItem(i));
      renderActivity();
    }
    redrawAll();
    if (!state.fitted) {
      const pts = [...state.users.values()].filter((u) => u.latest).map((u) => [u.latest.lat, u.latest.lng]);
      if (pts.length) map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
      state.fitted = true;
    }
    scheduleRender();
  }

  function activityItem({ at, phone, kind, loc, msg }) {
    const u = state.users.get(phone);
    const who = u ? displayName(u) : phone;
    if (kind === 'loc') {
      const where = [loc.label, loc.address].filter(Boolean).join(', ');
      return { at, phone, who, text: `shared location${where ? `: ${where}` : ''}` };
    }
    return { at, phone, who, text: `“${msg.body}”`, sos: msg.isSos };
  }

  function onLocation({ location, user }) {
    state.users.set(user.phone, user);
    if (addToTrack(location)) drawPoint(location);
    drawTrail(user.phone);
    drawMarker(user);
    addActivity(activityItem({ at: location.sharedAt, phone: user.phone, kind: 'loc', loc: location }));
    flash(user.phone);
    if (user.sosAt) beep();
    scheduleRender();
  }

  function onMessage({ message, user }) {
    state.users.set(user.phone, user);
    drawMarker(user);
    addActivity(activityItem({ at: message.sharedAt, phone: user.phone, kind: 'msg', msg: message }));
    if (message.isSos) {
      toast(`SOS from ${displayName(user)}: “${message.body}”`, 'toast-sos');
      beep();
    }
    flash(user.phone);
    scheduleRender();
  }

  function onUser({ user }) {
    const before = state.users.get(user.phone);
    state.users.set(user.phone, user);
    drawMarker(user);
    if (before?.sosAt && !user.sosAt && user.sosAckBy) {
      addActivity({ at: user.sosAckAt, phone: user.phone, who: displayName(user), text: `SOS acknowledged by ${user.sosAckBy}` });
    }
    scheduleRender();
  }

  async function acknowledge(phone) {
    const res = await fetch(`/api/users/${encodeURIComponent(phone)}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401) return (location.href = '/login');
    if (!res.ok && res.status !== 409) toast('Could not acknowledge. Try again.');
  }

  async function loadFullHistory(phone) {
    const res = await fetch(`/api/users/${encodeURIComponent(phone)}/history?hours=0`);
    if (res.status === 401) return (location.href = '/login');
    if (!res.ok) return toast('Could not load history.');
    const { locations } = await res.json();
    state.tracks.set(phone, []);
    locations.forEach(addToTrack);
    redrawUserPoints();
    drawTrail(phone);
    const line = trails.get(phone);
    if (locations.length > 1) map.fitBounds(line.getBounds(), { padding: [60, 60] });
    toast(`Loaded ${locations.length} locations for ${displayName(state.users.get(phone))}.`);
    scheduleRender();
  }

  // --- Live connection -------------------------------------------------------------------
  let source = null;
  function setConn(s, text) {
    $('conn').dataset.state = s;
    $('conn').textContent = text;
  }

  function connect() {
    source?.close();
    setConn('connecting', 'Connecting…');
    source = new EventSource(`/api/stream?hours=${state.hours}`);
    const handle = (fn) => (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
    source.addEventListener('snapshot', handle(onSnapshot));
    source.addEventListener('location', handle(onLocation));
    source.addEventListener('message', handle(onMessage));
    source.addEventListener('user', handle(onUser));
    source.onopen = () => setConn('live', 'Live');
    source.onerror = async () => {
      if (source.readyState === EventSource.CONNECTING) return setConn('connecting', 'Reconnecting…');
      setConn('down', 'Disconnected');
      try {
        const me = await fetch('/api/me');
        if (me.status === 401) return (location.href = '/login');
      } catch {}
      setTimeout(connect, 3000);
    };
  }

  // --- Controls --------------------------------------------------------------------------
  $('filter').addEventListener('input', scheduleRender);
  $('window').addEventListener('change', (e) => {
    state.hours = Number(e.target.value);
    connect();
  });
  $('show-trails').addEventListener('change', (e) =>
    e.target.checked ? trailsLayer.addTo(map) : trailsLayer.remove(),
  );
  $('show-points').addEventListener('change', (e) =>
    e.target.checked ? pointsLayer.addTo(map) : pointsLayer.remove(),
  );
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[data-tab]')) t.setAttribute('aria-selected', String(t === tab));
      $('people').hidden = tab.dataset.tab !== 'people';
      $('activity').hidden = tab.dataset.tab !== 'activity';
      if (tab.dataset.tab === 'activity') {
        state.unseenActivity = 0;
        $('activity-badge').hidden = true;
      }
    });
  }

  // Statuses age without new data (active -> recent -> stale), so refresh them periodically.
  setInterval(() => {
    for (const u of state.users.values()) drawMarker(u);
    scheduleRender();
  }, 20_000);

  try {
    if (localStorage.getItem('sm-sound') === '1') {
      // Browsers only allow audio after a gesture: arm it on the first click anywhere.
      document.addEventListener('click', () => state.sound || setSound(true), { once: true });
    }
  } catch {}

  connect();
})();
