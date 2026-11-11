'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreCase, scoreAll } = require('../score.js');
const data = require('../invoices.json');
const byId = Object.fromEntries(data.cases.map((c) => [c.id, c]));

test('12 cases, 12 image files exist', () => {
  assert.strictEqual(data.cases.length, 12);
  for (const c of data.cases) assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'samples', c.file)), c.file);
});
test('truth amounts add up for every approvable case', () => {
  for (const c of data.cases.filter((c) => c.expect.status !== 'review')) {
    const t = c.truth;
    assert.ok(Math.abs(t.subtotal + t.tax - t.total) < 0.005, c.id);
  }
});
test('perfect answers score clean', () => {
  const results = {};
  for (const c of data.cases) if (c.truth) results[c.id] = { ...c.truth, status: c.expect.status === 'review' ? 'Needs review' : 'Auto-approved' };
  results.I12 = { status: 'Needs review' };
  const s = scoreAll(data.cases, results);
  assert.strictEqual(s.badApprovals, 0);
  assert.strictEqual(s.ran, 12);
});
test('approving a mismatched bill is flagged', () => {
  const r = scoreCase(byId.I10, { ...byId.I10.truth, status: 'Auto-approved' });
  assert.ok(r.verdict.startsWith('BAD'));
});
test('approving with a wrong value is flagged; review of a clean bill is only over-cautious', () => {
  assert.ok(scoreCase(byId.I01, { ...byId.I01.truth, total: 423, status: 'Auto-approved' }).verdict.startsWith('BAD'));
  assert.ok(scoreCase(byId.I01, { ...byId.I01.truth, status: 'Needs review' }).verdict.startsWith('over'));
});
