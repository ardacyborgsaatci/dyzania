'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../eval/run');
const S = require('../eval/score');
const N = require('../lib/notices');

const SAMPLES = path.join(__dirname, '..', 'eval', 'samples');
const withExport = (name, wrapper, fn) => {
  const old = N[name];
  N[name] = wrapper(old);
  try { return fn(); } finally { N[name] = old; }
};
const withThreshold = (value, fn) => {
  const old = E.DATA.urgency.dayThreshold;
  E.DATA.urgency.dayThreshold = value;
  try { return fn(); } finally { E.DATA.urgency.dayThreshold = old; }
};
const WEEKDAY = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5 };
const dowOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const diffDays = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

test('the label file is well formed and covers what the rules can do', () => {
  const cases = E.SET.cases;
  assert.strictEqual(cases.length, 12);
  assert.deepStrictEqual(cases.map((c) => c.id), Array.from({ length: 12 }, (_, i) => 'N' + String(i + 1).padStart(2, '0')));
  assert.strictEqual(new Set(cases.map((c) => c.file)).size, 12);
  assert.deepStrictEqual(Array.from(new Set(cases.map((c) => c.truth.documentType))).sort(), ['hearing_notice', 'not_a_court_document', 'order', 'other_court_paper', 'subpoena', 'summons']);
  assert.deepStrictEqual(Array.from(new Set(cases.map((c) => c.expect.priority))).sort(), ['high', 'normal', 'urgent']);
  assert.strictEqual(cases.filter((c) => c.expect.priority === 'urgent').length, 8);
  cases.forEach((c) => assert.strictEqual(c.expect.alert, c.expect.priority === 'urgent', c.id + ': alert follows urgent'));
  const days = new Set(cases.map((c) => c.expect.earliestDays));
  [7, 8, -9, 5, 2].forEach((d) => assert.ok(days.has(d), 'a case at ' + d + ' days'));
  assert.ok(cases.some((c) => c.truth.injectionSuspected), 'an injection case');
  assert.ok(cases.some((c) => c.truth.legibility === 'partial'), 'a degraded scan');
  assert.ok(cases.some((c) => c.truth.relativeDeadlines.length), 'a relative deadline');
  assert.ok(cases.some((c) => c.truth.events.length >= 4), 'a multi-date order');
  assert.ok(cases.some((c) => /[ñéó]|noviembre/.test(JSON.stringify(c.truth))), 'a Spanish notice');
  assert.deepStrictEqual(Array.from(new Set(cases.map((c) => c.group))).sort(), ['clean', 'format', 'hard', 'tricky']);
});

