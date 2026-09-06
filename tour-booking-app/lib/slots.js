import { queries } from '../db.js';

const cfg = () => ({
  days: (process.env.TOUR_DAYS || '1,2,3,4,5').split(',').map((d) => Number(d.trim())),
  start: process.env.TOUR_START || '13:00',
  end: process.env.TOUR_END || '17:00',
  minutes: Number(process.env.SLOT_MINUTES || 30),
  leadHours: Number(process.env.LEAD_TIME_HOURS || 12),
  windowDays: Number(process.env.BOOKING_WINDOW_DAYS || 30),
  blackout: new Set(
    (process.env.BLACKOUT_DATES || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
  )
});

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function atTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Every slot the calendar could offer in the booking window, each marked
 * available or not. Days are grouped so the client can render a month grid
 * without recomputing the rules.
 */
export function buildCalendar() {
  const c = cfg();
  const now = new Date();
  const earliest = new Date(now.getTime() + c.leadHours * 3600 * 1000);

  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + c.windowDays + 1);

  const taken = new Set(queries.heldSlots(windowStart.toISOString(), windowEnd.toISOString()));

  const days = [];
  for (let i = 0; i <= c.windowDays; i++) {
    const day = new Date(windowStart);
    day.setDate(day.getDate() + i);
    const key = dateKey(day);

    if (!c.days.includes(day.getDay()) || c.blackout.has(key)) {
      days.push({ date: key, weekday: day.getDay(), slots: [] });
      continue;
    }

    const slots = [];
    const dayEnd = atTime(day, c.end);
    for (let t = atTime(day, c.start); t.getTime() + c.minutes * 60000 <= dayEnd.getTime() + 1; ) {
      const startIso = t.toISOString();
      const end = new Date(t.getTime() + c.minutes * 60000);
      slots.push({
        start: startIso,
        end: end.toISOString(),
        label: t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        available: t >= earliest && !taken.has(startIso)
      });
      t = end;
    }
    days.push({ date: key, weekday: day.getDay(), slots });
  }

  return { days, slotMinutes: c.minutes };
}

/**
 * Re-validates a slot the client sent back. Never trust the posted time —
 * the calendar may be stale, or the value hand-crafted.
 */
export function validateSlot(startIso) {
  const c = cfg();
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'That time is not a valid date.' };

  if (start.toISOString() !== startIso) {
    return { ok: false, error: 'That time is not a valid slot.' };
  }
  if (!c.days.includes(start.getDay())) {
    return { ok: false, error: 'Tours are not offered on that day.' };
  }
  if (c.blackout.has(dateKey(start))) {
    return { ok: false, error: 'The office is closed that day.' };
  }

  const earliest = new Date(Date.now() + c.leadHours * 3600 * 1000);
  if (start < earliest) {
    return { ok: false, error: `Please choose a time at least ${c.leadHours} hours from now.` };
  }

  const latest = new Date();
  latest.setDate(latest.getDate() + c.windowDays + 1);
  if (start > latest) return { ok: false, error: 'That date is too far out to book yet.' };

  // Must land exactly on the slot grid for its day.
  const dayStart = atTime(start, c.start);
  const dayEnd = atTime(start, c.end);
  const offset = start.getTime() - dayStart.getTime();
  const slotMs = c.minutes * 60000;
  if (offset < 0 || offset % slotMs !== 0 || start.getTime() + slotMs > dayEnd.getTime()) {
    return { ok: false, error: 'That time is outside tour hours.' };
  }

  if (queries.isSlotTaken(startIso)) {
    return { ok: false, error: 'Sorry — that time was just taken. Please pick another.' };
  }

  return { ok: true, start, end: new Date(start.getTime() + slotMs) };
}
