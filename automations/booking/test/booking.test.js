'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../lib/booking');
const { loadBookingData } = require('../lib/data');
const { validateIntake } = require('../../intake/lib/intake');

const TZ = 'America/Chicago';
const fresh = () => JSON.parse(JSON.stringify(loadBookingData()));
const DATA = loadBookingData();
const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);
const NOW = utc(2026, 11, 11, 20, 0); // Wed 2026-11-11 14:00 CST
const request = (o) => Object.assign({ name: 'Priya Nandakumar', email: 'priya.n@mail.example', phone: '', area: 'family', otherSide: 'Birchwood Appliance Repair', consent: true, channel: 'form' }, o);
const row = (id, att, startMs, mins, o) => Object.assign({
  id, bookingRef: 'DY-T' + id, status: 'booked', area: 'family', attorney: att, startUtc: B.bookIso(startMs), endUtc: B.bookIso(startMs + mins * 60000),
  name: 'Fixture Person', email: 'fixture' + id + '@mail.example', phone: ''
}, o);
const decide = (req, rows, now, data) => B.bookDecide(req, rows || [], now == null ? NOW : now, data || DATA, { ref: 'DY-TEST01', now: B.bookIso(now == null ? NOW : now) });

test('local time to UTC follows daylight saving, in both directions', () => {
  assert.strictEqual(B.bookLocalToUtc(2026, 10, 30, 10, 0, TZ), utc(2026, 10, 30, 15, 0), 'CDT is UTC-5');
  assert.strictEqual(B.bookLocalToUtc(2026, 11, 2, 9, 0, TZ), utc(2026, 11, 2, 15, 0), 'CST is UTC-6');
  assert.strictEqual(B.bookLocalToUtc(2027, 3, 12, 10, 0, TZ), utc(2027, 3, 12, 16, 0));
  assert.strictEqual(B.bookLocalToUtc(2027, 3, 16, 10, 0, TZ), utc(2027, 3, 16, 15, 0));
  assert.strictEqual(B.bookLocalToUtc(2027, 3, 14, 2, 30, TZ), null, 'the spring-forward hour does not exist');
  assert.strictEqual(B.bookLocalToUtc(2027, 3, 14, 3, 0, TZ), utc(2027, 3, 14, 8, 0));
  assert.strictEqual(B.bookLocalToUtc(2026, 11, 1, 1, 30, TZ), utc(2026, 11, 1, 6, 30), 'the repeated hour takes the first one');
  assert.strictEqual(B.bookStamp(utc(2026, 11, 1, 7, 30), TZ), '2026-11-01 01:30', 'and the second one reads the same on the clock');
});

test('local time round-trips for every 15 minutes over two years', () => {
  let n = 0, repeated = 0;
  for (let t = utc(2026, 1, 1, 0, 0); t < utc(2028, 1, 1, 0, 0); t += 15 * 60000) {
    const p = B.bookLocalParts(t, TZ);
    const back = B.bookLocalToUtc(p.y, p.m, p.d, p.hh, p.mm, TZ);
    n++;
    if (back === t) continue;
    assert.strictEqual(back, t - 3600000, 'only the repeated hour may come back an hour earlier: ' + B.bookStamp(t, TZ));
    repeated++;
  }
  assert.ok(n > 70000);
  assert.strictEqual(repeated, 8, 'four repeated 15-minute steps in each of two Novembers');
});

