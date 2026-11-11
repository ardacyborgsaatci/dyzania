// Booking in three steps: practice area, a time, your details. The times and every booking rule come from the booking
// workflow through /api/slots and /api/book; this page only shows them and collects the details. Nothing here decides
// whether a time is free.
(function () {
  'use strict';
  var kit = window.DY;
  var steps = { area: document.getElementById('step-area'), time: document.getElementById('step-time'), details: document.getElementById('step-details') };
  if (!steps.area) return;

  var result = document.getElementById('result');
  var progress = Array.prototype.slice.call(document.querySelectorAll('#progress li'));
  var areaForm = document.getElementById('area-form');
  var areaError = document.getElementById('area-error');
  var timeBox = document.getElementById('time-box');
  var timeHead = document.getElementById('time-head');
  var timeNotice = document.getElementById('time-notice');
  var toDetails = document.getElementById('to-details');
  var detailsForm = document.getElementById('details-form');
  var summaryBox = document.getElementById('chosen-summary');
  var errorSummary = document.getElementById('error-summary');
  var status = document.getElementById('form-status');
  var submit = document.getElementById('submit');
  var submitLabel = submit.textContent;
  var AREAS = ['family', 'injury', 'employment', 'estate'];

  var state = { area: '', info: null, slots: [], more: false, chosen: null, leadRef: '' };

  // ---- small formatting helpers ----
  function dayLabel(date) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  }
  function clock(hhmm) {
    var parts = hhmm.split(':');
    var h = Number(parts[0]);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + parts[1] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // ---- step switching ----
  function show(name, focus) {
    Object.keys(steps).forEach(function (key) { steps[key].hidden = key !== name; });
    result.hidden = true;
    var order = ['area', 'time', 'details'];
    progress.forEach(function (item, index) {
      var at = order.indexOf(name);
      if (index === at) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.classList.toggle('done', index < at);
    });
    if (focus !== false) kit.focusOn(document.getElementById('step-' + name + '-h'));
  }

  // ---- step 1: area ----
  function chosenArea() {
    var checked = areaForm.querySelector('input[name="area"]:checked');
    return checked ? checked.value : '';
  }
  areaForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var area = chosenArea();
    if (!area) {
      areaError.textContent = 'Choose the kind of matter first.';
      areaError.hidden = false;
      return;
    }
    areaError.hidden = true;
    state.area = area;
    state.chosen = null;
    loadTimes(false);
  });
  areaForm.addEventListener('change', function () { areaError.hidden = true; });

  // ---- step 2: times ----
  function renderTimes() {
    kit.clear(timeBox);
    var info = state.info;
    if (!state.slots.length) {
      var empty = kit.el('div', 'callout warn');
      var inner = kit.el('div');
      inner.appendChild(kit.el('p', '', 'No times are open in the next 30 days for this kind of matter.'));
      inner.appendChild(kit.el('p', '', 'Please send a message or call the office on 555-0142 during office hours, and someone will help.'));
      empty.appendChild(inner);
      timeBox.appendChild(empty);
      toDetails.hidden = true;
      return;
    }
    toDetails.hidden = false;
    var groups = [];
    state.slots.forEach(function (slot) {
      var last = groups[groups.length - 1];
      if (!last || last.date !== slot.date) { last = { date: slot.date, slots: [] }; groups.push(last); }
      last.slots.push(slot);
    });
    var fieldset = kit.el('fieldset');
    var legend = kit.el('legend', 'visually-hidden', 'Available times');
    fieldset.appendChild(legend);
    groups.forEach(function (group, index) {
      var day = kit.el('div', 'day');
      var heading = kit.el('h3', '', dayLabel(group.date));
      heading.id = 'day-' + index;
      day.appendChild(heading);
      var list = kit.el('div', 'slots');
      list.setAttribute('role', 'presentation');
      group.slots.forEach(function (slot, n) {
        var label = kit.el('label', 'slot');
        var input = kit.el('input');
        input.type = 'radio';
        input.name = 'slot';
        input.value = slot.start;
        input.id = 'slot-' + index + '-' + n;
        input.setAttribute('aria-label', dayLabel(slot.date) + ', ' + clock(slot.time));
        if (state.chosen && state.chosen.start === slot.start) input.checked = true;
        input.addEventListener('change', function () { state.chosen = slot; toDetails.disabled = false; });
        label.appendChild(input);
        label.appendChild(kit.el('span', '', clock(slot.time)));
        list.appendChild(label);
      });
      day.appendChild(list);
      fieldset.appendChild(day);
    });
    timeBox.appendChild(fieldset);
    if (state.more) {
      var more = kit.el('button', 'btn secondary small', 'Show more times');
      more.type = 'button';
      more.addEventListener('click', function () { loadTimes(true); });
      timeBox.appendChild(more);
    }
    toDetails.disabled = !state.chosen;
  }

  function showLoading() {
    kit.clear(timeBox);
    var skeleton = kit.el('div', 'skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i += 1) skeleton.appendChild(kit.el('i'));
    timeBox.appendChild(skeleton);
    timeBox.setAttribute('aria-busy', 'true');
    toDetails.hidden = true;
  }

  function loadTimes(append, notice) {
    show('time', !append);
    timeNotice.hidden = !notice;
    timeNotice.textContent = notice || '';
    if (!append) { state.slots = []; showLoading(); }
    var body = { area: state.area, limit: 24 };
    if (append && state.slots.length) body.after = state.slots[state.slots.length - 1].start;
    kit.post('/api/slots', body).then(function (response) {
      timeBox.removeAttribute('aria-busy');
      var data = response.data || {};
      if (response.status === 200 && data.ok) {
        state.info = data;
        var seen = {};
        state.slots.forEach(function (s) { seen[s.start] = true; });
        state.slots = state.slots.concat((data.slots || []).filter(function (s) { return !seen[s.start]; }));
        state.more = data.more === true;
        kit.clear(timeHead);
        timeHead.appendChild(kit.el('span', '', data.areaName + ': '));
        timeHead.appendChild(kit.el('strong', 'num', data.consultMinutes + ' minutes'));
        timeHead.appendChild(kit.el('span', '', data.fee));
        timeHead.appendChild(kit.el('span', '', 'Times are in ' + data.timezoneName + ', the firm’s local time.'));
        renderTimes();
        return;
      }
      kit.clear(timeBox);
      var box = kit.el('div', 'callout urgent');
      var inner = kit.el('div');
      var message = response.status === 429
        ? 'Too many requests from this device. Please wait a few minutes and try again.'
        : (data.error || 'We could not load the available times.');
      inner.appendChild(kit.el('p', '', message));
      var retry = kit.el('button', 'btn secondary small', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', function () { loadTimes(false); });
      inner.appendChild(retry);
      box.appendChild(inner);
      timeBox.appendChild(box);
      toDetails.hidden = true;
    });
  }

  document.getElementById('back-to-area').addEventListener('click', function () { show('area'); });
  toDetails.addEventListener('click', function () {
    if (!state.chosen) return;
    kit.clear(summaryBox);
    var p = kit.el('p');
    p.appendChild(kit.el('span', 'num', dayLabel(state.chosen.date) + ' at ' + clock(state.chosen.time)));
    p.appendChild(document.createTextNode(' (' + state.info.timezoneName + ')'));
    summaryBox.appendChild(p);
    summaryBox.appendChild(kit.el('p', 'note', state.info.areaName + ', ' + state.info.consultMinutes + ' minutes. ' + state.info.fee));
    show('details');
  });

  // ---- step 3: details ----
  var otherSide = document.getElementById('otherSide');
  var noOther = document.getElementById('noOtherSide');
  noOther.addEventListener('change', function () {
    otherSide.disabled = noOther.checked;
    if (noOther.checked) { otherSide.value = ''; kit.setError(otherSide, ''); }
  });
  document.getElementById('back-to-time').addEventListener('click', function () { show('time'); });

  function val(id) { return document.getElementById(id).value.replace(/\s+/g, ' ').trim(); }

  var checks = {
    name: function () {
      var v = val('name');
      return v.length >= 2 && v.length <= 100 && /^[\p{L}\p{M}0-9 .,'’-]+$/u.test(v) ? '' : 'Enter your name, using letters, spaces, hyphens or apostrophes.';
    },
    email: function () { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('email')) ? '' : 'Enter an email address, such as name@example.com.'; },
    phone: function () {
      var v = val('phone');
      if (!v) return '';
      var digits = v.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 && /^[0-9+()\-. ]+$/.test(v) ? '' : 'Enter a phone number with 7 to 15 digits, or leave it blank.';
    },
    otherSide: function () {
      if (noOther.checked) return '';
      var v = val('otherSide');
      if (!v) return 'Enter the other person or organization, or tick the box to say there is none.';
      return v.length <= 200 ? '' : 'Keep it under 200 characters.';
    },
    consent: function () { return document.getElementById('consent').checked ? '' : 'Tick the box to say you agree to be contacted and understand this is not legal advice.'; },
  };

  function check(id) {
    var message = checks[id]();
    kit.setError(document.getElementById(id), message);
    return message;
  }
  Object.keys(checks).forEach(function (id) {
    var field = document.getElementById(id);
    field.addEventListener('blur', function () { if (field.type === 'checkbox' || field.value !== '') check(id); });
    var again = function () { if (field.getAttribute('aria-invalid')) check(id); };
    field.addEventListener('input', again);
    field.addEventListener('change', again);
  });
  noOther.addEventListener('change', function () { if (otherSide.getAttribute('aria-invalid')) check('otherSide'); });

  function showResult(build) {
    kit.clear(result);
    build(result);
    Object.keys(steps).forEach(function (key) { steps[key].hidden = true; });
    progress.forEach(function (item) { item.removeAttribute('aria-current'); item.classList.add('done'); });
    result.hidden = false;
    kit.focusOn(result.querySelector('h2'));
  }

  function booked(data) {
    showResult(function (box) {
      var h = kit.el('h2', '', 'Your consultation is booked');
      h.id = 'result-h';
      box.appendChild(h);
      var facts = kit.el('dl', 'facts');
      [['When', data.label], ['Length', data.minutes + ' minutes'], ['With', data.attorney], ['Where', data.address], ['Fee', data.fee]].forEach(function (pair) {
        facts.appendChild(kit.el('dt', '', pair[0]));
        facts.appendChild(kit.el('dd', '', pair[1]));
      });
      facts.appendChild(kit.el('dt', '', 'Reference'));
      facts.appendChild(kit.el('dd', 'ref', data.ref));
      box.appendChild(facts);
      kit.paragraphs(box, data.message);
      box.appendChild(kit.el('p', 'note', 'To change or cancel, call 555-0142 or email hello@dyzania.example at least 24 hours before your appointment.'));
      var actions = kit.el('div', 'actions');
      var bring = kit.el('a', 'btn', 'What to bring');
      bring.href = '/practice-areas#' + state.area;
      var home = kit.el('a', 'btn secondary', 'Back to the home page');
      home.href = '/';
      actions.appendChild(bring);
      actions.appendChild(home);
      box.appendChild(actions);
    });
  }

  function officeOnly(message) {
    showResult(function (box) {
      var h = kit.el('h2', '', 'Please contact the office');
      h.id = 'result-h';
      box.appendChild(h);
      kit.paragraphs(box, message);
      var actions = kit.el('div', 'actions');
      var call = kit.el('a', 'btn', 'Call 555-0142');
      call.href = 'tel:5550142';
      var mail = kit.el('a', 'btn secondary', 'Email the office');
      mail.href = 'mailto:hello@dyzania.example';
      actions.appendChild(call);
      actions.appendChild(mail);
      box.appendChild(actions);
    });
  }

  detailsForm.addEventListener('submit', function (event) {
    event.preventDefault();
    status.textContent = '';
    status.className = 'form-status';
    var items = [];
    Object.keys(checks).forEach(function (id) {
      var message = check(id);
      if (message) items.push({ id: id, message: message });
    });
    kit.showSummary(errorSummary, items);
    if (items.length) return;
    if (!state.chosen) { show('time'); return; }

    var payload = {
      name: val('name'), email: val('email'), phone: val('phone'), area: state.area, start: state.chosen.start,
      otherSide: noOther.checked ? '' : val('otherSide'), noOtherSide: noOther.checked,
      consent: document.getElementById('consent').checked, leadRef: state.leadRef, website: detailsForm.elements.website.value,
    };
    kit.setBusy(submit, true, submitLabel);
    status.textContent = 'Booking your time…';
    kit.post('/api/book', payload).then(function (response) {
      kit.setBusy(submit, false, submitLabel);
      var data = response.data || {};
      if (response.status === 200 && data.code === 'booked') { status.textContent = ''; booked(data); return; }
      if (data.code === 'contact_office') { status.textContent = ''; officeOnly(data.message); return; }
      if (data.code === 'slot_unavailable') {
        state.chosen = null;
        loadTimes(false, 'That time is no longer available. Please choose another time.');
        return;
      }
      if (response.status === 422 && data.errors) {
        var found = [];
        Object.keys(data.errors).forEach(function (id) {
          var field = document.getElementById(id);
          if (!field) return;
          kit.setError(field, data.errors[id]);
          found.push({ id: id, message: data.errors[id] });
        });
        if (found.length) { kit.showSummary(errorSummary, found); status.textContent = ''; return; }
        state.chosen = null;
        loadTimes(false, 'Please choose a time from the list.');
        return;
      }
      if (response.status === 429) {
        var minutes = Math.max(1, Math.ceil((Number(data.retryAfterSec) || 60) / 60));
        status.textContent = 'Too many attempts from this device. Please try again in about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ', or call the office.';
      } else {
        status.textContent = data.message || data.error || 'We could not complete this booking. Please try again in a moment, or call the office.';
      }
      status.className = 'form-status error';
    });
  });

  // ---- start: a practice area and a lead reference may arrive in the address (from the contact form's reply) ----
  try {
    var params = new URLSearchParams(window.location.search);
    var area = params.get('area');
    var ref = params.get('ref');
    if (ref && /^[A-Za-z0-9-]{1,40}$/.test(ref)) state.leadRef = ref;
    if (area && AREAS.indexOf(area) !== -1) {
      var radio = areaForm.querySelector('input[name="area"][value="' + area + '"]');
      if (radio) radio.checked = true;
    }
  } catch (_) { /* no query string support: start at the first step */ }
  show('area', false);
})();
