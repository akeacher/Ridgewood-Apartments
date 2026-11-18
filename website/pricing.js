/* Shows the rents and availability staff post from the staff portal
   (Pricing & availability).

   The pages carry empty, hidden slots: data-rw-price="wilson" and so on. A slot
   is filled in and shown only once staff have posted something for that floor
   plan: a rent, a note, or whether it is available. Until then, and whenever
   the portal cannot be reached, the page reads exactly as it does without this
   file.

   The site build adds this script to the pages that have a slot. It is not part
   of the artifact previews, which have no portal to ask. */
(function () {
  'use strict';
  var slots = document.querySelectorAll('[data-rw-price]');
  var list = document.querySelector('[data-rw-price-list]');
  if (!slots.length && !list) return;

  var PLANS = [['wilson', 'The Wilson', '1 bedroom'], ['battlecreek', 'The Battle Creek', '2 bedrooms'],
    ['wakefield', 'The Wakefield', '3 bedrooms']];
  var AVAILABLE = 'Available now', UNAVAILABLE = 'Currently unavailable';

  function money(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function hasAvailability(p) { return p.available === true || p.available === false; }
  // textContent throughout: a note is typed by staff and is shown as text, never as markup
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  fetch('/api/portal/pricing', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.plans) return;

      Array.prototype.forEach.call(slots, function (slot) {
        var p = data.plans[slot.getAttribute('data-rw-price')];
        if (!p || (!p.rent && !p.note && !hasAvailability(p))) return;
        slot.textContent = '';
        if (hasAvailability(p)) {
          slot.appendChild(el('span', 'rw-avail ' + (p.available ? 'rw-avail-yes' : 'rw-avail-no'),
            p.available ? AVAILABLE : UNAVAILABLE));
        }
        if (p.rent) {
          var line = el('span', 'rw-price-line');
          if (p.from) line.appendChild(el('span', 'rw-price-from', 'From'));
          line.appendChild(el('strong', 'rw-price-amount', money(p.rent)));
          line.appendChild(el('span', 'rw-price-per', 'per month'));
          slot.appendChild(line);
        }
        if (p.note) slot.appendChild(el('span', 'rw-price-note', p.note));
        slot.hidden = false;
      });

      // the Questions page: swap "call us" for what has been posted
      if (!list) return;
      var ul = list.querySelector('ul');
      var anyRent = false, anyAvailability = false;
      PLANS.forEach(function (plan) {
        var p = data.plans[plan[0]];
        if (!p || (!p.rent && !hasAvailability(p))) return;
        anyRent = anyRent || !!p.rent;
        anyAvailability = anyAvailability || hasAvailability(p);
        var parts = [plan[2]];
        if (p.rent) parts[0] += ', ' + (p.from ? 'from ' : '') + money(p.rent) + ' a month';
        if (hasAvailability(p)) parts.push(p.available ? AVAILABLE.toLowerCase() : UNAVAILABLE.toLowerCase());
        if (p.note) parts.push(p.note);
        var li = el('li');
        li.appendChild(el('strong', '', plan[1]));
        li.appendChild(document.createTextNode(' — ' + parts.join(' · ')));
        ul.appendChild(li);
      });
      if (!anyRent && !anyAvailability) return;
      var intro = list.querySelector('[data-rw-price-intro]');
      if (intro) {
        intro.textContent = anyRent && anyAvailability ? 'Current rents and availability:'
          : anyRent ? 'Current monthly rents:' : 'Current availability:';
      }
      var fallback = document.querySelector('[data-rw-price-fallback]');
      if (fallback) fallback.hidden = true;
      list.hidden = false;
      // if that answer is already open, let it grow to fit
      var wrap = list.closest('.a-wrap');
      if (wrap && wrap.style.maxHeight) wrap.style.maxHeight = wrap.scrollHeight + 'px';
    })
    .catch(function () { /* a page without prices is still a complete page */ });
})();
