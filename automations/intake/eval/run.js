'use strict';
// Runs the intake over eval/cases.json and compares with the expected labels.
// Usage: node eval/run.js            print a report
//        node eval/run.js --write    also write eval/results.json
const fs = require('node:fs');
const path = require('node:path');
const { loadFirmData } = require('../../../firm/lib/data');
const { processIntake } = require('../lib/intake');

const FIELDS = ['area', 'nextStep', 'tier', 'urgency', 'conflict', 'score'];

function evaluate(setup, data) {
  const rows = setup.cases.map((c) => {
    const body = Object.assign({}, setup.defaults, c.input);
    const r = processIntake(body, data, { today: setup.today, ref: 'DY-EVAL-' + c.id, now: setup.today + 'T12:00:00Z' });
    if (!r.ok) return { id: c.id, note: c.note, error: r.errors || 'spam', expect: c.expect, got: null, misses: FIELDS };
    const got = {
      area: r.lead.areaFinal, nextStep: r.lead.nextStep, tier: r.lead.tier, urgency: r.lead.urgencyLevel,
      conflict: r.lead.conflictStatus, score: r.lead.score
    };
    const misses = FIELDS.filter((f) => got[f] !== c.expect[f]);
    return { id: c.id, note: c.note, expect: c.expect, got, misses, flags: r.lead.urgencyFlags, conflictNote: r.lead.conflictNote, basis: r.lead.areaBasis };
  });
  const summary = { cases: rows.length };
  for (const f of FIELDS) summary[f] = rows.filter((r) => !r.misses.includes(f)).length;
  summary.allFields = rows.filter((r) => r.misses.length === 0).length;
  summary.decisionsRight = rows.filter((r) => !r.misses.some((m) => m !== 'score')).length;
  return { summary, rows };
}

if (require.main === module) {
  const setup = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const out = evaluate(setup, loadFirmData());
  const s = out.summary;
  console.log('Intake eval (' + s.cases + ' invented leads, today = ' + setup.today + ')');
  for (const f of FIELDS) console.log('  ' + f.padEnd(9) + s[f] + '/' + s.cases);
  console.log('  every field right: ' + s.allFields + '/' + s.cases + ' | every decision right (score ignored): ' + s.decisionsRight + '/' + s.cases);
  for (const r of out.rows.filter((x) => x.misses.length)) {
    console.log('\n' + r.id + ' - ' + r.note);
    for (const m of r.misses) console.log('   ' + m + ': expected ' + (r.expect[m]) + ', got ' + (r.got ? r.got[m] : JSON.stringify(r.error)));
    if (r.flags) console.log('   flags: ' + r.flags + ' | conflict: ' + r.conflictNote + ' | basis: ' + r.basis);
  }
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 2) + '\n');
}

module.exports = { evaluate };
