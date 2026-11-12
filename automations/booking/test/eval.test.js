'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../eval/run');
const B = require('../lib/booking');

const ids = (r) => r.failed.map((x) => x.id);
// Change one number in the shared data for the duration of fn, then put it back.
function withData(path, value, fn) {
  const parts = path.split('.');
  let o = E.DATA;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const key = parts[parts.length - 1], old = o[key];
  o[key] = value;
  try { return fn(); } finally { o[key] = old; }
}
function withExport(name, wrapper, fn) {
  const old = B[name];
  B[name] = wrapper(old);
  try { return fn(); } finally { B[name] = old; }
}

test('the case file is well formed and covers every outcome the rules can give', () => {
  const cases = E.SET.cases;
  assert.strictEqual(cases.length, 86);
  assert.strictEqual(new Set(cases.map((c) => c.id)).size, cases.length, 'ids are unique');
  const kinds = {};
  cases.forEach((c) => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; assert.ok(Array.isArray(c.tags) && c.tags.length, c.id); assert.ok(c.expect, c.id); });
  assert.deepStrictEqual(kinds, { offer: 13, book: 60, verify: 8, cancel: 5 });
  const book = cases.filter((c) => c.kind === 'book');
  const codes = new Set(book.map((c) => c.expect.code));
  assert.deepStrictEqual(Array.from(codes).sort(), ['already_booked', 'booked', 'conflict_hold', 'invalid', 'not_offered', 'slot_taken', 'spam']);
  assert.deepStrictEqual(Array.from(new Set(book.filter((c) => c.expect.reason).map((c) => c.expect.reason))).sort(), ['beyond_horizon', 'outside_hours', 'too_soon']);
  ['family', 'injury', 'employment', 'estate'].forEach((a) => assert.ok(book.some((c) => c.expect.code === 'booked' && ((c.request || {}).area || 'family') === a), 'a booking for ' + a));
  ['dana-hollis', 'marcus-marr', 'elena-voss', 'tomas-reyes'].forEach((a) => assert.ok(book.some((c) => c.expect.attorney === a), 'a case that ends with ' + a));
  const tags = new Set([].concat.apply([], cases.map((c) => c.tags)));
  ['dst', 'buffer', 'boundary', 'race', 'conflict', 'person-limit', 'injection', 'input', 'voice', 'notice', 'horizon', 'stale-slot', 'status', 'spam', 'assign', 'cancel'].forEach((t) => assert.ok(tags.has(t), 'tag ' + t));
  assert.ok(book.some((c) => (c.request || {}).channel === 'voice'));
  cases.filter((c) => c.kind === 'book').forEach((c) => assert.ok(c.startLocal || c.startRaw, c.id + ' has a start'));
  const text = JSON.stringify(cases);
  assert.ok((text.match(/@[a-z.]+/g) || []).every((m) => /\.example/.test(m)), 'every address uses a .example domain');
});

test('the labels agree with a hand check of the calendar', () => {
  // the weekday of every date used in a label, checked against what the labels claim in comments and in the firm data
  const dow = (stamp) => new Date(stamp.slice(0, 10) + 'T12:00:00Z').toUTCString().slice(0, 3);
  assert.strictEqual(dow('2026-11-11'), 'Wed');
  assert.strictEqual(dow('2026-11-12'), 'Thu');
  assert.strictEqual(dow('2026-12-11'), 'Fri');
  assert.strictEqual(dow('2027-03-16'), 'Tue');
  assert.strictEqual(E.stampOf(E.brute('2026-11-12 10:00')), '2026-11-12 10:00');
  assert.strictEqual(E.iso(E.brute('2026-11-12 10:00')), '2026-11-12T16:00:00Z');
  assert.strictEqual(E.iso(E.brute('2026-10-30 10:00')), '2026-10-30T15:00:00Z');
  assert.throws(() => E.brute('2027-03-14 02:30'), /does not exist/);
});

test('every labelled case matches', () => {
  const r = E.evaluateCases();
  assert.deepStrictEqual(r.failed, []);
  assert.strictEqual(r.passed, 86);
});

test('the library gives the same free slots as the brute-force oracle, including across daylight saving', () => {
  const r = E.evaluateOracle();
  assert.deepStrictEqual(r.mismatches, []);
  assert.ok(r.checked >= 70, 'checked ' + r.checked);
  assert.ok(r.slotsChecked > 15000, 'compared ' + r.slotsChecked + ' start times');
});

test('random bookings made one after another never break the rules', () => {
  const r = E.evaluateSimulation();
  assert.deepStrictEqual(r.problems, []);
  assert.ok(r.booked > 100 && r.refused > 100, r.booked + ' booked, ' + r.refused + ' refused');
});

test('requests that race on a stale snapshot end with a valid set, and the verdict does not depend on who asks', () => {
  const r = E.evaluateRace();
  assert.deepStrictEqual(r.problems, []);
  assert.ok(r.losers > 20, 'only ' + r.losers + ' rows lost; the races are too easy');
});