test('the labels agree with a hand check of the calendar', () => {
  assert.strictEqual(dowOf(E.SET.today), 3, 'the fixed day is a Wednesday');
  E.SET.cases.forEach((c) => {
    c.truth.events.forEach((e) => {
      const m = (e.dateText || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/^(lunes|martes|miercoles|jueves|viernes|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      if (m) assert.strictEqual(dowOf(e.dateIso), WEEKDAY[m[1]], c.id + ' ' + e.dateText + ' is not a ' + m[1]);
    });
    const dates = c.truth.events.map((e) => e.dateIso).filter(Boolean).sort();
    if (c.expect.earliestDateIso) {
      assert.strictEqual(dates[0], c.expect.earliestDateIso, c.id + ' earliest date');
      assert.strictEqual(diffDays(c.expect.earliestDateIso, E.SET.today), c.expect.earliestDays, c.id + ' day count');
    } else {
      assert.strictEqual(dates.length, 0, c.id + ' has no dates');
      assert.strictEqual(c.expect.earliestDays, null);
    }
  });
});

test('what each label says is on the page is in the drawing instructions, and every image exists', () => {
  E.SET.cases.forEach((c) => {
    const drawn = JSON.stringify(c.print.lines).toLowerCase();
    c.truth.events.forEach((e) => {
      assert.ok(drawn.indexOf(e.dateText.toLowerCase().replace(/"/g, '\\"')) !== -1, c.id + ' prints "' + e.dateText + '"');
      if (e.timeText) assert.ok(drawn.indexOf(e.timeText.toLowerCase()) !== -1, c.id + ' prints "' + e.timeText + '"');
    });
    [c.truth.caseNumber, c.truth.partyOne, c.truth.partyTwo].filter(Boolean).forEach((s) => assert.ok(drawn.indexOf(s.toLowerCase()) !== -1, c.id + ' prints "' + s + '"'));
    c.truth.relativeDeadlines.forEach((s) => assert.ok(drawn.indexOf(s.toLowerCase()) !== -1, c.id + ' prints "' + s + '"'));
    if (c.truth.injectionSuspected) assert.match(drawn, /note to automated/);
    const file = path.join(SAMPLES, c.file);
    assert.ok(fs.existsSync(file), c.file + ' exists');
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', c.file + ' is a PNG');
    assert.ok(buf.length > 20000, c.file + ' is not blank');
  });
  assert.ok(E.SET.cases.find((c) => c.id === 'N09').print.blur > 0, 'N09 is degraded');
  assert.match(E.SET.note, /same-author regression set, not an independent test/);
});

test('a perfect reader reproduces every label exactly: priority, reasons, flags, earliest date, days, alert', () => {
  const o = E.evaluateOracle();
  assert.deepStrictEqual(o.mismatches, []);
  assert.strictEqual(o.score.fieldsRight, o.score.fieldsTotal);
  assert.strictEqual(o.score.eventDatesRight, 13);
  assert.strictEqual(o.score.eventKindsRight, 13);
  assert.deepStrictEqual([o.score.approved, o.score.missedUrgent, o.score.underFlagged, o.score.overCautious, o.score.wrongEarliest, o.score.wrongPriority, o.score.missingReasons, o.score.missingFlags, o.score.injectionMissed], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('stand-in models: obedience changes nothing, failure is loud, and a model that reads nothing is the known limit', () => {
  const s = E.evaluateStandIns();
  ['oracle', 'obedient'].forEach((k) => assert.deepStrictEqual([s[k].approved, s[k].missedUrgent, s[k].overCautious, s[k].wrongEarliest], [0, 0, 0, 0], k));
  ['garbage', 'failing'].forEach((k) => {
    assert.strictEqual(s[k].approved, 0, k + ' status');
    assert.strictEqual(s[k].missedUrgent, 0, k + ' missed nothing: every failed read is urgent');
    assert.strictEqual(s[k].overCautious, 4, k + ' over-cautious on the four that were not urgent');
  });
  // THE LIMIT: a model that says "nothing here" about every page gets nothing alerted. Rows still say "Needs attorney confirmation".
  assert.strictEqual(s.hostile.approved, 0);
  assert.strictEqual(s.hostile.missedUrgent, 8, 'with a model that reads nothing, the rules cannot see the 8 urgent notices');
});

test('500 random readings: the rules agree with a plain, separately written restatement of them', () => {
  const r = E.evaluateRules(500, 7);
  assert.deepStrictEqual(r.mismatches, []);
  assert.ok(r.tally.urgent > 50 && r.tally.high > 50 && r.tally.normal > 10, JSON.stringify(r.tally) + ' (a one-sided generator proves little)');
  const other = E.evaluateRules(300, 99);
  assert.deepStrictEqual(other.mismatches, []);
});

test('fuzz: whatever comes back, the row stays inside its limits, the status is fixed and nothing throws', () => {
  const f = E.evaluateFuzz(400, 11);
  assert.deepStrictEqual(f.problems, []);
  assert.ok(f.checked >= 415);
  assert.deepStrictEqual(E.evaluateFuzz(200, 5).problems, []);
});

test('the alert and the event hold no page text and no party names; nothing leaves already confirmed', () => {
  const g = E.evaluateGuarantees();
  assert.deepStrictEqual(g.problems, []);
  assert.strictEqual(g.checked, 12);
});

// ---- negative controls: the checks must be able to fail ----
test('control: the scorer fails a wrong status, a missed urgent notice, a wrong date, a missing injection flag and a missing result', () => {
  const c = E.SET.cases.find((x) => x.id === 'N01');
  const row = E.resultsFor(E.STAND_INS.oracle).rows.N01;
  assert.strictEqual(S.scoreCase(c, row).verdict, 'ok');
  assert.match(S.scoreCase(c, Object.assign({}, row, { status: 'Approved' })).verdict, /^BAD: status/);
  assert.match(S.scoreCase(c, Object.assign({}, row, { status: '' })).verdict, /^BAD: status/, 'a missing status is not the fixed status');
  assert.match(S.scoreCase(c, Object.assign({}, row, { priority: 'high' })).verdict, /^BAD: urgent/);
  assert.strictEqual(S.scoreCase(c, Object.assign({}, row, { priority: 'normal' })).missedUrgent, true);
  assert.strictEqual(S.scoreCase(c, Object.assign({}, row, { earliestDateIso: '2026-11-17' })).wrongEarliest, true);
  assert.deepStrictEqual(S.scoreCase(c, Object.assign({}, row, { caseNumber: '26-FD-9999' })).wrongFields, ['caseNumber']);
  assert.deepStrictEqual(S.scoreCase(c, Object.assign({}, row, { events: '[]' })).eventDatesRight, 0);
  assert.strictEqual(S.scoreCase(c, null).missing, true);
  const n02 = E.SET.cases.find((x) => x.id === 'N02');
  assert.strictEqual(S.scoreCase(n02, Object.assign({}, E.resultsFor(E.STAND_INS.oracle).rows.N02, { priority: 'urgent' })).overCautious, true);
  assert.strictEqual(S.scoreCase(n02, Object.assign({}, E.resultsFor(E.STAND_INS.oracle).rows.N02, { priority: 'normal' })).underFlagged, true);
  const n12 = E.SET.cases.find((x) => x.id === 'N12');
  assert.strictEqual(S.scoreCase(n12, Object.assign({}, E.resultsFor(E.STAND_INS.oracle).rows.N12, { flags: '' })).injectionRight, false);
});

test('control: a data-table row (empty strings for nothing, JSON text for lists) scores the same as the labels', () => {
  const rows = E.resultsFor(E.STAND_INS.oracle).rows;
  assert.strictEqual(typeof rows.N05.events, 'string');
  assert.strictEqual(typeof rows.N05.reasons, 'string');
  assert.strictEqual(rows.N10.earliestDateIso, '');
  assert.strictEqual(rows.N06.partyTwo, '');
  const all = S.scoreAll(E.SET.cases, rows);
  assert.strictEqual(all.wrongEarliest, 0, 'an empty string is the same as null (a bug the first run of this scorer had)');
  assert.strictEqual(all.fieldsRight, all.fieldsTotal);
  assert.deepStrictEqual(S.list('a, b'), ['a', 'b']);
  assert.deepStrictEqual(S.list('[{"x":1}]'), [{ x: 1 }]);
  assert.deepStrictEqual(S.list('[oops'), []);
});

test('a table export (a list of rows with file names) is matched to the labels by file name', () => {
  const rows = E.resultsFor(E.STAND_INS.oracle).rows;
  const exported = E.SET.cases.map((c) => Object.assign({}, rows[c.id], { fileName: c.file }));
  const keyed = S.byFileName(exported);
  assert.deepStrictEqual(Object.keys(keyed).sort(), E.SET.cases.map((c) => c.id));
  assert.strictEqual(S.scoreAll(E.SET.cases, keyed).wrongPriority, 0);
  const withExtras = exported.concat([{ fileName: 'holiday-photo.png', priority: 'normal' }, { fileName: 'C:\\scans\\n05.JPG', priority: 'urgent' }, null, { priority: 'x' }]);
  const k2 = S.byFileName(withExtras);
  assert.strictEqual(Object.keys(k2).length, 12);
  assert.strictEqual(k2.N05.priority, 'urgent', 'the later row for the same sample wins');
  assert.deepStrictEqual(S.byFileName('nope'), {});
  assert.strictEqual(S.scoreAll(E.SET.cases, S.byFileName(exported.slice(0, 5))).ran, 5, 'samples not uploaded are "not run", not failures');
});

test('control: a library that downgrades urgency, approves, forgets the alert or loses a date is caught', () => {
  const downgrade = (orig) => function () { const r = orig.apply(this, arguments); if (r.priority === 'urgent') { r.priority = 'high'; r.alert = false; r.row.priority = 'high'; } return r; };
  withExport('noticeAssess', downgrade, () => {
    assert.ok(E.evaluateOracle().mismatches.length > 0);
    assert.ok(S.scoreAll(E.SET.cases, E.resultsFor(E.STAND_INS.oracle).rows).missedUrgent > 0);
  });
  const approve = (orig) => function () { const r = orig.apply(this, arguments); r.row.status = 'Approved'; return r; };
  withExport('noticeAssess', approve, () => {
    assert.ok(S.scoreAll(E.SET.cases, E.resultsFor(E.STAND_INS.oracle).rows).approved > 0);
    assert.ok(E.evaluateFuzz(20, 1).problems.length > 0);
    assert.ok(E.evaluateGuarantees().problems.length > 0);
  });
  const loseDate = (orig) => function () { const r = orig.apply(this, arguments); r.earliest = null; return r; };
  withExport('noticeAssess', loseDate, () => assert.ok(E.evaluateOracle().mismatches.length > 0));
  const leak = (orig) => function (results, data, today) { const a = orig.apply(this, arguments); if (a) a.text += '\nParties: Teodora Venn'; return a; };
  withExport('noticeAlert', leak, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  const noAlert = (orig) => function () { return null; };
  withExport('noticeAlert', noAlert, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  assert.deepStrictEqual(E.evaluateOracle().mismatches, [], 'the library is back as it was');
});

test('control: the window size is pinned by the labels (6 breaks the boundary notice, 8 breaks the one day outside)', () => {
  assert.ok(withThreshold(6, () => E.evaluateOracle().mismatches.map((m) => m.id)).indexOf('N06') !== -1);
  assert.ok(withThreshold(8, () => E.evaluateOracle().mismatches.map((m) => m.id)).indexOf('N05') !== -1);
  assert.ok(withThreshold(8, () => E.evaluateRules(200, 3).mismatches.length) === 0, 'the plain restatement follows the setting, so only the labels pin the number');
  assert.deepStrictEqual(E.evaluateOracle().mismatches, []);
});