test('a start time must carry an offset and be a real moment', () => {
  const ok = (s, ms) => assert.strictEqual(B.bookParseStart(s), ms, s);
  ok('2026-11-12T16:00:00Z', utc(2026, 11, 12, 16, 0));
  ok('2026-11-12T16:00Z', utc(2026, 11, 12, 16, 0));
  ok('2026-11-12T10:00:00-06:00', utc(2026, 11, 12, 16, 0));
  ok('2026-11-12T10:00:00-0600', utc(2026, 11, 12, 16, 0));
  ok('2026-11-12T16:00:00.000Z', utc(2026, 11, 12, 16, 0));
  ok('2028-02-29T10:00:00Z', utc(2028, 2, 29, 10, 0));
  ['2026-02-29T10:00:00Z', '2026-04-31T10:00:00Z', '2026-11-12T10:00:60Z', '2026-11-12T24:00:00Z', '2026-11-12T10:60:00Z'].forEach((s) => assert.strictEqual(B.bookParseStart(s), null, s + ' is not a real moment'));
  ['2026-11-12T10:00:00', '2026-11-12 10:00', 'tomorrow', '', null, undefined, '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-12T25:00:00Z', '2026-11-12'].forEach((s) => assert.strictEqual(B.bookParseStart(s), null, String(s)));
});

test('slots: no missing or doubled times around a daylight-saving change', () => {
  const d = fresh();
  d.availability.windows['elena-voss'] = [{ day: 'sun', start: '01:00', end: '04:30' }];
  d.availability.windows['dana-hollis'] = [];
  d.availability.booking.minNoticeHours = 0;
  const slots = B.bookGenerate('family', utc(2027, 3, 10, 12, 0), d);
  const stamps = slots.map((s) => B.bookStamp(s.startMs, TZ));
  assert.ok(stamps.indexOf('2027-03-14 01:00') !== -1 && stamps.indexOf('2027-03-14 03:00') !== -1);
  assert.deepStrictEqual(stamps.filter((s) => s.startsWith('2027-03-14 02')), [], 'nothing at the times that do not exist');
  assert.strictEqual(new Set(slots.map((s) => s.startMs)).size, slots.length);
  const fall = B.bookGenerate('family', utc(2026, 10, 30, 12, 0), d);
  assert.strictEqual(new Set(fall.map((s) => s.startMs)).size, fall.length, 'no duplicate instants on the fall-back Sunday');
  fall.forEach((s, i) => { if (i) assert.ok(s.startMs > fall[i - 1].startMs); });
});

test('the gap after a consultation is its length plus the buffer, counted once, and comes from the data', () => {
  const booked = utc(2026, 11, 12, 19, 0); // Thu 13:00 local, 45 minutes: busy until 13:45, then a 60-minute gap (45 + 15)
  const offered = (att, minutesFromBooking, data) => B.bookOffers('family', [row(1, att, booked, 45)], NOW, data || DATA, {})
    .some((o) => o.startMs === booked + minutesFromBooking * 60000 && o.attorneys.indexOf(att) !== -1);
  assert.strictEqual(DATA.availability.booking.bufferMinutes, 15);
  assert.strictEqual(offered('elena-voss', -105), true, '11:15 to 12:00 leaves exactly the 60-minute gap before the 13:00 booking');
  assert.strictEqual(offered('elena-voss', -90), false, '11:30 to 12:15 leaves 45 minutes, not 60');
  assert.strictEqual(offered('elena-voss', -45), false, 'a 12:15 start overlaps the 13:00 booking');
  assert.strictEqual(offered('dana-hollis', 105), true, 'after the 13:45 end the gap is 60 minutes: a 14:45 start is allowed');
  assert.strictEqual(offered('dana-hollis', 90), false, 'a 14:30 start is inside the gap');
  const none = fresh(); none.availability.booking.bufferMinutes = 0;
  assert.strictEqual(offered('elena-voss', -90, none), true, 'with no buffer the gap is the 45-minute length alone: 11:30 to 12:15 ends exactly 45 minutes before 13:00');
  assert.strictEqual(offered('elena-voss', -75, none), false, '11:45 to 12:30 leaves only 30 minutes');
  const wide = fresh(); wide.availability.booking.bufferMinutes = 30;
  assert.strictEqual(offered('elena-voss', -120, wide), true, 'with a 30-minute buffer the gap is 75 minutes');
  assert.strictEqual(offered('elena-voss', -105, wide), false);
});

