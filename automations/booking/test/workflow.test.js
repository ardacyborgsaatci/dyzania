'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../eval/run');
const B = require('../lib/booking');
const { loadColumns } = require('../lib/data');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8'));
const node = (name) => wf.nodes.find((n) => n.name === name);
const code = (name) => node(name).parameters.jsCode;

// Run a Code node's text the way n8n would: $input and $('Node') are stubs, TEST_NOW and TEST_REF are plain arguments.
function runNode(name, input, refs, nowIso, ref) {
  const fn = new Function('$input', '$', 'TEST_NOW', 'TEST_REF', code(name));
  const $ = (n) => {
    if (!(n in refs)) throw new Error('node not available: ' + n);
    const json = refs[n];
    return { first: () => ({ json }), item: { json }, all: () => [{ json }] };
  };
  const items = (input.length ? input : [{}]).map((json) => ({ json }));
  return fn({ all: () => items, first: () => items[0] }, $, nowIso, ref);
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('the generated booking Code nodes give the same answer as the library for every labelled booking case', () => {
  let n = 0;
  E.SET.cases.filter((c) => c.kind === 'book').forEach((c) => {
    const { req, rows, nowMs } = E.runBook(c);
    const nowIso = new Date(nowMs).toISOString();
    const want = plain(B.bookDecide(req, rows, nowMs, E.DATA, { ref: 'DY-TEST01', now: nowIso }));
    const got = runNode('Decide booking', rows, { 'Booking request': { body: req } }, nowIso, 'DY-TEST01');
    assert.strictEqual(got.length, 1, c.id);
    assert.deepStrictEqual(plain(got[0].json), want, c.id);
    n++;
  });
  assert.strictEqual(n, 60);
});

test('the generated slot node gives the same answer as the library, with an empty table too', () => {
  let n = 0;
  E.SET.cases.filter((c) => c.kind === 'offer').forEach((c) => {
    const nowMs = E.brute(c.now || E.SET.defaults.now), rows = (c.bookings || []).map(E.fixtureRow);
    const body = { area: c.area, limit: 25 };
    const want = plain(B.bookListSlots(body, rows, nowMs, E.DATA));
    const got = runNode('List slots', rows, { 'Slots request': { body } }, new Date(nowMs).toISOString());
    assert.deepStrictEqual(plain(got[0].json), want, c.id);
    n++;
  });
  assert.strictEqual(n, 13);
  const empty = runNode('List slots', [], { 'Slots request': { body: { area: 'family', limit: 2 } } }, '2026-11-11T20:00:00Z');
  assert.strictEqual(empty[0].json.slots.length, 2, 'the one empty item n8n sends for an empty table is ignored');
  const noBody = runNode('List slots', [], { 'Slots request': {} }, '2026-11-11T20:00:00Z');
  assert.strictEqual(noBody[0].json.ok, false);
});

test('the generated verify node settles the race the same way as the library', () => {
  E.SET.cases.filter((c) => c.kind === 'verify').forEach((c) => {
    const rows = c.rows.map(E.fixtureRow), nowMs = E.brute(c.now || E.SET.defaults.now), nowIso = new Date(nowMs).toISOString();
    const mine = rows.find((r) => r.id === c.forRow);
    const dec = { row: mine, public: { ok: true, code: 'booked' }, confirmation: { subject: 's', text: 't' } };
    const out = runNode('Verify winner', rows, { 'Decide booking': dec, 'Insert booking': { id: c.forRow } }, nowIso)[0].json;
    const want = B.bookVerify(c.forRow, rows, nowMs, E.DATA);
    assert.strictEqual(out.won, want.won, c.id);
    assert.strictEqual(out.ref, mine.bookingRef);
    if (want.won) assert.strictEqual(out.lost, undefined, c.id);
    else {
      assert.strictEqual(out.lost.public.code, want.lost[c.forRow] === 'already_booked' ? 'contact_office' : 'slot_unavailable', c.id);
      assert.ok(out.lost.alternatives.length <= 3);
    }
  });
});

test('the confirmation outcome node records sent or failed, and tells the visitor the truth', () => {
  const dec = B.bookDecide(E.runBook(E.SET.cases.find((c) => c.id === 'B01')).req, [], E.brute('2026-11-11 14:00'), E.DATA, { ref: 'DY-TEST01', now: '2026-11-11T20:00:00.000Z' });
  const refs = { 'Verify winner': { decision: dec } };
  const sent = runNode('Confirmation outcome', [{ id: '18f3', threadId: 't', labelIds: ['SENT'] }], refs, '2026-11-11T20:00:00Z')[0].json;
  assert.strictEqual(sent.confirmation, 'sent');
  assert.strictEqual(sent.public.confirmationSent, true);
  assert.strictEqual(sent.ref, 'DY-TEST01');
  const failed = runNode('Confirmation outcome', [{ error: 'quota' }], refs, '2026-11-11T20:00:00Z')[0].json;
  assert.strictEqual(failed.confirmation, 'failed');
  assert.strictEqual(failed.public.confirmationSent, false);
  assert.match(failed.public.message, /could not send the confirmation email/);
  const empty = runNode('Confirmation outcome', [{}], refs, '2026-11-11T20:00:00Z')[0].json;
  assert.strictEqual(empty.confirmation, 'failed', 'no message id means it was not sent');
});

test('the booking reference is random in production, fixed only by the test hook', () => {
  const req = E.runBook(E.SET.cases.find((c) => c.id === 'B01')).req;
  const refs = { 'Booking request': { body: req } };
  const a = runNode('Decide booking', [], refs, '2026-11-11T20:00:00Z')[0].json.row.bookingRef;
  const b = runNode('Decide booking', [], refs, '2026-11-11T20:00:00Z')[0].json.row.bookingRef;
  assert.match(a, /^DY-[A-HJKMNP-Z2-9]{6}$/);
  assert.notStrictEqual(a, b);
});

test('the workflow shape: two authenticated endpoints, every path answers, one email, no outside calls', () => {
  assert.strictEqual(wf.name, 'Dyzania Booking - Slots and booking');
  const hooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  assert.deepStrictEqual(hooks.map((h) => h.parameters.path).sort(), ['booking/book', 'booking/slots']);
  hooks.forEach((h) => { assert.strictEqual(h.parameters.httpMethod, 'POST'); assert.strictEqual(h.parameters.authentication, 'headerAuth'); assert.strictEqual(h.parameters.responseMode, 'responseNode'); });
  const has = (name) => !!node(name);
  const out = (name) => ((wf.connections[name] || {}).main || []).reduce((a, b) => a.concat(b), []).map((l) => l.node);
  // every node that ends a path is a reply (or a note)
  // (the ops log is the one exception: it is only ever reached after a reply, checked below)
  wf.nodes.forEach((n) => { if (!out(n.name).length && n.type !== 'n8n-nodes-base.stickyNote' && n.name !== 'Log ops event' && n.name !== 'Create calendar event') assert.strictEqual(n.type, 'n8n-nodes-base.respondToWebhook', n.name + ' ends a path without a reply'); });
  const repliesIn = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').map((n) => n.name).filter((name) => name !== 'Reply with slots');
  assert.deepStrictEqual(repliesIn.slice().sort(), ['Reply booked', 'Reply held', 'Reply lost slot', 'Reply no booking'], 'every way a booking run ends has a reply');
  repliesIn.forEach((name) => assert.deepStrictEqual(out(name), ['Build ops event'], name + ' is followed by the ops event, never preceded by it'));
  assert.deepStrictEqual(out('Reply with slots'), [], 'listing free times is not a booking event');
  // every webhook reaches a reply
  const reach = (start) => { const seen = new Set(), todo = [start]; while (todo.length) { const x = todo.pop(); if (seen.has(x)) continue; seen.add(x); out(x).forEach((y) => todo.push(y)); } return seen; };
  hooks.forEach((h) => assert.ok(Array.from(reach(h.name)).some((x) => node(x).type === 'n8n-nodes-base.respondToWebhook'), h.name));
  assert.ok(has('Insert booking') && has('Cancel losing row') && has('Insert held row'));
  const sends = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.strictEqual(sends.length, 1, 'one email node only');
  assert.strictEqual(sends[0].parameters.operation, 'send');
  assert.strictEqual(sends[0].parameters.sendTo, '={{ $json.decision.row.email }}', 'only to the booked address');
  assert.strictEqual(sends[0].parameters.message, '={{ $json.decision.confirmation.html }}', 'only the fixed template, as brand HTML');
  assert.strictEqual(sends[0].parameters.emailType, 'html');
  assert.strictEqual(sends[0].onError, 'continueRegularOutput', 'a failed email must not lose the booking');
  assert.deepStrictEqual(wf.nodes.filter((n) => /httpRequest|langchain|lmChat/i.test(n.type)), [], 'no outside calls and no model');
  assert.deepStrictEqual(Object.keys(wf.connections).filter((k) => !has(k)), [], 'every connection starts at a real node');
  Object.values(wf.connections).forEach((c) => c.main.forEach((list) => list.forEach((l) => assert.ok(has(l.node), l.node))));
});

test('the order inside the booking path: insert, read again, verify, only then email', () => {
  const chain = (from) => { const order = []; let cur = from; while (cur) { order.push(cur); const next = ((wf.connections[cur] || {}).main || [])[0]; cur = next && next[0] && next[0].node; if (order.indexOf(cur) !== -1) break; } return order; };
  assert.deepStrictEqual(chain('Booked?'), ['Booked?', 'Insert booking', 'Load bookings (verify)', 'Verify winner', 'Won the slot?', 'Send confirmation', 'Confirmation outcome', 'Record confirmation status', 'Reply booked', 'Build ops event', 'Log ops event']);
  assert.deepStrictEqual(wf.connections['Won the slot?'].main[1].map((l) => l.node), ['Cancel losing row'], 'the loser is cancelled, not emailed');
  assert.deepStrictEqual(wf.connections['Cancel losing row'].main[0].map((l) => l.node), ['Reply lost slot']);
  assert.deepStrictEqual(wf.connections['Booked?'].main[1].map((l) => l.node), ['Held for review?']);
  assert.deepStrictEqual(wf.connections['Held for review?'].main[0].map((l) => l.node), ['Insert held row']);
  assert.deepStrictEqual(wf.connections['Insert held row'].main[0].map((l) => l.node), ['Reply held']);
  ['Load bookings (slots)', 'Load bookings', 'Load bookings (verify)'].forEach((n) => assert.strictEqual(node(n).alwaysOutputData, true, n + ' keeps the chain alive for an empty table'));
});

test('the Google Calendar entry: only for a kept booking, after the reply is set, with no attendees and no contact details', () => {
  const out = (name) => ((wf.connections[name] || {}).main || []).reduce((a, b) => a.concat(b), []).map((l) => l.node);
  // branches off the same node as the reply: it never delays or replaces the visitor's answer
  assert.deepStrictEqual(out('Record confirmation status'), ['Reply booked', 'Calendar entry']);
  assert.deepStrictEqual(out('Calendar entry'), ['Create calendar event']);
  assert.deepStrictEqual(out('Create calendar event'), [], 'the calendar create ends the path');
  // only the kept-booking path reaches it: a lost race is cancelled, a hold is never entered in the calendar
  const reachable = (start) => { const seen = new Set(), todo = [start]; while (todo.length) { const x = todo.pop(); if (seen.has(x)) continue; seen.add(x); out(x).forEach((y) => todo.push(y)); } return seen; };
  assert.ok(!reachable('Cancel losing row').has('Create calendar event'), 'a lost race has no calendar entry');
  assert.ok(!reachable('Insert held row').has('Create calendar event'), 'a hold has no calendar entry');
  const cal = node('Create calendar event');
  assert.strictEqual(cal.type, 'n8n-nodes-base.googleCalendar');
  assert.strictEqual(cal.onError, 'continueRegularOutput', 'a failed calendar create must not lose the booking');
  assert.strictEqual(cal.parameters.operation, 'create');
  assert.strictEqual(cal.parameters.start, '={{ $json.start }}');
  assert.strictEqual(cal.parameters.end, '={{ $json.end }}');
  assert.strictEqual(cal.parameters.additionalFields.sendUpdates, 'none', 'no invitation is sent');
  assert.strictEqual(cal.parameters.additionalFields.attendees, undefined, 'the visitor is not an attendee');
  assert.strictEqual(cal.credentials.googleCalendarOAuth2Api.id, 'zm0aokBQMyTEcVbe');
  assert.match(code('Calendar entry'), /bookCalendarEvent\(dec\.row, DATA\)/);
});

test('the calendar entry runs the library and carries no name, email or phone', () => {
  const r = runNode('Calendar entry', [{}], { 'Verify winner': { decision: { row: { bookingRef: 'DY-CAL001', area: 'family', attorney: 'dana-hollis', startUtc: '2026-11-17T16:00:00Z', endUtc: '2026-11-17T16:45:00Z', name: 'Priya Nandakumar', email: 'priya.n@mail.example', phone: '555-010-4444' } } } }, '', '');
  const ev = r[0].json;
  assert.strictEqual(ev.start, '2026-11-17T16:00:00Z');
  assert.strictEqual(ev.end, '2026-11-17T16:45:00Z');
  assert.strictEqual(ev.summary, 'Family law consultation (DY-CAL001)');
  assert.match(ev.description, /Attorney: Dana Hollis/);
  assert.doesNotMatch(JSON.stringify(ev), /Priya|priya|555|mail\.example/);
});

test('table nodes use exactly the declared columns; no credentials or real ids are stored', () => {
  const cols = loadColumns().map((c) => c.name);
  ['Insert booking', 'Insert held row'].forEach((n) => {
    assert.deepStrictEqual(Object.keys(node(n).parameters.columns.value), cols, n);
    assert.deepStrictEqual(node(n).parameters.columns.schema.map((s) => s.id), cols, n);
    assert.strictEqual(node(n).parameters.columns.schema.find((s) => s.id === 'minutes').type, 'number');
  });
  const text = JSON.stringify(wf);
  // the only credential reference is the Google Calendar one, by id: no secret values anywhere
  assert.deepStrictEqual(wf.nodes.filter((n) => n.credentials).map((n) => n.credentials), [{ googleCalendarOAuth2Api: { id: 'zm0aokBQMyTEcVbe', name: 'Google Calendar' } }]);
  assert.deepStrictEqual(Array.from(new Set(text.match(/REPLACE_WITH_[A-Z_]+/g))), ['REPLACE_WITH_BOOKINGS_TABLE_ID', 'REPLACE_WITH_OPS_EVENTS_TABLE_ID']);
  assert.doesNotMatch(text, /sk-|gsk_|AIza|xox[bp]-|Bearer /);
  assert.deepStrictEqual({ a: wf.settings.saveDataSuccessExecution, b: wf.settings.saveDataErrorExecution, c: wf.settings.saveExecutionProgress }, { a: 'none', b: 'none', c: false });
  assert.deepStrictEqual(node('Cancel losing row').parameters.columns.value, { status: 'cancelled_race' });
  assert.strictEqual(node('Cancel losing row').parameters.filters.conditions[0].keyName, 'bookingRef');
});

// ---- the ops event ----
const opsAdapters = require('../../ops/lib/adapters');
const opsEvent = require('../../ops/lib/event');
const opsSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'ops_events.schema.json'), 'utf8'));

