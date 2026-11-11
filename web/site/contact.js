// The intake form: checks each field when the person leaves it, shows a summary with links after a failed send, posts to
// /api/intake, and shows the firm's fixed reply. The rules the server applies are repeated here only so a mistake is
// caught early; the workflow checks everything again and its messages are shown beside the field.
(function () {
  'use strict';
  var form = document.getElementById('intake-form');
  if (!form) return;

  var kit = window.HM;
  var summary = document.getElementById('error-summary');
  var status = document.getElementById('form-status');
  var button = document.getElementById('submit');
  var panel = document.getElementById('form-panel');
  var result = document.getElementById('result');
  var sendLabel = button.textContent;
  var description = document.getElementById('description');
  var counter = document.getElementById('description-count');
  var AREAS = ['family', 'injury', 'employment', 'estate'];

  // The latest date a person may give for when it happened: today.
  var today = new Date();
  document.getElementById('incidentDate').max = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  function value(id) {
    var node = document.getElementById(id);
    return node ? node.value.replace(/\s+/g, ' ').trim() : '';
  }

  var checks = {
    name: function () {
      var v = value('name');
      return v.length >= 2 && v.length <= 100 && /^[\p{L}\p{M}0-9 .,'’-]+$/u.test(v) ? '' : 'Enter your name, using letters, spaces, hyphens or apostrophes.';
    },
    email: function () {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value('email')) ? '' : 'Enter an email address, such as name@example.com.';
    },
    phone: function () {
      var v = value('phone');
      var prefersPhone = form.elements.preferredContact.value === 'phone';
      if (!v) return prefersPhone ? 'Add a phone number, or choose email as the way to reach you.' : '';
      var digits = v.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 && /^[0-9+()\-. ]+$/.test(v) ? '' : 'Enter a phone number with 7 to 15 digits, or leave it blank.';
    },
    area: function () { return ''; },
    description: function () {
      var n = document.getElementById('description').value.replace(/\s+/g, ' ').trim().length;
      if (n < 20) return 'Describe your situation in a few sentences (at least 20 characters).';
      if (n > 1500) return 'Keep it under 1,500 characters.';
      return '';
    },
    location: function () { return value('location') ? '' : 'Choose where you are.'; },
    hearing: function () { return value('hearing') ? '' : 'Choose an answer.'; },
    incidentDate: function () {
      var v = value('incidentDate');
      if (!v) return '';
      return v > document.getElementById('incidentDate').max ? 'The date cannot be in the future.' : '';
    },
    otherSide: function () { return value('otherSide').length <= 200 ? '' : 'Keep it under 200 characters.'; },
    howHeard: function () { return ''; },
    consent: function () { return document.getElementById('consent').checked ? '' : 'Tick the box to say you agree to be contacted and understand this is not legal advice.'; },
  };

  function check(id) {
    var message = checks[id] ? checks[id]() : '';
    kit.setError(document.getElementById(id), message);
    return message;
  }

  Object.keys(checks).forEach(function (id) {
    var field = document.getElementById(id);
    if (!field) return;
    field.addEventListener('blur', function () {
      if (field.type === 'checkbox' || field.value !== '') check(id);
    });
    var again = function () { if (field.getAttribute('aria-invalid')) check(id); };
    field.addEventListener('input', again);
    field.addEventListener('change', again);
  });
  Array.prototype.forEach.call(form.elements.preferredContact, function (radio) {
    radio.addEventListener('change', function () { if (document.getElementById('phone').getAttribute('aria-invalid') || value('phone') === '') check('phone'); });
  });

  description.addEventListener('input', function () {
    counter.textContent = description.value.length + ' of 1,500 characters';
  });

  function failures() {
    var list = [];
    Object.keys(checks).forEach(function (id) {
      var message = check(id);
      if (message) list.push({ id: id, message: message });
    });
    return list;
  }

  function serverMessage(response) {
    var data = response.data || {};
    if (response.status === 429) {
      var minutes = Math.max(1, Math.ceil((Number(data.retryAfterSec) || 60) / 60));
      return 'Too many messages from this device. Please try again in about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.';
    }
    return data.error || 'We could not send your message. Please try again in a moment, or call the office.';
  }

  function show(data) {
    kit.clear(result);
    var title = kit.el('h2', '', data.headline || 'Thank you. Your message has been received.');
    title.id = 'result-h';
    result.appendChild(title);
    if (data.message) {
      // The first paragraph of the message repeats the headline; the rest is the fixed reply.
      var parts = String(data.message).split(/\n{2,}/);
      if (parts[0] && parts[0].trim() === (data.headline || '').trim()) parts.shift();
      kit.paragraphs(result, parts.join('\n\n'));
    }
    if (data.ref) {
      var ref = kit.el('p', 'note');
      ref.appendChild(document.createTextNode('Your reference: '));
      ref.appendChild(kit.el('span', 'ref', data.ref));
      result.appendChild(ref);
    }
    var actions = kit.el('div', 'actions');
    var area = form.elements.area.value;
    if (data.kind === 'book' || data.kind === 'follow_up') {
      var query = [];
      if (AREAS.indexOf(area) !== -1) query.push('area=' + encodeURIComponent(area));
      if (/^[A-Za-z0-9-]{1,40}$/.test(data.ref || '')) query.push('ref=' + encodeURIComponent(data.ref));
      var book = kit.el('a', 'btn', 'Book a first consultation');
      book.href = '/book' + (query.length ? '?' + query.join('&') : '');
      actions.appendChild(book);
    }
    if (data.kind === 'urgent') {
      var call = kit.el('a', 'btn', 'Call 555-0142');
      call.href = 'tel:5550142';
      actions.appendChild(call);
    }
    var home = kit.el('a', data.kind === 'book' || data.kind === 'follow_up' || data.kind === 'urgent' ? 'btn secondary' : 'btn', 'Back to the home page');
    home.href = '/';
    actions.appendChild(home);
    result.appendChild(actions);
    panel.hidden = true;
    result.hidden = false;
    kit.focusOn(title);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    status.textContent = '';
    status.className = 'form-status';
    var problems = failures();
    kit.showSummary(summary, problems);
    if (problems.length) return;

    var payload = {
      name: value('name'), email: value('email'), phone: value('phone'),
      preferredContact: form.elements.preferredContact.value,
      area: form.elements.area.value, description: description.value.trim(), location: value('location'),
      hearing: value('hearing'), incidentDate: value('incidentDate'), otherSide: value('otherSide'), howHeard: value('howHeard'),
      consent: document.getElementById('consent').checked, website: form.elements.website.value,
    };

    kit.setBusy(button, true, sendLabel);
    status.textContent = 'Sending your message…';
    kit.post('/api/intake', payload).then(function (response) {
      kit.setBusy(button, false, sendLabel);
      var data = response.data || {};
      if (response.status === 200 && data.ok) {
        status.textContent = '';
        show(data);
        return;
      }
      if (response.status === 422 && data.errors) {
        var items = [];
        Object.keys(data.errors).forEach(function (id) {
          var field = document.getElementById(id);
          if (!field) return;
          kit.setError(field, data.errors[id]);
          items.push({ id: id, message: data.errors[id] });
        });
        if (items.length) { kit.showSummary(summary, items); status.textContent = ''; return; }
      }
      status.textContent = serverMessage(response);
      status.className = 'form-status error';
    });
  });
})();