test('minimum notice and horizon come from the data too', () => {
  const edge = utc(2026, 11, 12, 18, 30); // Thu 12:30 local, four hours after 08:30
  const now = utc(2026, 11, 12, 14, 30);
  const first = (d) => B.bookOffers('family', [], now, d, {})[0].startMs;
  assert.strictEqual(first(DATA), edge, 'exactly four hours ahead is allowed');
  const three = fresh(); three.availability.booking.minNoticeHours = 3;
  assert.strictEqual(first(three), utc(2026, 11, 12, 17, 30));
  const short = fresh(); short.availability.booking.horizonDays = 7;
  const lastShort = B.bookOffers('family', [], NOW, short, {}).pop().startMs;
  assert.strictEqual(B.bookStamp(lastShort, TZ).slice(0, 10), '2026-11-17', 'day 7 from Wed Nov 11 is Wed Nov 18, and the last family day up to it is Tue Nov 17');
});

test('one person, one active booking: by email (any case) or by phone digits', () => {
  const t = utc(2026, 11, 19, 19, 0);
  const mine = (o) => decide(request(o), [row(1, 'dana-hollis', t, 45, { email: 'PRIYA.N@Mail.example', phone: '(555) 010-2323' })]).code;
  assert.strictEqual(mine({ start: '2026-11-12T16:00:00Z' }), 'already_booked');
  assert.strictEqual(mine({ start: '2026-11-12T16:00:00Z', email: 'other@mail.example' }), 'booked');
  assert.strictEqual(mine({ start: '2026-11-12T16:00:00Z', email: 'other@mail.example', phone: '555.010.2323' }), 'already_booked');
  const two = fresh(); two.availability.booking.maxActiveBookingsPerPerson = 2;
  const rows = [row(1, 'dana-hollis', t, 45, { email: 'priya.n@mail.example' })];
  assert.strictEqual(decide(request({ start: '2026-11-12T16:00:00Z' }), rows, NOW, two).code, 'booked');
  rows.push(row(2, 'dana-hollis', utc(2026, 12, 1, 16, 0), 45, { email: 'priya.n@mail.example' }));
  assert.strictEqual(decide(request({ start: '2026-11-12T16:00:00Z' }), rows, NOW, two).code, 'already_booked');
});

test('the conflict rule can be switched off in the data, and only there', () => {
  const req = request({ otherSide: 'Harlan Whitcombe', start: '2026-11-12T16:00:00Z' });
  assert.strictEqual(decide(req).code, 'conflict_hold');
  const off = fresh(); off.availability.booking.requiresConflictClear = false;
  assert.strictEqual(decide(req, [], NOW, off).code, 'booked');
});

test('the attorney is chosen by the rules: fewest future bookings, then the practice-area order', () => {
  const start = '2026-11-17T17:00:00Z'; // Tue 11:00 local, dana and elena both free
  const area = { area: 'estate', start };
  assert.strictEqual(decide(request(area)).row.attorney, 'dana-hollis');
  const dana = [row(1, 'dana-hollis', utc(2026, 12, 1, 16, 0), 45, { area: 'estate' })];
  assert.strictEqual(decide(request(area), dana).row.attorney, 'elena-voss');
  const both = dana.concat([row(2, 'elena-voss', utc(2026, 12, 8, 16, 0), 45, { area: 'estate' })]);
  assert.strictEqual(decide(request(area), both).row.attorney, 'dana-hollis', 'equal load goes back to the first listed');
  const past = [row(3, 'dana-hollis', utc(2026, 11, 3, 16, 0), 45)];
  assert.strictEqual(decide(request(area), past).row.attorney, 'dana-hollis', 'a finished consultation is not load');
});

