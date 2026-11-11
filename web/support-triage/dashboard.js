// Dashboard: renders the live feed (/api/feed) and the evaluation results (/data/eval-results.json).
// Every value is written with textContent, never as HTML.
(function () {
  var L = window.TriageLabels;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function byId(id) { return document.getElementById(id); }
  function pct(value) { return typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) + '%' : '–'; }
  function secs(ms) { return typeof ms === 'number' ? (ms / 1000).toFixed(1) + ' s' : '–'; }
  function showError(id, message) { var node = byId(id); node.textContent = message; node.hidden = false; }

  function bars(listId, entries) {
    var list = byId(listId);
    var max = entries.reduce(function (m, e) { return Math.max(m, e.value); }, 0) || 1;
    list.replaceChildren();
    entries.forEach(function (entry) {
      var row = el('li', 'bar-row');
      row.appendChild(el('span', null, entry.label));
      var track = el('span', 'bar-track');
      var fill = el('span', 'bar-fill');
      fill.style.width = Math.max(2, Math.round((entry.value / max) * 100)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'num', entry.text !== undefined ? entry.text : String(entry.value)));
      list.appendChild(row);
    });
  }

  function countsToEntries(counts, group, order) {
    var keys = Object.keys(counts || {});
    if (order) keys.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    else keys.sort(function (a, b) { return counts[b] - counts[a]; });
    return keys.map(function (key) { return { label: L.label(group, key), value: counts[key] }; });
  }

  function renderFeed(data) {
    byId('m-total').textContent = String(data.total || 0);
    byId('m-human').textContent = String(data.needsHuman || 0);
    byId('m-injection').textContent = String(data.injectionFlagged || 0);
    byId('m-latency').textContent = secs(data.medianLatencyMs);
    byId('feed-metrics').hidden = false;
    byId('feed-note').textContent = data.generatedAt ? 'Updated ' + new Date(data.generatedAt).toLocaleTimeString() : '';

    if (data.total) {
      bars('bars-category', countsToEntries(data.byCategory, 'category'));
      bars('bars-priority', countsToEntries(data.byPriority, 'priority', ['urgent', 'high', 'normal', 'low']));
      byId('feed-charts').hidden = false;
    }

    var recent = Array.isArray(data.recent) ? data.recent : [];
    var list = byId('feed-recent');
    list.replaceChildren();
    if (!recent.length) {
      list.appendChild(el('li', 'note', 'No playground activity yet. Try the playground and refresh.'));
    }
    recent.forEach(function (item) {
      var li = el('li');
      var badges = el('ul', 'badges');
      badges.style.marginBottom = '0';
      [[L.label('category', item.category), ''], [L.label('priority', item.priority), item.priority]].forEach(function (pair) {
        var b = el('li');
        b.appendChild(el('span', 'badge ' + pair[1], pair[0]));
        badges.appendChild(b);
      });
      if (item.needsHuman) { var h = el('li'); h.appendChild(el('span', 'badge human', 'Needs a person')); badges.appendChild(h); }
      if (item.injectionSuspected) { var a = el('li'); a.appendChild(el('span', 'badge alert', 'Injection suspected')); badges.appendChild(a); }
      li.appendChild(badges);
      if (item.subject) li.appendChild(el('div', 'title', item.subject));
      if (item.summary) li.appendChild(el('div', null, item.summary));
      var when = item.at ? new Date(item.at).toLocaleString() : '';
      li.appendChild(el('div', 'meta', (when ? when + ' · ' : '') + (item.latencyMs ? secs(item.latencyMs) : '') + (item.sampleId ? ' · sample email' : ' · visitor text not shown')));
      list.appendChild(li);
    });
    byId('feed-recent-card').hidden = false;
  }

  function renderEval(data) {
    var cards = [
      ['categoryAccuracy', 'Category accuracy', 'pct'], ['priorityExact', 'Priority exact match', 'pct'],
      ['priorityWithinOne', 'Priority within one level', 'pct'], ['needsHumanRecall', 'Risky mail escalated', 'pct'],
      ['needsHumanFalseFlagRate', 'Routine mail flagged for a person', 'pct'], ['injectionRecall', 'Injection attempts caught', 'pct'],
      ['unsafeDrafts', 'Drafts written for spam or attacks', 'int'], ['holdingReplies', 'Drafts replaced by a holding reply', 'int'],
      ['medianLatencyMs', 'Median time per email', 'sec'], ['p95LatencyMs', 'Slowest 5% took under', 'sec'],
    ];
    var grid = byId('eval-metrics');
    grid.replaceChildren();
    cards.forEach(function (c) {
      var card = el('div', 'card metric');
      var value = data[c[0]];
      card.appendChild(el('span', 'value', c[2] === 'pct' ? pct(value) : c[2] === 'sec' ? secs(value) : String(value === undefined ? '–' : value)));
      card.appendChild(el('span', 'label', c[1]));
      grid.appendChild(card);
    });
    var when = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    byId('eval-note').textContent = 'Prompt ' + (data.promptVersion || '?') + (data.models ? ' · ' + data.models : '') + (data.runNote ? ' · ' + data.runNote : '') + ' · ' + (data.total || 0) + ' emails' + (when ? ' · ' + when : '');

    var per = data.perCategory || {};
    bars('bars-eval', Object.keys(per).map(function (key) {
      var row = per[key];
      return { label: L.label('category', key), value: row.total ? Math.round((row.correct / row.total) * 100) : 0, text: row.correct + '/' + row.total };
    }));

    var table = byId('matrix');
    table.replaceChildren();
    var matrix = data.confusion && data.confusion.matrix;
    var labels = data.confusion && data.confusion.labels;
    if (!matrix || !labels) return;
    var head = el('tr');
    head.appendChild(el('th', null, 'Right answer'));
    labels.forEach(function (label) { head.appendChild(el('th', null, L.label('category', label))); });
    var thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el('tbody');
    matrix.forEach(function (row, i) {
      var tr = el('tr');
      tr.appendChild(el('th', null, L.label('category', labels[i])));
      row.forEach(function (count, j) {
        var td = el('td', i === j ? (count ? 'diag' : '') : (count ? 'off' : ''), count ? String(count) : '·');
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
  }

  fetch('/api/feed')
    .then(function (r) { if (!r.ok) throw new Error('feed'); return r.json(); })
    .then(renderFeed)
    .catch(function () {
      byId('feed-note').textContent = '';
      showError('feed-error', 'The live feed is unavailable right now. The evaluation results below do not depend on it.');
    });

  fetch('/data/eval-results.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('eval'); return r.json(); })
    .then(renderEval)
    .catch(function () {
      byId('eval-note').textContent = '';
      showError('eval-error', 'Evaluation results are not available yet.');
    });
})();
