// Sends realistic traffic to a running server so the dashboard can be tried without any
// WhatsApp, SMS or Telegram account:
//   - most people share single pins over WhatsApp (signed when WHATSAPP_APP_SECRET is set)
//   - when SMS_WEBHOOK_KEY is set, some text TRACK by SMS, open the link they get back,
//     and stream live GPS from it, like a phone on the live-sharing page would
//
//   npm run simulate -- --users 6 --interval 3 --url http://localhost:3000
import { signMetaBody } from '../src/whatsapp.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const server = (args.url || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const url = `${server}/webhook/whatsapp`;
const smsKey = process.env.SMS_WEBHOOK_KEY;
const userCount = Number(args.users) || 6;
const intervalMs = (Number(args.interval) || 3) * 1000;
const centre = { lat: Number(args.lat) || 17.385, lng: Number(args.lng) || 78.4867 }; // Hyderabad
const secret = process.env.WHATSAPP_APP_SECRET;

const NAMES = ['Priya Sharma', 'Ananya Reddy', 'Fatima Khan', 'Lakshmi Iyer', 'Sneha Patel', 'Divya Nair',
  'Meera Joshi', 'Kavya Rao', 'Aisha Begum', 'Pooja Verma', 'Riya Das', 'Sana Shaikh'];

const people = Array.from({ length: userCount }, (_, i) => ({
  live: Boolean(smsKey) && i % 3 === 2, // every third person streams from a live link
  waId: `91${9800000000 + i * 1111}`,
  name: NAMES[i % NAMES.length],
  lat: centre.lat + (Math.random() - 0.5) * 0.12,
  lng: centre.lng + (Math.random() - 0.5) * 0.12,
  heading: Math.random() * Math.PI * 2,
}));

let seq = 0;
async function send(person, message) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'SIMULATED',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '911800000000', phone_number_id: 'SIMULATED' },
          contacts: [{ profile: { name: person.name }, wa_id: person.waId }],
          messages: [{
            from: person.waId,
            id: `wamid.SIM.${Date.now()}.${seq++}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            ...message,
          }],
        },
      }],
    }],
  });
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Hub-Signature-256'] = signMetaBody(body, secret);
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

function step(p) {
  p.heading += (Math.random() - 0.5) * 0.8;
  const metres = 80 + Math.random() * 220;
  p.lat += (Math.cos(p.heading) * metres) / 111_320;
  p.lng += (Math.sin(p.heading) * metres) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
}

async function sms(person, text) {
  const res = await fetch(`${server}/webhook/sms?key=${encodeURIComponent(smsKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: person.waId.slice(2), text, id: `sim-${Date.now()}-${seq++}` }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()).reply ?? '';
}

async function startLiveLink(p) {
  const reply = await sms(p, 'TRACK');
  const link = /https?:\/\/\S+\/t\/([\w-]+)/.exec(reply);
  if (!link) throw new Error(`no link in reply: ${reply}`);
  p.trackApi = `${server}/api/track/${link[1]}`;
  console.log(`live link ${p.name} (SMS TRACK)`);
}

async function sendLiveFix(p) {
  const res = await fetch(p.trackApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: p.lat, lng: p.lng, accuracy: 5 + Math.random() * 20, timestamp: Date.now(), battery: 80 }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

console.log(
  `Simulating ${userCount} people -> ${server}${secret ? ' (signed)' : ''}` +
    `${smsKey ? ', some on live links via SMS' : ' (set SMS_WEBHOOK_KEY to include live links)'}. Ctrl+C to stop.`,
);

for (const p of people) {
  // Name them first so the SMS users show up with a name rather than just a number.
  await send(p, { type: 'location', location: { latitude: p.lat, longitude: p.lng } });
  if (p.live) await startLiveLink(p);
}

// Live-link phones report every couple of seconds while walking.
setInterval(async () => {
  for (const p of people.filter((x) => x.trackApi)) {
    step(p);
    await sendLiveFix(p).catch((err) => console.error(`live fix failed: ${err.message}`));
  }
}, 2500);

setInterval(async () => {
  const pinPeople = people.filter((x) => !x.live);
  const p = pinPeople[Math.floor(Math.random() * pinPeople.length)];
  if (!p) return;
  try {
    if (Math.random() < 0.05) {
      await send(p, { type: 'text', text: { body: 'SOS please help, someone is following me' } });
      console.log(`SOS     ${p.name}`);
    } else {
      step(p);
      await send(p, { type: 'location', location: { latitude: p.lat, longitude: p.lng } });
      console.log(`location ${p.name} ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    }
  } catch (err) {
    console.error(`send failed: ${err.message}`);
  }
}, intervalMs);
