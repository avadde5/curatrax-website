/**
 * CuraTrax email backend
 * -----------------------
 * Receives "Book a demo" and credentialing-waitlist submissions from the
 * website and emails them to your team via SMTP (configured for Zoho Mail).
 *
 * Endpoints:
 *   GET  /            -> health check
 *   POST /api/demo    -> demo request   { name, email, org, interest, company_website? }
 *   POST /api/waitlist-> waitlist signup { email, company_website? }
 *
 * All configuration comes from environment variables (see .env.example).
 * Nothing secret is hard-coded.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

/* ----------------------------- Configuration ----------------------------- */

const PORT = process.env.PORT || 3000;
const BRAND_NAME = process.env.BRAND_NAME || 'CuraTrax';

// Who receives the lead notifications (comma-separated list).
const TEAM_TO = (process.env.TEAM_TO || 'info@stelliteworks.com,support@curatrax.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// The "From" address. For Zoho this MUST be the authenticated mailbox (or a
// verified alias of it) — e.g. "CuraTrax <info@stelliteworks.com>".
const MAIL_FROM = process.env.MAIL_FROM || 'CuraTrax <info@stelliteworks.com>';

// Send a confirmation email back to the person who submitted? ("true"/"false")
const AUTOREPLY = String(process.env.AUTOREPLY || 'true').toLowerCase() === 'true';

// CORS: comma-separated list of allowed website origins, or "*" for any.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// SMTP connection (defaults target Zoho Mail India — smtp.zoho.in).
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.zoho.in';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

/* ------------------------------- Transporter ------------------------------ */

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE, // true for 465, false for 587 (STARTTLS)
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// Verify the SMTP connection on boot so misconfiguration shows up immediately.
transporter.verify()
  .then(() => console.log(`[mail] SMTP ready: ${SMTP_USER} via ${SMTP_HOST}:${SMTP_PORT}`))
  .catch(err => {
    console.error('[mail] SMTP verification FAILED — emails will not send until this is fixed.');
    console.error('[mail]', err && err.message ? err.message : err);
    console.error('[mail] Check SMTP_USER / SMTP_PASS (use a Zoho app password), SMTP_HOST and SMTP_PORT, and that SMTP access is enabled in Zoho Mail.');
  });

/* --------------------------------- Helpers -------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const e = email.trim();
  // Deliberately simple and permissive; full RFC validation is overkill here.
  return e.length >= 5 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function clamp(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Branded HTML wrapper (light background, CuraTrax cyan/teal accents).
// Table-based for maximum email-client compatibility.
function wrapEmail(heading, innerHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F1F5F9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;">
            <tr>
              <td style="background:#030712;padding:20px 28px;">
                <span style="font-size:18px;font-weight:700;color:#FFFFFF;letter-spacing:.2px;">${escapeHtml(BRAND_NAME)}</span>
                <span style="display:inline-block;height:8px;width:8px;border-radius:50%;background:#00D4FF;margin-left:8px;vertical-align:middle;"></span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <h1 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#0F172A;font-weight:700;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px 28px;color:#0F172A;font-size:15px;line-height:1.6;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px;line-height:1.5;">
                Sent automatically by the ${escapeHtml(BRAND_NAME)} website.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#64748B;font-size:13px;width:140px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#0F172A;font-size:15px;font-weight:600;vertical-align:top;">${escapeHtml(value || '—')}</td>
  </tr>`;
}

/* ------------------------------- Middleware ------------------------------- */

const app = express();
app.set('trust proxy', 1); // correct client IPs behind Render/Railway/proxies

app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  methods: ['POST', 'GET', 'OPTIONS']
}));

app.use(express.json({ limit: '12kb' }));

// Basic anti-abuse: cap submissions per IP.
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,                  // 20 requests / IP / window
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again shortly.' }
});
app.use('/api/', limiter);

/* --------------------------------- Routes --------------------------------- */

// Health check
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'curatrax-backend', endpoints: ['/api/demo', '/api/waitlist'] });
});

