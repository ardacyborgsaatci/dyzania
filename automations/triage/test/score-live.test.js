'use strict';
// The live scorer is tested with stand-in results shaped exactly like the triage core's output (the same triageFinish),
// after a JSON round trip, because that is what n8n hands back. No model is involved.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const E = require('../eval/run');
const S = require('../eval/score-live');

const roundTrip = (o) => JSON.parse(JSON.stringify(o));
function results(mode) {
  const out = {};
  E.SET.emails.forEach((e) => {
    const m = mode === 'hostile' && e.tags.includes('injection') ? 'obedient' : mode;
    out[e.id] = roundTrip(E.runOne(e, m));
  });
  return out;
}

test('a perfect model matches every label (urgency is not compared on the known limits) with nothing broken or missing', () => {
  const s = S.scoreLive(results('oracle'));
  assert.strictEqual(s.complete, true);
  assert.strictEqual(s.scored, 54);
  assert.deepStrictEqual(s.violations, []);
  Object.keys(s.perField).forEach((f) => assert.ok(s.perField[f] >= 53, f + ' ' + s.perField[f]));
  assert.strictEqual(s.perField.category, 54);
  assert.strictEqual(s.humanRecall.caught, s.humanRecall.of);
  assert.strictEqual(s.injectionsFlagged.flagged, s.injectionsFlagged.of);
  assert.strictEqual(s.urgentRaised.raised, s.urgentRaised.of);
  assert.deepStrictEqual(s.classifierFallbacks, []);
});

test('a hostile model is scored worse on the model fields, while the rules keep every guarantee', () => {
  const good = S.scoreLive(results('oracle'));
  const bad = S.scoreLive(results('hostile'));
  assert.ok(bad.perField.category < good.perField.category);
  assert.deepStrictEqual(bad.violations, []);
  assert.ok(bad.mismatches.length > 0);
  // a classifier that failed is counted as a fallback
  const down = S.scoreLive(results('rules'));
  assert.strictEqual(down.classifierFallbacks.length, 54);
  assert.deepStrictEqual(down.violations, []);
});

test('missing results are named, and an array of outputs is read by sampleId', () => {
  const all = results('oracle');
  const arr = Object.values(all);
  assert.strictEqual(S.scoreLive(arr).scored, 54);
  delete all.N01;
  delete all.N07;
  const s = S.scoreLive(all);
  assert.deepStrictEqual(s.missing, ['N01', 'N07']);
  assert.strictEqual(s.complete, false);
  assert.strictEqual(s.scored, 52);
  assert.match(S.report(s), /MISSING: N01, N07/);
  assert.strictEqual(S.scoreLive(null).scored, 0);
  assert.strictEqual(S.scoreLive('x').missing.length, 54);
});

test('a result that breaks a guarantee is reported as a bug, not as a model miss', () => {
  const all = results('oracle');
  const urgent = E.SET.emails.find((e) => e.expect.priority === 'urgent' && e.expect.urgency === 'urgent' && !e.tags.some((t) => E.LIMIT_TAGS.includes(t)));
  assert.ok(urgent, 'the set has an urgent email the rules can see');
  all[urgent.id].priority = 'low';
  all[urgent.id].alert = { send: false, subject: '', text: '' };
  const inj = E.SET.emails.find((e) => e.tags.includes('injection'));
  all[inj.id].draftMode = 'standard';
  all[inj.id].injectionSuspected = false;
  const s = S.scoreLive(all);
  const ids = s.violations.map((v) => v.id);
  assert.ok(ids.includes(urgent.id) && ids.includes(inj.id));
  assert.ok(s.violations.find((v) => v.id === urgent.id).broken.includes('urgent_not_raised_and_alerted'));
  assert.ok(s.violations.find((v) => v.id === inj.id).broken.includes('injection_not_contained'));
  assert.match(S.report(s), /BROKEN/);
});

test('the report says what the numbers are worth and asks for a person to read the drafts', () => {
  const text = S.report(S.scoreLive(results('oracle')));
  assert.match(text, /Needs-human recall/);
  assert.match(text, /A person must still read the \d+ drafted replies/);
  assert.match(text, /Guarantees broken .*none/);
});

test('the command line exits 0 on a complete clean run, 1 on a gap, and says how to use it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-triage-live-'));
  try {
    const run = (args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'eval', 'score-live.js'), ...args], { encoding: 'utf8' });
    const good = path.join(dir, 'good.json');
    fs.writeFileSync(good, JSON.stringify(results('oracle')));
    const ok = run([good]);
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /54 of 54 emails have a result/);
    const partial = results('oracle');
    delete partial.N02;
    const gap = path.join(dir, 'gap.json');
    fs.writeFileSync(gap, JSON.stringify(partial));
    assert.strictEqual(run([gap]).status, 1);
    const none = run([]);
    assert.strictEqual(none.status, 1);
    assert.match(none.stderr, /Usage/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
