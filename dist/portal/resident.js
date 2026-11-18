/* The resident side of the portal: sign in, ask for maintenance, follow it. */
(function () {
  'use strict';
  const { api, h, when, day, field, input, password, textarea, select, check, choices, onSubmit, chip, urgencyChip, tel, OFFICE } = window.RW;
  const app = document.getElementById('app');
  const who = document.getElementById('who');
  let flash = '';

  const URGENCY = [
    ['routine', 'Routine', 'It can wait for the next regular visit.'],
    ['soon', 'Soon', 'It is getting in the way of daily life.'],
    ['urgent', 'Urgent', 'It could cause damage or cannot be lived with.'],
  ];

  RW.onAuthError = function () { signIn('Your session has ended. Please sign in again.'); };

  async function boot() {
    try {
      dashboard(await api('/me'));
    } catch (e) {
      if (e.status === 401) signIn();
      else problem(e);
    }
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
  function dashboard(data) {
    const r = data.resident;
    who.replaceChildren(
      h('span', { class: 'who' }, r.name, h('small', {}, 'Apartment ' + r.unit)),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: signOut }, 'Sign out'));

    const open = data.requests.filter((q) => q.open);
    const closed = data.requests.filter((q) => !q.open);

    app.replaceChildren(...[
      h('div', { class: 'hello' },
        h('div', {},
          h('p', { class: 'label label-gold' }, 'Resident Portal'),
          h('h1', {}, 'Welcome, ' + r.name.split(' ')[0]),
          h('p', { class: 'lede' }, 'Apartment ' + r.unit + (r.building ? ' · ' + r.building + ' Wilson Ave' : '')))),
      h('p', { class: 'notice' },
        h('strong', {}, 'If it cannot wait: '),
        'for fire, a gas smell or immediate danger, call 911. For anything else urgent, call the leasing office at ', tel(OFFICE),
        ' as well as sending a request — this page is not watched around the clock.'),
      flash ? h('p', { class: 'notice', role: 'status' }, flash) : null,
      r.has_password ? null : h('p', { class: 'notice' },
        h('strong', {}, 'Your password is still your apartment number. '),
        'Choose one of your own under “Change your password” below.'),
      h('div', { class: 'two' },
        h('div', {}, requestForm(data), contactCard(r), passwordCard(r)),
        h('section', { 'aria-label': 'Your requests' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Your requests'),
            h('span', { class: 'fine' }, open.length ? open.length + ' open' : 'Nothing open')),
          data.requests.length === 0
            ? h('div', { class: 'empty' }, 'You have not sent any requests yet. When you do, you can follow them here.')
            : [open.map(requestCard),
              closed.length ? h('details', { class: 'more', open: open.length === 0 },
                h('summary', {}, closed.length + (closed.length === 1 ? ' closed request' : ' closed requests')),
                closed.map(requestCard)) : null])),
    ].filter(Boolean));
    flash = '';
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
  function openContact() {
    const d = document.getElementById('contactDetails');
    if (!d) return;
    d.open = true;
    d.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = d.querySelector('input');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 300);
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
    signIn('You are signed out.');
  }

  boot();
})();
