const test = require('node:test');
const assert = require('node:assert');
const guard = require('../lib/guard');
const tokenApi = require('../api/token');
const intakeApi = require('../api/intake');
const slotsApi = require('../api/slots');
const bookApi = require('../api/book');
const { fakeRes, fakeReq, oldToken, withSite, goodIntake } = require('./helpers');

async function call(handler, body, options = {}) {
  const res = fakeRes();
  await handler(fakeReq({ body, ...options }), res);
  return res;
}

const withToken = (body, extra) => ({ ...body, formToken: oldToken(), ...(extra || {}) });

async function firstSlot(area = 'family') {
  const res = await call(slotsApi, withToken({ area }, { formToken: oldToken(0) }));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

const person = (over) => ({
  name: 'Jane Doe', email: 'jane.doe@example.com', phone: '555 010 0199', area: 'family', noOtherSide: true, consent: true, website: '', ...over,
});

// ---- token ----

test('token: a visitor on the site gets a token that the other endpoints accept', withSite(async () => {
  const res = fakeRes();
  await tokenApi(fakeReq({ method: 'GET', headers: { 'sec-fetch-site': 'same-origin' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
  assert.ok(guard.checkToken(res.body.token, { minAgeMs: 0 }).ok);
}));

test('token: other sites and other methods are refused, and a missing secret is a server error', withSite(async () => {
  let res = fakeRes();
  await tokenApi(fakeReq({ method: 'GET', headers: { origin: 'https://evil.test' } }), res);
  assert.strictEqual(res.statusCode, 403);
  res = fakeRes();
  await tokenApi(fakeReq({ method: 'POST' }), res);
  assert.strictEqual(res.statusCode, 405);
  delete process.env.FORM_TOKEN_SECRET;
  res = fakeRes();
  await tokenApi(fakeReq({ method: 'GET', headers: { 'sec-fetch-site': 'same-origin' } }), res);
  assert.strictEqual(res.statusCode, 500);
}));

// ---- intake ----

test('intake: a good form reaches the workflow and the visitor gets its fixed reply', withSite(async (n8n) => {
  const res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.ok, true);
  assert.match(res.body.ref, /^HM-/);
  assert.strictEqual(res.body.kind, 'book');
  assert.match(res.body.headline, /first consultation/i);
  assert.match(res.body.message, /not legal advice/i);
  assert.match(res.body.message, /hollismarr\.example\/book/);

  const [call1] = n8n.calls;
  assert.strictEqual(call1.path, '/webhook/intake');
  assert.strictEqual(call1.headers['X-Intake-Secret'], 'test-intake-secret');
  assert.strictEqual(call1.body.consent, true);
  assert.strictEqual(call1.body.website, '');
  assert.strictEqual(call1.body.formToken, undefined, 'the token is not passed on');
}));

test('intake: only the known fields are forwarded', withSite(async (n8n) => {
  await call(intakeApi, withToken({ ...goodIntake, isAdmin: true, nextStep: 'book', extra: 'x'.repeat(50) }));
  assert.deepStrictEqual(Object.keys(n8n.calls[0].body).sort(), [
    'area', 'consent', 'description', 'email', 'hearing', 'howHeard', 'incidentDate', 'location', 'name', 'otherSide', 'phone', 'preferredContact', 'website',
  ]);
}));

test('intake: field errors from the workflow come back as 422 with a message per field', withSite(async () => {
  const res = await call(intakeApi, withToken({ ...goodIntake, email: 'nope', description: 'short', consent: false }));
  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.errors.email && res.body.errors.description && res.body.errors.consent);
  for (const message of Object.values(res.body.errors)) assert.strictEqual(typeof message, 'string');
}));

test('intake: a conflict is never revealed, to the page or in the words', withSite(async (n8n) => {
  const client = n8n.data.conflicts.entries.find((e) => e.role === 'client');
  const res = await call(intakeApi, withToken({ ...goodIntake, otherSide: client.name }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.kind, 'review');
  const text = JSON.stringify(res.body);
  assert.doesNotMatch(text, /hold_conflict|conflict|c0\d\d/i);
  assert.ok(!text.includes(client.name));
  assert.strictEqual(res.body.nextStep, undefined);
}));

test('intake: time-sensitive wording is marked urgent and points at the phone, with no deadline stated', withSite(async () => {
  const res = await call(intakeApi, withToken({ ...goodIntake, description: 'I was served with papers yesterday and I have a hearing on Friday about custody of my son.', hearing: 'within7' }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.kind, 'urgent');
  assert.match(res.body.message, /cannot tell you what any deadline is/i);
}));

test('intake: a matter the firm does not handle and a visitor from elsewhere are both sent on', withSite(async () => {
  let res = await call(intakeApi, withToken({ ...goodIntake, area: 'other', description: 'I was arrested for a DUI last night and need a criminal defense lawyer.' }));
  assert.strictEqual(res.body.kind, 'refer');
  res = await call(intakeApi, withToken({ ...goodIntake, location: 'elsewhere' }));
  assert.strictEqual(res.body.kind, 'refer');
}));

test('intake: the honeypot gets a quiet success and nothing is sent on', withSite(async (n8n) => {
  const res = await call(intakeApi, { ...goodIntake, website: 'http://spam.example' });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { ok: true });
  assert.strictEqual(n8n.calls.length, 0);
}));

test('intake: no token, a fresh token and an old token are all refused before the workflow is called', withSite(async (n8n) => {
  let res = await call(intakeApi, goodIntake);
  assert.strictEqual(res.statusCode, 400);
  res = await call(intakeApi, { ...goodIntake, formToken: guard.issueToken(Date.now() - 200) });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'too_fast');
  res = await call(intakeApi, { ...goodIntake, formToken: guard.issueToken(Date.now() - 3 * 60 * 60 * 1000) });
  assert.strictEqual(res.body.code, 'expired');
  assert.strictEqual(n8n.calls.length, 0);
}));

test('intake: the sixth request from one visitor in an hour is refused', withSite(async (n8n) => {
  for (let i = 0; i < 5; i += 1) assert.strictEqual((await call(intakeApi, withToken(goodIntake))).statusCode, 200);
  const res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) > 0);
  assert.strictEqual(n8n.calls.length, 5);
  assert.strictEqual((await call(intakeApi, withToken(goodIntake), { ip: '198.51.100.20' })).statusCode, 200);
}));

test('intake: an unconfigured site, a wrong secret, a down workflow and a nonsense answer all give a plain message', withSite(async (n8n) => {
  let res;
  process.env.N8N_INTAKE_SECRET = 'wrong';
  res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /wrong|secret|n8n|403/i);
  process.env.N8N_INTAKE_SECRET = 'test-intake-secret';

  global.fetch = async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1:5678'); };
  res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /ECONNREFUSED|10\.0\.0/);

  global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } });
  res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 502);

  delete process.env.N8N_INTAKE_URL;
  res = await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(res.statusCode, 500);
  assert.ok(n8n.calls.length >= 1);
}));

