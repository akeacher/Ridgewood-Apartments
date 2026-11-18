/* The staff side: work orders, completed records, the notes that stay with an
   apartment for the next technician, the resident roster, and the logs. */
(function () {
  'use strict';
  const { api, h, when, day, field, input, password, textarea, select, check, choices, onSubmit, chip, urgencyChip, tel } = window.RW;
  const app = document.getElementById('app');
  const who = document.getElementById('who');

  const S = { me: null, team: [], categories: [], buildings: [], labels: {},
    view: 'open', q: '', recordsQ: '', unit: '', unitBuilding: 'any', editResident: null, editReturn: null, resetMember: null, editSpecial: null, pending: 0,
    sheet: { q: '', building: 'all', removed: false, sort: 'unit', dir: 1 } };
  const OPEN = ['new', 'scheduled', 'in_progress', 'on_hold'];
  const URGENCY = [['routine', 'Routine'], ['soon', 'Soon'], ['urgent', 'Urgent']];
  let main = null, flash = '', painted = '', ticket = 0;

  const isManager = () => !!S.me && S.me.role === 'manager';
  const apt = (o) => 'Apt ' + o.unit + (o.building ? ' · ' + o.building : '');
  const buildingOptions = (blank) => [['', blank || 'Not set'], ['1871', '1871 Wilson'], ['1885', '1885 Wilson']];

  RW.onAuthError = function () { S.me = null; loginView('Your session has ended. Please sign in again.'); };

  /* ------------------------------------------------------------ start-up */
  async function boot() {
    let st;
    try {
      st = await api('/staff/state');
    } catch (e) {
      return gate(e.code === 'no_db' ? 'Not switched on yet' : 'We hit a snag',
        e.code === 'no_db' ? 'The portal has been installed but its database is not connected yet.' : e.message);
    }
    if (!st.activated) {
      return st.setup_available ? setupView()
        : gate('Not set up yet', 'The staff portal has not been set up, and no setup code is configured.');
    }
    if (!st.signed_in) return loginView();
    if (st.me.must_change) return mustChangeView(st.me);
    try {
      const me = await api('/staff/me');
      Object.assign(S, { me: me.me, team: me.team, categories: me.categories, buildings: me.buildings, labels: me.status_labels,
        pending: me.pending_residents || 0 });
    } catch (e) {
      return gate('We hit a snag', e.message);
    }
    shell();
    route();
  }

  function gate(title, text) {
    who.replaceChildren();
    app.replaceChildren(h('div', { class: 'card card-narrow stack' },
      h('p', { class: 'label label-gold' }, 'Staff Portal'), h('h1', {}, title), h('p', {}, text),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: boot }, 'Try again')));
  }

  function setupView() {
    who.replaceChildren();
    const form = h('form', { class: 'card card-narrow stack', novalidate: true },
      h('div', {}, h('p', { class: 'label label-gold' }, 'Staff Portal'), h('h1', {}, 'First-time setup'),
        h('p', { class: 'lede' }, 'Create the manager account. This page works once and then closes for good.')),
      field('Setup code', input('code', { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: true }),
        'The one-time code that came with the portal.'),
      field('Your name', input('name', { autocomplete: 'name', required: true })),
      field('Your email', input('email', { type: 'email', autocomplete: 'username', autocapitalize: 'none', required: true })),
      field('Choose a password', password('password', { autocomplete: 'new-password', required: true }),
        'At least 10 characters. Pick one you do not use anywhere else.'),
      field('Password again', password('again', { autocomplete: 'new-password', required: true })),
      h('button', { class: 'btn', type: 'submit' }, 'Create manager account'),
      h('p', { class: 'msg', role: 'alert', hidden: true }));
    onSubmit(form, async (v) => {
      if (v.password !== v.again) throw new Error('The two passwords do not match.');
      await api('/staff/setup', { code: v.code, name: v.name, email: v.email, password: v.password });
      flash = 'The portal is set up. Start by adding your residents so they can sign in.';
      location.hash = '#/residents';
      await boot();
    });
    app.replaceChildren(form);
  }

  function loginView(notice) {
    who.replaceChildren();
    const form = h('form', { class: 'card card-narrow stack', novalidate: true },
      h('div', {}, h('p', { class: 'label label-gold' }, 'Staff Portal'), h('h1', {}, 'Staff sign-in'),
        h('p', { class: 'lede' }, 'Work orders, completed records and apartment notes.')),
      notice ? h('p', { class: 'msg' }, notice) : null,
      field('Email', input('email', { type: 'email', autocomplete: 'username', autocapitalize: 'none', required: true })),
      field('Password', password('password', { autocomplete: 'current-password', required: true })),
      h('button', { class: 'btn', type: 'submit' }, 'Sign in'),
      h('p', { class: 'msg', role: 'alert', hidden: true }),
      h('p', { class: 'fine' }, 'Forgotten your password? A manager can reset it under Team.'));
    onSubmit(form, async (v) => {
      await api('/staff/login', { email: v.email, password: v.password });
      await boot();
    });
    app.replaceChildren(form);
    form.querySelector('input').focus();
  }

  function passwordFields() {
    return [
      field('Current password', password('current', { autocomplete: 'current-password', required: true })),
      field('New password', password('next', { autocomplete: 'new-password', required: true }), 'At least 10 characters.'),
      field('New password again', password('again', { autocomplete: 'new-password', required: true })),
    ];
  }
  async function changePassword(v) {
    if (v.next !== v.again) throw new Error('The two new passwords do not match.');
    await api('/staff/password', { current: v.current, next: v.next });
  }

  function mustChangeView(me) {
    who.replaceChildren(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: signOut }, 'Sign out'));
    const form = h('form', { class: 'card card-narrow stack', novalidate: true },
      h('div', {}, h('p', { class: 'label label-gold' }, 'Staff Portal'), h('h1', {}, 'Choose your password'),
        h('p', { class: 'lede' }, 'Welcome, ' + me.name + '. The password you were given is temporary — replace it with your own to continue.')),
      passwordFields(),
      h('button', { class: 'btn', type: 'submit' }, 'Save and continue'),
      h('p', { class: 'msg', role: 'alert', hidden: true }));
    onSubmit(form, async (v) => { await changePassword(v); await boot(); });
    app.replaceChildren(form);
  }

  async function signOut() {
    try { await api('/staff/logout', {}); } catch (e) { /* signed out either way */ }
    S.me = null;
    loginView('You are signed out.');
  }

  /* --------------------------------------------------------- shell + routes */
  function shell() {
    who.replaceChildren(
      h('span', { class: 'who' }, S.me.name, h('small', {}, isManager() ? 'Manager' : 'Maintenance')),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: signOut }, 'Sign out'));
    const links = [['orders', 'Work orders'], ['records', 'Completed records'], ['unit', 'Apartment history'],
      ['residents', 'Residents'], ['contacts', 'Contact sheet'], ['emails', 'Email log']];
    if (isManager()) links.push(null, ['pricing', 'Pricing & availability'], ['specials', 'Specials'], ['activity', 'Activity log'], ['team', 'Team'], ['settings', 'Settings']);
    links.push(null, ['account', 'My account']);
    main = h('section', { id: 'main' });
    app.replaceChildren(h('div', { class: 'staff-shell' },
      h('nav', { class: 'side', 'aria-label': 'Staff sections' },
        links.map((l) => (l ? h('a', { href: '#/' + l[0], 'data-nav': l[0] }, l[1]) : h('span', { class: 'side-gap' })))),
      main));
    setPending(S.pending);
  }

  // resident accounts waiting for approval: kept in the menu so they are not missed
  function setPending(n) {
    S.pending = n || 0;
    const link = app.querySelector('.side a[data-nav="residents"]');
    if (!link) return;
    link.replaceChildren('Residents', S.pending ? h('span', { class: 'nav-count', title: 'Waiting for approval' }, S.pending) : '');
  }

  const VIEWS = { orders: ordersView, new: newOrderView, records: recordsView, unit: unitView, residents: residentsView, contacts: contactsView,
    emails: emailsView, pricing: pricingView, specials: specialsView, activity: activityView, team: teamView, settings: settingsView, account: accountView };
  const MANAGER_ONLY = ['pricing', 'specials', 'activity', 'team', 'settings'];

  async function route() {
    if (!S.me || !main) return;
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    let name = VIEWS[parts[0]] ? parts[0] : 'orders';
    if (MANAGER_ONLY.includes(name) && !isManager()) name = 'orders';
    const id = name === 'orders' && /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : 0;
    const nav = name === 'new' ? 'orders' : name === 'orders' && id && S.from === 'records' ? 'records' : name;
    for (const a of app.querySelectorAll('.side a')) a.classList.toggle('on', a.getAttribute('data-nav') === nav);
    const mine = ++ticket;
    const key = name + '/' + id;
    if (key !== painted) main.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
    try {
      const nodes = id ? await detailView(id) : await VIEWS[name]();
      if (mine !== ticket) return;
      main.replaceChildren(flash ? h('p', { class: 'notice', role: 'status' }, flash) : '', ...nodes.filter(Boolean));
      if (key !== painted || flash) window.scrollTo({ top: 0 });
      flash = ''; painted = key;
    } catch (e) {
      if (mine !== ticket) return;
      if (e.status === 401) return RW.onAuthError();
      if (e.code === 'must_change') return boot();
      main.replaceChildren(h('div', { class: 'card stack' }, h('h2', {}, 'That did not load'), h('p', {}, e.message),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: route }, 'Try again'),
          h('a', { href: '#/orders' }, 'Back to work orders'))));
    }
  }
  window.addEventListener('hashchange', route);

  /* ---------------------------------------------------------- small pieces */
  function pageHead(title, text, action) {
    return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), text ? h('p', {}, text) : null), action || null);
  }
  function stat(n, label) { return h('div', { class: 'stat' }, h('span', { class: 'count' }, n), h('span', { class: 'label' }, label)); }
  function searchForm(value, placeholder, onSearch) {
    const box = input('q', { type: 'search', value: value, placeholder: placeholder, 'aria-label': placeholder });
    const form = h('form', { class: 'search', role: 'search' }, box, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Search'));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); onSearch(box.value.trim()); });
    return form;
  }
  // an email address that has to wrap breaks after the @, not in the middle of a word
  const addr = (e) => {
    const at = String(e || '').lastIndexOf('@');
    return at > 0 ? [e.slice(0, at + 1), h('wbr'), e.slice(at + 1)] : e;
  };

  // Every cell is labelled with its column heading. On a phone the tables are laid
  // out as a stack of cards and those labels stand in for the header row (portal.css).
  function tableOf(heads, rows) {
    for (const tr of rows) {
      let last = null;
      Array.from(tr.children).forEach((td, i) => {
        if (heads[i]) td.setAttribute('data-label', heads[i]);
        if (td.textContent.trim()) last = td; else td.classList.add('blank');
      });
      if (last) last.classList.add('end');
    }
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows)));
  }
  function orderRow(o, from) {
    return h('a', { class: 'order-row', href: '#/orders/' + o.id, onclick: () => { S.from = from; } },
      h('div', { class: 'or-top' }, h('span', { class: 'ref' }, o.ref), h('strong', {}, apt(o)),
        urgencyChip(o.open ? o.urgency : ''), chip(o.status, o.status_label)),
      h('p', { class: 'or-title' }, o.category + (o.location ? ' — ' + o.location : '')),
      h('p', { class: 'or-desc' }, o.description),
      o.status === 'completed' ? h('p', { class: 'or-done pre' }, h('span', { class: 'label' }, 'Work completed  '), o.work_done) : null,
      h('div', { class: 'or-meta' }, h('span', {}, o.contact_name),
        o.status === 'completed'
          ? h('span', {}, 'Completed ' + day(o.completed_at) + (o.completed_by_name ? ' by ' + o.completed_by_name : ''))
          : h('span', {}, 'Opened ' + day(o.created_at)),
        o.open ? h('span', {}, o.assigned_name ? 'Assigned to ' + o.assigned_name : 'Unassigned') : null));
  }

  /* ----------------------------------------------------------- work orders */
  async function ordersView() {
    const data = await api('/staff/workorders?view=' + S.view + (S.q ? '&q=' + encodeURIComponent(S.q) : ''));
    const c = data.counts;
    setPending(data.pending_residents);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Which work orders' },
      [['open', 'Open'], ['mine', 'Assigned to me'], ['all', 'Everything']].map((v) =>
        h('button', { type: 'button', class: S.view === v[0] ? 'on' : '', 'aria-pressed': String(S.view === v[0]),
          onclick: () => { S.view = v[0]; route(); } }, v[1])));
    const none = S.q ? 'Nothing matches “' + S.q + '”.'
      : S.view === 'mine' ? 'Nothing is assigned to you right now.'
      : S.view === 'all' ? 'No work orders yet.' : 'No open work orders.';
    return [
      pageHead('Work orders', 'Open maintenance requests, most urgent first.', h('a', { class: 'btn btn-sm', href: '#/new' }, 'New work order')),
      S.pending ? h('p', { class: 'notice' },
        h('strong', {}, S.pending === 1 ? '1 resident account is waiting for approval. ' : S.pending + ' resident accounts are waiting for approval. '),
        h('a', { href: '#/residents' }, isManager() ? 'Review' : 'See who')) : null,
      h('div', { class: 'stats' }, stat(c.new || 0, 'New'), stat(c.scheduled || 0, 'Scheduled'),
        stat(c.in_progress || 0, 'In progress'), stat(c.on_hold || 0, 'On hold')),
      h('div', { class: 'toolbar' }, seg, searchForm(S.q, 'Apartment, name or keyword', (q) => { S.q = q; route(); })),
      data.orders.length ? h('div', {}, data.orders.map((o) => orderRow(o, 'orders'))) : h('div', { class: 'empty' }, none),
    ];
  }

  async function recordsView() {
    const data = await api('/staff/workorders?view=completed' + (S.recordsQ ? '&q=' + encodeURIComponent(S.recordsQ) : ''));
    const total = data.counts.completed || 0;
    return [
      pageHead('Completed records', 'Every finished work order, newest first — what was done, who did it and when.',
        h('a', { class: 'btn btn-sm btn-ghost', href: '/api/portal/staff/export.csv' }, 'Download spreadsheet')),
      h('div', { class: 'toolbar' },
        searchForm(S.recordsQ, 'Apartment, name, or what was done', (q) => { S.recordsQ = q; route(); }),
        h('span', { class: 'fine' }, S.recordsQ ? data.orders.length + ' of ' + total + ' match' : total + ' completed'
          + (total > data.orders.length ? ' — showing the latest ' + data.orders.length + '; the spreadsheet has them all' : ''))),
      data.orders.length ? h('div', {}, data.orders.map((o) => orderRow(o, 'records')))
        : h('div', { class: 'empty' }, S.recordsQ ? 'Nothing matches “' + S.recordsQ + '”.' : 'No completed work orders yet.'),
    ];
  }

  const NOTE_KIND = { note: 'Internal note', handoff: 'For the next technician', message: 'Sent to resident',
    status: 'Update', tenant: 'From the resident', completed: 'Work completed' };

  function handoffList(items, emptyText) {
    if (!items.length) return h('p', { class: 'muted' }, emptyText);
    return items.map((n) => h('div', { class: 'handoff-item' }, h('p', { class: 'pre' }, n.body),
      h('p', { class: 'by' }, n.author_name + ' · ' + day(n.created_at) + ' · ',
        h('a', { href: '#/orders/' + n.work_order_id }, n.ref), n.building ? ' · ' + n.building : '')));
  }
  function previousList(items, emptyText) {
    if (!items.length) return h('p', { class: 'muted' }, emptyText);
    return items.map((p) => h('a', { class: 'prev', href: '#/orders/' + p.id },
      h('span', { class: 'ref' }, p.ref), ' ', chip(p.status, p.status_label),
      h('div', {}, p.category + (p.location ? ' — ' + p.location : '') + ' · ' + day(p.completed_at || p.created_at)),
      p.work_done ? h('div', { class: 'muted pre' }, p.work_done) : h('div', { class: 'muted' }, p.description)));
  }

  async function detailView(id) {
    const d = await api('/staff/workorders/' + id);
    const o = d.order;
    const again = () => route();

    const manage = h('form', { class: 'card stack' }, h('h3', {}, 'Manage'),
      field('Status', select('status', Object.keys(S.labels)
        .filter((k) => k !== 'completed' || o.status === 'completed').map((k) => [k, S.labels[k]]), o.status)),
      field('Urgency', select('urgency', URGENCY, o.urgency)),
      field('Assigned to', select('assigned_to', [['', 'Nobody yet']].concat(S.team.map((t) => [String(t.id), t.name])),
        o.assigned_to ? String(o.assigned_to) : '')),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Save changes'));
    onSubmit(manage, async (v) => {
      const body = { urgency: v.urgency, assigned_to: v.assigned_to ? Number(v.assigned_to) : null };
      if (v.status !== o.status) body.status = v.status;
      await api('/staff/workorders/' + id, body);
      flash = 'Saved.';
      again();
    });

    const note = h('form', { class: 'card stack' }, h('h3', {}, 'Add a note'),
      field('Note', textarea('body', { maxlength: 4000, required: true })),
      choices('kind', [
        ['note', 'Internal note', 'Staff only.'],
        ['handoff', 'Note for the next technician', 'Stays with this apartment and shows on every future job there.'],
        ['message', 'Message to the resident', 'Appears in their portal and is emailed to them.'],
      ], 'note'),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add note'));
    onSubmit(note, async (v) => {
      await api('/staff/workorders/' + id + '/notes', { body: v.body, kind: v.kind === 'handoff' ? 'handoff' : 'note',
        visible_to_tenant: v.kind === 'message' });
      flash = v.kind === 'message' ? 'Message sent to the resident.' : 'Note added.';
      again();
    });

    let complete = null;
    if (o.status !== 'completed' && o.status !== 'cancelled') {
      complete = h('form', { class: 'card card-accent stack' }, h('h3', {}, 'Complete this work order'),
        field('Work completed', textarea('work_done', { maxlength: 4000, required: true,
          placeholder: 'What was wrong, what you did, parts used.' }), 'Kept permanently in the completed records.'),
        field('Note for the next technician (optional)', textarea('handoff_note', { maxlength: 4000,
          placeholder: 'Anything the next person at this apartment should know — shut-offs, part numbers, quirks, what to watch.' })),
        field('Message to the resident (optional)', textarea('resident_message', { maxlength: 2000,
          placeholder: 'Shown in their portal and emailed to them.' })),
        h('button', { class: 'btn btn-gold', type: 'submit' }, 'Complete work order'));
      onSubmit(complete, async (v) => {
        await api('/staff/workorders/' + id + '/complete', { work_done: v.work_done, handoff_note: v.handoff_note,
          resident_message: v.resident_message });
        flash = o.ref + ' is completed and filed in the records.';
        again();
      });
    }

    const back = S.from === 'records' ? ['#/records', 'Completed records'] : ['#/orders', 'Work orders'];
    return [
      h('a', { class: 'back', href: back[0] }, '← ' + back[1]),
      h('div', { class: 'page-head' }, h('div', {},
        h('p', { class: 'or-top' }, h('span', { class: 'ref' }, o.ref), chip(o.status, o.status_label), urgencyChip(o.open ? o.urgency : '')),
        h('h1', {}, apt(o) + ' — ' + o.category),
        h('p', {}, 'Opened ' + when(o.created_at) + (o.source === 'staff' ? ' by staff on the resident’s behalf' : ' by the resident')))),
      h('div', { class: 'detail' },
        h('div', {},
          h('div', { class: 'card card-accent' }, h('div', { class: 'card-head' }, h('h3', {}, 'Notes for the next technician'),
            h('span', { class: 'fine' }, 'Apartment ' + o.unit)),
            handoffList(d.unit.handoff, 'Nobody has left notes for this apartment yet.')),
          h('div', { class: 'card stack' }, h('h3', {}, 'The problem'),
            h('p', { class: 'pre' }, o.description),
            h('dl', { class: 'kv' },
              h('dt', {}, 'Where'), h('dd', {}, o.location || '—'),
              h('dt', {}, 'Entry'), h('dd', {}, o.permission_to_enter ? 'May enter if the resident is out' : 'Arrange a time first'),
              o.entry_notes ? [h('dt', {}, 'Entry notes'), h('dd', {}, o.entry_notes)] : null)),
          o.status === 'completed' ? h('div', { class: 'card stack' }, h('h3', {}, 'Work completed'),
            h('p', { class: 'pre' }, o.work_done),
            h('p', { class: 'fine' }, (o.completed_by_name || 'Staff') + ' · ' + when(o.completed_at)),
            o.resident_message ? h('p', { class: 'fine pre' }, 'Told the resident: ' + o.resident_message) : null) : null,
          complete,
          h('div', { class: 'card' }, h('h3', {}, 'Timeline'),
            d.notes.length ? h('ul', { class: 'tl' }, d.notes.map((n) => h('li', {},
              h('div', { class: 'tl-head' }, h('strong', {}, n.author_name), h('span', {}, NOTE_KIND[n.kind] || n.kind),
                h('span', {}, when(n.created_at))),
              h('p', { class: 'pre' + (n.kind === 'handoff' ? ' tl-handoff' : '') }, n.body))))
              : h('p', { class: 'muted' }, 'Nothing has happened on this one yet.')),
          note),
        h('aside', {},
          h('div', { class: 'card stack' }, h('h3', {}, 'Resident'),
            h('dl', { class: 'kv' },
              h('dt', {}, 'Name'), h('dd', {}, o.contact_name),
              h('dt', {}, 'Phone'), h('dd', {}, tel(o.contact_phone)),
              h('dt', {}, 'Email'), h('dd', {}, o.contact_email ? h('a', { href: 'mailto:' + o.contact_email }, o.contact_email) : '—'),
              h('dt', {}, 'Apartment'), h('dd', {}, o.unit + (o.building ? ', ' + o.building + ' Wilson Ave' : '')))),
          manage,
          h('div', { class: 'card' }, h('h3', {}, 'Earlier work here'),
            previousList(d.unit.previous, 'No other work orders for this apartment.')))),
    ];
  }

  async function newOrderView() {
    const roster = (await api('/staff/residents')).residents.filter((r) => r.active);
    const pick = select('pick', [['', 'Choose a resident to fill in their details…']].concat(
      roster.map((r) => [String(r.id), 'Apt ' + r.unit + (r.building ? ' (' + r.building + ')' : '') + ' — ' + r.name])), '');
    const form = h('form', { class: 'card stack', novalidate: true },
      roster.length ? field('Resident on file', pick) : null,
      h('div', { class: 'cols' },
        field('Apartment number', input('unit', { required: true, maxlength: 12 })),
        field('Building', select('building', buildingOptions(), ''))),
      h('div', { class: 'cols-3' },
        field('Resident name', input('contact_name', { required: true, maxlength: 80 })),
        field('Phone', input('contact_phone', { type: 'tel', maxlength: 30 })),
        field('Email', input('contact_email', { type: 'email', maxlength: 200, autocapitalize: 'none' }))),
      h('div', { class: 'cols' },
        field('What needs attention?', select('category', [['', 'Choose one…']].concat(S.categories.map((c) => [c, c])), '')),
        field('Where is it?', input('location', { maxlength: 120 }))),
      field('What is happening?', textarea('description', { required: true, maxlength: 4000 })),
      h('div', { class: 'cols' },
        field('Urgency', select('urgency', URGENCY, 'routine')),
        field('Entry notes', input('entry_notes', { maxlength: 500 }))),
      check('permission_to_enter', 'The resident says maintenance may enter if they are not home.', false),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, 'Create work order'),
        h('a', { href: '#/orders' }, 'Cancel')));
    pick.addEventListener('change', () => {
      const r = roster.find((x) => String(x.id) === pick.value);
      if (!r) return;
      const e = form.elements;
      e.unit.value = r.unit; e.building.value = r.building; e.contact_name.value = r.name;
      e.contact_phone.value = r.phone; e.contact_email.value = r.email;
    });
    onSubmit(form, async (v) => {
      const made = await api('/staff/workorders', { unit: v.unit, building: v.building, contact_name: v.contact_name,
        contact_phone: v.contact_phone, contact_email: v.contact_email, category: v.category, location: v.location,
        description: v.description, urgency: v.urgency, entry_notes: v.entry_notes,
        permission_to_enter: v.permission_to_enter === 'on' });
      flash = 'Work order ' + made.ref + ' created.';
      S.from = 'orders';
      location.hash = '#/orders/' + made.id;
    });
    return [h('a', { class: 'back', href: '#/orders' }, '← Work orders'),
      pageHead('New work order', 'For requests that come in by phone or at the office.'), form];
  }

  /* ------------------------------------------------------ apartment history */
  async function unitView() {
    const form = h('form', { class: 'toolbar' },
      h('div', { class: 'search' }, input('unit', { value: S.unit, placeholder: 'Apartment number', 'aria-label': 'Apartment number' }),
        h('button', { class: 'btn btn-sm', type: 'submit' }, 'Look up')),
      select('building', [['any', 'Both buildings'], ['1871', '1871 Wilson'], ['1885', '1885 Wilson']], S.unitBuilding));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      S.unit = form.elements.unit.value.trim(); S.unitBuilding = form.elements.building.value; route();
    });
    const head = pageHead('Apartment history', 'Everything on file for one apartment: the notes technicians left, and every job done there.');
    if (!S.unit) return [head, form, h('div', { class: 'empty' }, 'Enter an apartment number to see its history.')];
    const d = await api('/staff/unit?unit=' + encodeURIComponent(S.unit) + '&building=' + encodeURIComponent(S.unitBuilding));
    return [head, form,
      h('div', { class: 'card card-accent' }, h('div', { class: 'card-head' }, h('h3', {}, 'Notes for the next technician'),
        h('span', { class: 'fine' }, 'Apartment ' + d.unit)), handoffList(d.handoff, 'No notes have been left for this apartment.')),
      h('div', { class: 'card' }, h('h3', {}, 'Work orders'), previousList(d.previous, 'No work orders for this apartment.')),
      h('div', { class: 'card' }, h('h3', {}, 'Residents on file'),
        d.residents.length ? h('dl', { class: 'kv' }, d.residents.map((r) => [
          h('dt', {}, r.name + (r.pending ? ' (waiting for approval)' : r.active ? '' : ' (removed)')),
          h('dd', {}, tel(r.phone), ' · ' + r.email + (r.building ? ' · ' + r.building : ''))]))
          : h('p', { class: 'muted' }, 'Nobody is listed for this apartment.'))];
  }

  /* -------------------------------------------------------------- residents */
  function residentFields(r) {
    r = r || {};
    return [h('div', { class: 'cols-3' },
      field('Apartment number', input('unit', { required: true, maxlength: 12, value: r.unit || '' })),
      field('Building', select('building', buildingOptions(), r.building || '')),
      field('Full name', input('name', { required: true, maxlength: 80, value: r.name || '' }))),
    h('div', { class: 'cols' },
      field('Email', input('email', { type: 'email', required: true, maxlength: 200, autocapitalize: 'none', value: r.email || '' })),
      field('Phone', input('phone', { type: 'tel', required: true, maxlength: 30, value: r.phone || '' }))),
    // editing someone already on file: the optional ways to reach them too
    r.id ? h('div', { class: 'cols-3' },
      field('Second phone', input('alt_phone', { type: 'tel', maxlength: 30, value: r.alt_phone || '' })),
      field('Emergency contact', input('emergency_name', { maxlength: 80, value: r.emergency_name || '',
        placeholder: 'Name and relationship' })),
      field('Emergency phone', input('emergency_phone', { type: 'tel', maxlength: 30, value: r.emergency_phone || '' }))) : null];
  }
  const residentBody = (v) => {
    const out = { unit: v.unit, building: v.building, name: v.name, email: v.email, phone: v.phone };
    for (const k of ['alt_phone', 'emergency_name', 'emergency_phone']) if (v[k] !== undefined) out[k] = v[k];
    return out;
  };
  // after an edit, go back to wherever it was started from (the contact sheet, or here)
  const leaveEdit = () => {
    const back = S.editReturn;
    S.editResident = null; S.editReturn = null;
    if (back && location.hash !== back) location.hash = back; else route();
  };

  async function residentsView() {
    const list = (await api('/staff/residents')).residents;
    const act = async (path, body, done) => {
      try { await api(path, body); flash = done; } catch (e) { flash = e.message; }
      route();
    };
    const nodes = [pageHead('Residents', 'Residents can create their own account from the resident portal, or you can add them here. '
      + 'Anyone you add signs in with their apartment number as the password until they choose their own.')];
    const waiting = list.filter((r) => r.pending);
    setPending(waiting.length);
    if (waiting.length) {
      nodes.push(h('div', { class: 'card card-accent' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Waiting for approval'),
          h('span', { class: 'fine' }, isManager() ? 'Check each one against your rent roll before approving.' : 'A manager approves these.')),
        waiting.map((r) => h('div', { class: 'handoff-item waiting' },
          h('div', {},
            h('p', {}, h('strong', {}, r.name), ' — Apt ' + r.unit + (r.building ? ', ' + r.building + ' Wilson Ave' : '')),
            h('p', { class: 'by' }, tel(r.phone), ' · ' + r.email + ' · signed up ' + when(r.created_at))),
          isManager() ? h('div', { class: 'actions' },
            h('button', { class: 'btn btn-sm', type: 'button',
              onclick: () => act('/staff/residents/' + r.id + '/approve', {}, r.name + ' can now sign in.') }, 'Approve'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => {
              if (!window.confirm('Decline ' + r.name + '? The sign-up is deleted and they will not be able to sign in.')) return;
              act('/staff/residents/' + r.id + '/decline', {}, 'The sign-up from ' + r.name + ' was declined.');
            } }, 'Decline')) : null))));
    }

    if (isManager()) {
      const editing = list.find((r) => r.id === S.editResident);
      if (editing) {
        const edit = h('form', { class: 'card card-accent stack' }, h('h3', {}, 'Edit ' + editing.name), residentFields(editing),
          h('p', { class: 'fine' }, 'Changing the apartment, email or phone signs the resident out; they sign back in with the new details.'),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Save'),
            h('button', { class: 'link-btn', type: 'button', onclick: leaveEdit }, 'Cancel')));
        onSubmit(edit, async (v) => {
          await api('/staff/residents/' + editing.id, residentBody(v));
          flash = 'Saved ' + v.name + '.'; leaveEdit();
        });
        nodes.push(edit);
      } else {
        const add = h('form', { class: 'card stack' }, h('h3', {}, 'Add a resident'), residentFields(),
          h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add resident'));
        onSubmit(add, async (v) => { await api('/staff/residents', residentBody(v)); flash = v.name + ' can now sign in.'; route(); });
        const bulk = h('form', { class: 'stack' },
          field('One resident per line', textarea('text', { placeholder: '204, Maria Lopez, maria@email.com, 651-555-0101, 1871', spellcheck: 'false' }),
            'Apartment, name, email, phone, then 1871 or 1885. Commas or tabs — pasting straight from a spreadsheet works.'),
          h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add them all'));
        onSubmit(bulk, async (v) => {
          const out = await api('/staff/residents/bulk', { text: v.text });
          if (out.problems.length) S.bulkProblems = out;
          else flash = out.added + (out.added === 1 ? ' resident added.' : ' residents added.');
          route();
        });
        if (S.bulkProblems) {
          // shown once, above the list the successful lines have just joined
          const out = S.bulkProblems;
          S.bulkProblems = null;
          nodes.push(h('div', { class: 'card card-accent stack' },
            h('h3', {}, out.added + ' added, ' + out.problems.length + ' could not be added'),
            h('ul', {}, out.problems.map((p) => h('li', {}, 'Line ' + p.line + ' (' + p.text + ') — ' + p.problem))),
            h('p', { class: 'fine' }, 'Fix those lines and paste just them again.')));
        }
        nodes.push(add, h('div', { class: 'card' }, h('details', { class: 'more' }, h('summary', {}, 'Add many at once'), bulk)));
      }
    }

    const filed = list.filter((r) => !r.pending);
    const rows = filed.map((r) => h('tr', { class: r.active ? '' : 'off' },
      h('td', { class: 'nowrap' }, r.unit + (r.building ? ' · ' + r.building : '')),
      h('td', {}, r.name, r.active ? null : h('span', { class: 'chip chip-off' }, 'Removed'),
        r.source === 'self' ? h('div', { class: 'fine' }, 'Signed up online') : null),
      h('td', { class: 'addr' }, addr(r.email)), h('td', { class: 'nowrap' }, tel(r.phone)),
      h('td', { class: 'fine' }, r.has_password ? 'Their own' : 'Apartment number'),
      h('td', { class: 'row-actions' },
        r.active ? h('button', { class: 'link-btn', type: 'button', title: 'Clear a sign-in lock after too many wrong attempts',
          onclick: () => act('/staff/residents/' + r.id + '/unlock', {}, r.name + ' can try signing in again.') }, 'Unlock') : null,
        isManager() && r.active ? h('button', { class: 'link-btn', type: 'button',
          onclick: () => { S.editResident = r.id; S.editReturn = null; route(); window.scrollTo({ top: 0 }); } }, 'Edit') : null,
        isManager() && r.active && r.has_password ? h('button', { class: 'link-btn', type: 'button',
          title: 'For a forgotten password: puts it back to the apartment number', onclick: () => {
            if (!window.confirm('Reset the password for ' + r.name + '? It goes back to their apartment number (' + r.unit
              + '), and they choose a new one after signing in.')) return;
            act('/staff/residents/' + r.id + '/reset-password', {}, r.name + ' can now sign in with their apartment number and choose a new password.');
          } }, 'Reset password') : null,
        isManager() ? h('button', { class: 'link-btn', type: 'button', onclick: () => {
          if (r.active && !window.confirm('Remove ' + r.name + '? They will no longer be able to sign in. Their work orders are kept.')) return;
          act('/staff/residents/' + r.id, { active: !r.active }, r.active ? r.name + ' was removed.' : r.name + ' was restored.');
        } }, r.active ? 'Remove' : 'Restore') : null)));
    nodes.push(h('div', { class: 'card-head' }, h('h2', {}, 'On file'),
      h('span', { class: 'fine' }, filed.filter((r) => r.active).length + ' active')),
    filed.length ? tableOf(['Apartment', 'Name', 'Email', 'Phone', 'Password', ''], rows)
      : h('div', { class: 'empty' }, 'No residents yet. Add them above, or let them create their own accounts.'));
    return nodes;
  }

  /* --------------------------------------------------------- contact sheet */
  // Every resident's contact details as a spreadsheet: one row per resident,
  // apartment by apartment, filtered and sorted in place as you type or click.
  const digitsOf = (x) => String(x || '').replace(/\D/g, '');
  const unitOrder = (a, b) => String(a.building).localeCompare(String(b.building))
    || String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true, sensitivity: 'base' })
    || String(a.name).localeCompare(String(b.name));
  const SHEET_COLS = [['unit', 'Apartment'], ['name', 'Resident'], [null, 'Email'], [null, 'Phone'], [null, 'Second phone'],
    [null, 'Emergency contact'], [null, 'Emergency phone'], ['updated', 'Last updated']];

  async function contactsView() {
    const everyone = (await api('/staff/residents')).residents;
    setPending(everyone.filter((r) => r.pending && r.active).length);
    const st = S.sheet;
    const body = h('tbody');
    const headRow = h('tr');
    const count = h('span', { class: 'fine' });
    const hint = h('p', { class: 'fine sheet-hint', hidden: true }, 'Scroll sideways to see every column.');
    const wrap = h('div', { class: 'sheet-wrap', tabindex: '0', role: 'region', 'aria-label': 'Resident contact sheet' });

    const matches = (r) => {
      if (!st.removed && !r.active) return false;
      if (st.building !== 'all' && r.building !== st.building) return false;
      const q = st.q.trim().toLowerCase().replace(/^(apartment|apt\.?|unit|#)\s*/, '');
      if (!q) return true;
      const text = [r.unit, r.name, r.email, r.emergency_name].join(' ').toLowerCase();
      const d = digitsOf(q);
      return text.includes(q) || (d.length >= 3 && [r.phone, r.alt_phone, r.emergency_phone].some((p) => digitsOf(p).includes(d)));
    };
    const sorter = (a, b) => st.dir * (st.sort === 'name' ? String(a.name).localeCompare(String(b.name)) || unitOrder(a, b)
      : st.sort === 'updated' ? String(a.contact_updated_at || '').localeCompare(String(b.contact_updated_at || '')) || unitOrder(a, b)
      : unitOrder(a, b));
    const updated = (r) => (r.contact_updated_at
      ? day(r.contact_updated_at) + ' · ' + (r.contact_updated_by === 'resident' ? 'by resident' : 'by ' + r.contact_updated_by)
      : 'Added ' + day(r.created_at));

    const render = () => {
      const rows = everyone.filter(matches).sort(sorter);
      let prev = '';
      body.replaceChildren(...rows.map((r) => {
        const unit = r.building + '|' + String(r.unit).toUpperCase();
        // a second resident of the same apartment sits under the first, number not repeated
        const same = st.sort === 'unit' && unit === prev;
        prev = unit;
        return h('tr', { class: (r.active ? '' : 'off') + (same ? ' same-unit' : '') },
          h('td', { class: 'sheet-unit' }, r.unit, r.building ? h('span', { class: 'fine' }, ' · ' + r.building) : null),
          h('td', {}, r.name,
            r.pending && r.active ? h('span', { class: 'chip chip-goldline' }, 'Waiting') : null,
            r.active ? null : h('span', { class: 'chip chip-off' }, 'Removed'),
            isManager() && r.active ? h('button', { class: 'link-btn sheet-edit', type: 'button', onclick: () => {
              S.editResident = r.id; S.editReturn = '#/contacts'; location.hash = '#/residents';
            } }, 'Edit') : null),
          h('td', { class: 'addr' }, r.email ? h('a', { href: 'mailto:' + r.email }, addr(r.email)) : ''),
          h('td', {}, r.phone ? tel(r.phone) : ''),
          h('td', {}, r.alt_phone ? tel(r.alt_phone) : ''),
          h('td', {}, r.emergency_name || ''),
          h('td', {}, r.emergency_phone ? tel(r.emergency_phone) : ''),
          h('td', { class: 'fine' }, updated(r)));
      }));
      if (!rows.length) {
        body.replaceChildren(h('tr', {}, h('td', { class: 'sheet-empty', colspan: String(SHEET_COLS.length) },
          everyone.length ? 'No residents match.' : 'No residents yet. Add them under Residents, or let them sign up from the resident portal.')));
      }
      const units = new Set(rows.map((r) => r.building + '|' + String(r.unit).toUpperCase())).size;
      count.textContent = rows.length + (rows.length === 1 ? ' resident in ' : ' residents in ') + units + (units === 1 ? ' apartment' : ' apartments');
      headRow.replaceChildren(...SHEET_COLS.map(([key, label]) => {
        if (!key) return h('th', { scope: 'col' }, label);
        const on = st.sort === key;
        return h('th', { scope: 'col', 'aria-sort': on ? (st.dir > 0 ? 'ascending' : 'descending') : null },
          h('button', { type: 'button', class: 'sort' + (on ? ' on' : ''), title: 'Sort by ' + label.toLowerCase(), onclick: () => {
            if (on) st.dir = -st.dir; else { st.sort = key; st.dir = key === 'updated' ? -1 : 1; }
            render();
          } }, label, h('span', { class: 'sort-mark', 'aria-hidden': 'true' }, on ? (st.dir > 0 ? ' ↑' : ' ↓') : '')));
      }));
      requestAnimationFrame(() => { hint.hidden = !(wrap.scrollWidth > wrap.clientWidth + 1); });
    };

    const search = input('q', { type: 'search', value: st.q, class: 'sheet-search', autocomplete: 'off',
      placeholder: 'Apartment, name, email or phone', 'aria-label': 'Search the contact sheet' });
    search.addEventListener('input', () => { st.q = search.value; render(); });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Building' });
    for (const [v, label] of [['all', 'Both buildings'], ['1871', '1871'], ['1885', '1885']]) {
      const b = h('button', { type: 'button', class: st.building === v ? 'on' : '', 'aria-pressed': String(st.building === v) }, label);
      b.addEventListener('click', () => {
        st.building = v;
        for (const x of seg.children) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
        render();
      });
      seg.append(b);
    }
    const removed = check('removed', 'Show removed residents', st.removed);
    removed.querySelector('input').addEventListener('change', (ev) => { st.removed = ev.target.checked; render(); });

    wrap.append(h('table', { class: 'sheet' }, h('thead', {}, headRow), body));
    render();
    return [
      pageHead('Contact sheet', 'Every resident’s email and phone numbers, apartment by apartment. '
        + 'Residents keep their own details current from the resident portal; changes show up here straight away.',
        isManager() ? h('a', { class: 'btn btn-sm btn-ghost', href: '/api/portal/staff/contacts.csv' }, 'Download spreadsheet') : null),
      h('div', { class: 'toolbar' }, search, seg, removed, count),
      hint, wrap,
    ];
  }

  /* ------------------------------------------------------------------- logs */
  const EMAIL_KIND = { office_new_request: 'New request → office', resident_received: 'Confirmation → resident',
    resident_update: 'Update → resident', resident_completed: 'Completed → resident',
    office_new_signup: 'New account → office', resident_signup: 'Sign-up received → resident',
    office_contact_update: 'Contact update → office', resident_email_changed: 'Email changed → old address',
    resident_welcome: 'Account ready → resident' };
  async function emailsView() {
    const list = (await api('/staff/emails')).emails;
    const state = (e) => (e.status === 'sent' ? h('span', { class: 'chip chip-solid' }, 'Sent')
      : e.status === 'failed' ? h('span', { class: 'chip chip-gold' }, 'Failed') : h('span', { class: 'chip chip-off' }, 'Not sent'));
    return [pageHead('Email log', 'Every notification the portal has produced, whether or not it could be delivered.'),
      list.length ? tableOf(['When', 'To', 'Message', 'Type', 'Delivery'], list.map((e) => h('tr', {},
        h('td', { class: 'nowrap' }, when(e.created_at)), h('td', { class: 'addr' }, addr(e.to_addr)),
        h('td', {}, h('details', {}, h('summary', {}, e.subject), h('p', { class: 'pre fine' }, e.body))),
        h('td', {}, EMAIL_KIND[e.kind] || e.kind),
        h('td', {}, state(e), e.detail ? h('div', { class: 'fine' }, e.detail) : null))))
        : h('div', { class: 'empty' }, 'No emails yet. One is logged each time a request is sent, updated or completed.')];
  }

  const EVENT = { sign_in: 'Signed in', sign_in_failed: 'Failed sign-in', request_created: 'Sent a request',
    request_cancelled: 'Cancelled a request', order_created: 'Created a work order', order_updated: 'Updated a work order',
    order_completed: 'Completed a work order', resident_added: 'Added a resident', residents_imported: 'Added residents',
    resident_removed: 'Removed a resident', resident_restored: 'Restored a resident', resident_edited: 'Edited a resident',
    resident_unlocked: 'Unlocked a resident', team_member_added: 'Added a team member', team_member_changed: 'Changed a team member',
    team_password_reset: 'Reset a password', password_changed: 'Changed their password', settings_changed: 'Changed settings',
    records_exported: 'Downloaded records', portal_set_up: 'Set up the portal', pricing_changed: 'Changed pricing or availability',
    contact_updated: 'Updated contact details', contacts_exported: 'Downloaded the contact sheet',
    special_created: 'Added a special', special_changed: 'Changed a special', special_turned_on: 'Turned a special on',
    special_turned_off: 'Turned a special off', special_deleted: 'Deleted a special',
    account_created: 'Created an account', resident_approved: 'Approved an account', resident_declined: 'Declined a sign-up',
    resident_password_changed: 'Changed their password', resident_password_reset: 'Reset a resident password' };
  async function activityView() {
    const list = (await api('/staff/activity')).activity;
    return [pageHead('Activity log', 'Who signed in and what was changed — including sign-in attempts that failed.'),
      list.length ? tableOf(['When', 'Who', 'What', 'Detail', 'From'], list.map((e) => h('tr', {},
        h('td', { class: 'nowrap' }, when(e.at)),
        h('td', {}, e.actor_label || '—', h('div', { class: 'fine' }, e.actor_kind === 'tenant' ? 'Resident' : 'Staff')),
        h('td', {}, e.event === 'sign_in_failed' ? h('span', { class: 'chip chip-gold' }, 'Failed sign-in') : EVENT[e.event] || e.event),
        h('td', {}, e.detail), h('td', { class: 'fine' }, e.ip))))
        : h('div', { class: 'empty' }, 'Nothing yet.')];
  }

  /* ------------------------------------------------------------------- team */
  async function teamView() {
    const list = (await api('/staff/team')).team;
    const act = async (id, body, done) => {
      try { await api('/staff/team/' + id, body); flash = done; } catch (e) { flash = e.message; }
      S.team = (await api('/staff/me')).team;
      route();
    };
    const nodes = [pageHead('Team', 'Everyone who can sign in to the staff side. Managers can also edit residents, the team and settings.')];
    const resetting = list.find((t) => t.id === S.resetMember);
    if (resetting) {
      const reset = h('form', { class: 'card card-accent stack' }, h('h3', {}, 'Reset password for ' + resetting.name),
        field('Temporary password', input('password', { type: 'text', autocomplete: 'off', required: true }),
          'At least 10 characters. Give it to them in person; they must replace it the first time they sign in.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'submit' }, 'Reset password'),
          h('button', { class: 'link-btn', type: 'button', onclick: () => { S.resetMember = null; route(); } }, 'Cancel')));
      onSubmit(reset, async (v) => {
        await api('/staff/team/' + resetting.id, { password: v.password });
        S.resetMember = null; flash = resetting.name + ' has a new temporary password.'; route();
      });
      nodes.push(reset);
    } else {
      const add = h('form', { class: 'card stack' }, h('h3', {}, 'Add a team member'),
        h('div', { class: 'cols' }, field('Name', input('name', { required: true, maxlength: 80 })),
          field('Email', input('email', { type: 'email', required: true, autocapitalize: 'none' }))),
        h('div', { class: 'cols' },
          field('Role', select('role', [['tech', 'Maintenance technician'], ['manager', 'Manager']], 'tech')),
          field('Temporary password', input('password', { type: 'text', autocomplete: 'off', required: true }),
            'At least 10 characters. They must replace it the first time they sign in.')),
        h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add to team'));
      onSubmit(add, async (v) => {
        await api('/staff/team', { name: v.name, email: v.email, role: v.role, password: v.password });
        S.team = (await api('/staff/me')).team;
        flash = v.name + ' can now sign in.'; route();
      });
      nodes.push(add);
    }
    nodes.push(tableOf(['Name', 'Email', 'Role', 'Last signed in', ''], list.map((t) => {
      const self = t.id === S.me.id;
      return h('tr', { class: t.active ? '' : 'off' },
        h('td', {}, t.name, self ? h('span', { class: 'fine' }, ' (you)') : null, t.active ? null : h('span', { class: 'chip chip-off' }, 'Removed')),
        h('td', { class: 'addr' }, addr(t.email)), h('td', {}, t.role === 'manager' ? 'Manager' : 'Technician'),
        h('td', { class: 'nowrap' }, t.last_login_at ? when(t.last_login_at) : 'Never'),
        h('td', { class: 'row-actions' }, self ? null : [
          t.active ? h('button', { class: 'link-btn', type: 'button', onclick: () => act(t.id, { role: t.role === 'manager' ? 'tech' : 'manager' },
            t.name + ' is now a ' + (t.role === 'manager' ? 'technician.' : 'manager.')) }, t.role === 'manager' ? 'Make technician' : 'Make manager') : null,
          t.active ? h('button', { class: 'link-btn', type: 'button', onclick: () => { S.resetMember = t.id; route(); window.scrollTo({ top: 0 }); } }, 'Reset password') : null,
          h('button', { class: 'link-btn', type: 'button', onclick: () => {
            if (t.active && !window.confirm('Remove ' + t.name + ' from the team? They will be signed out and unable to sign in.')) return;
            act(t.id, { active: !t.active }, t.active ? t.name + ' was removed.' : t.name + ' was restored.');
          } }, t.active ? 'Remove' : 'Restore')]));
    })));
    return nodes;
  }

  /* ---------------------------------------------- rents shown on the site */
  const dollars = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  async function pricingView() {
    const d = await api('/staff/pricing');
    const ids = Object.keys(d.plans);
    const form = h('form', { class: 'stack', novalidate: true },
      ids.map((id) => {
        const p = d.plans[id];
        return h('div', { class: 'card stack' },
          h('div', { class: 'card-head' }, h('h3', {}, p.name), h('span', { class: 'fine' }, p.beds + ' · 1 bath')),
          h('div', { class: 'cols' },
            field('Monthly rent', h('span', { class: 'money' },
              input(id + '_rent', { inputmode: 'numeric', autocomplete: 'off', value: p.rent || '', placeholder: 'No price shown' })),
              'Whole dollars. Leave it blank to show no price for this plan.'),
            field('Note under the price (optional)', input(id + '_note', { value: p.note, maxlength: 80, autocomplete: 'off',
              placeholder: 'Available December 1' }))),
          check(id + '_from', 'Show it as a starting price — “From $…”', p.from),
          h('p', { class: 'msg ok preview', 'data-preview': id }));
      }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'submit' }, 'Save and publish'),
        h('a', { href: '/#residences', target: '_blank', rel: 'noopener' }, 'Open the main site')),
      h('p', { class: 'msg', role: 'alert', hidden: true }));

    // what each plan will read as on the site, as it is typed
    const preview = () => ids.forEach((id) => {
      const e = form.elements;
      const typed = e[id + '_rent'].value.replace(/[$,\s]/g, '');
      const note = e[id + '_note'].value.trim();
      const price = /^\d+$/.test(typed) && Number(typed) > 0
        ? (e[id + '_from'].checked ? 'From ' : '') + dollars(Number(typed)) + ' per month' : '';
      const a = d.plans[id].available;
      const avail = a === true ? 'Available now' : a === false ? 'Currently unavailable' : '';
      form.querySelector('[data-preview="' + id + '"]').textContent = 'On the site: '
        + (typed && !price ? 'that rent is not a whole dollar amount'
          : [avail, price, note].filter(Boolean).join(' · ') || 'nothing shown for this plan');
    });
    form.addEventListener('input', preview);
    preview();

    onSubmit(form, async (v) => {
      const plans = {};
      ids.forEach((id) => { plans[id] = { rent: v[id + '_rent'], from: v[id + '_from'] === 'on', note: v[id + '_note'] }; });
      const out = await api('/staff/pricing', { plans: plans });
      flash = out.changed ? 'Saved. The main site is showing the new pricing now.' : 'Nothing was changed.';
      route();
    });

    // Availability: one toggle per floor plan, live on the site the moment it is
    // tapped. It saves on its own, so rents being typed below are left as they are.
    const availMsg = h('p', { class: 'msg', role: 'status', hidden: true });
    const lastChange = h('p', { class: 'fine last-change', hidden: !d.updated_at },
      d.updated_at ? 'Last changed ' + when(d.updated_at) + (d.updated_by ? ' by ' + d.updated_by : '') + '.' : '');
    const STATE = { true: 'Showing as available', false: 'Showing as unavailable', null: 'Not shown on the site' };
    const availRow = (id) => {
      const p = d.plans[id];
      const yes = h('button', { type: 'button' }, 'Available');
      const no = h('button', { type: 'button' }, 'Unavailable');
      const clear = h('button', { type: 'button', class: 'link-btn' }, 'Don’t show');
      const state = h('span', { class: 'fine avail-state' });
      const paint = () => {
        yes.classList.toggle('on', p.available === true); yes.setAttribute('aria-pressed', String(p.available === true));
        no.classList.toggle('on', p.available === false); no.setAttribute('aria-pressed', String(p.available === false));
        state.textContent = STATE[String(p.available)];
        clear.hidden = p.available === null;
        preview();
      };
      const set = async (value) => {
        if (value === p.available) return;
        for (const b of [yes, no, clear]) b.disabled = true;
        try {
          await api('/staff/pricing', { plans: { [id]: { available: value } } });
          p.available = value;
          lastChange.textContent = 'Last changed ' + when(new Date().toISOString()) + ' by ' + S.me.name + '.';
          lastChange.hidden = false;
          availMsg.className = 'msg ok';
          availMsg.textContent = value === null ? p.name + ' no longer shows availability on the site.'
            : p.name + ' now shows as ' + (value ? 'available' : 'unavailable') + ' on the site.';
        } catch (e) {
          availMsg.className = 'msg';
          availMsg.textContent = e.message;
          if (e.status === 401 && e.code === 'signed_out') RW.onAuthError(e);
        } finally {
          availMsg.hidden = false;
          for (const b of [yes, no, clear]) b.disabled = false;
          paint();
        }
      };
      yes.addEventListener('click', () => set(true));
      no.addEventListener('click', () => set(false));
      clear.addEventListener('click', () => set(null));
      paint();
      return h('div', { class: 'avail-row' },
        h('div', { class: 'avail-name' }, h('strong', {}, p.name), h('span', { class: 'fine' }, p.beds)),
        h('div', { class: 'seg avail-seg', role: 'group', 'aria-label': 'Availability of ' + p.name }, yes, no),
        h('div', { class: 'avail-status' }, state, clear));
    };
    const availCard = h('div', { class: 'card stack avail-card' },
      h('div', {}, h('h3', {}, 'Availability'),
        h('p', { class: 'fine' }, 'Tap to mark each floor plan available or unavailable. It changes on the main site straight away — '
          + 'on the floor plans and in the Questions page’s answer about what is available.')),
      h('div', {}, ids.map(availRow)),
      availMsg);

    return [pageHead('Pricing & availability', 'What the main site shows for each floor plan — on the home page, the Residences page '
      + 'and the Questions page.'),
      lastChange,
      availCard,
      h('h2', { class: 'section-title' }, 'Rents'),
      h('p', { class: 'fine section-lede' }, 'Changes to rents go live when you press “Save and publish”.'),
      form];
  }

  /* ------------------------------------------------ specials and promotions */
  // "2026-12-31" -> "December 31, 2026", read as a calendar date
  const longDate = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  };
  const SPECIAL_STATUS = { on: ['chip chip-gold', 'Showing on the site'], off: ['chip chip-off', 'Off'],
    ended: ['chip chip-off', 'Ended — past its end date'] };

  async function specialsView() {
    const d = await api('/staff/specials');
    const planName = {};
    for (const p of d.plans) planName[p.id] = p.name;
    const appliesTo = (ids) => (ids.length >= d.plans.length ? 'All floor plans' : ids.map((id) => planName[id]).join(' & '));
    const countEl = h('span', { class: 'fine' });
    const recount = () => {
      const showing = d.specials.filter((x) => x.status === 'on').length;
      countEl.textContent = d.specials.length ? showing + ' of ' + d.specials.length + ' showing on the site' : '';
    };

    // the form at the top: add a special, or edit the one chosen below
    const specialForm = (x) => {
      const editing = !!x;
      x = x || { title: '', details: '', fine_print: '', plans: d.plans.map((p) => p.id), ends_on: '' };
      const details = textarea('details', { maxlength: 400, rows: 3,
        placeholder: 'Sign a 12-month lease by December 31 and your first full month is free.' });
      const fine = textarea('fine_print', { maxlength: 300, rows: 2, placeholder: 'New residents only. Cannot be combined with other offers.' });
      details.value = x.details; fine.value = x.fine_print;
      const form = h('form', { class: 'card stack' + (editing ? ' card-accent' : ''), novalidate: true },
        h('h3', {}, editing ? 'Edit “' + x.title + '”' : 'Add a special'),
        field('Headline', input('title', { value: x.title, maxlength: 80, required: true, autocomplete: 'off',
          placeholder: 'First month free' })),
        field('Details (optional)', details),
        field('Fine print (optional)', fine, 'Shown in small type under the special.'),
        h('fieldset', { class: 'group' }, h('legend', { class: 'field-label' }, 'Applies to'),
          h('div', { class: 'checks' }, d.plans.map((p) => check('plan_' + p.id, p.name, x.plans.includes(p.id))))),
        h('div', { class: 'cols' },
          field('Ends on (optional)', input('ends_on', { type: 'date', value: x.ends_on }),
            'It comes off the site by itself after this day. Leave it blank to keep it up until you switch it off.')),
        editing ? null : check('active', 'Show it on the site as soon as it is added', true),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', type: 'submit' }, editing ? 'Save changes' : 'Add special'),
          editing ? h('button', { class: 'link-btn', type: 'button', onclick: () => { S.editSpecial = null; route(); } }, 'Cancel') : null),
        h('p', { class: 'msg', role: 'alert', hidden: true }));
      onSubmit(form, async (v) => {
        const body = { title: v.title, details: v.details, fine_print: v.fine_print, ends_on: v.ends_on,
          plans: d.plans.filter((p) => v['plan_' + p.id] === 'on').map((p) => p.id) };
        if (!editing) body.active = v.active === 'on';
        const out = await api(editing ? '/staff/specials/' + x.id : '/staff/specials', body);
        S.editSpecial = null;
        flash = out.status === 'ended' ? 'Saved, but its end date has already passed, so it is not on the site.'
          : editing ? (out.status === 'on' ? 'Saved — the site shows the change now.' : 'Saved.')
          : out.status === 'on' ? 'Added — it is on the site now.' : 'Added. It is switched off, so it is not on the site yet.';
        route();
      });
      return form;
    };

    // one card per special, with its on/off toggle (saved the moment it is tapped)
    const specialCard = (x) => {
      const chipEl = h('span', {});
      const on = h('button', { type: 'button' }, 'On');
      const off = h('button', { type: 'button' }, 'Off');
      const msg = h('p', { class: 'msg', role: 'status', hidden: true });
      const card = h('div', { class: 'card stack special-card' },
        h('div', { class: 'special-top' },
          h('div', { class: 'special-name' }, h('h3', {}, x.title),
            h('p', { class: 'fine' }, appliesTo(x.plans) + ' · ' + (x.ends_on ? 'ends ' + longDate(x.ends_on) : 'no end date'))),
          h('div', { class: 'special-toggle' },
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Show “' + x.title + '” on the site' }, on, off), chipEl)),
        x.details ? h('p', { class: 'pre' }, x.details) : null,
        x.fine_print ? h('p', { class: 'fine pre' }, x.fine_print) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'link-btn', type: 'button', onclick: () => { S.editSpecial = x.id; route(); window.scrollTo({ top: 0 }); } }, 'Edit'),
          h('button', { class: 'link-btn', type: 'button', onclick: async () => {
            if (!window.confirm('Delete “' + x.title + '”? It comes off the site and cannot be brought back. (To pause it, switch it off instead.)')) return;
            try { await api('/staff/specials/' + x.id + '/delete', {}); flash = 'Deleted “' + x.title + '”.'; } catch (e) { flash = e.message; }
            if (S.editSpecial === x.id) S.editSpecial = null;
            route();
          } }, 'Delete')),
        msg);
      const paint = () => {
        on.classList.toggle('on', !!x.active); on.setAttribute('aria-pressed', String(!!x.active));
        off.classList.toggle('on', !x.active); off.setAttribute('aria-pressed', String(!x.active));
        chipEl.className = SPECIAL_STATUS[x.status][0];
        chipEl.textContent = SPECIAL_STATUS[x.status][1];
        card.classList.toggle('card-accent', x.status === 'on');
      };
      const set = async (active) => {
        if (active === !!x.active) return;
        on.disabled = off.disabled = true;
        try {
          const out = await api('/staff/specials/' + x.id, { active: active });
          x.active = active; x.status = out.status;
          msg.className = 'msg ok';
          msg.textContent = out.status === 'on' ? 'It is on the site now.'
            : out.status === 'ended' ? 'Switched on, but its end date has passed, so it is not showing. Edit the end date to show it again.'
            : 'Taken off the site.';
        } catch (e) {
          msg.className = 'msg';
          msg.textContent = e.message;
          if (e.status === 401 && e.code === 'signed_out') RW.onAuthError(e);
        } finally {
          msg.hidden = false;
          on.disabled = off.disabled = false;
          paint();
          recount();
        }
      };
      on.addEventListener('click', () => set(true));
      off.addEventListener('click', () => set(false));
      paint();
      return card;
    };

    const editing = d.specials.find((x) => x.id === S.editSpecial);
    recount();
    return [
      pageHead('Specials', 'Rent specials and promotions for the main site. Each one that is switched on appears in a '
        + '“Specials & promotions” section on the home and Residences pages, and on the floor plans it applies to.',
        h('a', { class: 'btn btn-sm btn-ghost', href: '/#specials', target: '_blank', rel: 'noopener' }, 'Open the main site')),
      specialForm(editing),
      h('div', { class: 'card-head section-gap' }, h('h2', {}, 'Your specials'), countEl),
      d.specials.length ? h('div', {}, d.specials.map(specialCard))
        : h('div', { class: 'empty' }, 'No specials yet. Add one above — it shows on the site as soon as it is switched on.'),
    ];
  }

  /* --------------------------------------------------------------- settings */
  async function settingsView() {
    const s = await api('/staff/settings');
    const form = h('form', { class: 'card stack' }, h('h3', {}, 'Email notifications'),
      field('Office address', input('office_email', { type: 'email', value: s.office_email, autocapitalize: 'none' }),
        'Where “new maintenance request” notices are sent.'),
      field('Send from', input('mail_from', { value: s.mail_from, placeholder: 'Ridgewood Apartments <maintenance@ridgewoodapartments.org>' }),
        'The name and address residents see. It has to be an address on a domain the email service has verified.'),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Save settings'));
    onSubmit(form, async (v) => {
      await api('/staff/settings', { office_email: v.office_email, mail_from: v.mail_from });
      flash = 'Settings saved.'; route();
    });
    const status = s.delivery_on ? 'Notifications are sent and recorded in the email log.'
      : s.provider_key_set ? 'An email service is connected, but there is no “send from” address yet — add one below to start sending.'
      : 'Every notification is still recorded in the email log, but nothing is sent until an email service key is added to the site in Cloudflare.';
    const accounts = h('form', { class: 'card stack' }, h('h3', {}, 'Resident accounts'),
      choices('signup_mode', [
        ['approval', 'Residents create their own account, and staff approve it',
          'A new account cannot sign in until a manager approves it under Residents.'],
        ['open', 'Residents create their own account and can use it straight away',
          'Nobody checks first, so anyone who finds the page can sign up as a resident of any apartment.'],
        ['off', 'Only staff create resident accounts', 'The “Create an account” option is hidden from the resident portal.'],
      ], s.signup_mode),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Save'));
    onSubmit(accounts, async (v) => {
      await api('/staff/settings', { signup_mode: v.signup_mode });
      flash = 'Resident account setting saved.'; route();
    });
    return [pageHead('Settings'), accounts,
      h('p', { class: 'notice notice-gap' }, h('strong', {}, s.delivery_on ? 'Email is on. ' : 'Email is off. '), status), form];
  }

  async function accountView() {
    const form = h('form', { class: 'card stack' }, h('h3', {}, 'Change your password'), passwordFields(),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Change password'));
    onSubmit(form, async (v, f) => { await changePassword(v); f.reset(); return 'Password changed. Your other devices have been signed out.'; });
    return [pageHead('My account'),
      h('div', { class: 'card' }, h('dl', { class: 'kv' },
        h('dt', {}, 'Name'), h('dd', {}, S.me.name), h('dt', {}, 'Email'), h('dd', {}, S.me.email),
        h('dt', {}, 'Role'), h('dd', {}, isManager() ? 'Manager' : 'Maintenance technician'))),
      form];
  }

  boot();
})();