test('verification keeps the earliest row and compares ids as numbers', () => {
  const t = utc(2026, 11, 12, 16, 0);
  const rows = [row(10, 'elena-voss', t, 45, { email: 'b@mail.example' }), row(9, 'elena-voss', t, 45, { email: 'a@mail.example' })];
  const v = B.bookVerify(10, rows, NOW, DATA);
  assert.deepStrictEqual(v.accepted, [9], 'id 9 was inserted before id 10');
  assert.strictEqual(v.won, false);
  assert.deepStrictEqual(v.lost, { 10: 'slot_taken' });
  assert.strictEqual(B.bookVerify('9', rows, NOW, DATA).won, true, 'string ids from the table work');
  assert.strictEqual(B.bookVerify(5, [], NOW, DATA).won, false, 'a row that is not there did not win');
  const past = [row(1, 'elena-voss', utc(2026, 11, 3, 16, 0), 45, { email: 'a@mail.example' }), row(2, 'elena-voss', utc(2026, 11, 12, 16, 0), 45, { email: 'a@mail.example' })];
  assert.strictEqual(B.bookVerify(2, past, NOW, DATA).won, true, 'an earlier booking that is over does not count against the person');
});

test('rows from the table: wrapped items, empty items and the wrong kind are handled', () => {
  const r = row(1, 'elena-voss', utc(2026, 11, 12, 16, 0), 45);
  assert.strictEqual(B.bookRows([{ json: r }, { json: {} }, {}, null, 'x', r]).length, 2);
  assert.deepStrictEqual(B.bookRows(null), []);
  const t = utc(2026, 11, 12, 16, 0);
  assert.strictEqual(B.bookOffers('family', B.bookRows([{}]), NOW, DATA, {})[0].startMs, t, 'an empty table gives one empty item in n8n; it must not hide slots');
  assert.strictEqual(B.bookListSlots({ area: 'family' }, [{}], NOW, DATA).ok, true);
});

test('two rows with a short or junk phone number are not taken to be one person', () => {
  const a = row(1, 'elena-voss', utc(2026, 11, 12, 16, 0), 45, { email: 'a@mail.example', phone: '12345' });
  const b = row(2, 'dana-hollis', utc(2026, 11, 12, 19, 0), 45, { email: 'b@mail.example', phone: '12345' });
  assert.deepStrictEqual(B.bookVerify(2, [a, b], NOW, DATA).accepted, [1, 2]);
});

test('rows that are not booked, or have bad times, never block a slot', () => {
  const t = utc(2026, 11, 12, 16, 0);
  const bad = [row(1, 'elena-voss', t, 45, { status: 'cancelled' }), row(2, 'elena-voss', t, 45, { status: 'held' }), row(3, 'elena-voss', t, 45, { startUtc: 'not a time' }), row(4, 'elena-voss', t, 45, { status: 'Booked ' })];
  assert.strictEqual(B.bookOffers('family', bad, NOW, DATA, {})[0].startMs, t);
});

test('the slot list: limits, paging, areas and bad input', () => {
  const all = B.bookListSlots({ area: 'family', limit: 100 }, [], NOW, DATA);
  assert.strictEqual(all.ok, true);
  assert.strictEqual(all.slots.length, 100);
  assert.strictEqual(all.more, true);
  assert.strictEqual(all.consultMinutes, 45);
  assert.match(all.fee, /\$150/);
  assert.strictEqual(B.bookListSlots({ area: 'injury', limit: 3 }, [], NOW, DATA).fee, 'No charge for this first consultation.');
  assert.strictEqual(B.bookListSlots({ area: 'family', limit: 0 }, [], NOW, DATA).slots.length, 40, 'a zero limit falls back to the default');
  assert.strictEqual(B.bookListSlots({ area: 'family', limit: 9999 }, [], NOW, DATA).slots.length, 100, 'and a huge one is capped');
  const first = B.bookListSlots({ area: 'family', limit: 2 }, [], NOW, DATA);
  assert.deepStrictEqual(first.slots.map((s) => s.start), ['2026-11-12T16:00:00Z', '2026-11-12T16:15:00Z']);
  assert.strictEqual(first.slots[0].label, 'Thu, Nov 12, 10:00 AM CST');
  const next = B.bookListSlots({ area: 'family', limit: 1, after: first.slots[1].start }, [], NOW, DATA);
  assert.strictEqual(next.slots[0].start, '2026-11-12T16:30:00Z');
  assert.strictEqual(B.bookListSlots({ area: 'criminal' }, [], NOW, DATA).ok, false);
  assert.strictEqual(B.bookListSlots({}, [], NOW, DATA).ok, false);
  assert.strictEqual(B.bookListSlots({ area: 'family', after: 'soon' }, [], NOW, DATA).ok, false);
  const text = JSON.stringify(first);
  assert.doesNotMatch(text, /elena|dana|marcus|tomas/i, 'the slot list never says who is free');
});

