# Friendly CRM: local walkthrough

Everything below runs on your machine against the local Postgres database. Nothing is sent to real customers:
WhatsApp messages go to a developer sandbox that prints them in the API console.

## 1. Start it

In PowerShell, from the project folder (`friendly-crm`):

```powershell
$env:ENABLE_DEV_SMS_GATEWAY = 'true'      # OTP codes are printed in this console instead of sent by SMS
$env:WHATSAPP_WEBHOOK_SECRET = 'dev-secret'  # lets the WhatsApp simulator talk to the bot
$env:DEV_LOG_MESSAGE_BODIES = 'true'      # prints what the bot / reminders would send on WhatsApp
# $env:ANTHROPIC_API_KEY = 'paste-your-key-here'  # optional: also reads handwriting and scanned PDFs (remove the # to switch on)
npm run dev -- --env-mode=loose
```

- Web app: http://localhost:3000   API: http://localhost:4000/api
- The first visit to each page compiles it and can take 20-40 seconds. Later visits are instant.
- Tamil text can look garbled in the console. Run `chcp 65001` first, or ignore it; the web pages are fine.
- Postgres must be running (database `friendly_crm`). Migrations 0001-0014 are already applied to it.

## 2. Log in

1. Open http://localhost:3000. You land on `/login`.
2. Enter **9876543210** (the owner, Jeevan Prakash) and press send.
3. Look at the console running `npm run dev` for `DEV OTP for +919876543210: 123456` and type that code.
   A code can be requested once a minute.

Other login: **9876543211** is Murugan (Floor Supervisor), role PRODUCTION, a good test of what a limited role sees.

## 3. The data you start with

Four businesses, all owned by 9876543210 (switch between them from the business name at the top left):

| Business | Industry | Customer | Order | Total | Due |
|---|---|---|---|---|---|
| Senthaamarai Art Crafts & Calendars | Printing | Sri Krishna Sweets (+919443022222) | ORD-2026-4832 | 1,25,000 | 75,000 |
| Kongu Tex & Garments | Textiles | Chennai Silks Mart (+919443066666) | ORD-2026-2888 | 2,10,000 | 1,10,000 |
| Sri Vinayaga Furniture | Furniture | Karthik Residence (+919443044444) | ORD-2026-6245 | 85,000 | 50,000 |
| Sun Steel & Industrial Traders | Trading | Apex Fabrication Works (+919443088888) | ORD-2026-2299 | 64,000 | 0 |

No leads, quotes, GSTIN or UPI ID are set yet. Most of the walkthrough below uses **Senthaamarai**.

## 4. Screen by screen

| Screen | URL | What to check |
|---|---|---|
| Login | `/login` | OTP request, wrong code is rejected, resend countdown, English / Tamil toggle |
| Home | `/` | Dashboard cards, then **Quotes to Send** (every enquiry still waiting for its quote, oldest first, with **＋ Prepare quote**), then the follow-up queue. **Quick Add** saves an enquiry, sets "Send the quote by" (default today), and takes you here. Making the quote ticks it off and schedules "Follow up on quote" two days later; the customer accepting closes that follow-up; **Close** drops an enquiry that is not going ahead |
| Customers | `/customers` | List, search by name or phone, balance column. **Add customer** adds one (no enquiry is created) |
| Import customers | `/customers/import` | Upload a CSV (or paste rows from Excel), check the columns, preview what will be added, then import. Handles opening balances, GSTIN, state, address; skips phone numbers that already exist |
| Customer detail | `/customers/<id>` | Orders, quotes, ledger, timeline. **GST details** card at the bottom: edit GSTIN, state, address, and "Do not send automatic payment reminders" |
| Quick Add (voice note / files) | the **Quick Add** button | The mobile number comes first and is the customer's identity: type it any way (`98409 80001`, `09840980001`, `+91…`) and the customer list is checked automatically. A known number shows a green **Existing customer** box, fills the name and company from the list (locked) and adds no duplicate; it also matches a customer's WhatsApp number. An unknown number shows **New customer** and you type the name; saving adds them once. Under the enquiry fields: **Record** a voice note of the requirement (play it back, record again) and **Attach** photos, drawings, PDF, Word, Excel, CSV or text files (up to 10, files 10 MB, voice 5 MB / 5 minutes). They are uploaded right after the enquiry is saved; if one fails the enquiry is kept and the button becomes **Retry attachments** |
| New quote | `/quotations/new?customerId=<id>` (the **New Quote** button on a customer, or **Prepare quote** on Home) | The **Customer's requirement** box at the top shows the enquiry's voice note and files: **Play**, **View** a photo, download, remove, or **＋ Add** more. Press **✨ Read enquiry and fill the quote**: handwritten notes, photos, PDFs, the enquiry text and the voice note's words are read, matched to your Products (rate, GST %, HSN, unit filled from the product), and added as lines marked *Filled from the enquiry — please check*, with anything not found flagged *You need to fill in: quantity, rate*. Nothing is saved until you press save. Then add or correct items with rate, GST % and optional HSN; save; View PDF / WhatsApp share / Convert Order |
| Quote PDF view | `/q/<id>/pdf` | Printable quote; **Download PDF** button |
| Products | `/products` | Your product and service list: search, **Add product**, edit, archive. Each has code, HSN/SAC, unit, rate (before GST) and GST % |
| Import products | `/products/import` | Upload a CSV or paste from Excel, check the columns, preview, import. Skips or updates products with the same name or code |
| Orders | `/orders` | List and stage filter |
| Order detail | `/orders/<id>` | Stage card (move the order forward), payments, **Issue GST invoice** panel. Once invoiced, a **Credit notes** box: **Issue credit note** to take back goods returned (quantity per item), give a discount after the sale or correct a value (amount per item), or **Cancel the whole invoice**. The exact total (CGST/SGST or IGST) is shown before you issue it |
| Inbox | `/inbox` | Customer change requests from WhatsApp, and approved orders still waiting for payment |
| Dues ("Who owes me") | `/dues` | Total, ageing buckets (click to filter), per-customer **Send reminder**, WhatsApp / Call links. Money owed from before Friendly CRM shows as a purple **Before Friendly CRM** bucket; expand a customer and press **Record payment received** to clear it |
| Invoices | `/invoices` | Issued GST invoices with PDF download and paid / due / credited status, and below them the credit notes issued |
| Reports | `/reports` | Funnel, pending collections, repeat opportunities. Owner / Manager / Accounts only |
| Settings | `/settings` | Owner only: legal name, GSTIN, address, UPI ID, automatic reminder schedule |