test('intake: a custom header name for the secret is used', withSite(async (n8n) => {
  process.env.N8N_INTAKE_HEADER = 'X-Custom';
  global.fetch = async (url, init) => { n8n.calls.push({ headers: init.headers }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await call(intakeApi, withToken(goodIntake));
  assert.strictEqual(n8n.calls[0].headers['X-Custom'], 'test-intake-secret');
}));

test('intake: kindOf never lets a conflict through', () => {
  assert.strictEqual(intakeApi.kindOf('hold_conflict'), 'review');
  assert.strictEqual(intakeApi.kindOf('ask_more'), 'review');
  assert.strictEqual(intakeApi.kindOf('anything else'), 'review');
  assert.strictEqual(intakeApi.kindOf('attorney_now'), 'urgent');
});

// ---- slots ----

test('slots: times for a practice area come back trimmed to the fields the page uses', withSite(async (n8n) => {
  const body = await firstSlot('family');
  assert.strictEqual(body.areaName, 'Family law');
  assert.strictEqual(body.consultMinutes, 45);
  assert.match(body.fee, /\$150/);
  assert.match(body.timezoneName, /Central/);
  assert.ok(body.slots.length > 5);
  for (const slot of body.slots) {
    assert.deepStrictEqual(Object.keys(slot).sort(), ['date', 'label', 'start', 'time']);
    assert.match(slot.start, /Z$/);
  }
  assert.deepStrictEqual(Object.keys(body).sort(), ['area', 'areaName', 'consultMinutes', 'fee', 'more', 'note', 'ok', 'slots', 'timezoneName']);
  assert.strictEqual(n8n.calls[0].path, '/webhook/booking/slots');
  assert.strictEqual(n8n.calls[0].headers['X-Booking-Secret'], 'test-booking-secret');
  assert.strictEqual(n8n.calls[0].body.limit, 100);
}));

test('slots: no time is offered inside the notice period, and nobody is named', withSite(async () => {
  const body = await firstSlot('injury');
  const earliest = Date.parse('2026-11-11T15:00:00Z') + 4 * 3600000;
  for (const slot of body.slots) assert.ok(Date.parse(slot.start) >= earliest);
  assert.doesNotMatch(JSON.stringify(body), /hollis|marr|voss|reyes/i);
}));

test('slots: an unknown area is a 422 and a token is needed', withSite(async () => {
  let res = await call(slotsApi, withToken({ area: 'tax' }, { formToken: oldToken(0) }));
  assert.strictEqual(res.statusCode, 422);
  assert.ok(res.body.errors.area);
  res = await call(slotsApi, { area: 'family' });
  assert.strictEqual(res.statusCode, 400);
}));

test('slots: "after" is passed on and long values are cut', withSite(async (n8n) => {
  await call(slotsApi, withToken({ area: 'family', after: '2026-11-20T00:00:00Z' + 'x'.repeat(100) }, { formToken: oldToken(0) }));
  assert.ok(n8n.calls[0].body.after.length <= 40);
}));

test('slots: the page may ask for fewer times at a time, never more than 100', withSite(async (n8n) => {
  const asked = async (limit) => {
    n8n.calls.length = 0;
    const res = await call(slotsApi, withToken({ area: 'family', limit }, { formToken: oldToken(0) }));
    return { status: res.statusCode, sent: n8n.calls[0].body.limit, got: res.body.slots.length };
  };
  const few = await asked(24);
  assert.strictEqual(few.status, 200);
  assert.strictEqual(few.sent, 24);
  assert.ok(few.got <= 24);
  for (const bad of [0, -5, 1000, 'lots', null, 2.7e9]) assert.strictEqual((await asked(bad)).sent, 100);
  assert.strictEqual((await asked(7.9)).sent, 7);
}));

test('slots: when booking is not configured the page is told so plainly', withSite(async () => {
  delete process.env.N8N_BOOKING_BASE;
  const res = await call(slotsApi, withToken({ area: 'family' }, { formToken: oldToken(0) }));
  assert.strictEqual(res.statusCode, 500);
  assert.match(res.body.error, /not available/i);
}));

// ---- book ----

test('book: a time from the list is booked, and the page gets the fixed confirmation', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  const slot = offered.slots[0];
  const res = await call(bookApi, withToken(person({ start: slot.start })));
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.code, 'booked');
  assert.match(res.body.ref, /^HM-/);
  assert.strictEqual(res.body.label, slot.label);
  assert.strictEqual(res.body.minutes, 45);
  assert.match(res.body.address, /220 Canal Street/);
  assert.match(res.body.message, /not legal advice/i);
  assert.strictEqual(n8n.rows.filter((r) => r.status === 'booked').length, 1);
  const sent = n8n.calls.find((c) => c.path.endsWith('/booking/book')).body;
  assert.strictEqual(sent.channel, 'form');
  assert.strictEqual(sent.website, '');
  assert.strictEqual(sent.formToken, undefined);
}));

