# WhatsApp through Twilio

Friendly CRM sends and receives WhatsApp messages through Twilio when the settings below are present. With no Twilio
settings it behaves as before (the development sandbox, or the Hostinger / WAHA gateway if that is configured).

## 1. Settings (`.env`, never committed)

| Setting | Needed | What it is |
|---|:-:|---|
| `TWILIO_ACCOUNT_SID` | yes | Starts with `AC`. Twilio console home page. |
| `TWILIO_AUTH_TOKEN` | yes | The account auth token. It also signs Twilio's webhook calls, so it is needed even if you send with an API key. |
| `TWILIO_WHATSAPP_FROM` | one of | The sending number: `+14155238886` for the sandbox, or your approved WhatsApp sender. |
| `TWILIO_MESSAGING_SERVICE_SID` | these two | Use a Messaging Service (starts with `MG`) instead of a single number. |
| `TWILIO_WEBHOOK_URL` | yes | The exact address entered in Twilio, e.g. `https://api.yourshop.in/api/notifications/twilio/webhook`. Twilio signs this address, so it must match character for character (scheme, host, path). If it is not set, `PUBLIC_API_URL` + `/api/notifications/twilio/webhook` is used. |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | no | Send with an API key instead of the auth token. |
| `TWILIO_STATUS_CALLBACK_URL` | no | Asks Twilio to report delivered / read / failed for every message sent. Usually the same address as above. |
| `TWILIO_TEST_TO` | no | Only for `npm run check:twilio`: a number that may receive one test message. |

Twilio sending is used once `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and a sender are all set. It comes after a
business-specific gateway and before the Hostinger gateway. `ENABLE_DEV_SMS_GATEWAY=true` keeps everything in the
development sandbox, so leave it `false` on the real server.

## 2. In the Twilio console

1. **Sandbox (for trying it):** Messaging → Try it out → Send a WhatsApp message. Each phone that should receive messages
   first sends the join code shown there to the sandbox number.
2. **Webhook:** in the sandbox settings (or your sender's settings) set **When a message comes in** to
   `…/api/notifications/twilio/webhook`, method **POST**. Set **Status callback URL** to the same address.
3. The API must be reachable from the internet at that address (for local tests, a tunnel such as ngrok; then set
   `TWILIO_WEBHOOK_URL` to the tunnel's address).

## 3. Check it

```
cd apps/api
npm run check:twilio
```

It reports which settings are missing (names only), asks Twilio whether the account and token are valid (sends nothing),
and, only if `TWILIO_TEST_TO` is set, sends one short test message.

## 4. Things to know

- **24-hour rule.** WhatsApp lets a business send free-form text only within 24 hours of the customer's last message.
  Replies from the bot (answering someone who just wrote) are always inside the window. Messages the system starts on its
  own, such as quote created, order confirmed or a payment reminder, are outside it unless the customer wrote recently;
  for those Twilio refuses free-form text (error 63016) and an **approved template** is needed. Such a message is marked
  failed with a plain reason and is **not** retried. Sending those through templates is the next step once the templates
  exist in Twilio.
- **Long messages** are split at line ends into several WhatsApp messages (Twilio's limit is 1600 characters).
- **PDFs and pictures** are sent by link: Twilio fetches the link, so it must be public (the signed quote links are).
- **Delivered / read / failed** reports are matched to the queued message by the id Twilio gave it (migration 0023,
  `notification_outbox.provider_message_id`). Run `npm run db:migrate` after updating.
- **Security.** Every call to the webhook must carry a valid `X-Twilio-Signature`. Without `TWILIO_AUTH_TOKEN` and a known
  webhook address every call is refused; there is no development bypass.
- **Trial accounts** can message only verified numbers.
