// Shows the voice assistant only when its own server answers. The address comes from data/site.json (empty until the
// voice server is deployed); on a local machine it is the default local server.
(function () {
  'use strict';
  var box = document.getElementById('voice-try');
  var off = document.getElementById('voice-off');
  var frame = document.getElementById('voice-frame');
  var open = document.getElementById('voice-open');
  if (!box || !frame) return;

  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  function start(url) {
    if (!url) return;
    // Only show the player if the voice server answers.
    fetch(url, { mode: 'no-cors' }).then(function () {
      frame.src = url;
      open.href = url;
      box.hidden = false;
      off.hidden = true;
    }).catch(function () { /* the server is not running: keep the explanation */ });
  }

  if (local) { start('http://localhost:8000/'); return; }
  fetch('/data/site.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (data) { start(typeof data.voiceUrl === 'string' && /^https:\/\//.test(data.voiceUrl) ? data.voiceUrl : ''); })
    .catch(function () {});
})();
