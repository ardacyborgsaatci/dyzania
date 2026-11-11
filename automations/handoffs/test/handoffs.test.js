'use strict';
// Each handoff is tested across the real libraries, not on hand-made objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..');
const { loadFirmData } = require(path.join(root, '..', 'firm', 'lib', 'data'));
const { processIntake } = require(path.join(root, 'intake', 'lib', 'intake'));
const TR = require(path.join(root, 'triage', 'eval', 'run.js'));
const T = require(path.join(root, 'triage', 'lib', 'triage'));
const N = require(path.join(root, 'notices', 'lib', 'notices'));
const NO = require(path.join(root, 'notices', 'eval', 'run.js'));
const B = require(path.join(root, 'booking', 'lib', 'booking'));
const BO = require(path.join(root, 'booking', 'eval', 'run.js'));
const { loadBookingData } = require(path.join(root, 'booking', 'lib', 'data'));
const A = require('../../ops/lib/adapters.js');
const D = require('../../ops/lib/digest.js');
const { toRow } = require('../../ops/lib/event.js');
const H = require('../lib/handoffs.js');

const firm = loadFirmData();
const bookData = loadBookingData();
const intakeSet = JSON.parse(fs.readFileSync(path.join(root, 'intake', 'eval', 'cases.json'), 'utf8'));
const NOW_MS = Date.parse('2026-11-11T20:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const row = (built, minutesAfter) => toRow(Object.assign({}, built.event, { ts: new Date(NOW_MS + (minutesAfter || 0) * 60000) }));

const leads = intakeSet.cases.map((c) => {
  const body = Object.assign({}, intakeSet.defaults, c.input);
  return { id: c.id, body, out: processIntake(body, firm, { today: intakeSet.today, ref: 'HM-EVAL-' + c.id, now: intakeSet.today + 'T12:00:00Z' }) };
}).filter((l) => l.out.ok && !l.out.spam);

test('the four links are written down once, between known automations, with a stated carrier', () => {
  assert.deepEqual(H.HANDOFFS.map((h) => h.id), ['intake-booking', 'voice-booking', 'triage-intake', 'notices-ops']);
  for (const h of H.HANDOFFS) {
    assert.ok(['reference', 'channel', 'queue', 'event'].includes(h.how), h.id);
    assert.ok(h.trigger && h.result, h.id);
    assert.doesNotMatch(h.result + h.trigger, /\bsends? (an )?email to the (client|visitor|sender)\b/i);
  }
});

test('intake -> booking: a lead shown the booking page books, and the two rows chain by the lead reference', () => {
  const offered = leads.filter((l) => ['book', 'follow_up'].includes(l.out.lead.nextStep));
  assert.ok(offered.length >= 10, 'the set has leads offered the booking page: ' + offered.length);
  const rows = [];
  for (const l of offered.slice(0, 12)) {
    const area = l.out.lead.areaFinal;
    const slots = B.bookListSlots({ area, limit: 1 }, [], NOW_MS, bookData);
    assert.equal(slots.ok, true, l.id + ' area ' + area + ' can be booked');
    const req = { name: l.body.name, email: l.body.email, phone: '', area, otherSide: l.body.otherSide || '', noOtherSide: !l.body.otherSide, consent: true, channel: 'form', leadRef: l.out.lead.ref, start: slots.slots[0].start, website: '' };
    const dec = B.bookDecide(req, [], NOW_MS, bookData, { ref: 'HM-B-' + l.id, now: iso(NOW_MS) });
    // The booking row keeps the lead reference, so a person can see which inquiry it came from.
    if (dec.row) assert.equal(dec.row.leadRef, l.out.lead.ref, l.id);
    const sent = A.intakeEvent(l.out, { now: new Date(NOW_MS) });
    const received = A.bookingEvent(dec, { now: new Date(NOW_MS), leadRef: l.out.lead.ref });
    assert.ok(sent.ok && received.ok, l.id);
    assert.equal(sent.event.handoffRef, received.event.runId, l.id);
    assert.equal(sent.event.handoffTo, 'booking');
    assert.equal(received.event.source, 'handoff');
    rows.push(row(sent, 0), row(received, 5));
  }
  assert.deepEqual(H.chainProblems(rows), []);
  assert.deepEqual(H.openHandoffs(rows), []);
});

test('intake -> booking: no other next step offers the booking page, so none claims a handoff', () => {
  for (const l of leads) {
    const e = A.intakeEvent(l.out, { now: new Date(NOW_MS) });
    const offered = ['book', 'follow_up'].includes(l.out.lead.nextStep);
    assert.equal(Boolean(e.event.handoffTo), offered, l.id + ' ' + l.out.lead.nextStep);
  }
  // a conflict hold in particular must never look like an offer
  const held = leads.filter((l) => l.out.lead.nextStep === 'hold_conflict');
  assert.ok(held.length > 0);
  for (const l of held) assert.equal(A.intakeEvent(l.out, { now: new Date(NOW_MS) }).event.handoffTo, '');
});

test('intake -> booking: an offer nobody takes up is open, not a fault', () => {
  const l = leads.find((x) => x.out.lead.nextStep === 'book');
  const sent = row(A.intakeEvent(l.out, { now: new Date(NOW_MS) }), 0);
  assert.deepEqual(H.chainProblems([sent]), []);
  assert.deepEqual(H.openHandoffs([sent]).map((o) => [o.ref, o.to]), [[l.out.lead.ref, 'booking']]);
});

test('voice -> booking: the same request gets the same decision on a call as on the website', () => {
  let compared = 0;
  for (const c of BO.SET.cases.filter((x) => x.kind === 'book')) {
    const { req, rows, nowMs, result: web } = BO.runBook(c);
    if (req.channel !== 'form') continue;
    const call = B.bookDecide(Object.assign({}, req, { channel: 'voice' }), rows, nowMs, bookData, { ref: 'HM-TEST01', now: iso(nowMs) });
    assert.equal(call.code, web.code, c.id);
    assert.equal(call.reason, web.reason, c.id);
    assert.equal(call.row && call.row.attorney, web.row && web.row.attorney, c.id);
    assert.equal(call.row && call.row.startUtc, web.row && web.row.startUtc, c.id);
    if (call.event.code === 'booked') assert.equal(A.bookingEvent(call, { now: new Date(NOW_MS) }).event.source, 'voice', c.id);
    compared += 1;
  }
  assert.ok(compared >= 40, 'compared ' + compared);
});

test('triage -> intake and triage -> notices: only mail that reached a person\'s queue is handed off, and never as another automation\'s row', () => {
  const byHandoff = {};
  const rows = [];
  for (const e of TR.SET.emails) {
    const log = T.triageLogRow(TR.runOne(e, 'oracle'));
    const ev = A.triageEvent(log, { now: new Date(NOW_MS) });
    rows.push(row(ev, 0));
    byHandoff[log.handoff || 'none'] = (byHandoff[log.handoff || 'none'] || 0) + 1;
    if (log.handoff === 'intake') { assert.equal(log.category, 'new_inquiry', e.id); assert.deepEqual([ev.event.handoffTo, ev.event.handoffRef], ['intake', H.QUEUE], e.id); }
    else if (log.handoff === 'extraction') { assert.equal(log.category, 'court_notice', e.id); assert.deepEqual([ev.event.handoffTo, ev.event.handoffRef], ['notices', H.QUEUE], e.id); }
    else assert.equal(ev.event.handoffTo, '', e.id);
    // a handoff never sends anything: injected mail is never handed off, and no reply promises a booking or a result
    if (log.injectionSuspected) assert.equal(ev.event.handoffTo, '', e.id + ' injected mail was handed off');
  }
  assert.ok(byHandoff.intake > 0 && byHandoff.extraction > 0, JSON.stringify(byHandoff));
  assert.deepEqual(H.chainProblems(rows), []);
  assert.deepEqual(H.openHandoffs(rows), [], 'a queue is not an open offer');
});

test('notices -> ops: every notice is a row, the digest counts it, and each urgent one is named in the owner alert', () => {
  const { raw } = NO.resultsFor(NO.STAND_INS.oracle);
  const results = NO.SET.cases.map((c) => raw[c.id]);
  const events = results.map((r) => A.noticeEvent(r, { now: new Date(NOW_MS) }));
  const rows = events.map((e) => row(e, -30));
  const digest = D.buildDigest(rows, { now: new Date(NOW_MS) });
  assert.equal(digest.notices, results.length);
  assert.equal(digest.urgentNotices, results.filter((r) => r.alert).length);
  const alert = N.noticeAlert(results, NO.DATA, NO.SET.today);
  assert.ok(alert, 'there is an alert when something is urgent');
  for (const r of results.filter((x) => x.alert)) assert.ok(alert.text.includes(r.row.ref), 'alert names ' + r.row.ref);
  for (const r of results.filter((x) => !x.alert)) assert.ok(!alert.text.includes(r.row.ref), 'alert leaves out ' + r.row.ref);
  // nothing in the row says a notice was confirmed: a person does that
  for (const e of events) assert.equal(e.event.status, 'needs_human');
  assert.deepEqual(H.chainProblems(rows), []);
});

test('the contract check finds what is wrong: a receiver with no sender, a receiver older than its sender, a sender to nowhere', () => {
  const lead = leads.find((x) => x.out.lead.nextStep === 'book');
  const sent = row(A.intakeEvent(lead.out, { now: new Date(NOW_MS) }), 10);
  const booking = bookingRunsOf(lead);
  const early = row(booking, 0);
  assert.match(H.chainProblems([early]).join(), /has no sender/);
  assert.match(H.chainProblems([sent, early]).join(), /older than every sender/);
  assert.match(H.chainProblems([Object.assign({}, sent, { handoffTo: 'billing' })]).join(), /unknown automation/);
  assert.match(H.chainProblems([Object.assign({}, sent, { handoffRef: '' })]).join(), /no handoffRef/);
  assert.match(H.chainProblems([Object.assign({}, sent, { handoffTo: 'intake' })]).join(), /hands off to itself/);
  assert.deepEqual(H.chainProblems(null), []);
  assert.deepEqual(H.chainProblems([null, undefined, {}]), []);
  assert.deepEqual(H.openHandoffs(undefined), []);
});

function bookingRunsOf(lead) {
  const area = lead.out.lead.areaFinal;
  const slots = B.bookListSlots({ area, limit: 1 }, [], NOW_MS, bookData);
  const dec = B.bookDecide({ name: lead.body.name, email: lead.body.email, phone: '', area, otherSide: '', noOtherSide: true, consent: true, channel: 'form', leadRef: lead.out.lead.ref, start: slots.slots[0].start, website: '' }, [], NOW_MS, bookData, { ref: 'HM-B-X', now: iso(NOW_MS) });
  return A.bookingEvent(dec, { now: new Date(NOW_MS), leadRef: lead.out.lead.ref });
}
