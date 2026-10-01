# Safety Desk: live location monitoring for women safety

People share their location with the **safety helpline** by WhatsApp, SMS, Telegram, a
live-sharing link or a tracker app. The **safety department's dashboard** shows everyone
on one map within about a second, with no page refresh, alongside every location each
person has shared.

```
 WhatsApp ─┐                                           ┌─► SQLite
 SMS ──────┤  webhooks (signed / keyed)                │
 Telegram ─┼──────────────────────────► Safety Desk ───┼─► reply to the person (code, links, 112)
 Live link ┤  GPS from the phone's browser   server    │
 Tracker ──┘  OsmAnd / Traccar Client                  └─► Server-Sent Events
                                                              │
                                     Safety department dashboard: map, people, SOS, activity
```

## Ways a person can share their location

| Channel | What the person does | Continuous? | Needs |
| --- | --- | --- | --- |
| **WhatsApp** | Sends 📎 > Location > *Send your current location* | Single pins, sent again as they move | Meta Cloud API or Twilio |
| **Live-sharing link** | Texts `TRACK` (or `SOS`) on any channel, opens the link, taps *Start sharing* | **Yes**, every few seconds while the page is open | Nothing to install |
| **Telegram** | 📎 > Location > *Share My Live Location* to the bot | **Yes**, for as long as they choose to share, even with the screen locked | A Telegram bot |
| **SMS** | Texts `SOS`, `TRACK`, a Google Maps link or coordinates | Through the `TRACK` link | Twilio SMS or any SMS gateway |
| **Tracker app / GPS device** | Runs the free *Traccar Client* app, or carries a GPS tracker | **Yes**, in the background with the screen locked | One-time setup from the dashboard |

WhatsApp's business APIs never forward WhatsApp's own *Live location*, only single pins.
That is why the other channels exist: the live link needs no install, Telegram forwards
live location natively, and the tracker app keeps working with the phone locked.

### What people can text (WhatsApp, SMS or Telegram)

| Message | Effect |
| --- | --- |
| `SOS`, `help`, `emergency`, `danger`, `unsafe`, `bachao` | Raises an SOS on the dashboard; the reply includes a live-sharing link and 112 |
| `TRACK` or `LIVE` | Reply with a private live-sharing link (valid 12 h) |
| `STOP` | Ends their live-sharing links |
| `CODE` | Reply with their personal safety code |
| `SOS 482913`, `TRACK 482913` | Same as above, **for the owner of code 482913**: for when they are using someone else's phone. The dashboard shows which number it was sent from. |
| A Google Maps link (including `maps.app.goo.gl` short links), a `geo:` link, or `17.3850, 78.4867` | Becomes a point on their trail |

Everyone gets a **personal safety code** (6 digits) the first time they contact the
helpline, or when the desk registers them with *Add person*. A code is recognised only
straight after a keyword or on its own, so a 6-digit postal PIN in an address is never
taken for one. Codes identify, they do not authenticate: anyone who knows a code can raise
an alert for that person, so the desk always sees the real sending number too.

## What the dashboard does

- **Live map.** Every person has a marker at their latest position: red and pulsing for an
  open SOS, green if they shared in the last 15 minutes, amber within the hour, grey
  otherwise. **LIVE** marks people streaming right now (link, Telegram or tracker).
- **All shared locations.** Trails and every individual point in the history window (last
  hour up to everything). Clicking a person shows the source, accuracy circle, battery
  level, and "sent from" when it came from a borrowed phone.
- **No refresh.** One Server-Sent Events connection pushes new locations, messages and SOS
  changes. If it drops, the browser reconnects and receives a fresh snapshot.
- **SOS alerts.** A red banner, a toast and an optional alarm sound, and the person goes to
  the top of the list. An operator acknowledges it, and the dashboard records who did.
- **Desk actions.** *Add person* registers someone in advance and shows their code.
  *Live-sharing link* creates a link the desk can forward or read out. *Tracker app setup*
  issues the identifier for the Traccar Client app or a GPS device.

## Quick start (local demo, no accounts needed)

Requires Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there are no
native modules to compile.

```bash
cd safety-monitor
npm install
cp .env.example .env          # set DASHBOARD_PASSWORD; set SMS_WEBHOOK_KEY to demo live links
npm start                     # http://localhost:3000
npm run simulate -- --users 9 --interval 3      # second terminal
```

The simulator sends WhatsApp pins around Hyderabad (`--lat/--lng` to move it). With
`SMS_WEBHOOK_KEY` set, every third simulated person texts `TRACK` by SMS and streams GPS
from the link they get back. Now and then someone sends "SOS".

To try the live-sharing page yourself, open a person's popup, click **Live-sharing link**,
and open the link on your phone. Browsers only share location over HTTPS, so for a phone
expose the server with a tunnel (e.g. `ngrok http 3000`) and set `PUBLIC_BASE_URL`.

## Connecting the channels

Put the server on a public HTTPS address first and set `PUBLIC_BASE_URL` to it. Each
channel is optional, and they all work at the same time.

### WhatsApp: Meta Cloud API

