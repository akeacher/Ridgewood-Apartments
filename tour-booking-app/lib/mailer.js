import nodemailer from 'nodemailer';

const env = (k, d = '') => process.env[k] ?? d;

/** Everything from a prospect is untrusted; never drop it into HTML raw. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let transport;
function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', 587)),
    secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') } : undefined
  });
  return transport;
}

async function send({ to, subject, html, text, attachments, replyTo }) {
  const message = {
    from: env('MAIL_FROM', 'tours@localhost'),
    to,
    subject,
    text,
    html,
    attachments,
    replyTo: replyTo || env('LEASING_EMAIL') || undefined
  };

  if (env('MAIL_DRY_RUN') === 'true') {
    console.log('\n─── EMAIL (dry run, not sent) ─────────────────');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    if (attachments?.length) console.log(`[${attachments.length} attachment(s)]`);
    console.log('───────────────────────────────────────────────\n');
    return { dryRun: true };
  }

  return getTransport().sendMail(message);
}

const fmt = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

const shell = (heading, bodyHtml) => `
<div style="background:#f2eee7;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fbfaf7;border:1px solid #d6cfc1;">
    <div style="background:#2c3a2e;padding:26px 30px;">
      <div style="color:#eeeade;font-size:19px;letter-spacing:5px;text-transform:uppercase;">
        ${esc(env('PROPERTY_NAME', 'Ridgewood Apartments'))}
      </div>
    </div>
    <div style="padding:30px;">
      <h1 style="margin:0 0 18px;font-size:22px;font-weight:400;color:#2a2e26;">${esc(heading)}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:20px 30px;border-top:1px solid #d6cfc1;color:#6f7064;font-size:12px;line-height:1.7;">
      ${esc(env('PROPERTY_ADDRESS'))}<br>
      ${esc(env('PROPERTY_PHONE'))}
    </div>
  </div>
</div>`;

const detailRows = (tour) => `
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;color:#2a2e26;">
    <tr><td style="padding:8px 0;color:#6f7064;width:110px;">When</td><td style="padding:8px 0;">${esc(fmt(tour.slot_start))}</td></tr>
    <tr><td style="padding:8px 0;color:#6f7064;">Where</td><td style="padding:8px 0;">${esc(env('PROPERTY_ADDRESS'))}</td></tr>
    <tr><td style="padding:8px 0;color:#6f7064;">Floor plan</td><td style="padding:8px 0;">${esc(tour.plan)}</td></tr>
  </table>`;

/** RFC 5545 escaping: commas, semicolons and backslashes are delimiters. */
const icsEscape = (s) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

const icsStamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function buildIcs(tour) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ridgewood Apartments//Tour//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:tour-${tour.id}@ridgewood`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(tour.slot_start)}`,
    `DTEND:${icsStamp(tour.slot_end)}`,
    `SUMMARY:${icsEscape('Apartment tour — ' + env('PROPERTY_NAME'))}`,
    `LOCATION:${icsEscape(env('PROPERTY_ADDRESS'))}`,
    `DESCRIPTION:${icsEscape(`Tour of the ${tour.plan}. Questions? Call ${env('PROPERTY_PHONE')}.`)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

export function sendRequestReceived(tour) {
  const html = shell(
    `Thanks, ${esc(tour.name.split(' ')[0])} — we have your request`,
    `<p style="font-size:14px;line-height:1.7;color:#2a2e26;margin:0;">
       We received your tour request and the leasing office will confirm it shortly.
       You'll get a second email once it's approved.</p>
     ${detailRows(tour)}
     <p style="font-size:13px;line-height:1.7;color:#6f7064;margin:0;">
       Need to cancel? <a href="${esc(env('BASE_URL'))}/cancel/${esc(tour.token)}" style="color:#a98b5b;">Cancel this request</a>.</p>`
  );
  return send({
    to: tour.email,
    subject: `Tour request received — ${env('PROPERTY_NAME')}`,
    text: `Thanks ${tour.name}, we received your tour request for ${fmt(tour.slot_start)}. The leasing office will confirm shortly.\n\nCancel: ${env('BASE_URL')}/cancel/${tour.token}`,
    html
  });
}

export function sendNewRequestAlert(tour) {
  const to = env('LEASING_EMAIL');
  if (!to) return Promise.resolve({ skipped: 'no LEASING_EMAIL set' });
  const html = shell(
    'New tour request',
    `${detailRows(tour)}
     <table style="width:100%;border-collapse:collapse;font-size:14px;color:#2a2e26;">
       <tr><td style="padding:8px 0;color:#6f7064;width:110px;">Name</td><td>${esc(tour.name)}</td></tr>
       <tr><td style="padding:8px 0;color:#6f7064;">Email</td><td>${esc(tour.email)}</td></tr>
       <tr><td style="padding:8px 0;color:#6f7064;">Phone</td><td>${esc(tour.phone)}</td></tr>
     </table>
     ${tour.message ? `<p style="font-size:14px;line-height:1.7;color:#2a2e26;background:#e6e0d4;padding:14px;margin:16px 0;">${esc(tour.message)}</p>` : ''}
     <p style="margin:22px 0 0;">
       <a href="${esc(env('BASE_URL'))}/admin" style="background:#2a2e26;color:#f2eee7;padding:13px 24px;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Review in dashboard</a>
     </p>`
  );
  return send({
    to,
    subject: `New tour request — ${tour.name}, ${fmt(tour.slot_start)}`,
    text: `New tour request\n\n${tour.name}\n${tour.email}\n${tour.phone}\n${tour.plan}\n${fmt(tour.slot_start)}\n\n${tour.message}\n\nReview: ${env('BASE_URL')}/admin`,
    html,
    replyTo: tour.email
  });
}

export function sendApproved(tour) {
  const html = shell(
    'Your tour is confirmed',
    `<p style="font-size:14px;line-height:1.7;color:#2a2e26;margin:0;">
       We're looking forward to showing you around. A calendar invitation is attached.</p>
     ${detailRows(tour)}
     <p style="font-size:13px;line-height:1.7;color:#6f7064;margin:0;">
       Something come up? <a href="${esc(env('BASE_URL'))}/cancel/${esc(tour.token)}" style="color:#a98b5b;">Cancel your tour</a>
       or call ${esc(env('PROPERTY_PHONE'))}.</p>`
  );
  return send({
    to: tour.email,
    subject: `Tour confirmed — ${fmt(tour.slot_start)}`,
    text: `Your tour at ${env('PROPERTY_NAME')} is confirmed for ${fmt(tour.slot_start)} at ${env('PROPERTY_ADDRESS')}.\n\nCancel: ${env('BASE_URL')}/cancel/${tour.token}`,
    html,
    attachments: [
      { filename: 'ridgewood-tour.ics', content: buildIcs(tour), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }
    ]
  });
}

export function sendDeclined(tour) {
  const html = shell(
    'About your tour request',
    `<p style="font-size:14px;line-height:1.7;color:#2a2e26;margin:0;">
       Unfortunately we can't host a tour at ${esc(fmt(tour.slot_start))}.</p>
     ${tour.decline_note ? `<p style="font-size:14px;line-height:1.7;color:#2a2e26;background:#e6e0d4;padding:14px;margin:16px 0;">${esc(tour.decline_note)}</p>` : ''}
     <p style="font-size:14px;line-height:1.7;color:#2a2e26;margin:16px 0 0;">
       We'd still love to show you the property — please pick another time that works for you.</p>
     <p style="margin:22px 0 0;">
       <a href="${esc(env('BASE_URL'))}/book" style="background:#2a2e26;color:#f2eee7;padding:13px 24px;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Choose another time</a>
     </p>`
  );
  return send({
    to: tour.email,
    subject: `Your tour request — ${env('PROPERTY_NAME')}`,
    text: `We can't host a tour at ${fmt(tour.slot_start)}. ${tour.decline_note || ''}\n\nPick another time: ${env('BASE_URL')}/book`,
    html
  });
}
