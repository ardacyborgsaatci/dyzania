'use strict';
// The live check is tested against the real site endpoints and the real intake and booking rules (the helpers' fake n8n),
// so the journey it will run on the deployed site is the one proven here, apart from the network hop.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fakeRes, fakeReq, withSite } = require('./helpers');

const root = path.join(__dirname, '..', '..', '..');
const A = require(path.join(root, 'automations', 'ops', 'lib', 'adapters.js'));
const E = require(path.join(root, 'automations', 'ops', 'lib', 'event.js'));
const live = () => import(pathToFileURL(path.join(root, 'scripts', 'live-check.mjs')).href);

const handlers = { '/api/token': require('../api/token'), '/api/intake': require('../api/intake'), '/api/slots': require('../api/slots'), '/api/book': require('../api/book') };
function siteRequest(log) {
  return async (method, p, body) => {
    const res = fakeRes();
    await handlers[p](fakeReq({ method, body }), res);
    const out = { status: res.statusCode || 200, data: res.body };
    if (log) log.push({ method, path: p, body, out });
    return out;
  };
}
// The journey waits for the form token to age; here the clock jumps instead of the test sleeping.
async function withFastClock(fn) {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real() + offset;
  try { return await fn(async (ms) => { offset += ms; }); } finally { Date.now = real; }
}

test('the journey books one invented visitor through the real endpoints and rules, and sends only invented data', withSite(async () => {
  const { runJourney, PERSON } = await live();
  const log = [];
  const r = await withFastClock((wait) => runJourney({ request: siteRequest(log), wait, now: () => new Date('2026-11-11T15:00:00Z') }));
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.deepEqual(r.steps.map((s) => s.step), ['token', 'intake', 'slots', 'book']);
  assert.match(r.report.leadRef, /^DY-/);
  assert.match(r.report.bookingRef, /^DY-/);
  assert.ok(['book', 'follow_up'].includes(r.report.intakeKind));
  assert.equal(r.report.confirmationSent, true);
  // the booking carries the lead reference the intake returned
  const book = log.find((x) => x.path === '/api/book');
  assert.equal(book.body.leadRef, r.report.leadRef);
  assert.equal(book.body.start, log.find((x) => x.path === '/api/slots').out.data.slots[0].start);
  // nothing real is sent: an address that cannot receive mail, no phone number, and the stated test purpose in the text
  const sent = JSON.stringify(log.map((x) => x.body));
  assert.match(PERSON.email, /\.example$/);
  assert.match(PERSON.description, /automated live check .* invented person/);
  assert.doesNotMatch(sent, /\d{3}[ -]\d{3}[ -]\d{4}/);
  assert.equal(book.body.phone, '');
}));

test('the journey can send the confirmation to an inbox the owner controls', withSite(async () => {
  const { runJourney } = await live();
  const log = [];
  const r = await withFastClock((wait) => runJourney({ request: siteRequest(log), wait, email: 'owner.inbox@mail.example' }));
  assert.equal(r.ok, true);
  assert.equal(log.find((x) => x.path === '/api/book').body.email, 'owner.inbox@mail.example');
  assert.equal(r.report.person.email, 'owner.inbox@mail.example');
}));

