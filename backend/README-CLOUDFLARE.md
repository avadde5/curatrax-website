# CuraTrax email backend — Cloudflare Worker + ZeptoMail

This is the Cloudflare version of your form backend. When someone submits the **demo** form or the **credentialing waitlist**, this Worker emails the details to your team (and sends the visitor a confirmation) using **Zoho ZeptoMail**.

> **Use this folder, not the earlier Node backend folder.** We switched from Render to Cloudflare, and Cloudflare needs a different setup — explained below.

## Why this is built differently

Cloudflare Workers can't open a direct connection to a mail server (no SMTP). So instead of logging into your Zoho mailbox, this Worker calls **ZeptoMail's web API** to send mail. ZeptoMail is Zoho's transactional-email service, so you're still in the Zoho family — it's just a different "door" into it that a Worker is allowed to use.

There are **three parts**, about 30–40 minutes total the first time:

- **A.** Set up ZeptoMail (verify your domain, get a sending token).
- **B.** Deploy the Worker on Cloudflare (paste the code, add your settings).
- **C.** Point your website at the Worker.

---

## Part A — Set up ZeptoMail

1. Go to **zoho.com/zeptomail** and sign in with your existing Zoho account (the same one that owns `info@stelliteworks.com`). If it asks which data center, choose the same region as your mail — yours is **India**.
2. **Add and verify a sending domain.** Add `stelliteworks.com` (and/or `curatrax.com`). ZeptoMail gives you a few DNS records (SPF/DKIM, and a verification record) to add at wherever your DNS is managed. Add them, then click verify. This is what lets ZeptoMail send *as* `info@stelliteworks.com` and keeps mail out of spam.
3. **Create a Mail Agent** (ZeptoMail calls each sending app an "Agent") — name it `CuraTrax Website`.
4. **Copy the Send Mail Token.** In the Agent, go to **Setup Info / SMTP & API → API → Send Mail Token** and copy it. It's a long string — keep it handy for Part B. (This is the only secret you'll need.)

> **India data center note:** if your ZeptoMail account is on the India region, the API address is `https://api.zeptomail.in` (not `.com`). You'll set this as `ZEPTO_ENDPOINT` in Part B. If you're unsure, start with `.in` since your mailboxes are on Zoho India; if sending fails with a "not found"/404, switch to `.com`.

---

## Part B — Deploy the Worker on Cloudflare

The easy path is the dashboard — no command line, no git needed.

1. Go to **dash.cloudflare.com** → **Workers & Pages** → **Create application** → **Create Worker**.
2. Give it a name like `curatrax-worker` → **Deploy** (this creates a placeholder Worker).
3. Click **Edit code**. Delete everything in the editor, then paste the entire contents of **`worker.js`** from this folder. Click **Deploy**.
4. Go to the Worker's **Settings → Variables and Secrets** and add the following.

   **Plaintext variables** (click *Add variable* for each):

   | Name | Value |
   |---|---|
   | `ZEPTO_ENDPOINT` | `https://api.zeptomail.in` (or `.com` — see the data-center note) |
   | `MAIL_FROM_ADDRESS` | `info@stelliteworks.com` (must be your verified domain) |
   | `MAIL_FROM_NAME` | `CuraTrax` |
   | `TEAM_TO` | `services@stelliteworks.com` |
   | `ALLOWED_ORIGINS` | `https://curatrax.com,https://www.curatrax.com` |
   | `AUTOREPLY` | `true` |
   | `BRAND_NAME` | `CuraTrax` |

   **Secret** (the one sensitive value — add it and choose *Encrypt*):

   | Name | Value |
   |---|---|
   | `ZEPTO_TOKEN` | the Send Mail Token you copied in Part A |

5. Click **Deploy** again so the new settings take effect.
6. Your Worker now has a public URL like **`https://curatrax-worker.YOUR-SUBDOMAIN.workers.dev`** (shown at the top of the Worker page). That's your **API base URL** for Part C.

**Quick check:** open that URL in a browser. You should see `{"ok":true,"service":"curatrax-worker",...}`. That means the Worker is live.

> **Prefer the command line / git?** This folder also has `wrangler.toml`. Install Node, run `npx wrangler login`, then `npx wrangler deploy`, and set the secret once with `npx wrangler secret put ZEPTO_TOKEN`. The dashboard path above is simpler if you just want it working.

---

## Part C — Connect your website

Open **`FRONTEND-PATCH.md`** and apply the three edits to your HTML:

1. Paste your `workers.dev` URL into the `API_BASE` line.
2. Add the hidden honeypot field to the demo form.
3. Swap in the two new form handlers.

Then push your site the way you normally do so AWS picks it up. (These edits are identical to any other backend — the form just points at your Worker URL.)

---

## Part D — Test

Open your live site, fill the demo form, and submit. The button shows "Sending…", then your "Request received" screen. Within a few seconds, `services@stelliteworks.com` gets the lead, and the test address gets a confirmation.

To watch it happen live, open your Worker in the Cloudflare dashboard → **Logs** (or run `npx wrangler tail`) and submit the form — you'll see each request and any error in real time.

---

## Troubleshooting

- **Browser console shows a CORS error.** Add your exact site address to `ALLOWED_ORIGINS` (e.g. `https://curatrax.com`, no trailing slash), then redeploy.
- **`401 Unauthorized` in the logs.** The `ZEPTO_TOKEN` is wrong or missing. Re-copy the Send Mail Token from your ZeptoMail Agent. (You paste just the token; the Worker adds the `Zoho-enczapikey` part for you.)
- **Error mentions the sender / domain not allowed.** Your `MAIL_FROM_ADDRESS` must be on a domain that's **verified** in ZeptoMail (Part A, step 2).
- **404 / "not found" from ZeptoMail.** You're pointed at the wrong data center — switch `ZEPTO_ENDPOINT` between `https://api.zeptomail.in` and `https://api.zeptomail.com`.
- **Visitor confirmation didn't arrive but you got the lead.** That's by design — the team notification is treated as critical and the auto-reply as best-effort, so a hiccup on the confirmation never costs you the lead. Check the logs for the reason; set `AUTOREPLY=false` if you'd rather not send confirmations at all.

## A note on cost

ZeptoMail is a paid transactional service (it includes a free trial allotment and is inexpensive after that — pay-as-you-go credits). For a demo form the volume is tiny. Check **zoho.com/zeptomail/pricing** for current numbers. If you'd rather not pay anything, the no-server form services (Web3Forms/Formspree) remain a free fallback, but they don't send from your own domain the way this does.
