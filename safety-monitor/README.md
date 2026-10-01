# Safety Desk: WhatsApp location monitoring for women safety

A person in trouble shares their location with the **safety WhatsApp number**. The
**safety department's dashboard** shows it on a map within about a second, with no page
refresh, alongside every other location that anyone has shared.

```
 Person's WhatsApp ──location / "SOS"──► WhatsApp (Meta Cloud API or Twilio)
                                                │ webhook (signed)
                                                ▼
                                   Safety Desk server ──► SQLite
                                     │   ▲        └──► auto-reply to the person
                       Server-Sent   │   │ acknowledge SOS
                          Events     ▼   │
                             Safety department dashboard (map, people, activity)
```

## What the dashboard does

- **Live map.** Every person who has shared a location gets a marker at their latest
  position, coloured by status: red pulsing for an open SOS, green if they shared in the
  last 15 minutes, amber within the hour, grey otherwise.
- **All shared locations.** Each person's trail and every individual point in the chosen
  history window (last hour, 6 h, 24 h, 7 days or everything) is drawn on the map.
  "Full history" in a person's popup loads everything they have ever shared.
- **No refresh.** The page holds one Server-Sent Events connection. New locations,
  messages and SOS changes are pushed as they arrive. If the connection drops, the browser
  reconnects by itself and receives a fresh snapshot, so nothing is missed.
- **SOS alerts.** A message containing an SOS keyword (`sos`, `help`, `emergency`, `danger`,
  `unsafe`, `bachao` by default) raises an alert: a red banner, a toast, an optional alarm
  sound, and the person goes to the top of the list. An operator acknowledges it, and the
  dashboard records who did and when.
- **People list and activity feed.** Search by name or number, click to fly to someone, and
  see a timeline of every location and message received.
- **Replies to the person.** Every message gets an automatic reply confirming that the desk
  received it, telling them how to share their location, and giving the emergency number
  (`112` by default).

## Quick start (local demo, no WhatsApp account needed)

Requires Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there are no native
modules to compile.

```bash
cd safety-monitor
npm install
cp .env.example .env          # set DASHBOARD_PASSWORD at least
npm start                     # http://localhost:3000
```

In a second terminal, simulate people sharing their locations around Hyderabad
(`--lat/--lng` to move it elsewhere):

```bash
npm run simulate -- --users 8 --interval 3
```

Open http://localhost:3000, sign in with your name and the desk password, and watch the
markers move. Occasionally a simulated person sends "SOS".

## Connecting a real WhatsApp number

Use either provider. Both work at the same time if you need them to.

### Option A: WhatsApp Business Cloud API (Meta)

1. In [Meta for Developers](https://developers.facebook.com/), create an app, add the
   **WhatsApp** product and register the safety phone number.
2. Put the server on a public HTTPS URL (for testing, `ngrok http 3000`).
3. Under WhatsApp > Configuration > Webhook set:
   - Callback URL: `https://<your-host>/webhook/whatsapp`
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to the **messages** webhook field.
5. Set `WHATSAPP_APP_SECRET` (App settings > Basic) so webhook signatures are verified,
   and `WHATSAPP_ACCESS_TOKEN` (a system-user token) so the server can send replies.

### Option B: Twilio

1. Enable a WhatsApp sender in Twilio (the Sandbox is fine for testing).
2. Set "When a message comes in" to `https://<your-host>/webhook/twilio` (HTTP POST).
3. Set `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL`, the exact public URL Twilio calls, so
   signatures can be checked. Replies are returned as TwiML, so no extra credentials are needed.

## A WhatsApp limitation to plan around: live location

WhatsApp's business APIs deliver **single location pins** ("Send your current location"
or a picked place). They do **not** forward WhatsApp's *Live location* feature to
businesses, so a person sharing live location with the safety number is not tracked
continuously. In practice:

- Tell users to send **"Send your current location"** and to send it again as they move.
  The auto-reply reminds them.
- Each pin becomes a point on that person's trail, so repeated shares build a route the
  desk can follow.
- If continuous tracking is required, pair this with a small companion app or a web page
  that posts GPS fixes. The store and dashboard already handle any number of points per
  person, so that would only need a new ingest endpoint.

## Production checklist

- Run behind HTTPS (set `TRUST_PROXY=true` behind a reverse proxy). With nginx, disable
  buffering for `/api/stream`; the server already sends `X-Accel-Buffering: no`.
- Set `DASHBOARD_PASSWORD`, `SESSION_SECRET`, and the provider secrets. The server warns at
  startup if any signature check is disabled.
- This is sensitive personal data: phone numbers and movements. Restrict who can reach the
  dashboard (VPN or IP allow-list), set `RETENTION_DAYS` to what your policy allows, and
  back up `data/safety.db`.
- Use a tile provider suitable for your load (`TILE_URL`). The public OpenStreetMap
  servers are for light use only.
- The server runs as a single process. To run several instances, move the live fan-out
  to a shared bus such as Redis pub/sub, and move storage to Postgres.

## Project layout

```
src/
  server.js     entrypoint: config warnings, retention job, graceful shutdown
  app.js        HTTP routes: webhooks, sign-in, live stream, dashboard API
  whatsapp.js   Meta/Twilio payload parsing, signature checks, replies
  store.js      SQLite schema and queries (users, locations, messages)
  live.js       Server-Sent Events hub
  auth.js       signed session cookie, login throttling
public/         dashboard (Leaflet map) and login page
scripts/simulate.js   fake WhatsApp traffic for demos
test/           unit and end-to-end tests (`npm test`)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/webhook/whatsapp` | Meta webhook verification handshake |
| POST | `/webhook/whatsapp` | Meta inbound messages (signature checked) |
| POST | `/webhook/twilio` | Twilio inbound messages (signature checked) |
| GET | `/api/stream?hours=24` | Live event stream: `snapshot`, then `location`, `message`, `user` |
| GET | `/api/users/:phone/history?hours=0` | All locations for one person |
| POST | `/api/users/:phone/acknowledge` | Close an open SOS (JSON body) |
| GET | `/healthz` | Liveness and connected-dashboard count |
