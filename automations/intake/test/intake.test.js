'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadFirmData } = require('../../../firm/lib/data');
const { validateIntake, scoreIntake, decideIntake, visitorMessage, processIntake, INTAKE_POINTS } = require('../lib/intake');
const { evaluate } = require('../eval/run');

const data = loadFirmData();
const TODAY = '2026-11-11';
const ctx = { today: TODAY, ref: 'DY-TEST-0001', now: '2026-11-11T12:00:00Z' };
const base = {
  name: 'Ana Lopez', email: 'ana.lopez@mail.example', phone: '555-0100', preferredContact: 'email', area: 'family',
  description: 'I want a divorce and need some help with the custody of our son. We separated in the summer.',
  location: 'harlow_point', hearing: 'none', incidentDate: '', otherSide: '', howHeard: '', consent: true
};
const run = (o) => processIntake(Object.assign({}, base, o), data, ctx);

test('validation accepts a good form and cleans it', () => {
  const v = validateIntake(Object.assign({}, base, { email: '  ANA.Lopez@Mail.Example ', description: '  I want a divorce\u0007 please help me  ' }), data, TODAY);
  assert.ok(v.ok);
  assert.strictEqual(v.clean.email, 'ana.lopez@mail.example');
  assert.strictEqual(v.clean.description, 'I want a divorce please help me');
});

test('validation rejects bad input field by field', () => {
  const errs = (o) => validateIntake(Object.assign({}, base, o), data, TODAY).errors || {};
  assert.ok(errs({ name: '' }).name);
  assert.ok(errs({ name: '<script>alert(1)</script>' }).name);
  assert.ok(!errs({ name: "José O'Brien-Müller" }).name);
  assert.ok(errs({ email: 'not-an-email' }).email);
  assert.ok(errs({ email: 'a@b.example\r\nBcc: x@y.example' }).email);
  assert.ok(errs({ phone: 'abc' }).phone);
  assert.ok(errs({ preferredContact: 'phone', phone: '' }).phone);
  assert.ok(errs({ preferredContact: 'carrier pigeon' }).preferredContact);
  assert.ok(errs({ area: 'crypto' }).area);
  assert.ok(errs({ description: 'too short' }).description);
  assert.ok(errs({ description: 'x'.repeat(1501) }).description);
  assert.ok(errs({ location: '' }).location);
  assert.ok(errs({ hearing: 'maybe' }).hearing);
  assert.ok(errs({ howHeard: 'telepathy' }).howHeard);
  assert.ok(errs({ incidentDate: '2026-12-01' }).incidentDate, 'a future date');
  assert.ok(errs({ incidentDate: '2026-02-30' }).incidentDate, 'a date that does not exist');
  assert.ok(errs({ incidentDate: '11/03/2026' }).incidentDate, 'the wrong format');
  assert.ok(!errs({ incidentDate: '2026-11-11' }).incidentDate, 'today is allowed');
  assert.ok(errs({ consent: false }).consent);
  assert.ok(errs({ consent: undefined }).consent);
  assert.deepStrictEqual(Object.keys(validateIntake(null, data, TODAY).errors).sort(), ['consent', 'description', 'email', 'location', 'name']);
});

test('the honeypot field is dropped quietly and nothing is scored', () => {
  const r = run({ website: 'http://spam.example' });
  assert.deepStrictEqual(r, { ok: true, spam: true });
});

test('score weights add up to 100 and the best possible lead gets 100', () => {
  const p = INTAKE_POINTS;
  const max = Math.max(...Object.values(p.area)) + Math.max(...Object.values(p.location)) + Math.max(...Object.values(p.time)) +
    (p.descriptionBands[0][1] + p.incidentDate + p.otherSide) + (p.email + p.phone);
  assert.strictEqual(max, 100);
  const r = run({ description: 'x'.repeat(10) + ' divorce custody ' + 'y'.repeat(300), hearing: 'within7', incidentDate: '2026-10-01', otherSide: 'Someone Else' });
  assert.strictEqual(r.lead.score, 100);
  assert.strictEqual(r.lead.tier, 'Hot');
});

test('time points use whichever is higher: the form answer or the wording', () => {
  assert.strictEqual(JSON.parse(run({ hearing: 'none', description: base.description + ' My hearing is tomorrow.' }).lead.scoreParts).time, 20);
  assert.strictEqual(JSON.parse(run({ hearing: 'later' }).lead.scoreParts).time, 12);
  assert.strictEqual(JSON.parse(run({ hearing: 'within7' }).lead.scoreParts).time, 20);
  assert.strictEqual(JSON.parse(run({}).lead.scoreParts).time, 0);
});

