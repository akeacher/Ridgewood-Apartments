const $ = (id) => document.getElementById(id);
let currentStatus = 'pending';

/** Requests come from strangers on the internet — never inject them as HTML. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

const fmtAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

function notify(msg, isError = false) {
  const n = $('notice');
  n.textContent = msg;
  n.className = isError ? 'notice error' : 'notice';
  n.hidden = false;
  setTimeout(() => { n.hidden = true; }, 6000);
}

async function checkSession() {
  const { signedIn } = await fetch('/api/admin/session').then((r) => r.json());
  $('login').hidden = signedIn;
  $('dash').hidden = !signedIn;
  $('logout').hidden = !signedIn;
  if (signedIn) load();
  else $('password').focus();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.hidden = true;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('password').value })
  });
  const data = await res.json();
  if (!res.ok) {
    err.textContent = data.error || 'Sign-in failed.';
    err.hidden = false;
    return;
  }
  $('password').value = '';
  checkSession();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  currentStatus = tab.dataset.status;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
  load();
});

async function load() {
  const res = await fetch(`/api/admin/tours?status=${encodeURIComponent(currentStatus)}`);
  if (res.status === 401) return checkSession();
  const { tours, counts } = await res.json();

  ['pending', 'approved', 'declined', 'cancelled'].forEach((s) => {
    const el = $(`c-${s}`);
    if (el) el.textContent = counts[s] || 0;
  });

  if (!tours.length) {
    $('list').innerHTML = `<p class="muted empty">No ${esc(currentStatus)} requests.</p>`;
    return;
  }

  $('list').innerHTML = tours.map(card).join('');
}

function card(t) {
  const isPending = t.status === 'pending';
  const past = new Date(t.slot_start) < new Date();
  return `
  <article class="req ${esc(t.status)}">
    <div class="req-main">
      <div class="req-when">
        <strong>${esc(fmtWhen(t.slot_start))}</strong>
        <span class="status-pill ${esc(t.status)}">${esc(t.status)}</span>
        ${past && isPending ? '<span class="status-pill warn">date passed</span>' : ''}
      </div>
      <h3>${esc(t.name)}</h3>
      <div class="req-meta">
        <a href="mailto:${esc(t.email)}">${esc(t.email)}</a>
        <a href="tel:${esc(t.phone.replace(/[^\d+]/g, ''))}">${esc(t.phone)}</a>
        <span>${esc(t.plan)}</span>
        <span class="muted">requested ${esc(fmtAgo(t.created_at))}</span>
      </div>
      ${t.message ? `<p class="req-msg">${esc(t.message)}</p>` : ''}
      ${t.decline_note ? `<p class="req-msg muted">Decline note: ${esc(t.decline_note)}</p>` : ''}
    </div>
    ${isPending ? `
    <div class="req-actions">
      <button class="btn btn-sm" data-approve="${t.id}">Approve &amp; Email</button>
      <button class="btn-text" data-decline="${t.id}">Decline</button>
    </div>` : ''}
  </article>`;
}

document.addEventListener('click', async (e) => {
  const approve = e.target.closest('[data-approve]');
  const decline = e.target.closest('[data-decline]');
  if (!approve && !decline) return;

  const id = (approve || decline).dataset.approve || decline.dataset.decline;
  const btn = approve || decline;
  btn.disabled = true;

  let body = {};
  if (decline) {
    const note = prompt('Optional note to include in the decline email (leave blank to skip):', '');
    if (note === null) { btn.disabled = false; return; }
    body = { note };
  }

  const res = await fetch(`/api/admin/tours/${id}/${approve ? 'approve' : 'decline'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) {
    notify(data.error || 'That did not work.', true);
    btn.disabled = false;
    load();
    return;
  }
  notify(data.warning || (approve ? 'Approved — confirmation email sent.' : 'Declined — notification sent.'), Boolean(data.warning));
  load();
});

checkSession();