1. In [Meta for Developers](https://developers.facebook.com/), create an app, add
   **WhatsApp**, and register the safety number.
2. WhatsApp > Configuration > Webhook: callback `https://<host>/webhook/whatsapp`, verify
   token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.
3. Set `WHATSAPP_APP_SECRET` (signature checks) and `WHATSAPP_ACCESS_TOKEN` (replies).

### WhatsApp and SMS: Twilio

Point "A message comes in" for your WhatsApp sender **and/or** your SMS number at
`https://<host>/webhook/twilio` (HTTP POST) and set `TWILIO_AUTH_TOKEN`. Replies go back as
TwiML, so there's nothing else to configure. Senders without the `whatsapp:` prefix are
recorded as SMS.

### SMS: any other gateway (MSG91, Exotel, Gupshup, a GSM modem bridge)

Set `SMS_WEBHOOK_KEY` and configure the gateway's inbound-SMS webhook as
`https://<host>/webhook/sms?key=<SMS_WEBHOOK_KEY>`. It accepts GET or POST, form or JSON,
and common field names for the sender (`from`, `sender`, `mobile`, `msisdn`...) and text
(`text`, `message`, `body`, `content`...). National numbers get `DEFAULT_COUNTRY_CODE`.
The response is `{"ok": true, "reply": "..."}`. Gateways that can reply from the webhook
response can use that; otherwise send `reply` through the gateway's outbound API. In India,
outbound SMS needs DLT registration of the sender ID and message templates.

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN`.
2. Choose a random `TELEGRAM_WEBHOOK_SECRET` and register the webhook:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url=https://<host>/webhook/telegram \
     -d secret_token=$TELEGRAM_WEBHOOK_SECRET \
     -d 'allowed_updates=["message","edited_message"]'
   ```
3. People open the bot and tap Start. Buttons let them send their location or share their
   phone number. Until they share it, they appear as "Telegram (number not shared)". Once
   they do, their Telegram history joins any WhatsApp/SMS history for that number.

### Tracker app (background tracking) and GPS devices

On the dashboard, open the person and click **Tracker app setup**. It shows a secret
*device identifier* and the *server URL* (`https://<host>/track/osmand`).

- **Phone:** install the free **Traccar Client** (Android / iPhone). Enter the two values,
  set accuracy to High, allow location "All the time", and switch it on. Positions keep
  arriving with the screen locked, and buffered points are sent when signal returns.
- **GPS tracker / panic pendant:** any device or app that speaks the **OsmAnd** HTTP
  protocol uses the same identifier and URL.

Creating a new identifier cuts off the previous one, e.g. for a lost phone.

## Production checklist

- Run behind HTTPS (`TRUST_PROXY=true` behind a reverse proxy) and set `PUBLIC_BASE_URL`.
  With nginx, disable buffering for `/api/stream`; the server already sends
  `X-Accel-Buffering: no`.
- Set `DASHBOARD_PASSWORD`, `SESSION_SECRET` and every enabled channel's secret. The server
  warns at startup about any check that is off.
- This is sensitive personal data: identities and movements. Restrict who can reach the
  dashboard (VPN or IP allow-list), set `RETENTION_DAYS` to what your policy allows, and
  back up `data/safety.db`. Live-sharing links and tracker identifiers are bearer
  secrets: anyone holding one can post locations for that person.
- Use a tile provider suitable for your load (`TILE_URL`). The public OpenStreetMap
  servers are for light use only.
- The server runs as a single process. To run several instances, move the live fan-out to
  a shared bus such as Redis pub/sub, and move storage to Postgres.

## Project layout

```
src/
  server.js     entrypoint: config warnings, retention job, graceful shutdown
  app.js        HTTP routes: every channel's webhook, live link, tracker, dashboard API
  ingest.js     one pipeline for all channels: store, broadcast, decide the reply
  text.js       reading SOS, commands, codes and map links out of message text
  whatsapp.js   Meta/Twilio payloads, signature checks, phone number normalisation
  telegram.js   Telegram updates (incl. live location edits) and replies
  sms.js        generic SMS gateway payloads
  tracker.js    OsmAnd / Traccar Client positions
  store.js      SQLite schema, migrations and queries
  live.js       Server-Sent Events hub
  auth.js       signed session cookie, login throttling
public/
  index.html, app.js    dashboard (Leaflet map)
  track.html, track.js  live-sharing page opened on the person's phone
  login.html, styles.css
scripts/simulate.js     fake traffic for demos
test/                   unit and end-to-end tests (`npm test`)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/webhook/whatsapp` | Meta verification handshake / inbound messages |
| POST | `/webhook/twilio` | Twilio WhatsApp and SMS |
| GET/POST | `/webhook/sms?key=` | Any other SMS gateway |
| POST | `/webhook/telegram` | Telegram bot updates |
| GET/POST | `/track/osmand` | Tracker apps and GPS devices |
| GET | `/t/:token` | Live-sharing page |
| GET/POST | `/api/track/:token` | Link status / submit a GPS fix |
| POST | `/api/track/:token/sos` | SOS button on the live-sharing page |
| GET | `/api/stream?hours=24` | Dashboard event stream: `snapshot`, then `location`, `message`, `user`, `refresh` |
| POST | `/api/people` | Register a person (returns their code) |
| GET | `/api/users/:phone/history?hours=0` | All locations for one person |
| POST | `/api/users/:phone/acknowledge` | Close an open SOS |
| POST | `/api/users/:phone/tracking-link` | Create a live-sharing link |
| POST | `/api/users/:phone/device-key` | Issue a tracker identifier (revokes the old one) |
| GET | `/healthz` | Liveness and connected-dashboard count |
