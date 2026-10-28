#!/usr/bin/env node
/**
 * Local WhatsApp simulator: sends one message to the bot as if it came from a phone, via the real inbound
 * webhook (signed the way Meta signs it). The bot's reply is printed in the API console when the API runs with
 * DEV_LOG_MESSAGE_BODIES=true.
 *
 *   node scripts/dev-chat.mjs <phone> "<message>"
 *   node scripts/dev-chat.mjs +919443022222 "hi"
 *
 * Needs the API started with WHATSAPP_WEBHOOK_SECRET set to the same value as WHATSAPP_WEBHOOK_SECRET here
 * (default: dev-secret). Local development only.
 */
import { createHmac, randomUUID } from 'node:crypto';

const [phone, ...rest] = process.argv.slice(2);
const text = rest.join(' ');
if (!phone || !text) {
  console.error('Usage: node scripts/dev-chat.mjs <phone> "<message>"');
  process.exit(1);
}
const secret = process.env.WHATSAPP_WEBHOOK_SECRET || 'dev-secret';
const api = process.env.API_URL || 'http://localhost:4000';

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'DEV-WABA',
      changes: [{ value: { messages: [{ id: `wamid.${randomUUID()}`, from: phone.replace(/\D/g, ''), type: 'text', text: { body: text } }] } }],
    },
  ],
});
const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

const res = await fetch(`${api}/api/notifications/whatsapp/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  body,
});
console.log(`webhook -> ${res.status} ${res.status === 200 || res.status === 201 ? 'accepted' : await res.text()}`);
console.log('The bot reply is printed in the API console (look for [DEV MESSAGE to ...]).');