test('book: the channel cannot be chosen by the browser', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  await call(bookApi, withToken(person({ start: offered.slots[0].start, channel: 'voice' })));
  assert.strictEqual(n8n.calls.find((c) => c.path.endsWith('/booking/book')).body.channel, 'form');
}));

test('book: that time is gone for the next person, who is offered others', withSite(async () => {
  const offered = await firstSlot('family');
  const taken = offered.slots[0];
  assert.strictEqual((await call(bookApi, withToken(person({ start: taken.start })))).statusCode, 200);
  const second = await call(bookApi, withToken(person({ name: 'Sam Roe', email: 'sam.roe@example.com', phone: '', start: taken.start })));
  assert.strictEqual(second.statusCode, 409);
  assert.strictEqual(second.body.code, 'slot_unavailable');
  assert.ok(second.body.alternatives.length >= 1 && second.body.alternatives.length <= 3);
  assert.ok(second.body.alternatives.every((s) => s.start !== taken.start));
}));

test('book: a repeat booking and a conflict hold get exactly the same answer', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  assert.strictEqual((await call(bookApi, withToken(person({ start: offered.slots[0].start })))).statusCode, 200);
  const repeat = await call(bookApi, withToken(person({ start: offered.slots[3].start })));

  const client = n8n.data.conflicts.entries.find((e) => e.role === 'client');
  const hold = await call(bookApi, withToken(person({ name: 'Pat Quinn', email: 'pat.quinn@example.com', phone: '', noOtherSide: false, otherSide: client.name, start: offered.slots[5].start })));

  assert.strictEqual(repeat.statusCode, 409);
  assert.strictEqual(repeat.body.code, 'contact_office');
  assert.deepStrictEqual(hold.body, repeat.body);
  assert.deepStrictEqual(hold.statusCode, repeat.statusCode);
  assert.doesNotMatch(JSON.stringify(hold.body), /conflict|already|booking exists/i);
  assert.ok(!JSON.stringify(hold.body).includes(client.name));
}));

