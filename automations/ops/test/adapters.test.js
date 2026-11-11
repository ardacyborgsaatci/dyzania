'use strict';
// The adapters are tested on what the four real libraries produce for their own evaluation sets, not on hand-made objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..');
const { loadFirmData } = require(path.join(root, '..', 'firm', 'lib', 'data'));
const { processIntake } = require(path.join(root, 'intake', 'lib', 'intake'));
const TR = require(path.join(root, 'triage', 'eval', 'run.js'));
const { triageLogRow } = require(path.join(root, 'triage', 'lib', 'triage'));
const NO = require(path.join(root, 'notices', 'eval', 'run.js'));
const BO = require(path.join(root, 'booking', 'eval', 'run.js'));
const A = require('../lib/adapters.js');
const { QUEUE } = require('../lib/event.js');

const NOW = new Date('2026-11-11T12:00:00Z');
const intakeSet = JSON.parse(fs.readFileSync(path.join(root, 'intake', 'eval', 'cases.json'), 'utf8'));
const firm = loadFirmData();

// ---- real outputs, with the private text that went in, so a test can look for it in what comes out ----
const intakeRuns = intakeSet.cases.map((c) => {
  const body = Object.assign({}, intakeSet.defaults, c.input);
  const out = processIntake(body, firm, { today: intakeSet.today, ref: 'HM-EVAL-' + c.id, now: intakeSet.today + 'T12:00:00Z' });
  return { id: c.id, out, private: [body.name, body.email, body.phone, body.otherSide, body.description] };
});
const triageRuns = TR.SET.emails.map((e) => {
  const row = triageLogRow(TR.runOne(e, 'oracle'));
  const fallback = triageLogRow(TR.runOne(e, 'rules'));
  return { id: e.id, row, fallback, private: [e.from, e.subject, e.body] };
});
const noticeRuns = (() => {
  const { raw } = NO.resultsFor(NO.STAND_INS.oracle);
  return NO.SET.cases.map((c) => {
    const t = c.truth;
    return { id: c.id, out: raw[c.id], private: [t.court, t.caseNumber, t.partyOne, t.partyTwo].concat(t.events.map((x) => x.label), t.events.map((x) => x.location), t.relativeDeadlines || []) };
  });
})();
const bookingRuns = BO.SET.cases.filter((c) => c.kind === 'book').map((c) => {
  const { req, result } = BO.runBook(c);
  return { id: c.id, req, result, private: [req.name, req.email, req.phone, req.otherSide] };
});

// What a summary may never hold: any private text that went in. Short strings (under 5 characters) are ignored.
function leaks(summary, privates) {
  const s = summary.toLowerCase();
  return privates.filter((p) => typeof p === 'string' && p.trim().length >= 5 && s.includes(p.trim().toLowerCase()));
}
function allEvents() {
  const out = [];
  for (const r of intakeRuns) { const e = A.intakeEvent(r.out, { now: NOW }); if (e) out.push({ id: 'intake ' + r.id, e, private: r.private }); }
  for (const r of triageRuns) {
    for (const row of [r.row, r.fallback]) { const e = A.triageEvent(row, { now: NOW }); if (e) out.push({ id: 'triage ' + r.id, e, private: r.private }); }
  }
  for (const r of noticeRuns) { const e = A.noticeEvent(r.out, { now: NOW }); if (e) out.push({ id: 'notice ' + r.id, e, private: r.private }); }
  for (const r of bookingRuns) { const e = A.bookingEvent(r.result, { now: NOW }); if (e) out.push({ id: 'booking ' + r.id, e, private: r.private }); }
  return out;
}

test('the sets are real: every library produced something to log', () => {
  assert.equal(intakeRuns.length, 48);
  assert.equal(triageRuns.length, 54);
  assert.equal(noticeRuns.length, 12);
  assert.equal(bookingRuns.length, 60);
  // 48 intake (minus spam / invalid) + 108 triage (two modes) + 12 notices + 60 bookings (minus invalid / spam)
  assert.ok(allEvents().length > 150, 'events: ' + allEvents().length);
});

test('every event from every real output is valid, never throws, and has no private text', () => {
  for (const { id, e, private: privates } of allEvents()) {
    assert.equal(e.ok, true, id + ': ' + JSON.stringify(e.problems));
    assert.ok(!e.event.summary.includes('@'), id);
    assert.deepEqual(leaks(e.event.summary, privates), [], id + ' leaks ' + e.event.summary);
    assert.doesNotMatch(e.event.summary, /\d{3}[ -]?\d{4}/, id + ' has a phone-like run');
    assert.ok(e.event.summary.length <= 140, id);
  }
});

test('intake: needs a person unless the next step is a booking link or a referral out; only the two steps that show the booking page are a handoff', () => {
  const seen = new Set();
  for (const r of intakeRuns) {
    const e = A.intakeEvent(r.out, { now: NOW });
    if (!r.out.ok || r.out.spam) { assert.equal(e, null, r.id); continue; }
    const step = r.out.lead.nextStep;
    seen.add(step);
    assert.equal(e.event.automation, 'intake');
    assert.equal(e.event.source, 'web');
    assert.equal(e.event.runId, r.out.lead.ref);
    assert.equal(e.event.status, ['attorney_now', 'ask_more', 'follow_up', 'hold_conflict'].includes(step) ? 'needs_human' : 'ok', r.id + ' ' + step);
    if (step === 'book' || step === 'follow_up') assert.deepEqual([e.event.handoffTo, e.event.handoffRef], ['booking', r.out.lead.ref], r.id);
    else assert.deepEqual([e.event.handoffTo, e.event.handoffRef], ['', ''], r.id + ' ' + step);
  }
  assert.ok(seen.has('book') && seen.has('attorney_now') && seen.has('hold_conflict'), 'the set covers the main next steps: ' + [...seen]);
  assert.equal(A.intakeEvent(null, {}), null);
  assert.equal(A.intakeEvent({ ok: false, errors: { email: 'x' } }, {}), null);
});

