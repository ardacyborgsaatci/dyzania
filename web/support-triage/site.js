// Fills the headline metrics from the latest evaluation run. Everything is written with textContent.
(function () {
  const nodes = document.querySelectorAll('[data-metric]');
  const note = document.getElementById('eval-note');
  if (!nodes.length) return;

  function format(value, kind) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
    if (kind === 'pct') return (Number.isInteger(value) ? value : value.toFixed(1)) + '%';
    if (kind === 'sec') return (value / 1000).toFixed(1) + ' s';
    return String(value);
  }

  fetch('/data/eval-results.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
    .then(function (data) {
      nodes.forEach(function (el) { el.textContent = format(data[el.dataset.metric], el.dataset.format); });
      if (note) {
        const when = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        note.textContent = 'Prompt ' + (data.promptVersion || '') + (data.models ? ', ' + data.models : '') + (data.runNote ? ', ' + data.runNote : '') + ', ' + (data.total || 0) + ' emails' + (when ? ', run ' + when : '');
      }
    })
    .catch(function () { if (note) note.textContent = 'Results are not available yet.'; });
})();