test('next step order: not a fit, refer out, conflict hold, urgent, unclear, follow up, book', () => {
  // each case also has something lower in the list that would apply, to show the order
  const out = run({ location: 'elsewhere', area: 'other', description: 'I was arrested for a DUI and have a bail hearing tomorrow, please help me.', otherSide: 'Oren Kessler' });
  assert.strictEqual(out.lead.nextStep, 'not_a_fit');
  const refer = run({ area: 'other', description: 'I was arrested for a DUI and have a bail hearing tomorrow, please help me.', otherSide: 'Oren Kessler' });
  assert.strictEqual(refer.lead.nextStep, 'refer_out');
  const hold = run({ otherSide: 'Oren Kessler', hearing: 'within7' });
  assert.strictEqual(hold.lead.nextStep, 'hold_conflict');
  assert.strictEqual(hold.lead.priority, 'urgent', 'a held lead that is urgent still alerts');
  assert.strictEqual(hold.alert.send, true);
  assert.strictEqual(run({ hearing: 'within7' }).lead.nextStep, 'attorney_now');
  assert.strictEqual(run({ area: 'other', description: 'Something happened and I need to talk to someone about it.' }).lead.nextStep, 'ask_more');
  assert.strictEqual(run({ area: 'injury', description: 'I was fired last week and I think it was unfair, please help me.' }).lead.nextStep, 'follow_up');
  assert.strictEqual(run({}).lead.nextStep, 'book');
});

test('a conflict hold caps the tier at Warm', () => {
  const longText = 'divorce custody ' + 'y'.repeat(300);
  const clear = run({ description: longText, otherSide: 'Nobody Known', incidentDate: '2026-10-01' });
  const held = run({ description: longText, otherSide: 'Oren Kessler', incidentDate: '2026-10-01' });
  assert.strictEqual(clear.lead.tier, 'Hot');
  assert.strictEqual(held.lead.tier, 'Warm');
  assert.ok(held.lead.score >= 75, 'the score itself is not changed, only the tier');
});

test('the attorney on duty is not alerted for matters the firm cannot take, unless safety wording is present', () => {
  const eviction = run({ area: 'other', description: 'My landlord gave me a three day notice to quit and I must be out by Nov 14.' });
  assert.strictEqual(eviction.lead.priority, 'urgent');
  assert.strictEqual(eviction.alert.send, false);
  const unsafe = run({ area: 'other', location: 'elsewhere', description: 'My landlord says he will hurt me if I stay, I am afraid for my safety.' });
  assert.strictEqual(unsafe.alert.send, true);
});

test('the lead record has every column the intake_leads table needs, and nothing else', () => {
  const columns = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'columns.json'), 'utf8')).map((c) => c.name);
  assert.deepStrictEqual(Object.keys(run({}).lead).sort(), columns.slice().sort());
});

test('visitor reply: fixed templates, no advice, no promises, no hint of a conflict', () => {
  const forbidden = [/you have a (good |strong )?case/i, /you (will|should) win/i, /within \d+ (hours?|minutes?|days?)/i, /by (tomorrow|today|end of day)/i,
    /guarantee/i, /conflict/i, /we (can|will) (definitely )?help you win/i, /your deadline (is|was)/i, /statute of limitations/i, /must (file|respond) by/i];
  const forms = [
    {}, { hearing: 'within7' }, { otherSide: 'Oren Kessler' }, { otherSide: 'Oren Kessler', hearing: 'within7' },
    { area: 'other', description: 'I was arrested for a DUI last night, I need help.' }, { location: 'elsewhere' },
    { area: 'other', description: 'Something happened and I need to talk to someone about it.' },
    { area: 'injury', description: 'I was fired last week and I think it was unfair, please help me.' },
    { description: base.description + ' I am afraid for my safety and want a protective order.' }
  ];
  for (const f of forms) {
    const r = run(f);
    for (const re of forbidden) assert.doesNotMatch(r.visitor.text, re, JSON.stringify(f) + ' -> ' + re);
    assert.match(r.visitor.text, /automated assistant, not a lawyer/);
    assert.match(r.visitor.text, /not legal advice/);
    assert.ok(r.visitor.text.length < 1400, 'short enough to read');
  }
});