test('triage: needs a person when the label says so or the classifier failed; a handoff goes to a queue, never straight to a workflow row', () => {
  let handoffs = 0, fallbacks = 0, queued = new Set();
  for (const r of triageRuns) {
    const e = A.triageEvent(r.row, { now: NOW });
    assert.equal(e.event.source, 'gmail');
    assert.equal(e.event.runId, r.row.messageId);
    assert.equal(e.event.status, r.row.needsHuman ? 'needs_human' : 'ok', r.id);
    if (r.row.handoff) {
      handoffs += 1;
      assert.equal(e.event.handoffRef, QUEUE);
      assert.equal(e.event.handoffTo, r.row.handoff === 'extraction' ? 'notices' : 'intake', r.id);
      queued.add(e.event.handoffTo);
    } else assert.deepEqual([e.event.handoffTo, e.event.handoffRef], ['', ''], r.id);
    const f = A.triageEvent(r.fallback, { now: NOW });
    if (r.fallback.classificationStatus === 'fallback') { fallbacks += 1; assert.equal(f.event.status, 'needs_human', r.id); assert.match(f.event.summary, /classifier failed/); }
  }
  assert.ok(handoffs > 0 && fallbacks > 0, 'the set has handoffs and classifier failures');
  assert.ok(queued.has('intake'), 'at least the intake handoff is exercised: ' + [...queued]);
  assert.equal(A.triageEvent(null, {}), null);
  assert.equal(A.triageEvent({}, {}), null);
});

test('notices: every notice needs an attorney, whatever its priority; the run id is the notice reference', () => {
  const priorities = new Set();
  for (const r of noticeRuns) {
    const e = A.noticeEvent(r.out, { now: NOW });
    assert.equal(e.event.status, 'needs_human', r.id);
    assert.equal(e.event.source, 'upload');
    assert.equal(e.event.runId, r.out.event.ref);
    assert.match(e.event.summary, new RegExp(' priority ' + r.out.event.priority + '\\b'));
    assert.deepEqual([e.event.handoffTo, e.event.handoffRef], ['', '']);
    priorities.add(r.out.event.priority);
  }
  assert.ok(priorities.has('urgent') && priorities.size >= 2, 'the set has more than one priority: ' + [...priorities]);
  assert.equal(A.noticeEvent(null, {}), null);
  assert.equal(A.noticeEvent({}, {}), null);
});

test('booking: status follows the decision code; spam and invalid are not logged; the source follows the channel and the lead reference', () => {
  const codes = {};
  for (const r of bookingRuns) {
    const code = r.result.event.code;
    const e = A.bookingEvent(r.result, { now: NOW });
    if (code === 'invalid' || code === 'spam') { assert.equal(e, null, r.id); continue; }
    codes[code] = (codes[code] || 0) + 1;
    const want = code === 'booked' ? 'ok' : (code === 'conflict_hold' || code === 'already_booked') ? 'needs_human' : (code === 'slot_taken' || code === 'not_offered') ? 'blocked' : 'error';
    assert.equal(e.event.status, want, r.id + ' ' + code);
    assert.equal(e.event.source, r.result.event.channel === 'voice' ? 'voice' : 'web', r.id);
    assert.match(e.event.summary, new RegExp('channel ' + (r.result.event.channel || 'unknown')));
  }
  for (const needed of ['booked', 'slot_taken', 'conflict_hold', 'already_booked']) assert.ok(codes[needed] > 0, 'the set has ' + needed + ': ' + JSON.stringify(codes));
});

test('booking: an intake reference makes the booking the receiving end of the handoff and chains the two rows by run id', () => {
  const booked = bookingRuns.find((r) => r.result.event.code === 'booked');
  const leadRef = 'HM-261111-AB12';
  const e = A.bookingEvent(booked.result, { now: NOW, leadRef });
  assert.equal(e.event.source, 'handoff');
  assert.equal(e.event.runId, leadRef);
  // and it matches the row the intake wrote for the same reference
  const sent = A.intakeEvent({ ok: true, lead: { ref: leadRef, areaFinal: 'family', tier: 'Hot', nextStep: 'book', urgencyLevel: 'none' } }, { now: NOW });
  assert.deepEqual([sent.event.handoffTo, sent.event.handoffRef], ['booking', leadRef]);
  assert.equal(sent.event.runId, e.event.runId);
  // without one, the booking stands alone and is keyed by its own reference
  const alone = A.bookingEvent(booked.result, { now: NOW });
  assert.notEqual(alone.event.source, 'handoff');
  assert.equal(alone.event.runId, booked.result.row.bookingRef);
  assert.equal(A.bookingEvent(null, {}), null);
  assert.equal(A.bookingEvent({}, {}), null);
});

test('voice: a booking made on a call is logged as the voice source and shows up in the digest as voice', () => {
  const booked = bookingRuns.find((r) => r.result.event.code === 'booked');
  const voice = JSON.parse(JSON.stringify(booked.result));
  voice.event.channel = 'voice';
  voice.row.channel = 'voice';
  const e = A.bookingEvent(voice, { now: NOW });
  assert.equal(e.event.source, 'voice');
  assert.match(e.event.summary, /channel voice/);
});
