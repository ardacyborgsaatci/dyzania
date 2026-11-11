'use strict';
// For tests/test_parity.py: what the web side's rules (firm/lib) say about each sentence, so the voice side can be compared.
// stdin: JSON list of sentences. stdout: JSON list of { area, basis, hits, outOfScope, urgent }.
const fs = require('node:fs');
const { loadFirmData } = require('../../firm/lib/data');
const { classifyArea } = require('../../firm/lib/areas');
const { detectUrgency } = require('../../firm/lib/urgency');

const data = loadFirmData();
const sentences = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = sentences.map((text) => {
  const c = classifyArea({ selected: 'not_sure', text }, data.areas);
  const u = detectUrgency({ text, hearing: 'none' }, data.urgency, '2026-11-11');
  return { area: c.area, basis: c.basis, hits: c.hits, outOfScope: c.outOfScope ? c.outOfScope.id : null, urgent: u.flags.map((f) => f.id).sort() };
});
process.stdout.write(JSON.stringify(out));