test('the ops event node gives the row the library gives, for every labelled booking case, and nothing for invalid input or spam', () => {
  let logged = 0, skipped = 0;
  E.SET.cases.filter((c) => c.kind === 'book').forEach((c) => {
    const { req, rows, nowMs } = E.runBook(c);
    const nowIso = new Date(nowMs).toISOString();
    const dec = plain(B.bookDecide(req, rows, nowMs, E.DATA, { ref: 'DY-TEST01', now: nowIso }));
    const refs = { 'Decide booking': dec };
    const got = runNode('Build ops event', [{}], refs, nowIso);
    const want = opsAdapters.bookingEvent(dec, { now: new Date(nowIso), ref: (dec.row && dec.row.bookingRef) || '', leadRef: (dec.row && dec.row.leadRef) || '' });
    if (!want) { assert.deepStrictEqual(got, [], c.id + ' logs nothing'); skipped++; return; }
    assert.strictEqual(got.length, 1, c.id);
    assert.deepStrictEqual(got[0].json.row, opsEvent.toRow(want.event), c.id);
    assert.deepStrictEqual(Object.keys(got[0].json.row), opsSchema.columns.map((x) => x.name), c.id);
    // nothing private: not the name, the address, the phone or the other side
    const text = JSON.stringify(got[0].json.row).toLowerCase();
    [req.name, req.email, req.phone, req.otherSide].forEach((s) => { if (s && s.length >= 5) assert.ok(!text.includes(String(s).toLowerCase()), c.id + ' repeats ' + s); });
    logged++;
  });
  assert.strictEqual(logged + skipped, 60);
  assert.ok(logged >= 40 && skipped >= 10, 'logged ' + logged + ', skipped ' + skipped);
});

