// Shared helpers for the contact and booking forms. Everything is written with textContent, never as HTML.
(function () {
  'use strict';

  var tokenPromise = null;

  // The signed token the server asks for with every form post (see lib/guard.js). Fetched when the page loads, so it is
  // always a few seconds old by the time a person has filled something in.
  function getToken(force) {
    if (!tokenPromise || force) {
      tokenPromise = fetch('/api/token', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('token')); })
        .then(function (d) { return d.token || ''; })
        .catch(function () { tokenPromise = null; return ''; });
    }
    return tokenPromise;
  }

  // Resolves { status, ok, data, retryAfter }. Never rejects: a network failure is { status: 0 }.
  function post(url, body) {
    return getToken().then(function (token) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, body, { formToken: token })),
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (data && (data.code === 'expired' || data.code === 'bad' || data.code === 'missing')) getToken(true);
        return { status: r.status, ok: r.ok, data: data || {}, retryAfter: r.headers.get('Retry-After') };
      });
    }).catch(function () {
      return { status: 0, ok: false, data: {}, retryAfter: null };
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Moves focus to a heading or panel so a screen reader announces where the person is.
  function focusOn(node) {
    if (!node) return;
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node.focus({ preventScroll: false });
  }

  // ---- field errors: beside the field, joined to it with aria-describedby ----
  function errorNode(field) {
    var id = field.id + '-error';
    var node = document.getElementById(id);
    if (!node) {
      node = el('p', 'field__error');
      node.id = id;
      node.hidden = true;
      var holder = field.closest('.field') || field.parentNode;
      holder.appendChild(node);
    }
    return node;
  }

  function describedBy(field, id, on) {
    var ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(function (x) { return x !== id; });
    if (on) ids.push(id);
    if (ids.length) field.setAttribute('aria-describedby', ids.join(' '));
    else field.removeAttribute('aria-describedby');
  }

  function setError(field, message) {
    var node = errorNode(field);
    node.textContent = message || '';
    node.hidden = !message;
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    describedBy(field, node.id, !!message);
  }

  // A summary at the top of the form after a failed send: focusable, with a link to each field.
  function showSummary(box, items) {
    clear(box);
    if (!items.length) { box.hidden = true; return; }
    box.appendChild(el('h2', '', 'There is a problem'));
    var list = el('ul');
    items.forEach(function (item) {
      var li = el('li');
      var link = el('a', '', item.message);
      link.href = '#' + item.id;
      link.addEventListener('click', function (event) {
        var target = document.getElementById(item.id);
        if (target) { event.preventDefault(); target.focus(); }
      });
      li.appendChild(link);
      list.appendChild(li);
    });
    box.appendChild(list);
    box.hidden = false;
    focusOn(box);
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    clear(button);
    if (busy) {
      var spin = el('span', 'spinner');
      spin.setAttribute('aria-hidden', 'true');
      button.appendChild(spin);
      button.appendChild(document.createTextNode(' Sending'));
    } else {
      button.textContent = label;
    }
  }

  function paragraphs(container, text) {
    String(text || '').split(/\n{2,}/).forEach(function (part) {
      if (part.trim()) container.appendChild(el('p', '', part.trim()));
    });
  }

  window.DY = { getToken: getToken, post: post, el: el, clear: clear, focusOn: focusOn, setError: setError, showSummary: showSummary, setBusy: setBusy, paragraphs: paragraphs };
  getToken();
})();
