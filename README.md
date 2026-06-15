# CuraTrax email backend

A tiny Node.js service that makes your website's **"Book a demo"** form and **credentialing waitlist** actually deliver to your inbox. When someone submits, this backend emails the details to your team and (optionally) sends the visitor a confirmation.

---

## The problem this fixes

Right now your website's form is a front-end shell. When someone clicks **Book my demo**, the page just shows a "Request received" message — it runs `dCard.classList.add('sent')` and nothing is sent anywhere. No email, no inbox, no record. This backend is the missing piece that receives the submission and emails it to you.

## What I found about your email

Both `stelliteworks.com` and `curatrax.com` receive mail through **Zoho Mail** (mail servers `mx.zoho.in` — the India data center). So `info@stelliteworks.com` and `support@curatrax.com` are real, working mailboxes. That's why this backend is pre-configured for **Zoho SMTP** (`smtp.zoho.in`). You just need to add an app password.

## How it works

```
Visitor fills form  ->  website POSTs to this backend  ->  backend sends email via Zoho SMTP
                                                              |-> notification to your team
                                                              |-> confirmation to the visitor (optional)
```

Two endpoints:

- `POST /api/demo` — demo requests (name, email, organization, interest)
- `POST /api/waitlist` — credentialing waitlist signups (email)

---

## Prerequisites

- **Node.js 18 or newer** (`node -v` to check). Download at nodejs.org if needed.
- Access to your Zoho Mail account for `info@stelliteworks.com`.

---

## Step 1 — Get a Zoho app password

Zoho won't let an app send mail using your normal login password. You generate a one-off "app password" instead.

1. Sign in at **https://accounts.zoho.in** (use `.in`, since your mail is on the India data center).
2. Go to **Security** → **App Passwords**.
3. Click **Generate New Password**, name it `CuraTrax Website`.
4. Copy the password it shows (a ~16-character string). You'll paste it into `.env` as `SMTP_PASS`.

Also make sure SMTP is allowed: in **Zoho Mail → Settings → Mail Accounts**, confirm **IMAP/SMTP access** is enabled for the mailbox. (On most Zoho plans it's on by default.)

> If you have two-factor auth off and app passwords aren't available, turn on 2FA first — that unlocks app passwords.

---

## Step 2 — Install and configure

From inside the `curatrax-backend` folder:

```bash
npm install
cp .env.example .env
```

Open `.env` and set at minimum:

- `SMTP_USER` = `info@stelliteworks.com`
- `SMTP_PASS` = the app password from Step 1
- `ALLOWED_ORIGINS` = your real site, e.g. `https://curatrax.com,https://www.curatrax.com`

Everything else already has sensible Zoho defaults.

---

## Step 3 — Run locally and test

```bash
npm start
```

You should see `[mail] SMTP ready: ...`. If you see `SMTP verification FAILED`, jump to Troubleshooting.

In a second terminal, send a test demo request:

```bash
curl -X POST http://localhost:3000/api/demo \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"you@example.com","org":"Test Hospital","interest":"Full platform"}'
```

Expected response: `{"ok":true}`. Check `info@stelliteworks.com` and `support@curatrax.com` — the notification should arrive.

---

## Step 4 — Deploy it (so your live site can reach it)

Your website is a static file, so the backend needs its own home with a public URL. **Render** is the simplest free option.

**Render (recommended):**

1. Push this `curatrax-backend` folder to a GitHub repo.
2. At render.com → **New** → **Web Service** → connect the repo.
3. Settings: **Build command** `npm install`, **Start command** `npm start`.
4. Under **Environment**, add each variable from your `.env` (Render has its own env editor — do **not** upload the `.env` file). Set `SMTP_USER`, `SMTP_PASS`, `ALLOWED_ORIGINS`, etc.
5. Deploy. Render gives you a URL like `https://curatrax-backend.onrender.com`. That's your **API base URL** for Step 5.

(Railway, Fly.io, or any Node host work the same way: set the env vars, run `npm start`.)

> Note: Render's free tier sleeps when idle, so the first submission after a quiet spell may take ~30 seconds. Fine for a demo form; upgrade to the cheapest paid tier if you want it always-on.

---

## Step 5 — Connect your website

Three small edits to your HTML file (see `FRONTEND-PATCH.md` for the exact code):

1. Add one line near the top of the `<script>`:
   `var API_BASE = "https://curatrax-backend.onrender.com";` (your Render URL).
2. Add a hidden honeypot field inside the demo form (spam protection).
3. Replace the demo-form and waitlist click handlers with versions that POST to the backend. On success they still show your existing "Request received" / "waited" screens; on failure they re-enable the button and point the visitor to email you.

---

## Connector reference

This backend speaks standard SMTP, so it works with any provider — just change the `SMTP_*` values. Yours is **Zoho**.

| Provider | SMTP_HOST | SMTP_PORT | SMTP_SECURE | SMTP_USER | SMTP_PASS |
|---|---|---|---|---|---|
| **Zoho (India)** ← yours | `smtp.zoho.in` | `465` | `true` | full mailbox email | Zoho **app password** |
| Zoho (global) | `smtp.zoho.com` | `465` | `true` | full mailbox email | Zoho app password |
| Google Workspace | `smtp.gmail.com` | `465` | `true` | full mailbox email | Google **app password** |
| Microsoft 365 | `smtp.office365.com` | `587` | `false` | full mailbox email | account/app password |
| SendGrid | `smtp.sendgrid.net` | `587` | `false` | the literal word `apikey` | your SendGrid API key |
| Resend | `smtp.resend.com` | `465` | `true` | the literal word `resend` | your Resend API key |
| Mailgun | `smtp.mailgun.org` | `587` | `false` | your Mailgun SMTP login | your Mailgun SMTP password |

The **"From" address must match the authenticated mailbox** (or a verified alias), or the provider will reject or spam-folder the message.

---

## Troubleshooting

- **`535 Authentication Failed` (Zoho):** you're using your normal password — switch to an **app password** (Step 1), and confirm SMTP access is enabled in Zoho Mail settings.
- **`SMTP verification FAILED` on boot:** check `SMTP_HOST`/`SMTP_PORT` (`smtp.zoho.in` + `465` + `SMTP_SECURE=true`), and that `SMTP_USER` is the full email address.
- **Emails send but land in spam:** make sure `MAIL_FROM` is `info@stelliteworks.com` (the authenticated mailbox). Your domain's SPF already authorizes Zoho, so sending from the Zoho mailbox is correct.
- **Browser console shows a CORS error:** add your site's exact origin to `ALLOWED_ORIGINS` (e.g. `https://curatrax.com`). No trailing slash.
- **Nothing arrives and no error:** confirm the form is actually hitting your deployed `API_BASE` URL (open browser dev tools → Network tab → submit → look for the `/api/demo` request).
- **Zoho daily send limit:** lower Zoho plans cap outbound mail (roughly 100–500/day). Ample for a demo form; transactional providers like SendGrid/Resend scale higher if you ever need it.

---

## Don't want to run a server at all?

If hosting a backend feels like too much, a no-code form service (Web3Forms or Formspree) can deliver submissions to your inbox with zero server — you'd just point the form at their endpoint. This backend is the more capable, fully-owned option (custom emails, auto-replies, your own domain), which is why it's set up here. Either path ends with submissions reaching `info@stelliteworks.com`.