test('what the visitor is told: fixed words, and the same words for a hold and a repeat booking', () => {
  const t = utc(2026, 11, 19, 19, 0);
  const hold = decide(request({ otherSide: 'Harlan Whitcombe', start: '2026-11-12T16:00:00Z' })).public;
  const dup = decide(request({ start: '2026-11-12T16:00:00Z' }), [row(1, 'dana-hollis', t, 45, { email: 'priya.n@mail.example' })]).public;
  assert.deepStrictEqual(hold, dup);
  assert.strictEqual(hold.code, 'contact_office');
  assert.match(hold.message, /555-0142/);
  assert.doesNotMatch(hold.message, /conflict|already|booked|hold|client/i);
  const spam = decide(request({ website: 'http://x.example', start: '2026-11-12T16:00:00Z' }));
  assert.strictEqual(spam.public.code, 'unavailable');
  assert.strictEqual(spam.row, undefined);
  const taken = decide(request({ start: '2026-11-12T16:00:00Z' }), [row(1, 'elena-voss', utc(2026, 11, 12, 16, 0), 45)]);
  assert.strictEqual(taken.public.code, 'slot_unavailable');
  assert.ok(taken.public.alternatives.length >= 1 && taken.public.alternatives.length <= 3);
  assert.doesNotMatch(JSON.stringify(taken.public), /elena|dana|marcus|tomas/i);
});

test('the confirmation email is a fixed template with the booked facts', () => {
  const r = decide(request({ start: '2026-11-12T16:00:00Z', phone: '555-010-4444' }));
  assert.strictEqual(r.code, 'booked');
  const { subject, text } = r.confirmation;
  assert.strictEqual(subject, 'Your consultation with Dyzania LLP: Thu, Nov 12, 10:00 AM CST');
  assert.match(text, /^Hello Priya Nandakumar,/);
  assert.match(text, /When: Thursday, November 12, 2026 at 10:00 AM CST/);
  assert.match(text, /Time zone: Central Standard Time/);
  assert.match(text, /With: Elena Voss, associate attorney/);
  assert.match(text, /Fee: \$150 for this first consultation, credited toward the retainer/);
  assert.match(text, /Reference: DY-TEST01/);
  assert.match(text, /- Photo ID/);
  assert.match(text, /at least 24 hours/);
  assert.ok(text.indexOf(DATA.firm.language.notLegalAdvice) !== -1 && text.indexOf(DATA.firm.language.noConfidential) !== -1);
  assert.doesNotMatch(text, /555-010-4444|Birchwood|priya\.n@/, 'nothing from the form is repeated except the name');
  const summer = decide(request({ area: 'injury', start: '2026-10-30T15:00:00Z' }), [], utc(2026, 10, 27, 19, 0));
  assert.match(summer.confirmation.text, /10:00 AM CDT/);
  assert.match(summer.confirmation.text, /Central Daylight Time/);
  assert.match(summer.confirmation.text, /Fee: No charge for this first consultation\./);
});