test('the ops event node follows the race: a booking that lost the slot is logged as blocked, not as booked', () => {
  const c = E.SET.cases.find((x) => x.kind === 'book' && x.expect.code === 'booked');
  const { req, rows, nowMs } = E.runBook(c);
  const nowIso = new Date(nowMs).toISOString();
  const dec = plain(B.bookDecide(req, rows, nowMs, E.DATA, { ref: 'DY-TEST01', now: nowIso }));
  const won = runNode('Build ops event', [{}], { 'Decide booking': dec, 'Verify winner': { won: true, ref: 'DY-TEST01', decision: dec } }, nowIso)[0].json.row;
  assert.strictEqual(won.status, 'ok');
  assert.match(won.summary, /: booked,/);
  const lost = plain(B.bookRaceLost(dec.row, 'slot_taken', rows, nowMs, E.DATA));
  const got = runNode('Build ops event', [{}], { 'Decide booking': dec, 'Verify winner': { won: false, ref: 'DY-TEST01', decision: dec, lost } }, nowIso)[0].json.row;
  assert.strictEqual(got.status, 'blocked');
  assert.match(got.summary, /slot_taken/);
  assert.doesNotMatch(got.summary, /: booked,/);
});

test('a booking that came from an intake lead is the receiving end of the handoff and chains by the lead reference', () => {
  const c = E.SET.cases.find((x) => x.kind === 'book' && x.expect.code === 'booked');
  const { req, rows, nowMs } = E.runBook(c);
  const nowIso = new Date(nowMs).toISOString();
  const dec = plain(B.bookDecide(Object.assign({}, req, { leadRef: 'DY-261111-AB12' }), rows, nowMs, E.DATA, { ref: 'DY-TEST01', now: nowIso }));
  const row = runNode('Build ops event', [{}], { 'Decide booking': dec, 'Verify winner': { won: true, ref: 'DY-TEST01', decision: dec } }, nowIso)[0].json.row;
  assert.strictEqual(row.source, 'handoff');
  assert.strictEqual(row.runId, 'DY-261111-AB12');
  assert.match(row.summary, /DY-TEST01/, 'the booking reference is in the summary');
});

