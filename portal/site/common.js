/* Shared by the resident and staff pages.
   No framework: the pages are small. Everything that reaches the screen goes
   through textContent, never innerHTML, so text typed by a resident can never
   turn into markup. */
(function () {
  'use strict';
  const RW = window.RW = {};

  RW.OFFICE = '651-578-0498';
  RW.STATUS = { new: 'Received', scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold',
    completed: 'Completed', cancelled: 'Cancelled' };

  function ApiError(status, message, code) { this.status = status; this.message = message; this.code = code || ''; }
  RW.ApiError = ApiError;

  // GET when there is no body, POST when there is
  RW.api = async function (path, body) {
    const opt = { method: 'GET', credentials: 'same-origin', headers: {}, cache: 'no-store' };
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/json';
      opt.headers['X-RW-Portal'] = '1';
      opt.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch('/api/portal' + path, opt);
    } catch (e) {
      throw new ApiError(0, 'Could not reach the portal. Check your connection and try again.');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.', data && data.code);
    }
    return data || {};
  };

  // h('p', { class: 'x', onclick: fn }, 'text', otherNode, [more])
  RW.h = function (tag, attrs) {
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const add = (kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    };
    for (let i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  };
  const h = RW.h;

  RW.when = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  RW.day = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  RW.field = function (label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control,
      hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  RW.input = function (name, attrs) { return h('input', Object.assign({ name: name, type: 'text' }, attrs || {})); };
  RW.textarea = function (name, attrs) { return h('textarea', Object.assign({ name: name }, attrs || {})); };

  // The eye icons are built node by node rather than from markup, in keeping
  // with the no-innerHTML rule above.
  const EYE = ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'];
  const EYE_OFF = ['M3 3l18 18', 'M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1',
    'M6.5 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7c2 0 3.8-.6 5.4-1.5', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'];
  function icon(paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const set = { viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const k of Object.keys(set)) svg.setAttribute(k, set[k]);
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  /* A password box with an eye button that shows what has been typed.
     It goes back to dots when the form is sent, so a password is never left
     readable on screen, or handed to the browser as ordinary text. */
  RW.password = function (name, attrs) {
    const box = RW.input(name, Object.assign({ type: 'password' }, attrs || {}));
    const btn = h('button', { type: 'button', class: 'pw-toggle' });
    const show = (on) => {
      box.type = on ? 'text' : 'password';
      btn.replaceChildren(icon(on ? EYE_OFF : EYE));
      btn.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
      btn.setAttribute('title', on ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(on));
    };
    box.hidePassword = () => show(false);
    btn.addEventListener('click', () => { show(box.type === 'password'); box.focus(); });
    show(false);
    return h('span', { class: 'pw' }, box, btn);
  };
  // options: [[value, label], …]
  RW.select = function (name, options, value) {
    const el = h('select', { name: name }, options.map((o) => h('option', { value: o[0] }, o[1])));
    el.value = value === undefined || value === null ? '' : String(value);
    return el;
  };
  RW.check = function (name, label, checked) {
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: name, checked: !!checked }), h('span', {}, label));
  };
  RW.choices = function (name, options, value) {
    return h('div', { class: 'choices' }, options.map((o) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: name, value: o[0], checked: o[0] === value }),
      h('span', {}, h('strong', {}, o[1]), o[2] ? h('small', {}, o[2]) : null))));
  };
  RW.values = function (form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v : ''; });
    return out;
  };

  /* Wire a form up: disables its button while the handler runs and shows what
     came back. The handler returns a sentence to show on success, or nothing. */
  RW.onSubmit = function (form, handler) {
    let msg = form.querySelector('.msg');
    if (!msg) { msg = h('p', { class: 'msg', role: 'status', hidden: true }); form.append(msg); }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      msg.hidden = true;
      for (const el of form.querySelectorAll('.pw input')) el.hidePassword();
      if (btn) btn.disabled = true;
      try {
        const note = await handler(RW.values(form), form);
        if (note) { msg.textContent = note; msg.className = 'msg ok'; msg.hidden = false; }
      } catch (e) {
        if (form.isConnected) {
          msg.textContent = (e && e.message) || 'Something went wrong. Please try again.';
          msg.className = 'msg'; msg.hidden = false;
        }
        if (RW.onAuthError && e && e.status === 401 && e.code === 'signed_out') RW.onAuthError(e);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    return form;
  };

  RW.chip = function (status, label) {
    const cls = { new: 'chip-ink', scheduled: 'chip-goldline', in_progress: 'chip-gold', on_hold: 'chip-off',
      completed: 'chip-solid', cancelled: 'chip-off' }[status] || '';
    return h('span', { class: 'chip ' + cls }, label || RW.STATUS[status] || status);
  };
  RW.urgencyChip = function (urgency) {
    if (urgency === 'urgent') return h('span', { class: 'chip chip-gold' }, 'Urgent');
    if (urgency === 'soon') return h('span', { class: 'chip chip-goldline' }, 'Soon');
    return null;
  };
  RW.tel = function (number) {
    const digits = String(number || '').replace(/\D/g, '');
    return digits ? h('a', { href: 'tel:' + (digits.length === 10 ? '1' : '') + digits }, number) : document.createTextNode('—');
  };
})();