test('the journey stops at the first step that fails and says which', withSite(async () => {
  const { runJourney } = await live();
  const never = async () => ({ status: 500, data: null });
  assert.deepEqual((await runJourney({ request: never, wait: async () => {} })).steps, [{ step: 'token', ok: false, detail: 'no token from /api/token' }]);
  // a site that rejects the intake
  const reject = async (method, p) => (p === '/api/token' ? { status: 200, data: { token: 't' } } : { status: 422, data: { ok: false, errors: { email: 'x' } } });
  const r = await runJourney({ request: reject, wait: async () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.report, null);
  assert.equal(r.steps[r.steps.length - 1].step, 'intake');
  // a site where the intake does not offer booking
  const noBook = async (method, p) => (p === '/api/token' ? { status: 200, data: { token: 't' } } : { status: 200, data: { ok: true, ref: 'DY-1', kind: 'urgent' } });
  assert.equal((await runJourney({ request: noBook, wait: async () => {} })).steps.pop().step, 'intake kind');
  // a booking that is refused
  const refuse = async (method, p) => (p === '/api/token' ? { status: 200, data: { token: 't' } }
    : p === '/api/intake' ? { status: 200, data: { ok: true, ref: 'DY-1', kind: 'book' } }
    : p === '/api/slots' ? { status: 200, data: { ok: true, slots: [{ start: '2026-11-12T16:00:00Z' }] } }
    : { status: 409, data: { ok: false, code: 'slot_unavailable' } });
  assert.equal((await runJourney({ request: refuse, wait: async () => {} })).steps.pop().step, 'book');
}));

// ---- verifying the rows ----
const T0 = new Date('2026-11-11T15:00:00Z');
const report = { startedAt: T0.toISOString(), finishedAt: new Date(T0.getTime() + 20000).toISOString(), leadRef: 'DY-L00001', intakeKind: 'book', bookingRef: 'DY-B00001', person: { name: 'Live Check Visitor', email: 'live-check@mail.example', otherSide: 'Invented Cafe Supplies' } };
function goodRows() {
  const intake = A.intakeEvent({ ok: true, lead: { ref: 'DY-L00001', areaFinal: 'family', tier: 'Hot', nextStep: 'book', urgencyLevel: 'none' } }, { now: new Date(T0.getTime() + 5000) });
  const booking = A.bookingEvent({ event: { at: T0.toISOString(), code: 'booked', reason: '', area: 'family', channel: 'form', attorney: 'elena-voss' }, row: { bookingRef: 'DY-B00001' } }, { now: new Date(T0.getTime() + 15000), ref: 'DY-B00001', leadRef: 'DY-L00001' });
  return [E.toRow(intake.event), E.toRow(booking.event)];
}

test('verify: passes on the two events a real run writes, in the form the data table gives them', async () => {
  const { verifyRows } = await live();
  const rows = goodRows().map((r, i) => Object.assign({ id: i + 1, createdAt: r.ts, updatedAt: r.ts }, r));
  const r = verifyRows(rows, report);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.found, { intake: 1, booking: 1, digestBooked: 1 });
  // other people's rows in the table do not matter
  const noise = A.noticeEvent({ event: { ref: 'N-20261111-AB12-01', documentType: 'summons', priority: 'urgent', reasons: [], readStatus: 'ok' } }, { now: T0 });
  assert.deepEqual(verifyRows(rows.concat([E.toRow(noise.event)]), report).problems, []);
});

test('verify: says what is wrong when an event is missing, mislinked, late, leaking or invalid', async () => {
  const { verifyRows } = await live();
  const [intake, booking] = goodRows();
  const problems = (rows, rep) => verifyRows(rows, rep || report).problems.join(' | ');
  assert.match(problems([intake]), /expected exactly one booked event/);
  assert.match(problems([booking]), /expected exactly one intake event/);
  assert.match(problems([], report), /expected exactly one intake event/);
  assert.match(problems([intake, Object.assign({}, booking, { source: 'web' })]), /expected handoff/);
  assert.match(problems([intake, Object.assign({}, booking, { status: 'blocked' })]), /status blocked/);
  assert.match(problems([Object.assign({}, intake, { handoffTo: '', handoffRef: '' }), booking]), /does not hand off to booking/);
  assert.match(problems([intake, Object.assign({}, booking, { ts: new Date(T0.getTime() - 3600000).toISOString() })]), /older than the intake event/);
  assert.match(problems([intake, Object.assign({}, booking, { summary: booking.summary.replace('DY-B00001', 'DY-B99999') })]), /does not carry the booking reference/);
  assert.match(problems([intake, booking, Object.assign({}, booking, { source: 'handoff', status: 'ok' })]), /exactly one booked event/);
  // private text in a summary: a name, an address, a phone-like number
  assert.match(problems([intake, Object.assign({}, booking, { summary: 'Booking DY-B00001: booked, family, for Live Check Visitor' })]), /repeats private text/);
  assert.match(problems([intake, Object.assign({}, booking, { summary: booking.summary + ' live-check@mail.example' })]), /has an @/);
  assert.match(problems([intake, Object.assign({}, booking, { summary: booking.summary + ' call 555 010 0199' })]), /phone-like/);
  // an invalid row anywhere in the table is reported
  assert.match(problems([intake, booking, { ts: T0.toISOString(), automation: 'billing', team: 'x', runId: 'z', source: 'web', status: 'ok', summary: 's' }]), /fails its own checks/);
  // a receiver with no sender
  assert.match(problems([intake, booking, Object.assign({}, booking, { runId: 'DY-L00077', source: 'handoff' })]), /chain: receiver booking DY-L00077 has no sender/);
  // no report
  assert.match(problems([intake, booking], {}), /run the journey first/);
  assert.equal(verifyRows(null, null).ok, false);
});
