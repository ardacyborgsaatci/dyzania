// Renders the automation cards from data/status.json. Everything is written with textContent.
(function () {
  const list = document.getElementById('autos');
  const errorEl = document.getElementById('autos-error');
  const verified = document.getElementById('verified');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function row(dl, term, value) {
    dl.append(el('dt', '', term), el('dd', '', value));
  }

  function card(a, liveTriaged) {
    const li = el('li', 'card');
    li.append(el('span', 'team', a.team));
    li.append(el('h3', '', a.name));
    li.append(el('span', 'state ' + (a.state === 'building' ? 'building' : a.state === 'paused' ? 'paused' : ''), a.stateLabel));
    li.append(el('p', '', a.what));
    const dl = el('dl');
    row(dl, 'Evidence', a.evidence);
    if (a.id === 'support' && liveTriaged != null) row(dl, 'Live', liveTriaged + ' emails triaged in the last 30 days');
    row(dl, 'Next', a.next);
    li.append(dl);
    if (Array.isArray(a.links) && a.links.length) {
      const p = el('p', '');
      p.style.marginTop = '12px';
      a.links.forEach(function (pair, i) {
        const link = el('a', '', pair[0]);
        link.href = pair[1];
        if (i) p.append(' · ');
        p.append(link);
      });
      li.append(p);
    }
    return li;
  }

  function render(data, liveTriaged) {
    list.replaceChildren.apply(list, data.automations.map(function (a) { return card(a, liveTriaged); }));
    verified.textContent = 'Status checked ' + data.verified;
  }

  fetch('/data/status.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
    .then(function (data) {
      render(data, null);
      // The support feed is the one live number today; if it is unavailable the card omits it.
      fetch('/api/feed').then(function (r) { return r.ok ? r.json() : null; }).then(function (feed) {
        const total = feed && typeof feed.total === 'number' ? feed.total : null;
        if (total != null) render(data, total);
      }).catch(function () {});
    })
    .catch(function () {
      errorEl.hidden = false;
      errorEl.textContent = 'The status list could not be loaded.';
      verified.textContent = '';
    });
})();