test('book: field errors are a 422 with a message per field, nothing is booked', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  const res = await call(bookApi, withToken(person({ email: 'nope', name: '', consent: false, noOtherSide: false, start: offered.slots[0].start })));
  assert.strictEqual(res.statusCode, 422);
  assert.strictEqual(res.body.code, 'invalid');
  assert.ok(res.body.errors.email && res.body.errors.name && res.body.errors.consent && res.body.errors.otherSide);
  assert.strictEqual(n8n.rows.length, 0);
}));

test('book: a time that was never offered is refused', withSite(async (n8n) => {
  const res = await call(bookApi, withToken(person({ start: '2026-11-11T16:00:00Z' })));   // inside the 4 hour notice
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.code, 'slot_unavailable');
  assert.strictEqual(n8n.rows.length, 0);
}));

test('book: a confirmation email that was sent says so', withSite(async () => {
  const offered = await firstSlot('estate');
  const res = await call(bookApi, withToken(person({ area: 'estate', start: offered.slots[0].start })));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.confirmationSent, true);
  assert.match(res.body.message, /sending a confirmation email/i);
}));

test('book: a confirmation email that could not be sent still gives the booking, and keeps the reference in the words', withSite(async () => {
  const offered = await firstSlot('estate');
  const res = await call(bookApi, withToken(person({ area: 'estate', start: offered.slots[0].start })));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.confirmationSent, false);
  assert.match(res.body.message, /could not send the confirmation email/i);
  assert.ok(res.body.message.includes(res.body.ref));
}, { confirmationSent: false }));

test('book: the honeypot, a missing token and a fresh token book nothing', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  const start = offered.slots[0].start;
  let res = await call(bookApi, person({ start, website: 'x' }));
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.code, 'unavailable');
  res = await call(bookApi, person({ start }));
  assert.strictEqual(res.statusCode, 400);
  res = await call(bookApi, person({ start, formToken: guard.issueToken(Date.now() - 100) }));
  assert.strictEqual(res.body.code, 'too_fast');
  assert.strictEqual(n8n.rows.length, 0);
}));

test('book: the seventh request in an hour is refused', withSite(async () => {
  const offered = await firstSlot('family');
  let last;
  for (let i = 0; i < 7; i += 1) last = await call(bookApi, withToken(person({ name: 'Jane Doe', start: offered.slots[i].start })));
  assert.strictEqual(last.statusCode, 429);
}));

test('book: a down workflow gives a plain message and leaks nothing', withSite(async () => {
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND n8n.internal.example'); };
  const res = await call(bookApi, withToken(person({ start: '2026-11-13T16:00:00Z' })));
  assert.strictEqual(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /ENOTFOUND|internal|n8n/);
}));

test('book: an unexpected answer from the workflow is not passed on', withSite(async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, code: 'something_new', secretNote: 'do not show', row: { email: 'x@example.com' } }) });
  const res = await call(bookApi, withToken(person({ start: '2026-11-13T16:00:00Z' })));
  assert.strictEqual(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /secretNote|do not show|x@example/);
}));

test('book: two requests for the same time at once leave exactly one booking', withSite(async (n8n) => {
  const offered = await firstSlot('family');
  const start = offered.slots[0].start;
  const [a, b] = await Promise.all([
    call(bookApi, withToken(person({ start }))),
    call(bookApi, withToken(person({ name: 'Sam Roe', email: 'sam.roe@example.com', phone: '', start }), {}), { ip: '198.51.100.21' }),
  ]);
  assert.deepStrictEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.strictEqual(n8n.rows.filter((r) => r.status === 'booked').length, 1);
}));