test('the table row holds only the declared columns, and the event holds no personal data', () => {
  const { loadColumns } = require('../lib/data');
  const cols = loadColumns().map((c) => c.name);
  const r = decide(request({ start: '2026-11-12T16:00:00Z', phone: '555-010-4444', leadRef: 'DY-L-0042', attorney: 'dana-hollis', status: 'confirmed', id: 5 }));
  assert.deepStrictEqual(Object.keys(r.row).sort(), cols.slice().sort());
  assert.strictEqual(r.row.leadRef, 'DY-L-0042');
  assert.strictEqual(r.row.status, 'booked');
  assert.strictEqual(r.row.minutes, 45);
  assert.strictEqual(r.row.localDate + ' ' + r.row.localTime, '2026-11-12 10:00');
  assert.strictEqual(r.row.rulesVersion, B.BOOK_RULES_VERSION);
  const ev = JSON.stringify(r.event);
  assert.doesNotMatch(ev, /Priya|priya|555|Birchwood|DY-L-0042/);
  assert.deepStrictEqual(Object.keys(r.event).sort(), ['area', 'at', 'attorney', 'channel', 'code', 'reason', 'rulesVersion', 'source']);
  const held = decide(request({ otherSide: 'Harlan Whitcombe', start: '2026-11-12T16:00:00Z' }));
  assert.deepStrictEqual(Object.keys(held.row).sort(), cols.slice().sort());
  assert.match(held.row.note, /^c001 other_side: /);
  assert.doesNotMatch(held.row.note, /Harlan|Whitcombe/, 'the note holds list ids, not names');
});

test('the same validation rules as the intake form for name, email and phone', () => {
  const intakeBody = (o) => Object.assign({ name: 'Priya Nandakumar', email: 'priya.n@mail.example', phone: '', preferredContact: 'email', area: 'family', description: 'I would like to talk about a parenting plan after a move.', location: 'harlow_point', hearing: 'none', consent: true }, o);
  const intakeErrors = (o) => { const r = validateIntake(intakeBody(o), DATA, '2026-11-11'); return r.errors || {}; };
  const bookErrors = (o) => B.bookValidate(Object.assign({ start: '2026-11-12T16:00:00Z', otherSide: 'x y', channel: 'form' }, intakeBody(o)), DATA).errors || {};
  const cases = [
    { name: 'P' }, { name: 'Ann O\'Neil-Smith' }, { name: 'Zoë Müller' }, { name: 'Ann\nBcc: x@y.example' }, { name: 'Ann <script>' }, { name: 'A'.repeat(101) }, { name: '  ' },
    { email: 'a@b' }, { email: 'a@b.co' }, { email: 'a b@c.example' }, { email: 'A@B.EXAMPLE' }, { email: '@c.example' }, { email: '' },
    { phone: '555-010-2323' }, { phone: '(555) 010 2323' }, { phone: '555' }, { phone: '555-ABC-2323' }, { phone: '+44 20 7946 0958' }, { phone: '1'.repeat(16) }
  ];
  cases.forEach((c) => {
    const a = intakeErrors(c), b = bookErrors(c);
    ['name', 'email', 'phone'].forEach((k) => assert.strictEqual(!!b[k], !!a[k], k + ' for ' + JSON.stringify(c)));
  });
});

test('cancel: allowed up to the notice time, from the data', () => {
  const start = utc(2026, 11, 16, 16, 0);
  const r = row(1, 'elena-voss', start, 45);
  assert.strictEqual(B.bookCancelDecision(r, start - 24 * 3600000, DATA).allowed, true);
  assert.strictEqual(B.bookCancelDecision(r, start - 24 * 3600000 + 1, DATA).reason, 'late');
  const short = fresh(); short.availability.booking.cancelNoticeHours = 2;
  assert.strictEqual(B.bookCancelDecision(r, start - 3 * 3600000, short).allowed, true);
  assert.strictEqual(B.bookCancelDecision(Object.assign({}, r, { status: 'cancelled' }), NOW, DATA).reason, 'not_active');
  assert.strictEqual(B.bookCancelDecision(r, start + 60000, DATA).reason, 'late', 'under way: too late to cancel on the site');
  assert.strictEqual(B.bookCancelDecision(r, start + 46 * 60000, DATA).reason, 'not_active', 'over: nothing to cancel');
  assert.strictEqual(B.bookCancelDecision(null, NOW, DATA).allowed, false);
});