Also check on every screen: the business switcher, the language toggle, sign out, a narrow browser window
(the bottom bar scrolls sideways), and what happens after you sign out and press Back.

## 4b. Bringing in your existing customers

1. Customers → **Import from Excel / CSV** → **Download template** to see the columns (Name and Phone are required).
2. Fill it in, or use your own sheet: columns like `Party Name`, `Mobile`, `GST No`, `State`, `Outstanding` are recognised automatically.
3. In Excel use **Save As → CSV UTF-8** so Tamil names import correctly.
4. **Check the list** shows what will be added, skipped (phone already a customer) or rejected (with the reason per row). Nothing is saved yet.
5. **Import**. `Opening balance` is what each customer owed before Friendly CRM; it shows up in **Who owes me** and in the customer's WhatsApp `dues` reply.

An opening balance is only set for NEW customers. Importing a customer that already exists never changes their balance.

## 4c. Product master and quotes

1. **Products → Import from Excel / CSV** (or **Add product**). Name is required; Rate, GST %, HSN/SAC and Unit are what fill a quote line. A missing rate becomes ₹0 and a missing GST % becomes 18%; the check step lists those rows.
2. Customer → **New Quote**: in the item box start typing (for example `cal`). Pick a product and the unit, rate, GST % and HSN fill in. You can still change them, or type an item that is not in the list.
3. Changing a product later never changes quotes or invoices already made; they keep their own copy.
4. When you issue a GST invoice, an item that has no HSN gets the HSN from your product list as a suggestion.

Owner and Manager can change products; Sales and Accounts can only look and use them in quotes; Production cannot see prices.

## 5. End-to-end money flow (about 10 minutes)

Do this in **Senthaamarai**. Use a second PowerShell window for the WhatsApp commands.

1. **Settings** (`/settings`): set GSTIN `33AABCS1234A1Z8` (a valid test number), an address, a UPI ID such as
   `senthaamarai@okhdfc`, and save. The state (33 Tamil Nadu) fills in from the GSTIN.
2. **Customer** (`/customers` → Sri Krishna Sweets → **New Quote**): add an item (for example 500 calendars,
   rate 100, GST 18%, HSN `4910`), save. Note the quote number.
3. **Customer approves on WhatsApp.** Pretend to be the customer:
   ```powershell
   node scripts/dev-chat.mjs +919443022222 "hi"        # the bot asks to verify (name or an order number)
   node scripts/dev-chat.mjs +919443022222 "ORD-2026-4832"
   node scripts/dev-chat.mjs +919443022222 "quotes"    # lists the open quote
   ```
   Read each reply in the `npm run dev` console under `[DEV MESSAGE to +919443022222]`. Pick the quote, review it,
   and confirm to approve. The reply includes the new order number and a UPI pay link.
   Menu words: **orders**, **quotes**, **dues**, **language**.
