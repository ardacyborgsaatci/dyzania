'use strict';
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
const D = require('../lib/digest.js');
const { buildEvent, toRow, AUTOMATIONS } = require('../lib/event.js');

const NOW = new Date('2026-11-12T08:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const intakeSet = JSON.parse(fs.readFileSync(path.join(root, 'intake', 'eval', 'cases.json'), 'utf8'));
const firm = loadFirmData();

// One real event of each kind, from the libraries' own evaluation sets, placed at a given time.
function real() {
  const intake = intakeSet.cases.map((c) => A.intakeEvent(processIntake(Object.assign({}, intakeSet.defaults, c.input), firm, { today: intakeSet.today, ref: 'HM-EVAL-' + c.id, now: intakeSet.today + 'T12:00:00Z' }), { now: NOW })).filter(Boolean);
  const triage = TR.SET.emails.map((e) => A.triageEvent(triageLogRow(TR.runOne(e, 'oracle')), { now: NOW }));
  const notices = Object.values(NO.resultsFor(NO.STAND_INS.oracle).raw).map((r) => A.noticeEvent(r, { now: NOW }));
  const booking = BO.SET.cases.filter((c) => c.kind === 'book').map((c) => A.bookingEvent(BO.runBook(c).result, { now: NOW })).filter(Boolean);
  return { intake, triage, notices, booking };
}
const R = real();
const at = (built, when, extra) => toRow(Object.assign({}, built.event, { ts: when }, extra || {}));
const pick = (list, pred) => list.find((b) => pred(b.event));

test('counts every automation separately, by status, over the last 24 hours only', () => {
  const rows = [
    at(R.intake[0], hoursAgo(1)), at(R.intake[1], hoursAgo(23.5)), at(R.intake[2], hoursAgo(25)),
    at(R.triage[0], hoursAgo(2)), at(R.triage[1], hoursAgo(30)),
    at(R.notices[0], hoursAgo(3)),
    // clock skew: a little in the future still counts, a lot does not
    at(R.notices[1], new Date(NOW.getTime() + 30 * 1000)), at(R.notices[2], new Date(NOW.getTime() + 3600 * 1000))
  ];
  const d = D.buildDigest(rows, { now: NOW });
  assert.equal(d.events, 5);
  assert.equal(d.counts.intake.runs, 2);
  assert.equal(d.counts.triage.runs, 1);
  assert.equal(d.counts.notices.runs, 2);
  assert.equal(d.counts.booking.runs, 0);
  assert.deepEqual(Object.keys(d.counts), AUTOMATIONS);
  for (const key of AUTOMATIONS) {
    const n = d.counts[key];
    assert.equal(n.ok + n.needs_human + n.blocked + n.error, n.runs, key);
  }
  assert.match(d.text, /Lead intake: 2 runs/);
  assert.match(d.text, /Court notices: 2 runs, 0 ok, 2 need a person/);
});

test('seed and evaluation events are listed but never counted', () => {
  const rows = [at(R.intake[0], hoursAgo(1)), at(R.intake[1], hoursAgo(1), { source: 'seed' }), at(R.triage[0], hoursAgo(1), { source: 'eval' })];
  const d = D.buildDigest(rows, { now: NOW });
  assert.equal(d.events, 1);
  assert.equal(d.tests, 2);
  assert.equal(d.counts.triage.runs, 0);
  assert.match(d.text, /2 test events \(seed or evaluation\) are not counted/);
  assert.doesNotMatch(D.buildDigest([at(R.intake[0], hoursAgo(1))], { now: NOW }).text, /test events/);
});

test('court notices waiting are counted, urgent ones named in the subject, and nothing here is a deadline', () => {
  const urgent = R.notices.filter((b) => / priority urgent\b/.test(b.event.summary));
  const other = R.notices.filter((b) => !/ priority urgent\b/.test(b.event.summary));
  assert.ok(urgent.length > 0 && other.length > 0, 'the set has urgent and other notices');
  const d = D.buildDigest([...urgent, ...other].map((b) => at(b, hoursAgo(2))), { now: NOW });
  assert.equal(d.notices, R.notices.length);
  assert.equal(d.urgentNotices, urgent.length);
  assert.match(d.subject, new RegExp(urgent.length + ' urgent court notice'));
  assert.match(d.text, new RegExp('waiting for an attorney to confirm: ' + R.notices.length + ' \\(' + urgent.length + ' urgent\\)'));
  const calm = D.buildDigest(other.map((b) => at(b, hoursAgo(2))), { now: NOW });
  assert.doesNotMatch(calm.subject, /urgent/);
  assert.doesNotMatch(calm.text, /\(\d+ urgent\)/);
  // reason codes such as relative_deadline are labels; what must never appear is a statement of a date or advice
  assert.doesNotMatch(d.text, /deadline is|is due|due on|due date|must file|you should|you must|we recommend/i);
});

test('bookings are counted by channel, and a refused or held booking is not a booked one', () => {
  const booked = R.booking.filter((b) => b.event.status === 'ok');
  const notBooked = R.booking.filter((b) => b.event.status !== 'ok');
  assert.ok(booked.length > 0 && notBooked.length > 0);
  const voiceOne = JSON.parse(JSON.stringify(booked[0].event));
  voiceOne.summary = voiceOne.summary.replace(/channel \w+/, 'channel voice');
  const rows = [...booked.map((b) => at(b, hoursAgo(2))), ...notBooked.map((b) => at(b, hoursAgo(2))), toRow({ ...voiceOne, ts: hoursAgo(2) })];
  const d = D.buildDigest(rows, { now: NOW });
  assert.equal(d.booked, booked.length + 1);
  const form = booked.filter((b) => /channel form\b/.test(b.event.summary)).length;
  const voice = booked.filter((b) => /channel voice\b/.test(b.event.summary)).length;
  assert.ok(form > 0 && voice > 0, 'the set books by form and by voice');
  assert.equal(form + voice, booked.length);
  assert.match(d.text, new RegExp('Consultations booked: ' + (booked.length + 1) + ' \\(website ' + form + ', voice ' + (voice + 1) + '\\)'));
  // a conflict hold or an already-booked answer mentions "booked" in its code but is not a booking
  assert.ok(notBooked.some((b) => /already_booked/.test(b.event.summary)));
  assert.equal(D.buildDigest(notBooked.map((b) => at(b, hoursAgo(2))), { now: NOW }).booked, 0);
});

test('handoffs between automations and into a person\'s queue are counted apart', () => {
  const toBooking = R.intake.filter((b) => b.event.handoffTo === 'booking');
  const toQueue = R.triage.filter((b) => b.event.handoffTo);
  assert.ok(toBooking.length > 0 && toQueue.length > 0);
  const d = D.buildDigest([...toBooking, ...toQueue].map((b) => at(b, hoursAgo(1))), { now: NOW });
  assert.deepEqual(d.handoffs, { betweenWorkflows: toBooking.length, toQueues: toQueue.length });
  assert.match(d.text, new RegExp(toBooking.length + ' handoffs between automations, ' + toQueue.length + ' to a person\'s queue'));
});

test('the attention list shows 15 at most and says how many more there are', () => {
  const needy = R.notices.slice(0, 12).concat(R.intake.filter((b) => b.event.status === 'needs_human')).slice(0, 40);
  assert.ok(needy.length > 15);
  const d = D.buildDigest(needy.map((b, i) => at(b, hoursAgo(1 + i / 100))), { now: NOW });
  assert.equal(d.attention, needy.length);
  assert.equal((d.text.match(/^- \[/gm) || []).length, D.MAX_ATTENTION);
  assert.match(d.text, new RegExp('\\.\\.\\.and ' + (needy.length - D.MAX_ATTENTION) + ' more'));
  const quiet = D.buildDigest([at(pick(R.intake, (e) => e.status === 'ok'), hoursAgo(1))], { now: NOW });
  assert.match(quiet.text, /Nothing needs a person\./);
  assert.doesNotMatch(quiet.text, /\.\.\.and/);
});

test('an empty day, junk rows and a missing context still give a readable digest', () => {
  for (const rows of [[], null, undefined, [null, 5, 'x', {}, { automation: 'nope', ts: NOW }]]) {
    const d = D.buildDigest(rows, { now: NOW });
    assert.equal(d.events, 0);
    assert.match(d.text, /0 events\./);
    assert.match(d.text, /Nothing needs a person\./);
    assert.match(d.subject, /Daily ops digest$/);
  }
  assert.match(D.buildDigest([], undefined).subject, /^\[Hollis & Marr LLP\]/);
});

test('the digest of a whole real day holds no private text, no address and no number that looks like a phone', () => {
  const every = [].concat(R.intake, R.triage, R.notices, R.booking);
  const d = D.buildDigest(every.map((b, i) => at(b, hoursAgo(1 + (i % 20)))), { now: NOW });
  assert.ok(d.events > 150);
  assert.ok(!d.text.includes('@'));
  assert.doesNotMatch(d.text, /\d{3}[ -]\d{3,4}[ -]?\d{4}/);
  const secrets = [];
  for (const c of intakeSet.cases) secrets.push(c.input.name, c.input.email, c.input.otherSide, c.input.description);
  for (const e of TR.SET.emails) secrets.push(e.from, e.subject);
  for (const c of NO.SET.cases) secrets.push(c.truth.court, c.truth.caseNumber, c.truth.partyOne, c.truth.partyTwo);
  // A one-word subject like "Consultation" is ordinary vocabulary the digest uses itself; names, addresses and sentences are what must not appear.
  const personal = (s) => typeof s === 'string' && s.trim().length >= 5 && /[\s@\d]/.test(s.trim());
  for (const s of secrets) if (personal(s)) assert.ok(!d.text.toLowerCase().includes(s.trim().toLowerCase()), 'digest repeats: ' + s);
  assert.match(d.text, /no names and no message text/);
  assert.match(d.text, /fixed booking confirmation/);
});

test('the digest and the alert use the firm name they are given, and the default is the firm\'s', () => {
  assert.match(D.buildDigest([], { now: NOW, firm: 'Test Firm' }).subject, /^\[Test Firm\]/);
  assert.match(D.errorAlert({}, { now: NOW, firm: 'Test Firm' }).subject, /^\[Test Firm\]/);
  assert.match(D.errorAlert({}, { now: NOW }).subject, /^\[Hollis & Marr LLP\]/);
  assert.doesNotMatch(JSON.stringify(D.buildDigest([], { now: NOW })), /wrenbook/i);
});

test('a failed workflow is matched to its automation by name', () => {
  const cases = {
    'H&M Intake - Lead intake and scoring': 'intake', 'H&M Triage - Gmail inbox': 'triage', 'H&M Triage - Core': 'triage', 'H&M Booking - Core': 'booking',
    'H&M Booking - Tool: list slots': 'booking', 'H&M Notices - Court notices': 'notices', 'H&M Voice - Tools': 'voice',
    'H&M Ops - Daily digest': 'ops', 'H&M Ops - Cleanup': 'ops', 'Something else': 'ops', '': 'ops'
  };
  for (const [name, want] of Object.entries(cases)) assert.equal(D.automationFromWorkflowName(name), want, name);
  assert.equal(D.automationFromWorkflowName(null), 'ops');
});

test('the error alert is a valid event, has no address, cuts a long message and never throws', () => {
  const failure = {
    workflow: { name: 'H&M Booking - Core' },
    execution: { id: '4821', url: 'https://n8n.example/execution/4821', mode: 'webhook', lastNodeExecuted: 'Insert booking', error: { message: 'Could not write for jane.doe@mail.example: ' + 'x'.repeat(600) } }
  };
  const a = D.errorAlert(failure, { now: NOW });
  assert.equal(a.event.ok, true, JSON.stringify(a.event.problems));
  assert.equal(a.event.event.automation, 'booking');
  assert.equal(a.team, 'intake');
  assert.equal(a.event.event.status, 'error');
  assert.equal(a.event.event.source, 'schedule');
  assert.equal(a.event.event.runId, '4821');
  assert.ok(!a.text.includes('@'));
  assert.match(a.text, /\[address\]/);
  assert.ok(a.text.split('\n').find((l) => l.startsWith('Error: ')).length <= 'Error: '.length + 300);
  assert.match(a.text, /No client email was sent because of this failure/);
  assert.equal(a.subject, '[Hollis & Marr LLP] Failure in H&M Booking - Core');
  for (const bad of [null, undefined, {}, { workflow: null }, { execution: { error: null } }, 'x', 5]) {
    const r = D.errorAlert(bad, { now: NOW });
    assert.equal(r.event.ok, true, JSON.stringify(bad));
    assert.match(r.text, /A workflow failed\./);
    assert.equal(r.event.event.automation, 'ops');
  }
});

test('the cleanup picks only rows older than the rule, never an undated one, and at most 1000 a night', () => {
  const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
  const rows = [
    { id: 1, ts: day(91) }, { id: 2, ts: day(89) }, { id: 3, ts: day(400) }, { id: 4, ts: '' }, { id: 5, ts: null }, { id: 6 }, { id: 7, ts: 'not a date' },
    { ts: day(200) }, null, 'x', { id: 8, ts: day(90.0001) }, { id: 9, ts: day(0) }
  ];
  const r = D.selectExpired(rows, 'ops_events', NOW);
  assert.deepEqual(r.ids, [1, 3, 8]);
  assert.equal(r.found, 3);
  assert.equal(r.capped, false);
  assert.equal(r.cutoff, '2026-08-14T08:00:00.000Z');
  // triage_log is dated by the table's own createdAt, not by a column the workflow fills
  assert.deepEqual(D.selectExpired([{ id: 1, createdAt: day(120), receivedAt: day(1) }, { id: 2, createdAt: day(5), receivedAt: day(500) }], 'triage_log', NOW).ids, [1]);
  // a big backlog is taken in parts
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, ts: day(100) }));
  const big = D.selectExpired(many, 'ops_events', NOW);
  assert.equal(big.ids.length, D.MAX_DELETE);
  assert.equal(big.found, 2500);
  assert.equal(big.capped, true);
  assert.equal(D.selectExpired(many, 'ops_events', NOW, 10).ids.length, 10);
  // empty and junk input delete nothing; a table with no rule is refused, so leads, bookings and notices can never be selected
  for (const bad of [[], null, undefined, 'x', {}]) assert.deepEqual(D.selectExpired(bad, 'ops_events', NOW).ids, []);
  for (const table of ['intake_leads', 'bookings', 'court_notices']) assert.throws(() => D.selectExpired(many, table, NOW), /no retention rule/);
  assert.deepEqual(Object.keys(D.RETENTION_FIELD).sort(), Object.keys(D.RETENTION_DAYS).sort());
});

test('the nightly cleanup deletes only what has a rule, 90 days back, and refuses everything else', () => {
  assert.deepEqual(D.RETENTION_DAYS, { ops_events: 90, triage_log: 90 });
  assert.equal(D.retentionCutoff('ops_events', NOW), '2026-08-14T08:00:00.000Z');
  assert.equal(D.retentionCutoff('triage_log', NOW), '2026-08-14T08:00:00.000Z');
  for (const table of ['intake_leads', 'bookings', 'court_notices', 'ops_config', '', undefined]) assert.throws(() => D.retentionCutoff(table, NOW), /no retention rule/, String(table));
  // the privacy page must say the same: leads, bookings and notices are kept until a person deletes them
  const privacy = fs.readFileSync(path.join(root, '..', 'web', 'site', 'privacy.html'), 'utf8');
  assert.match(privacy, /90 days/);
});