test('a request with nothing in it, or the wrong types, is refused without throwing', () => {
  [undefined, null, {}, [], 'x', 5, { start: {} }, { area: ['family'], start: 5, name: {}, email: [] }].forEach((b) => {
    const r = decide(b);
    assert.strictEqual(r.ok, false);
    assert.ok(['invalid', 'spam'].indexOf(r.code) !== -1);
    assert.ok(r.public && r.public.ok === false);
  });
  const odd = decide(request({ start: '2026-11-12T16:00:00Z', consent: 'yes', noOtherSide: 'on', otherSide: '' }));
  assert.strictEqual(odd.code, 'booked');
});

test('a row that lost the race gets the ordinary "not available" answer with fresh alternatives', () => {
  const t = utc(2026, 11, 12, 16, 0);
  const winner = row(1, 'elena-voss', t, 45, { email: 'a@mail.example' });
  const loser = row(2, 'elena-voss', t, 45, { email: 'b@mail.example', channel: 'voice' });
  const r = B.bookRaceLost(loser, 'slot_taken', [winner, loser], NOW, DATA);
  assert.strictEqual(r.public.code, 'slot_unavailable');
  assert.strictEqual(r.public.alternatives.length, 3);
  assert.ok(r.public.alternatives.every((a) => Date.parse(a.start) > t), 'only later times are offered');
  assert.strictEqual(r.public.alternatives[0].start, '2026-11-12T17:45:00Z', 'Thu 11:45: the first time that clears the winner plus its 60-minute gap (45 + 15)');
  assert.strictEqual(r.event.reason, 'race_lost');
  assert.strictEqual(r.event.channel, 'voice');
  assert.doesNotMatch(JSON.stringify(r), /b@mail|a@mail|Fixture/);
  assert.strictEqual(B.bookRaceLost(loser, 'already_booked', [winner, loser], NOW, DATA).public.code, 'contact_office');
});

test('when the confirmation email could not be sent the visitor is told, and keeps the reference', () => {
  const booked = decide(request({ start: '2026-11-12T16:00:00Z' }));
  const ok = B.bookConfirmedPublic(booked.public, true, DATA), bad = B.bookConfirmedPublic(booked.public, false, DATA);
  assert.strictEqual(ok.confirmationSent, true);
  assert.strictEqual(ok.message, booked.public.message);
  assert.strictEqual(bad.confirmationSent, false);
  assert.match(bad.message, /could not send the confirmation email/);
  assert.match(bad.message, /DY-TEST01/);
  assert.match(bad.message, /555-0142/);
  assert.ok(bad.message.indexOf(DATA.firm.language.notLegalAdvice) !== -1);
  assert.strictEqual(bad.ref, 'DY-TEST01');
});

test('the Intake row update: a web booking names its lead and the time; a voice booking has no lead, so nothing is written', () => {
  const start = utc(2026, 11, 16, 16, 0); // Mon 10:00 CST
  const webRow = row(1, 'dana-hollis', start, 45, { bookingRef: 'DY-INT001', leadRef: 'LD-ABC123' });
  const u = B.bookIntakeUpdate(webRow, DATA);
  assert.strictEqual(u.reference, 'LD-ABC123', 'matched to the Intake row by the lead reference');
  assert.strictEqual(u.status, 'Booked');
  assert.match(u.nextStep, /^Booked Mon, Nov 16, 10:00 AM CST with Dana Hollis \(DY-INT001\)$/);
  assert.strictEqual(B.bookIntakeUpdate(row(2, 'dana-hollis', start, 45, { bookingRef: 'DY-INT002', leadRef: '' }), DATA), null, 'a voice booking has no lead');
  assert.strictEqual(B.bookIntakeUpdate(null, DATA), null);
});
