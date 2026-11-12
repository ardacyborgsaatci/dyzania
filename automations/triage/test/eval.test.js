'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../eval/run');

const clone = (o) => JSON.parse(JSON.stringify(o));
const find = (id) => E.SET.emails.find((e) => e.id === id);

test('the evaluation set is well formed and covers every category, draft mode and queue', () => {
  const emails = E.SET.emails;
  assert.strictEqual(emails.length, 54);
  assert.strictEqual(new Set(emails.map((e) => e.id)).size, emails.length, 'ids are unique');
  emails.forEach((e) => {
    ['category', 'priority', 'urgency', 'needsHuman', 'draftMode', 'queue'].forEach((k) => assert.ok(e.expect[k] !== undefined, e.id + ' missing ' + k));
    assert.ok(Array.isArray(e.tags) && e.tags.length > 0, e.id);
  });
  const seen = (k) => new Set(emails.map((e) => e.expect[k]));
  assert.deepStrictEqual(Array.from(seen('category')).sort(), E.DATA.urgency.triageCategories.slice().sort());
  assert.deepStrictEqual(Array.from(seen('draftMode')).sort(), ['acknowledgement', 'none', 'standard']);
  assert.deepStrictEqual(Array.from(seen('priority')).sort(), ['high', 'low', 'normal', 'urgent']);
  assert.deepStrictEqual(Array.from(seen('queue')).sort(), ['billing', 'case_team', 'front_desk', 'intake', 'matter_attorney', 'none', 'records', 'urgent']);
  assert.ok(emails.filter((e) => e.expect.injection).length >= 4);
  assert.ok(emails.filter((e) => e.expect.language === 'es').length >= 3);
  assert.ok(emails.some((e) => e.tags.includes('date-window')) && emails.some((e) => e.tags.includes('false-positive-trap')));
  assert.ok(E.SET.emails.every((e) => !/@(?!.*\.example\b)/.test(e.from)), 'every address uses a .example domain');
});

test('with a perfect model every field of every email matches its label', () => {
  const r = E.evaluateOracle();
  assert.deepStrictEqual(r.mismatches, []);
  E.FIELDS.forEach((f) => assert.strictEqual(r.perField[f], 54, f));
  assert.deepStrictEqual(r.urgencyLimits, ['U06']);
});

test('whatever the model says, the rule guarantees hold on every email the rules can see', () => {
  const h = E.evaluateGuarantees('hostile');
  const n = E.evaluateGuarantees('rules');
  assert.deepStrictEqual(h.violations, []);
  assert.deepStrictEqual(n.violations, []);
  const limits = ['U06', 'X01', 'X02', 'X03'];
  assert.deepStrictEqual(h.limits.slice().sort(), limits);
  assert.deepStrictEqual(n.limits.slice().sort(), limits);
  assert.strictEqual(h.checked, 54 - limits.length);
});

test('the rule screen alone misses exactly one labelled email (a Spanish one), and that is stated', () => {
  const u = E.evaluateUrgency();
  assert.deepStrictEqual(u.missed.map((m) => m.id), ['U06']);
  assert.ok(find('U06').tags.includes('known-limit'));
});

test('the checker can fail: each guarantee is broken by a tampered result', () => {
  const run = (id, mode) => E.runOne(find(id), mode || 'oracle');
  const broke = (id, tamper) => { const r = clone(run(id)); tamper(r); return E.guarantees(find(id), r); };
  assert.deepStrictEqual(E.guarantees(find('K02'), run('K02')), []);
  assert.ok(broke('K02', (r) => { r.priority = 'normal'; }).includes('urgent_not_raised_and_alerted'));
  assert.ok(broke('K02', (r) => { r.alert.send = false; }).includes('urgent_not_raised_and_alerted'));
  assert.ok(broke('C02', (r) => { r.priority = 'normal'; }).includes('check_not_high_and_flagged'));
  assert.ok(broke('K01', (r) => { r.draftMode = 'standard'; }).includes('draft_where_none_expected'));
  assert.ok(broke('I01', (r) => { r.handoff = 'intake'; }).includes('injection_not_contained'));
  assert.ok(broke('I02', (r) => { r.injectionSuspected = false; }).includes('injection_not_contained'));
  assert.ok(broke('A01', (r) => { r.queue = 'front_desk'; }).includes('auto_reply_not_quiet'));
  assert.ok(broke('K05', (r) => { r.category = 'other'; }).includes('court_mail_not_handled'));
  assert.ok(broke('O05', (r) => { r.draftMode = 'standard'; }).includes('counsel_mail_not_held'));
});

test('the checker can fail: weakening the rule data is caught by the evaluation', () => {
  const weaker = (edit) => { const d = clone(E.DATA); edit(d); return E.evaluate(d); };
  // no known courts: court mail is no longer recognised without the model
  let r = weaker((d) => { d.rules.knownCourtDomains = []; });
  assert.ok(r.hostile.violations.some((v) => v.broken.includes('court_mail_not_handled')));
  // no lawyer cues: mail from another lawyer is no longer held without the model
  r = weaker((d) => { d.rules.counselCues = []; });
  assert.ok(r.hostile.violations.some((v) => v.broken.includes('counsel_mail_not_held')));
  // the 7-day window shrinks: a hearing in 6 days is no longer urgent
  r = weaker((d) => { d.urgency.dayThreshold = 2; });
  assert.ok(r.hostile.violations.some((v) => v.broken.includes('urgent_not_raised_and_alerted')));
  // served papers and hearings are no longer recognised
  r = weaker((d) => { d.urgency.categories = d.urgency.categories.filter((c) => !['served_papers', 'court_date'].includes(c.id)); });
  assert.ok(r.hostile.violations.length >= 3);
  assert.ok(r.urgency.missed.length >= 3);
  // an auto-reply pattern list that is empty lets the out-of-office through
  r = weaker((d) => { d.rules.autoReply = { subjectPatterns: [], senderContains: [] }; });
  assert.ok(r.hostile.violations.some((v) => v.broken.includes('auto_reply_not_quiet')));
});

test('a wrong label is reported as a mismatch (negative control)', () => {
  const copy = clone(E.SET);
  const set = copy.emails.find((e) => e.id === 'N01');
  const original = set.expect.draftMode;
  const real = E.SET.emails.find((e) => e.id === 'N01');
  real.expect.draftMode = 'none';
  try {
    const r = E.evaluateOracle();
    assert.deepStrictEqual(r.mismatches.map((m) => m.id), ['N01']);
    assert.deepStrictEqual(r.mismatches[0].wrong, ['draftMode']);
  } finally {
    real.expect.draftMode = original;
  }
  assert.deepStrictEqual(E.evaluateOracle().mismatches, []);
});