test('visitor reply: each next step says the right thing', () => {
  assert.match(run({}).visitor.text, /book/);
  assert.match(run({ area: 'injury', description: 'I was injured in a collision last week, please help me.' }).visitor.text, /free/);
  assert.match(run({}).visitor.text, /\$150/);
  assert.match(run({ hearing: 'within7' }).visitor.text, /555-0142/);
  assert.match(run({ hearing: 'within7' }).visitor.text, /cannot promise a response time/);
  assert.match(run({ area: 'other', description: 'My work visa expires soon and I need help with immigration.' }).visitor.text, /bar association/);
  assert.match(run({ location: 'elsewhere' }).visitor.text, /Harlow Point and the surrounding area/);
  assert.match(run({ description: base.description + ' I am afraid for my safety.' }).visitor.text, /call 911/);
  // a held lead does not get a booking link, an urgent held lead gets the urgent wording
  assert.doesNotMatch(run({ otherSide: 'Oren Kessler' }).visitor.text, /book/);
  assert.match(run({ otherSide: 'Oren Kessler', hearing: 'within7' }).visitor.text, /flagged for a person/);
  assert.match(run({ name: 'Ana Lopez' }).visitor.headline, /^Thanks, Ana\./);
});

test('the alert email carries no message text, no email address and no phone number', () => {
  const r = run({ description: base.description + ' My secret detail is ZEBRA-1234.', hearing: 'within7', otherSide: 'Oren Kessler' });
  assert.strictEqual(r.alert.send, true);
  const all = r.alert.subject + '\n' + r.alert.text;
  assert.doesNotMatch(all, /ZEBRA-1234/);
  assert.doesNotMatch(all, /ana\.lopez@/);
  assert.doesNotMatch(all, /555-0100/);
  assert.doesNotMatch(all, /Ana Lopez/);
  assert.doesNotMatch(all, /Oren Kessler/);
  assert.match(all, /DY-TEST-0001/);
  assert.match(all, /not legal advice/);
});

test('the conflict note names ids and reasons only', () => {
  const r = run({ otherSide: 'Oren Kessler' });
  assert.strictEqual(r.lead.conflictNote, 'c003 other_side: match');
});

test('a hostile name or description is stored as text and never reaches the alert or the reply as markup', () => {
  const r = run({ description: base.description + ' <img src=x onerror=alert(1)>' });
  assert.ok(r.ok);
  assert.doesNotMatch(r.alert.text, /<img/);
  assert.doesNotMatch(r.visitor.text, /<img/);
  assert.strictEqual(run({ name: '<b>Ana</b>' }).ok, false);
});

test('the eval set passes: every expected area, step, tier, urgency, conflict and score', () => {
  const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
  const out = evaluate(setup, data);
  const bad = out.rows.filter((r) => r.misses.length).map((r) => r.id + ': ' + r.misses.join(','));
  assert.deepStrictEqual(bad, []);
  assert.strictEqual(out.summary.allFields, setup.cases.length);
});

test('the eval scorer can fail (negative control)', () => {
  const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
  setup.cases[0].expect.tier = 'Low';
  setup.cases[1].expect.score = 1;
  setup.cases[2].expect.nextStep = 'book';
  const out = evaluate(setup, data);
  assert.deepStrictEqual(out.rows.filter((r) => r.misses.length).map((r) => r.id), [setup.cases[0].id, setup.cases[1].id, setup.cases[2].id]);
});

test('the eval set keeps its promises about what it covers', () => {
  const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
  const cls = (n) => (n >= 300 ? 'L' : n >= 120 ? 'M' : n >= 40 ? 'S' : '-');
  for (const c of setup.cases) assert.strictEqual(cls(c.input.description.trim().length), c.len, c.id + ' description length class');
  const steps = new Set(setup.cases.map((c) => c.expect.nextStep));
  for (const s of ['book', 'follow_up', 'ask_more', 'hold_conflict', 'attorney_now', 'refer_out', 'not_a_fit']) assert.ok(steps.has(s), 'no case for ' + s);
  const areas = new Set(setup.cases.map((c) => c.expect.area));
  for (const a of ['family', 'injury', 'employment', 'estate', 'out_of_scope', 'unclear']) assert.ok(areas.has(a), 'no case for ' + a);
  assert.ok(new Set(setup.cases.map((c) => c.id)).size === setup.cases.length);
  assert.ok(setup.cases.length >= 40);
  const text = JSON.stringify(setup);
  assert.doesNotMatch(text, /wrenbook/i);
  for (const a of text.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g) || []) assert.match(a, /@mail\.example$/, a);
});