4. **Inbox** (`/inbox`): the new order appears under "Approved, awaiting payment". Ask for a change on a second
   quote ("quotes" → pick → change) to see it under "Quotes with change requests". Press **Revise quote** on that
   card, adjust the items or discount, and press **Save v2 and send to customer**. The customer is sent the updated
   quote (new total, the earlier total, a fresh link) and from then on sees only v2: `quotes` lists v2 and the link in
   the old message opens v2. A quote that was already approved or already replaced cannot be revised.
5. **Staff records a payment on WhatsApp.** Pretend to be the owner:
   ```powershell
   node scripts/dev-chat.mjs +919876543210 "hi"        # the staff menu; choose the record payment option
   ```
   Follow the prompts (order, amount, mode, reference, confirm). The customer's receipt appears in the console.
   You can also record a payment from the order page.
6. **Order page** (`/orders/<id>`): move the stage forward; the customer gets a status message (console).
7. **Issue GST invoice** (same page): fill the HSN if asked, check the place of supply (your own state is assumed
   unless the customer has a GSTIN or state), read the preview (CGST + SGST for same state, IGST otherwise),
   press **Issue invoice**, then **Download PDF**. Open `/invoices` to see it. Try issuing it a second time: it is refused.
8. **Dues** (`/dues`): the customer's balance with age. Press **Send reminder**; the message with the UPI link
   prints in the console. Pressing it again within 24 hours is refused.
9. **Automatic reminders**: in Settings turn them on. Reminders only go out 9am-7pm IST, for debts at least
   "first after" days old, and the scheduler wakes every 10 minutes. Your seeded orders are brand new, so
   nothing is old enough to be sent today.

## 6. Roles

Log out and sign in as **9876543211** (PRODUCTION). Expected: no Dues, Inbox, Invoices, Reports or Settings in the
navigation, no amounts on orders, and typing those URLs directly shows "Your role cannot..." rather than data.
WhatsApp as that number (`node scripts/dev-chat.mjs +919876543211 "hi"`) shows the production menu.

## 7. Things that are not finished (so you do not report them as bugs)

- **No Razorpay / card payments** (no keys). Payments are UPI links plus staff recording the payment.
- **No e-invoice or e-way bill** (needs government API access).
- **One invoice per order.** Credit notes (own series `CN/2026-27/0001`) reduce an issued invoice but an order cannot be invoiced a second time: after a full cancellation the order stays un-invoiced-able. A credit note lowers the order total and balance; if the invoice was already paid the balance goes negative, meaning the customer is in credit with you (shown on the invoice; the customer list may show it as a negative balance). Refunding that money is done outside the app. Credit notes are not sent to the customer automatically.
- **A customer cannot reply "stop"** to automatic reminders on WhatsApp; staff set it on the customer page.
- **Quote links only reach other phones once the server has a public address.** Locally the link in the quote message points at `http://localhost:4000` (works on this computer only). For real use set `PUBLIC_API_URL` (the address customers can reach) and `QUOTE_LINK_SECRET` (16+ random characters); without them in production no link is sent.
- **Customers in credit (advances)** cannot be imported yet; a negative balance is rejected.
- **WhatsApp is a sandbox.** Replies print in the console; nothing reaches a phone. No interactive buttons yet.
- **Reading the enquiry works three ways.** With no setup it reads the typed and spoken words, the text inside PDFs and printed text in photos (OCR, English) on this server, and says which photos look handwritten and need a person. Add `ANTHROPIC_API_KEY` (cloud) or `OLLAMA_URL` + `OLLAMA_MODEL` (a vision model on your own machine) in `.env` to read handwriting and scanned PDFs too; see `.env.example`. With a key, photos and scanned PDFs are sent to Anthropic only when staff press the button. Word and Excel attachments are never read. If two places give different quantities for an item, the first is used and the clash is listed for you to check.
- **Voice notes are written down by the browser** while recording (Chrome / Edge / Safari; Tamil and Indian English) and the text is editable. If the browser cannot, type what was said, or the voice note is skipped by the reader. Audio itself is never sent to the reader. The browser asks for microphone permission; recording works on `localhost` and on https sites only. Safari records `.m4a`, Chrome and Edge `.webm`.
- **Attachments live in the database** (simple, but not for hundreds of large files per business); moving them to cloud file storage is a later step. WhatsApp voice notes or photos sent by customers are not attached to enquiries yet.
- **Invoice PDF** prints "Rs." and cannot show Tamil names (font limitation).
- **Not yet reviewed in a browser by me:** page layout, Tamil text, mobile view. Report anything that looks wrong.
- There is no separate leads list page; a lead made with Quick Add shows wherever the dashboard lists leads.

## 8. Handy extras

```powershell
# Run the automated checks
cd apps/api; npx jest --config ./jest.config.js
```

To undo what you create while testing (invoices cannot be deleted by the app on purpose), ask for a cleanup of the
dev database.

If a page shows "Could not reach the server", the API is not running or crashed; look at the console.
If the API says `EADDRINUSE`, an old server still holds port 3000 or 4000; close the old terminal first.
