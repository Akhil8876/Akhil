// Sends realistic WhatsApp Cloud API webhooks to a running server so the dashboard can be
// tried without a WhatsApp Business account. Signs requests when WHATSAPP_APP_SECRET is set.
//
//   npm run simulate -- --users 6 --interval 3 --url http://localhost:3000
import { signMetaBody } from '../src/whatsapp.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const url = `${(args.url || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '')}/webhook/whatsapp`;
const userCount = Number(args.users) || 6;
const intervalMs = (Number(args.interval) || 3) * 1000;
const centre = { lat: Number(args.lat) || 17.385, lng: Number(args.lng) || 78.4867 }; // Hyderabad
const secret = process.env.WHATSAPP_APP_SECRET;

const NAMES = ['Priya Sharma', 'Ananya Reddy', 'Fatima Khan', 'Lakshmi Iyer', 'Sneha Patel', 'Divya Nair',
  'Meera Joshi', 'Kavya Rao', 'Aisha Begum', 'Pooja Verma', 'Riya Das', 'Sana Shaikh'];

const people = Array.from({ length: userCount }, (_, i) => ({
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

console.log(`Simulating ${userCount} people -> ${url}${secret ? ' (signed)' : ''}. Ctrl+C to stop.`);

for (const p of people) {
  await send(p, { type: 'location', location: { latitude: p.lat, longitude: p.lng } });
}

setInterval(async () => {
  const p = people[Math.floor(Math.random() * people.length)];
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
