const $ = (id) => document.getElementById(id);

const state = {
  days: [],
  byDate: new Map(),
  viewMonth: null,
  selectedDate: null,
  selectedSlot: null
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function parseDateKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }

async function boot() {
  const [cfg, cal] = await Promise.all([
    fetch('/api/config').then((r) => r.json()),
    fetch('/api/slots').then((r) => r.json())
  ]);

  $('headPhone').textContent = cfg.phone;
  $('headPhone').href = `tel:${cfg.phone.replace(/\D/g, '')}`;
  $('footAddress').textContent = cfg.address;
  $('footPhone').textContent = cfg.phone;
  $('planSelect').innerHTML =
    '<option value="">Choose one…</option>' +
    cfg.plans.map((p) => `<option>${p}</option>`).join('');

  state.days = cal.days;
  state.byDate = new Map(cal.days.map((d) => [d.date, d]));

  const firstOpen = cal.days.find((d) => d.slots.some((s) => s.available));
  state.viewMonth = firstOpen ? parseDateKey(firstOpen.date) : new Date();
  renderCalendar();
  if (firstOpen) selectDate(firstOpen.date);
}

function renderCalendar() {
  const view = state.viewMonth;
  $('calMonth').textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-cell empty"></span>');

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const day = state.byDate.get(key);
    const open = day && day.slots.some((s) => s.available);
    const selected = state.selectedDate === key;
    cells.push(
      open
        ? `<button class="cal-cell open${selected ? ' selected' : ''}" data-date="${key}" role="gridcell" aria-pressed="${selected}">${d}</button>`
        : `<span class="cal-cell closed" role="gridcell" aria-disabled="true">${d}</span>`
    );
  }
  $('calGrid').innerHTML = cells.join('');

  const monthsAvailable = new Set(state.days.filter((d) => d.slots.some((s) => s.available)).map((d) => d.date.slice(0, 7)));
  $('prevMonth').disabled = !monthsAvailable.has(shiftMonth(-1));
  $('nextMonth').disabled = !monthsAvailable.has(shiftMonth(1));
}

function shiftMonth(delta) {
  const d = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + delta, 1);
  return monthKey(d);
}

function selectDate(key) {
  state.selectedDate = key;
  state.selectedSlot = null;
  $('formPanel').hidden = true;
  renderCalendar();

  const day = state.byDate.get(key);
  const open = (day?.slots ?? []).filter((s) => s.available);
  const nice = parseDateKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  $('timeHint').textContent = open.length ? `${nice} — ${open.length} time${open.length === 1 ? '' : 's'} open` : 'No times left that day.';
  $('slots').innerHTML = open
    .map((s) => `<button class="slot" type="button" data-start="${s.start}" data-label="${s.label}">${s.label}</button>`)
    .join('');
}

function selectSlot(start, label) {
  state.selectedSlot = { start, label };
  document.querySelectorAll('.slot').forEach((b) => b.classList.toggle('selected', b.dataset.start === start));

  const nice = parseDateKey(state.selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('chosen').textContent = `${nice} at ${label}`;
  $('formPanel').hidden = false;
  $('error').hidden = true;
  $('formPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-cell.open');
  if (cell) return selectDate(cell.dataset.date);

  const slot = e.target.closest('.slot');
  if (slot) return selectSlot(slot.dataset.start, slot.dataset.label);
});

$('prevMonth').addEventListener('click', () => {
  state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
  renderCalendar();
});
$('nextMonth').addEventListener('click', () => {
  state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
  renderCalendar();
});
$('changeTime').addEventListener('click', () => {
  $('formPanel').hidden = true;
  $('booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selectedSlot) return;

  const btn = $('submitBtn');
  const err = $('error');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  err.hidden = true;

  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.slot = state.selectedSlot.start;

  try {
    const res = await fetch('/api/tours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      err.textContent = data.error || 'Something went wrong. Please try again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Request This Tour';
      // The slot may have just been taken — refresh availability.
      if (res.status === 409) {
        const cal = await fetch('/api/slots').then((r) => r.json());
        state.days = cal.days;
        state.byDate = new Map(cal.days.map((d) => [d.date, d]));
        if (state.selectedDate) selectDate(state.selectedDate);
      }
      return;
    }

    $('booking').hidden = true;
    $('formPanel').hidden = true;
    document.querySelector('.page-head').hidden = true;
    $('doneWhen').textContent = `Your requested time: ${$('chosen').textContent}.`;
    $('done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    err.textContent = 'Could not reach the server. Please check your connection or call the office.';
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Request This Tour';
  }
});

boot().catch(() => {
  $('intro').textContent = 'The booking calendar could not load. Please call the leasing office.';
});
