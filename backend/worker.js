/**
 * CuraTrax email Worker (Cloudflare)
 * ----------------------------------
 * Receives "Book a demo" and credentialing-waitlist submissions from the
 * website and sends them via the ZeptoMail HTTP API (Cloudflare Workers can't
 * use SMTP, so we call ZeptoMail's REST endpoint with fetch()).
 *
 * Endpoints:
 *   GET  /             -> health check
 *   POST /api/demo     -> { name, email, org, interest, company_website? }
 *   POST /api/waitlist -> { email, company_website? }
 *
 * Configuration lives in Worker Variables & Secrets (see README-CLOUDFLARE.md):
 *   ZEPTO_TOKEN        (secret) ZeptoMail "Send Mail Token"
 *   ZEPTO_ENDPOINT     (var)    https://api.zeptomail.com  (use https://api.zeptomail.in for India DC)
 *   MAIL_FROM_ADDRESS  (var)    info@stelliteworks.com  (must be on a domain verified in ZeptoMail)
 *   MAIL_FROM_NAME     (var)    CuraTrax
 *   TEAM_TO            (var)    info@stelliteworks.com,support@curatrax.com
 *   ALLOWED_ORIGINS    (var)    https://curatrax.com,https://www.curatrax.com   (or *)
 *   AUTOREPLY          (var)    true | false
 *   BRAND_NAME         (var)    CuraTrax
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'curatrax-worker', endpoints: ['/api/demo', '/api/waitlist'] }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/demo') {
      return handleDemo(request, env, cors);
    }
    if (request.method === 'POST' && url.pathname === '/api/waitlist') {
      return handleWaitlist(request, env, cors);
    }

    return json({ ok: false, error: 'Not found' }, 404, cors);
  }
};

/* -------------------------------- helpers -------------------------------- */

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  let allowOrigin = '*';
  if (!allowed.includes('*')) {
    allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '');
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isValidEmail(e) {
  if (typeof e !== 'string') return false;
  e = e.trim();
  return e.length >= 5 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function clamp(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function teamList(env) {
  return (env.TEAM_TO || 'info@stelliteworks.com,support@curatrax.com')
    .split(',').map(s => s.trim()).filter(Boolean);
}

function wrapEmail(brand, heading, inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F1F5F9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;">
<tr><td style="background:#030712;padding:20px 28px;"><span style="font-size:18px;font-weight:700;color:#FFFFFF;">${escapeHtml(brand)}</span><span style="display:inline-block;height:8px;width:8px;border-radius:50%;background:#00D4FF;margin-left:8px;vertical-align:middle;"></span></td></tr>
<tr><td style="padding:28px 28px 8px 28px;"><h1 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;color:#0F172A;font-weight:700;">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:0 28px 28px 28px;color:#0F172A;font-size:15px;line-height:1.6;">${inner}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px;line-height:1.5;">Sent automatically by the ${escapeHtml(brand)} website.</td></tr>
</table></td></tr></table></body></html>`;
}

function row(label, value) {
  return `<tr><td style="padding:8px 0;color:#64748B;font-size:13px;width:140px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#0F172A;font-size:15px;font-weight:600;vertical-align:top;">${escapeHtml(value || '—')}</td></tr>`;
}

// Send one email through the ZeptoMail REST API.
async function sendViaZepto(env, { to, replyTo, subject, html, text }) {
  const base = (env.ZEPTO_ENDPOINT || 'https://api.zeptomail.com').replace(/\/+$/, '');

  // Accept either the raw token or a full "Zoho-enczapikey <token>" string.
  const tok = (env.ZEPTO_TOKEN || '').trim();
  const authHeader = /^zoho-enczapikey\s/i.test(tok) ? tok : ('Zoho-enczapikey ' + tok);

  const payload = {
    from: { address: env.MAIL_FROM_ADDRESS, name: env.MAIL_FROM_NAME || env.BRAND_NAME || 'CuraTrax' },
    to: to.map(addr => ({ email_address: { address: addr } })),
    subject,
    htmlbody: html,
    textbody: text
  };
  if (replyTo) payload.reply_to = [{ address: replyTo }];

  const res = await fetch(base + '/v1.1/email', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('ZeptoMail ' + res.status + ' ' + detail.slice(0, 400));
  }
  return true;
}

/* -------------------------------- handlers ------------------------------- */

async function handleDemo(request, env, cors) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid request.' }, 400, cors); }

  // Honeypot — bots fill this hidden field; real visitors never do.
  if (clamp(body.company_website, 200)) return json({ ok: true }, 200, cors);

  const name = clamp(body.name, 200);
  const email = clamp(body.email, 254);
  const org = clamp(body.org, 200);
  const interest = clamp(body.interest, 120) || 'Full platform';

  if (!name) return json({ ok: false, error: 'Name is required.' }, 400, cors);
  if (!isValidEmail(email)) return json({ ok: false, error: 'A valid work email is required.' }, 400, cors);
  if (!org) return json({ ok: false, error: 'Organization is required.' }, 400, cors);

  const brand = env.BRAND_NAME || 'CuraTrax';
  const when = new Date().toUTCString();

  // 1) Notify the team — this MUST succeed.
  try {
    await sendViaZepto(env, {
      to: teamList(env),
      replyTo: email,
      subject: `New demo request — ${name} (${org})`,
      html: wrapEmail(brand, 'New demo request', `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${row('Name', name)}${row('Work email', email)}${row('Organization', org)}${row('Interested in', interest)}${row('Received', when)}
        </table>
        <p style="margin:20px 0 0 0;color:#475569;font-size:13px;">Reply directly to this email to reach ${escapeHtml(name)}.</p>`),
      text: `New demo request\n\nName: ${name}\nWork email: ${email}\nOrganization: ${org}\nInterested in: ${interest}\nReceived: ${when}\n`
    });
  } catch (err) {
    console.error('[demo] team send failed:', err.message);
    return json({ ok: false, error: 'Could not send your request right now.' }, 502, cors);
  }

  // 2) Confirmation to the visitor — best effort; never fail the lead over this.
  if (String(env.AUTOREPLY || 'true').toLowerCase() === 'true') {
    const first = name.split(' ')[0] || 'there';
    try {
      await sendViaZepto(env, {
        to: [email],
        replyTo: teamList(env)[0],
        subject: `We received your ${brand} demo request`,
        html: wrapEmail(brand, `Thanks, ${first} — we've got your request`, `
          <p style="margin:0 0 14px 0;">Thanks for your interest in ${escapeHtml(brand)}. Our team will reach out within one business day to schedule your walkthrough.</p>
          <p style="margin:0 0 6px 0;color:#64748B;font-size:13px;">Here's what you sent us:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${row('Organization', org)}${row('Interested in', interest)}</table>
          <p style="margin:18px 0 0 0;">Questions in the meantime? Just reply to this email.</p>`),
        text: `Thanks for your interest in ${brand}. Our team will reach out within one business day to schedule your walkthrough.\n\nOrganization: ${org}\nInterested in: ${interest}\n`
      });
    } catch (err) {
      console.error('[demo] autoreply failed (non-fatal):', err.message);
    }
  }

  return json({ ok: true }, 200, cors);
}

async function handleWaitlist(request, env, cors) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid request.' }, 400, cors); }

  if (clamp(body.company_website, 200)) return json({ ok: true }, 200, cors); // honeypot

  const email = clamp(body.email, 254);
  if (!isValidEmail(email)) return json({ ok: false, error: 'A valid email is required.' }, 400, cors);

  const brand = env.BRAND_NAME || 'CuraTrax';
  const when = new Date().toUTCString();

  try {
    await sendViaZepto(env, {
      to: teamList(env),
      replyTo: email,
      subject: `New credentialing waitlist signup — ${email}`,
      html: wrapEmail(brand, 'New credentialing waitlist signup', `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          ${row('Email', email)}${row('List', 'Staff credentialing (coming soon)')}${row('Received', when)}
        </table>`),
      text: `New credentialing waitlist signup\n\nEmail: ${email}\nReceived: ${when}\n`
    });
  } catch (err) {
    console.error('[waitlist] team send failed:', err.message);
    return json({ ok: false, error: 'Could not add you to the waitlist right now.' }, 502, cors);
  }

  if (String(env.AUTOREPLY || 'true').toLowerCase() === 'true') {
    try {
      await sendViaZepto(env, {
        to: [email],
        replyTo: teamList(env)[0],
        subject: `You're on the ${brand} credentialing waitlist`,
        html: wrapEmail(brand, `You're on the list`, `
          <p style="margin:0;">Thanks for your interest in ${escapeHtml(brand)} staff credentialing. We'll email you the moment it's ready for early access.</p>`),
        text: `Thanks for your interest in ${brand} staff credentialing. We'll email you the moment it's ready for early access.`
      });
    } catch (err) {
      console.error('[waitlist] autoreply failed (non-fatal):', err.message);
    }
  }

  return json({ ok: true }, 200, cors);
}