// Demo request
app.post('/api/demo', async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: real users never fill this hidden field. Bots do.
    if (clamp(body.company_website, 200)) {
      return res.json({ ok: true }); // pretend success, send nothing
    }

    const name = clamp(body.name, 200);
    const email = clamp(body.email, 254);
    const org = clamp(body.org, 200);
    const interest = clamp(body.interest, 120) || 'Full platform';

    if (!name) return res.status(400).json({ ok: false, error: 'Name is required.' });
    if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'A valid work email is required.' });
    if (!org) return res.status(400).json({ ok: false, error: 'Organization is required.' });

    const when = new Date().toUTCString();

    // 1) Notify the team
    const teamHtml = wrapEmail('New demo request', `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${row('Name', name)}
        ${row('Work email', email)}
        ${row('Organization', org)}
        ${row('Interested in', interest)}
        ${row('Received', when)}
      </table>
      <p style="margin:20px 0 0 0;color:#475569;font-size:13px;">Reply directly to this email to reach ${escapeHtml(name)}.</p>
    `);

    await transporter.sendMail({
      from: MAIL_FROM,
      to: TEAM_TO,
      replyTo: `${name} <${email}>`,
      subject: `New demo request — ${name} (${org})`,
      html: teamHtml,
      text:
        `New demo request\n\nName: ${name}\nWork email: ${email}\n` +
        `Organization: ${org}\nInterested in: ${interest}\nReceived: ${when}\n`
    });

    // 2) Optional confirmation to the visitor
    if (AUTOREPLY) {
      const replyHtml = wrapEmail(`Thanks, ${name.split(' ')[0] || 'there'} — we've got your request`, `
        <p style="margin:0 0 14px 0;">Thanks for your interest in ${escapeHtml(BRAND_NAME)}. Our team will reach out within one business day to schedule your walkthrough.</p>
        <p style="margin:0 0 6px 0;color:#64748B;font-size:13px;">Here's what you sent us:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${row('Organization', org)}
          ${row('Interested in', interest)}
        </table>
        <p style="margin:18px 0 0 0;">Questions in the meantime? Just reply to this email.</p>
      `);

      await transporter.sendMail({
        from: MAIL_FROM,
        to: email,
        subject: `We received your ${BRAND_NAME} demo request`,
        html: replyHtml,
        text:
          `Thanks for your interest in ${BRAND_NAME}. Our team will reach out within one business day ` +
          `to schedule your walkthrough.\n\nOrganization: ${org}\nInterested in: ${interest}\n\n` +
          `Questions in the meantime? Just reply to this email.`
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[demo] send failed:', err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: 'Could not send your request right now.' });
  }
});

// Credentialing waitlist
app.post('/api/waitlist', async (req, res) => {
  try {
    const body = req.body || {};

    if (clamp(body.company_website, 200)) {
      return res.json({ ok: true }); // honeypot
    }

    const email = clamp(body.email, 254);
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'A valid email is required.' });
    }

    const when = new Date().toUTCString();

    await transporter.sendMail({
      from: MAIL_FROM,
      to: TEAM_TO,
      replyTo: email,
      subject: `New credentialing waitlist signup — ${email}`,
      html: wrapEmail('New credentialing waitlist signup', `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${row('Email', email)}
          ${row('List', 'Staff credentialing (coming soon)')}
          ${row('Received', when)}
        </table>
      `),
      text: `New credentialing waitlist signup\n\nEmail: ${email}\nReceived: ${when}\n`
    });

    if (AUTOREPLY) {
      await transporter.sendMail({
        from: MAIL_FROM,
        to: email,
        subject: `You're on the ${BRAND_NAME} credentialing waitlist`,
        html: wrapEmail(`You're on the list`, `
          <p style="margin:0;">Thanks for your interest in ${escapeHtml(BRAND_NAME)} staff credentialing. We'll email you the moment it's ready for early access.</p>
        `),
        text: `Thanks for your interest in ${BRAND_NAME} staff credentialing. We'll email you the moment it's ready for early access.`
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[waitlist] send failed:', err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: 'Could not add you to the waitlist right now.' });
  }
});

/* --------------------------------- Start ---------------------------------- */

app.listen(PORT, () => {
  console.log(`[server] ${BRAND_NAME} backend listening on port ${PORT}`);
  console.log(`[server] Notifications go to: ${TEAM_TO.join(', ')}`);
  console.log(`[server] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