test('the log node writes the table the schema describes, continues on failure and uses a placeholder id', () => {
  const log = node('Log ops event');
  assert.strictEqual(log.parameters.operation, 'insert');
  assert.strictEqual(log.onError, 'continueRegularOutput');
  assert.strictEqual(log.parameters.dataTableId.value, 'REPLACE_WITH_OPS_EVENTS_TABLE_ID');
  assert.deepStrictEqual(Object.keys(log.parameters.columns.value), opsSchema.columns.map((x) => x.name));
  const text = code('Build ops event');
  assert.match(text, /^\/\/ GENERATED by scripts\/build-booking-workflow\.mjs/);
  assert.doesNotMatch(text, /\brequire\(|module\.exports|\bfetch\(|\bprocess\./);
});

test('the library has no clock and no randomness of its own; the Code nodes are the library plus a few glue lines', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'booking.js'), 'utf8');
  assert.doesNotMatch(lib, /Date\.now\(|new Date\(\)|Math\.random|process\.|require\((?!'\.\.\/\.\.\/\.\.\/firm\/lib\/conflicts')/);
  ['List slots', 'Decide booking', 'Verify winner', 'Confirmation outcome'].forEach((n) => {
    const c = code(n);
    assert.match(c, /^\/\/ GENERATED by scripts\/build-booking-workflow\.mjs/);
    assert.doesNotMatch(c, /\brequire\(|module\.exports/);
    assert.ok(c.indexOf('function bookDecide(') !== -1 && c.indexOf('function checkConflicts(') !== -1 && c.indexOf('const DATA = {') !== -1);
  });
  assert.strictEqual((code('Decide booking').match(/Math\.random/g) || []).length, 1, 'randomness only in the reference glue');
});

test('the workflow file on disk is what the builder produces from the library today', async () => {
  const { buildWorkflow } = await import('../../../scripts/build-booking-workflow.mjs');
  assert.strictEqual(JSON.stringify(buildWorkflow(), null, 2) + '\n', fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8').replace(/\r\n/g, '\n'));
});
