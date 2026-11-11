// Renders the "How it runs" page from data/status.json. Everything is written with textContent, never as HTML.
(function () {
  'use strict';
  var list = document.getElementById('autos');
  var errorBox = document.getElementById('autos-error');
  var verified = document.getElementById('verified');
  var today = document.getElementById('links-today');
  var later = document.getElementById('links-later');
  var rules = document.getElementById('rules');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function row(dl, term, value) {
    if (!value) return;
    dl.appendChild(el('dt', '', term));
    dl.appendChild(el('dd', '', value));
  }

  var STATE_CLASS = { running: 'running', live: 'running', paused: 'paused' };

  function card(a) {
    var li = el('li', 'card');
    li.appendChild(el('span', 'team', a.team));
    li.appendChild(el('h3', '', a.name));
    li.appendChild(el('span', 'state ' + (STATE_CLASS[a.state] || ''), a.stateLabel));
    li.appendChild(el('p', '', a.what));
    var dl = el('dl');
    row(dl, 'How it was checked', a.evidence);
    row(dl, 'What that does not prove', a.limit);
    row(dl, 'Still to do', a.next);
    li.appendChild(dl);
    if (Array.isArray(a.links) && a.links.length) {
      var p = el('p');
      p.style.marginTop = '12px';
      a.links.forEach(function (pair, i) {
        var link = el('a', '', pair[0]);
        link.href = pair[1];
        if (i) p.appendChild(document.createTextNode(' · '));
        p.appendChild(link);
      });
      li.appendChild(p);
    }
    return li;
  }

  function fill(node, items, build) {
    if (!node || !Array.isArray(items)) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    items.forEach(function (item) { node.appendChild(build(item)); });
  }

  fetch('/data/status.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
    .then(function (data) {
      fill(list, data.automations, card);
      list.removeAttribute('aria-busy');
      fill(today, data.linksToday, function (text) { return el('li', '', text); });
      fill(later, data.linksLater, function (text) { return el('li', '', text); });
      fill(rules, data.rules, function (pair) {
        var li = el('li');
        li.appendChild(el('strong', '', pair[0]));
        li.appendChild(document.createTextNode(pair[1]));
        return li;
      });
      verified.textContent = 'Status checked ' + data.verified + '.';
    })
    .catch(function () {
      list.removeAttribute('aria-busy');
      errorBox.hidden = false;
      errorBox.textContent = 'The status list could not be loaded. Please reload the page.';
    });
})();
