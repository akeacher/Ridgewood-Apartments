/* The resident side of the portal: sign in, then three tabs — the community
   board (the landing page), maintenance requests, and the resident's account. */
(function () {
  'use strict';
  const { api, h, when, day, field, input, password, textarea, select, check, choices, onSubmit, chip, urgencyChip, tel, OFFICE } = window.RW;
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  let flash = '';
  let me = null;          // the signed-in resident and their requests (/me)
  let board = null;       // the community board, fetched alongside /me
  let main = null;        // the area beside the menu that each tab fills
  let painted = '';
  let wantContact = false;

  const URGENCY = [
    ['routine', 'Routine', 'It can wait for the next regular visit.'],
    ['soon', 'Soon', 'It is getting in the way of daily life.'],
    ['urgent', 'Urgent', 'It could cause damage or cannot be lived with.'],
  ];

  RW.onAuthError = function () { me = null; main = null; signIn('Your session has ended. Please sign in again.'); };

  // load (or reload, after a change) everything the tabs show, then draw the current tab
  async function boot() {
    try {
      [me, board] = await Promise.all([api('/me'), api('/community')]);
    } catch (e) {
      me = null; main = null;
      if (e.status === 401) signIn();
      else problem(e);
      return;
    }
    if (!main || !main.isConnected) shell();
    paintWho();
    route();
  }

  function problem(e) {
    who.replaceChildren();
    app.replaceChildren(h('div', { class: 'card card-narrow stack' },
      h('p', { class: 'label label-gold' }, 'Resident Portal'),
      h('h1', {}, e.code === 'no_db' ? 'Opening soon' : 'We hit a snag'),
      h('p', {}, e.code === 'no_db'
        ? 'The resident portal is not switched on yet. Until it is, please call the leasing office with any maintenance request.'
        : e.message),
      h('p', {}, 'Leasing office: ', tel(OFFICE)),
      e.code === 'no_db' ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: boot }, 'Try again')));
  }

  /* ------------------------------------------------------------- sign in */
  function signIn(notice) {
    who.replaceChildren();
    const form = h('form', { class: 'card card-narrow stack', novalidate: true },
      h('div', {},
        h('p', { class: 'label label-gold' }, 'Resident Portal'),
        h('h1', {}, 'Sign in'),
        h('p', { class: 'lede' }, 'Request maintenance for your apartment and follow its progress.')),
      notice ? h('p', { class: 'msg' }, notice) : null,
      field('Email address', input('email', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true })),
      field('Phone number', input('phone', { type: 'tel', autocomplete: 'tel', required: true })),
      field('Apartment number', input('unit', { autocomplete: 'off', autocapitalize: 'characters', required: true })),
      field('Password', password('password', { autocomplete: 'current-password', required: true }),
        'The one you chose when you created your account, or the one the leasing office gave you.'),
      h('button', { class: 'btn', type: 'submit' }, 'Sign in'),
      h('p', { class: 'msg', role: 'alert', hidden: true }),
      h('p', { class: 'fine' }, 'Use the same email address, phone number and apartment number as on your account. Trouble signing in? Call ', tel(OFFICE), '.'));
    onSubmit(form, async (v) => {
      await api('/login', { email: v.email, phone: v.phone, unit: v.unit, password: v.password });
      await boot();
    });
    app.replaceChildren(form);
    form.querySelector('input').focus();
    // offered only while the office allows residents to create accounts
    api('/signup').then((info) => {
      if (info.mode === 'off' || !form.isConnected) return;
      form.querySelector('.lede').after(h('p', { class: 'fine' }, 'New to the portal? ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => signUp(info.mode) }, 'Create an account')));
      form.after(h('div', { class: 'card card-narrow under-card' },
        h('p', {}, h('strong', {}, 'New to the portal? '), 'Residents can create their own account.'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => signUp(info.mode) }, 'Create an account')));
    }).catch(() => { /* the sign-in form works without it */ });
  }

  /* ------------------------------------------------------ create an account */
  function signUp(mode) {
    who.replaceChildren();
    const form = h('form', { class: 'card card-narrow stack', novalidate: true },
      h('div', {},
        h('p', { class: 'label label-gold' }, 'Resident Portal'),
        h('h1', {}, 'Create your account'),
        h('p', { class: 'lede' }, mode === 'approval'
          ? 'For Ridgewood residents. The leasing office confirms each new account before it can be used.'
          : 'For Ridgewood residents. It takes a minute.')),
      field('Full name', input('name', { autocomplete: 'name', required: true, maxlength: 80 })),
      field('Email address', input('email', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true })),
      field('Phone number', input('phone', { type: 'tel', autocomplete: 'tel', required: true })),
      h('div', { class: 'cols' },
        field('Apartment number', input('unit', { autocomplete: 'off', autocapitalize: 'characters', required: true, maxlength: 12 })),
        field('Building', select('building', [['', 'Choose…'], ['1871', '1871 Wilson Ave'], ['1885', '1885 Wilson Ave']], ''))),
      field('Choose a password', password('password', { autocomplete: 'new-password', required: true }), 'At least 8 characters.'),
      field('Password again', password('again', { autocomplete: 'new-password', required: true })),
      h('button', { class: 'btn', type: 'submit' }, 'Create account'),
      h('p', { class: 'msg', role: 'alert', hidden: true }),
      h('p', { class: 'fine' }, 'You will sign in with this email address, phone number, apartment number and password. ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => signIn() }, 'I already have an account')));
    onSubmit(form, async (v) => {
      if (v.password !== v.again) throw new Error('The two passwords do not match.');
      const made = await api('/signup', { name: v.name, email: v.email, phone: v.phone, unit: v.unit, building: v.building, password: v.password });
      if (!made.pending) {
        flash = 'Welcome — your account is ready.';
        return boot();
      }
      app.replaceChildren(h('div', { class: 'card card-narrow stack' },
        h('p', { class: 'label label-gold' }, 'Resident Portal'),
        h('h1', {}, 'Thank you, ' + v.name.trim().split(' ')[0]),
        h('p', {}, 'Your account has been created. The leasing office confirms each new account, and you will be able to sign in as soon as they have.'),
        h('p', {}, 'If your request cannot wait, call the leasing office at ', tel(OFFICE), '.'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => signIn() }, 'Back to sign in')));
      window.scrollTo({ top: 0 });
    });
    app.replaceChildren(form);
    form.querySelector('input').focus();
    window.scrollTo({ top: 0 });
  }

  /* ----------------------------------------------------------- dashboard */
  /* --------------------------------------------------- menu and the tabs */
  const TABS = [['community', 'Community'], ['maintenance', 'Maintenance'], ['account', 'My account']];
  function paintWho() {
    const r = me.resident;
    who.replaceChildren(
      h('span', { class: 'who' }, r.name, h('small', {}, 'Apartment ' + r.unit)),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: signOut }, 'Sign out'));
  }
  function shell() {
    main = h('section', { id: 'main' });
    app.replaceChildren(h('div', { class: 'staff-shell' },
      h('nav', { class: 'side', 'aria-label': 'Resident portal' },
        TABS.map((t) => h('a', { href: '#/' + t[0], 'data-nav': t[0] }, t[1]))),
      main));
  }
  function navCount(tab, n, title) {
    const link = app.querySelector('.side a[data-nav="' + tab + '"]');
    const label = TABS.find((t) => t[0] === tab)[1];
    if (link) link.replaceChildren(label, n ? h('span', { class: 'nav-count', title: title }, n) : '');
  }
  function route() {
    if (!me || !main) return;
    const asked = location.hash.replace(/^#\/?/, '').split('/')[0];
    const tab = TABS.some((t) => t[0] === asked) ? asked : 'community';
    for (const a of app.querySelectorAll('.side a')) a.classList.toggle('on', a.getAttribute('data-nav') === tab);
    const nodes = tab === 'maintenance' ? maintenanceView() : tab === 'account' ? accountView() : communityView();
    main.replaceChildren(...[flash ? h('p', { class: 'notice', role: 'status' }, flash) : null].concat(nodes).filter(Boolean));
    if (tab !== painted || flash) window.scrollTo({ top: 0 });
    flash = ''; painted = tab;
    const open = me.requests.filter((q) => q.open).length;
    navCount('maintenance', open, open === 1 ? '1 open request' : open + ' open requests');
    navCount('community', tab === 'community' ? 0 : unseenPosts(), 'New on the board');
    if (tab === 'account' && wantContact) {
      wantContact = false;
      setTimeout(() => {
        const d = document.getElementById('contactDetails');
        if (!d) return;
        d.open = true;
        d.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        const first = d.querySelector('input');
        if (first) first.focus({ preventScroll: true });
      }, 50);
    }
  }
  window.addEventListener('hashchange', route);

  // which posts are new to this resident on this device (a convenience only:
  // if the browser forgets, nothing is marked new)
  const seenKey = () => 'rw_board_seen:' + me.resident.email;
  function readSeen() {
    try { const v = window.localStorage.getItem(seenKey()); return v === null ? null : Number(v); } catch (e) { return null; }
  }
  function writeSeen(id) {
    try { window.localStorage.setItem(seenKey(), String(id)); } catch (e) { /* private browsing: fine */ }
  }
  function unseenPosts() {
    const seen = readSeen();
    return seen === null ? 0 : board.posts.filter((x) => x.id > seen).length;
  }

  // "2026-11-25T09:00" is a Saint Paul wall-clock time; read it as one
  function localTime(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  function localDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const longDay = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // "Today", "Tomorrow", or "Tuesday, November 25", against Saint Paul's today
  function dayName(dateStr) {
    const d = localDate(dateStr), t = localDate(board.today);
    const diff = Math.round((d - t) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : longDay(d);
  }
  function timeRange(start, end) {
    const a = localTime(start), b = localTime(end);
    if (!a) return '';
    if (!b) return dayName(start) + ' at ' + clock(a);
    if (start.slice(0, 10) === end.slice(0, 10)) return dayName(start) + ' · ' + clock(a) + ' – ' + clock(b);
    return dayName(start) + ', ' + clock(a) + ' – ' + dayName(end) + ', ' + clock(b);
  }
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ------------------------------------------------- community (landing) */
  let boardFilter = 'all';
  function communityView() {
    const r = me.resident, d = board, cats = d.categories;
    const seen = readSeen();
    const isNew = (x) => seen !== null && x.id > seen;
    const newest = d.posts.reduce((n, x) => Math.max(n, x.id), seen || 0);
    writeSeen(newest);

    // coming up: anything with a time on the board, and the next pickups
    const coming = d.posts.filter((x) => x.starts_at).map((x) => ({ sort: x.starts_at, day: x.starts_at.slice(0, 10),
      what: x.title, kind: cats[x.category], detail: timeRange(x.starts_at, x.ends_at), building: x.building }))
      .concat(d.collection.items.filter((x) => x.next.length).map((x) => ({ sort: x.next[0] + 'T00:00', day: x.next[0],
        what: x.what + ' pickup', kind: 'Trash & recycling', detail: dayName(x.next[0]) + (x.put_out ? ' · ' + x.put_out : ''), building: '' })))
      .sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 6);

    const posts = d.posts;
    const present = Object.keys(cats).filter((k) => posts.some((x) => x.category === k));
    if (boardFilter !== 'all' && !present.includes(boardFilter)) boardFilter = 'all';
    const list = h('div', { class: 'board-list' });
    const paintList = () => {
      const shown = posts.filter((x) => !x.pinned && (boardFilter === 'all' || x.category === boardFilter));
      list.replaceChildren(...(shown.length ? shown.map((x) => postCard(x, cats, isNew(x)))
        : [h('div', { class: 'empty' }, posts.length ? 'Nothing else under this heading right now.'
          : 'No notices right now. Building news, water shutoffs and community updates from the office will appear here.')]));
    };
    const filters = present.length > 1 ? h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Show' },
      [['all', 'Everything']].concat(present.map((k) => [k, cats[k]])).map((f) => {
        const b = h('button', { type: 'button', class: boardFilter === f[0] ? 'on' : '', 'aria-pressed': String(boardFilter === f[0]) }, f[1]);
        b.addEventListener('click', () => {
          boardFilter = f[0];
          for (const x of b.parentNode.children) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
          paintList();
        });
        return b;
      })) : null;
    paintList();

    const pinned = posts.filter((x) => x.pinned);
    return [
      h('div', { class: 'hello' },
        h('div', {},
          h('p', { class: 'label label-gold' }, 'Ridgewood Community'),
          h('h1', {}, 'Welcome, ' + r.name.split(' ')[0]),
          h('p', { class: 'lede' }, 'Apartment ' + r.unit + (r.building ? ' · ' + r.building + ' Wilson Ave' : ''))),
        h('a', { class: 'btn btn-sm', href: '#/maintenance' }, 'Request maintenance')),
      r.has_password ? null : h('p', { class: 'notice' }, h('strong', {}, 'Your password is still your apartment number. '),
        'Choose one of your own under ', h('a', { href: '#/account' }, 'My account'), '.'),
      h('div', { class: 'community' },
        h('div', {},
          coming.length ? h('section', { class: 'card coming-card', 'aria-label': 'Coming up' }, h('h2', {}, 'Coming up'),
            h('ul', { class: 'coming' }, coming.map((c) => {
              const dd = localDate(c.day);
              return h('li', {},
                h('span', { class: 'coming-date' }, h('strong', {}, dd.toLocaleDateString('en-US', { weekday: 'short' })),
                  dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                h('span', {}, h('span', { class: 'post-cat' }, c.kind), h('span', { class: 'coming-what' }, c.what),
                  h('span', { class: 'fine' }, c.detail + (c.building ? ' · ' + c.building + ' Wilson only' : ''))));
            }))) : null,
          pinned.map((x) => postCard(x, cats, isNew(x))),
          h('div', { class: 'card-head board-head' }, h('h2', {}, 'Community board'),
            h('span', { class: 'fine' }, posts.length ? posts.length + (posts.length === 1 ? ' post' : ' posts') : '')),
          filters, list),
        h('aside', {}, pickupCard(d.collection), officeCard())),
    ];
  }

  function postCard(x, cats, fresh) {
    return h('article', { class: 'post' + (x.pinned ? ' post-pinned' : '') },
      h('div', { class: 'post-top' }, h('span', { class: 'post-cat' }, cats[x.category] || 'Notice'),
        x.pinned ? h('span', { class: 'chip chip-goldline' }, 'Pinned') : null,
        fresh ? h('span', { class: 'chip chip-gold' }, 'New') : null,
        x.building ? h('span', { class: 'fine' }, x.building + ' Wilson only') : null),
      h('h3', {}, x.title),
      x.starts_at ? h('p', { class: 'post-when' }, timeRange(x.starts_at, x.ends_at)) : null,
      x.body ? h('p', { class: 'pre post-body' }, x.body) : null,
      h('p', { class: 'fine post-date' }, 'Posted ' + day(x.created_at)
        + (x.updated_at && x.updated_at.slice(0, 10) !== x.created_at.slice(0, 10) ? ' · updated ' + day(x.updated_at) : '')));
  }

  function pickupCard(col) {
    return h('section', { class: 'card stack' }, h('h3', {}, 'Trash & recycling'),
      col.items.length ? h('div', {}, col.items.map((x) => h('div', { class: 'pickup' },
        h('p', {}, h('strong', {}, x.what), ' — ' + (x.every === 2 ? 'every other ' : 'every ') + WEEKDAYS[x.weekday]),
        x.next.length ? h('p', { class: 'fine' }, 'Next: ' + dayName(x.next[0]) + (x.put_out ? ' · ' + x.put_out : '')) : null,
        x.notes ? h('p', { class: 'fine' }, x.notes) : null)))
        : h('p', { class: 'muted' }, 'The pickup schedule has not been posted yet.'),
      col.reminder ? h('p', { class: 'reminder pre' }, col.reminder) : null);
  }

  function officeCard() {
    return h('section', { class: 'card stack' }, h('h3', {}, 'Leasing office'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Phone'), h('dd', {}, tel(OFFICE)),
        h('dt', {}, 'Hours'), h('dd', {}, 'Monday – Friday, 1 – 5 pm'),
        h('dt', {}, 'Address'), h('dd', {}, '1871 & 1885 Wilson Ave, Saint Paul')),
      h('p', { class: 'fine' }, h('strong', {}, 'Fire, a gas smell or danger: call 911. '),
        'For other urgent problems, call the office as well as sending a request.'));
  }

  /* ------------------------------------------------------- maintenance */
  function maintenanceView() {
    const data = me;
    const open = data.requests.filter((q) => q.open);
    const closed = data.requests.filter((q) => !q.open);
    return [
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Maintenance'),
        h('p', {}, 'Send a request and follow it here until it is done.'))),
      h('p', { class: 'notice' },
        h('strong', {}, 'If it cannot wait: '),
        'for fire, a gas smell or immediate danger, call 911. For anything else urgent, call the leasing office at ', tel(OFFICE),
        ' as well as sending a request — this page is not watched around the clock.'),
      h('div', { class: 'two' },
        requestForm(data),
        h('section', { 'aria-label': 'Your requests' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Your requests'),
            h('span', { class: 'fine' }, open.length ? open.length + ' open' : 'Nothing open')),
          data.requests.length === 0
            ? h('div', { class: 'empty' }, 'You have not sent any requests yet. When you do, you can follow them here.')
            : [open.map(requestCard),
              closed.length ? h('details', { class: 'more', open: open.length === 0 },
                h('summary', {}, closed.length + (closed.length === 1 ? ' closed request' : ' closed requests')),
                closed.map(requestCard)) : null])),
    ];
  }

  /* ---------------------------------------------------------- my account */
  function accountView() {
    const r = me.resident;
    return [
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My account'),
        h('p', {}, r.name + ' · Apartment ' + r.unit + (r.building ? ' · ' + r.building + ' Wilson Ave' : '')))),
      r.has_password ? null : h('p', { class: 'notice' },
        h('strong', {}, 'Your password is still your apartment number. '),
        'Choose one of your own under “Change your password” below.'),
      h('div', { class: 'account-cols' }, contactCard(r), passwordCard(r)),
    ];
  }

  function passwordCard(r) {
    const form = h('form', { class: 'stack' },
      field('Current password', password('current', { autocomplete: 'current-password', required: true }),
        r.has_password ? null : 'Your apartment number, until you change it here.'),
      field('New password', password('next', { autocomplete: 'new-password', required: true }), 'At least 8 characters.'),
      field('New password again', password('again', { autocomplete: 'new-password', required: true })),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Change password'),
      h('p', { class: 'msg', role: 'alert', hidden: true }));
    onSubmit(form, async (v) => {
      if (v.next !== v.again) throw new Error('The two new passwords do not match.');
      await api('/password', { current: v.current, next: v.next });
      flash = 'Your password has been changed.';
      await boot();
      window.scrollTo({ top: 0 });
    });
    return h('div', { class: 'card' }, h('details', { class: 'more flush' }, h('summary', {}, 'Change your password'), form));
  }

  // jump to the contact details card and open its form
  // the contact details live under My account; go there with the form open
  function openContact() {
    wantContact = true;
    if (location.hash === '#/account') route(); else location.hash = '#/account';
  }

  function contactCard(r) {
    const emergency = [r.emergency_name, r.emergency_phone].filter(Boolean).join(' · ');
    const form = h('form', { class: 'stack', novalidate: true },
      field('Email address', input('email', { type: 'email', value: r.email, autocomplete: 'email', inputmode: 'email',
        autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 200 })),
      field('Phone number', input('phone', { type: 'tel', value: r.phone, autocomplete: 'tel', required: true, maxlength: 30 })),
      field('Second phone (optional)', input('alt_phone', { type: 'tel', value: r.alt_phone, autocomplete: 'off', maxlength: 30 }),
        'A work number, or another way to reach you.'),
      h('fieldset', { class: 'group' }, h('legend', { class: 'field-label' }, 'Emergency contact (optional)'),
        h('div', { class: 'cols' },
          field('Name', input('emergency_name', { value: r.emergency_name, autocomplete: 'off', maxlength: 80,
            placeholder: 'Name and relationship' })),
          field('Phone', input('emergency_phone', { type: 'tel', value: r.emergency_phone, autocomplete: 'off', maxlength: 30 })))),
      field('Current password', password('password', { autocomplete: 'current-password', required: true }), 'To confirm it is you.'),
      h('p', { class: 'fine' }, 'You sign in with your email address and phone number, so if you change either one, '
        + 'use the new one the next time you sign in.'),
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Save contact details'),
      h('p', { class: 'msg', role: 'alert', hidden: true }));
    onSubmit(form, async (v) => {
      const out = await api('/me/contact', { email: v.email, phone: v.phone, alt_phone: v.alt_phone,
        emergency_name: v.emergency_name, emergency_phone: v.emergency_phone, password: v.password });
      flash = !out.changed ? 'Your contact details were already up to date.'
        : out.sign_in_changed ? 'Thank you — your contact details are updated. Next time you sign in, use your new email address and phone number.'
        : 'Thank you — your contact details are updated.';
      await boot();
      window.scrollTo({ top: 0 });
    });
    return h('div', { class: 'card stack' },
      h('div', { class: 'card-head flush-head' }, h('h3', {}, 'Your contact details'),
        r.contact_updated_at ? h('span', { class: 'fine' }, 'Updated ' + day(r.contact_updated_at)) : null),
      h('p', { class: 'fine' }, 'How the office and maintenance reach you. Please keep it current.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Email'), h('dd', {}, r.email),
        h('dt', {}, 'Phone'), h('dd', {}, r.phone),
        h('dt', {}, 'Second phone'), h('dd', {}, r.alt_phone || '—'),
        h('dt', {}, 'Emergency'), h('dd', {}, emergency || '—')),
      h('details', { class: 'more', id: 'contactDetails' }, h('summary', {}, 'Update your contact details'), form));
  }

  function requestForm(data) {
    const r = data.resident;
    const form = h('form', { class: 'card stack', novalidate: true },
      h('div', {}, h('h2', {}, 'New maintenance request'),
        h('p', { class: 'lede' }, 'Tell us what is wrong and we will take it from there.')),
      field('What needs attention?', select('category', [['', 'Choose one…']].concat(data.categories.map((c) => [c, c])), '')),
      field('Where is it?', input('location', { maxlength: 120, placeholder: 'Kitchen, bathroom, hallway…' })),
      field('What is happening?', textarea('description', { maxlength: 4000, required: true,
        placeholder: 'Describe the problem — what you see, hear or smell, and when it started.' })),
      h('div', {}, h('span', { class: 'field-label' }, 'How soon?'), choices('urgency', URGENCY, 'routine')),
      check('permission_to_enter', 'Maintenance may enter my apartment to make this repair if I am not home.', true),
      field('Anything we should know before coming in?', input('entry_notes', { maxlength: 500, placeholder: 'Best times, where to find it… (optional)' })),
      h('div', {}, h('span', { class: 'field-label' }, 'We will contact you at'),
        h('p', {}, r.phone + ' · ' + r.email),
        h('p', { class: 'fine' }, 'Out of date? ',
          h('button', { class: 'link-btn', type: 'button', onclick: openContact }, 'Update your contact details'), '.')),
      h('button', { class: 'btn', type: 'submit' }, 'Send request'),
      h('p', { class: 'msg', role: 'alert', hidden: true }));
    onSubmit(form, async (v) => {
      const done = await api('/requests', { category: v.category, location: v.location, description: v.description,
        urgency: v.urgency, permission_to_enter: v.permission_to_enter === 'on', entry_notes: v.entry_notes });
      flash = 'Thank you — request ' + done.ref + ' has reached the maintenance team.';
      await boot();
      window.scrollTo({ top: 0 });
    });
    return form;
  }

  function requestCard(q) {
    const card = h('article', { class: 'req' },
      h('div', { class: 'req-top' }, h('span', { class: 'ref' }, q.ref), chip(q.status, q.status_label), urgencyChip(q.urgency)),
      h('h3', {}, q.category + (q.location ? ' — ' + q.location : '')),
      h('p', { class: 'when' }, 'Sent ' + when(q.created_at) + (q.completed_at ? ' · Completed ' + day(q.completed_at) : '')),
      h('p', { class: 'req-body pre' }, q.description),
      h('p', { class: 'fine' }, q.permission_to_enter ? 'Maintenance may enter if you are not home.' : 'Maintenance will arrange a time with you before entering.',
        q.entry_notes ? ' Note: ' + q.entry_notes : ''),
      q.updates.length ? h('ul', { class: 'tl' }, q.updates.map((u) => h('li', {},
        h('div', { class: 'tl-head' }, h('strong', {}, u.from), h('span', {}, when(u.at))),
        h('p', { class: 'pre' }, u.body)))) : null);

    if (q.open) {
      const note = h('form', { class: 'stack' },
        field('Add a note for maintenance', textarea('body', { maxlength: 2000, required: true })),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', type: 'submit' }, 'Add note'),
          h('button', { class: 'link-btn', type: 'button', onclick: () => cancel(q) }, 'Cancel this request')),
        h('p', { class: 'msg', role: 'alert', hidden: true }));
      onSubmit(note, async (v) => {
        await api('/requests/' + q.id + '/note', { body: v.body });
        flash = 'Your note was added to ' + q.ref + '.';
        await boot();
      });
      card.append(h('details', { class: 'more' }, h('summary', {}, 'Add a note or cancel'), note));
    }
    return card;
  }

  async function cancel(q) {
    if (!window.confirm('Cancel request ' + q.ref + '? Maintenance will be told it is no longer needed.')) return;
    try {
      await api('/requests/' + q.id + '/cancel', {});
      flash = 'Request ' + q.ref + ' was cancelled.';
    } catch (e) {
      flash = e.message;
    }
    await boot();
  }

  async function signOut() {
    try { await api('/logout', {}); } catch (e) { /* signed out either way */ }
    me = null; main = null; painted = '';
    signIn('You are signed out.');
  }

  boot();
})();
