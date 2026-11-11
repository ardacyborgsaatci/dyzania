// Playground: sends an email to /api/triage and shows the answer.
// Every value that comes back from the model is written with textContent, never as HTML.
(function () {
  var L = window.TriageLabels;
  var form = document.getElementById('triage-form');
  var presetsEl = document.getElementById('presets');
  var nameEl = document.getElementById('name');
  var subjectEl = document.getElementById('subject');
  var bodyEl = document.getElementById('body');
  var honeyEl = document.getElementById('website');
  var counterEl = document.getElementById('counter');
  var statusEl = document.getElementById('status');
  var submitEl = document.getElementById('submit');
  var resultEl = document.getElementById('result');
  var samples = [];
  var activeId = '';
  var busy = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (isError ? ' error' : '');
  }

  function updateCounter() {
    counterEl.textContent = bodyEl.value.length + ' / 4000';
  }

  function markPresets() {
    Array.prototype.forEach.call(presetsEl.querySelectorAll('button'), function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.id === activeId));
    });
  }

  function choose(sample) {
    activeId = sample.id;
    nameEl.value = '';
    subjectEl.value = sample.subject;
    bodyEl.value = sample.body;
    updateCounter();
    markPresets();
    setStatus('');
  }

  // Editing a preset turns it into a free-text email, so the preset marker is dropped.
  function dropPresetIfEdited() {
    if (!activeId) return;
    var sample = samples.filter(function (s) { return s.id === activeId; })[0];
    if (!sample || subjectEl.value.trim() !== sample.subject || bodyEl.value.trim() !== sample.body) {
      activeId = '';
      markPresets();
    }
  }

  function showEmpty(message) {
    resultEl.replaceChildren(el('h2', null, '2. Result'), el('div', 'empty', message));
  }

  function showLoading() {
    var box = el('div', 'loading');
    box.appendChild(el('div', 'spinner'));
    box.appendChild(el('div', null, 'The model is reading the email…'));
    resultEl.replaceChildren(el('h2', null, '2. Result'), box);
  }

  function badge(text, className) {
    var li = el('li');
    li.appendChild(el('span', 'badge' + (className ? ' ' + className : ''), text));
    return li;
  }

  function fact(list, term, value) {
    list.appendChild(el('dt', null, term));
    list.appendChild(el('dd', null, value));
  }

  function render(r) {
    var parts = [el('h2', null, '2. Result')];

    var badges = el('ul', 'badges');
    badges.setAttribute('aria-label', 'Classification');
    badges.appendChild(badge(L.label('category', r.category)));
    badges.appendChild(badge(L.label('priority', r.priority) + ' priority', r.priority));
    badges.appendChild(badge(L.label('sentiment', r.sentiment)));
    badges.appendChild(badge(L.languages[r.language] || String(r.language || '').toUpperCase()));
    badges.appendChild(r.needsHuman ? badge('Needs a person', 'human') : badge('No person needed', 'ok'));
    if (r.injectionSuspected) badges.appendChild(badge('Injection suspected', 'alert'));
    parts.push(badges);

    if (r.injectionSuspected) {
      parts.push(el('p', 'callout alert', L.skip.injection));
    } else if (r.skipReason && L.skip[r.skipReason]) {
      parts.push(el('p', 'callout', L.skip[r.skipReason]));
    }
    if (r.needsHuman && r.humanReason) parts.push(el('p', 'callout', 'Why a person is needed: ' + r.humanReason));

    var facts = el('dl', 'facts');
    fact(facts, 'Summary', r.summary || '');
    if (typeof r.confidence === 'number') fact(facts, 'Confidence', Math.round(r.confidence * 100) + '%');
    if (typeof r.latencyMs === 'number') fact(facts, 'Time taken', (r.latencyMs / 1000).toFixed(1) + ' s');
    if (r.kbArticlesUsed && r.kbArticlesUsed.length) fact(facts, 'Help articles used', r.kbArticlesUsed.join(', '));
    if (r.promptVersion) fact(facts, 'Prompt version', r.promptVersion);
    parts.push(facts);

    if (r.draftReply) {
      var draft = el('div', 'draft');
      var head = el('div', 'draft-head');
      head.appendChild(el('span', 'draft-label', 'Draft only · never sent'));
      if (r.draftStatus === 'holding_reply') head.appendChild(el('span', 'badge human', 'Holding reply: the full draft failed a safety check'));
      draft.appendChild(head);
      draft.appendChild(el('pre', null, r.draftReply));
      parts.push(draft);
    } else {
      parts.push(el('p', 'note', 'No draft was written for this email.'));
    }

    resultEl.replaceChildren.apply(resultEl, parts);
    if (window.matchMedia('(max-width: 899px)').matches) resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readError(response, data) {
    if (data && data.error) return data.error;
    return response.status === 429 ? 'Too many requests. Please try again later.' : 'Something went wrong. Please try again.';
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!bodyEl.value.trim()) {
      setStatus('Please write the email text first.', true);
      bodyEl.focus();
      return;
    }
    busy = true;
    submitEl.disabled = true;
    setStatus('');
    showLoading();
    try {
      var response = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameEl.value, subject: subjectEl.value, body: bodyEl.value, sampleId: activeId, website: honeyEl.value }),
      });
      var data = null;
      try { data = await response.json(); } catch (ignore) { data = null; }
      if (!response.ok || !data || !data.result) {
        showEmpty('No result. Adjust the email and try again.');
        setStatus(readError(response, data), true);
        return;
      }
      render(data.result);
      if (typeof data.result.remaining === 'number') {
        setStatus(data.result.remaining + (data.result.remaining === 1 ? ' request' : ' requests') + ' left this hour.');
      }
    } catch (err) {
      showEmpty('No result. Adjust the email and try again.');
      setStatus('Could not reach the server. Check your connection and try again.', true);
    } finally {
      busy = false;
      submitEl.disabled = false;
    }
  }

  form.addEventListener('submit', submit);
  bodyEl.addEventListener('input', function () { updateCounter(); dropPresetIfEdited(); });
  subjectEl.addEventListener('input', dropPresetIfEdited);
  updateCounter();

  fetch('/data/samples.json')
    .then(function (r) { if (!r.ok) throw new Error('samples'); return r.json(); })
    .then(function (list) {
      samples = list;
      list.forEach(function (sample) {
        var li = el('li');
        var button = el('button', 'chip', sample.label);
        button.type = 'button';
        button.dataset.id = sample.id;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () { choose(sample); });
        li.appendChild(button);
        presetsEl.appendChild(li);
      });
      if (list.length) choose(list[0]);
    })
    .catch(function () { presetsEl.appendChild(el('li', 'note', 'Samples could not be loaded. You can still write your own email.')); });
})();