test('the guarantees hold for every labelled booking', () => {
  const r = E.evaluateGuarantees();
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.checked, 60);
});

// ---- negative controls: the scorer must be able to fail ----
test('control: each number in the firm data is pinned by at least one label', () => {
  const pins = [
    ['availability.booking.bufferMinutes', 30, ['O07', 'B22']],
    ['availability.booking.bufferMinutes', 0, ['O07', 'O08']],
    ['availability.booking.minNoticeHours', 3, ['O05', 'B14']],
    ['availability.booking.minNoticeHours', 5, ['O05', 'B15']],
    ['availability.booking.horizonDays', 29, ['O02', 'B18']],
    ['availability.booking.horizonDays', 31, ['B19', 'O06']],
    ['availability.booking.slotStepMinutes', 30, ['O01']],
    ['availability.booking.maxActiveBookingsPerPerson', 2, ['B24', 'B25']],
    ['availability.booking.requiresConflictClear', false, ['B29', 'B30']],
    ['availability.booking.cancelNoticeHours', 23, ['C03']],
    ['availability.booking.cancelNoticeHours', 25, ['C02']]
  ];
  pins.forEach(([path, value, expected]) => {
    const failed = withData(path, value, () => ids(E.evaluateCases()));
    expected.forEach((id) => assert.ok(failed.indexOf(id) !== -1, path + '=' + value + ' should fail ' + id + ' but failed: ' + failed.join(',')));
  });
});

test('control: the consultation length and the weekly windows are pinned too', () => {
  const fam = E.DATA.areas.areas.find((a) => a.id === 'family');
  const short = JSON.parse(JSON.stringify(fam.consult)); fam.consult.minutes = 30;
  try { assert.ok(ids(E.evaluateCases()).indexOf('B01') !== -1 && ids(E.evaluateCases()).indexOf('O01') !== -1); } finally { fam.consult.minutes = short.minutes; }
  const w = E.DATA.availability.windows['elena-voss'], saved = JSON.parse(JSON.stringify(w));
  w.splice(2, 1); // drop her Thursday window
  try { assert.ok(ids(E.evaluateCases()).indexOf('O01') !== -1); } finally { w.length = 0; saved.forEach((x) => w.push(x)); }
  assert.deepStrictEqual(ids(E.evaluateCases()), [], 'the data is back as it was');
});

test('control: a library that drops a slot, doubles the buffer or forgets the race is caught', () => {
  const dropLast = (orig) => function () { const r = orig.apply(this, arguments); return r.slice(0, -1); };
  withExport('bookOffers', dropLast, () => {
    assert.ok(E.evaluateOracle(5).mismatches.length > 0);
    assert.ok(ids(E.evaluateCases()).length > 0);
  });
  const addSlot = (orig) => function () { const r = orig.apply(this, arguments); return r.concat([{ startMs: r[r.length - 1].startMs + 900000, endMs: r[r.length - 1].endMs + 900000, attorneys: ['dana-hollis'] }]); };
  withExport('bookOffers', addSlot, () => assert.ok(E.evaluateOracle(5).mismatches.length > 0));
  withExport('bookVerify', (orig) => function (id) { const r = orig.apply(this, arguments); return Object.assign({}, r, { won: true }); }, () => assert.ok(ids(E.evaluateCases()).length > 0 || E.evaluateRace().problems.length > 0));
  withExport('bookVerify', (orig) => function (id, rows, now, data) { const r = orig.apply(this, arguments); return { accepted: rows.map((x) => x.id), lost: {}, won: true }; }, () => assert.ok(E.evaluateRace().problems.length > 0));
  assert.deepStrictEqual(ids(E.evaluateCases()), []);
});

test('control: a library that leaks, over-promises or books through a hold is caught', () => {
  withExport('bookDecide', (orig) => function () { const r = orig.apply(this, arguments); if (r.code === 'conflict_hold') { r.public = { ok: false, code: 'contact_office', message: 'There is a conflict with ' + arguments[0].otherSide }; } return r; }, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  withExport('bookDecide', (orig) => function () { const r = orig.apply(this, arguments); if (r.code === 'booked') r.confirmation = { subject: r.confirmation.subject, text: r.confirmation.text + '\nWe guarantee a good result.' }; return r; }, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  withExport('bookDecide', (orig) => function () { const r = orig.apply(this, arguments); if (r.code === 'booked') r.confirmation = { subject: r.confirmation.subject, text: r.confirmation.text.replace(/This is general information, not legal advice\./, '') }; return r; }, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  withExport('bookDecide', (orig) => function () { const r = orig.apply(this, arguments); r.event = Object.assign({}, r.event, { name: arguments[0].name }); return r; }, () => assert.ok(E.evaluateGuarantees().problems.length > 0));
  withExport('bookDecide', (orig) => function () { const r = orig.apply(this, arguments); if (r.code === 'conflict_hold') { r.code = 'booked'; r.ok = true; } return r; }, () => assert.ok(ids(E.evaluateCases()).length > 0));
  assert.deepStrictEqual(E.evaluateGuarantees().problems, []);
});
