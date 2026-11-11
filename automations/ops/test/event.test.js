'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEvent, validateEvent, orFallback, toRow, cleanSummary, AUTOMATIONS, TEAMS, SOURCES, STATUSES, MAX_SUMMARY, QUEUE } = require('../lib/event.js');

const base = { automation: 'triage', source: 'gmail', status: 'ok', runId: 'gm-1', summary: 'Email sorted: billing, priority normal' };
const NOW = new Date('2026-11-11T08:00:00Z');

test('builds a valid event and fills the team for every automation', () => {
  for (const automation of AUTOMATIONS) {
    const r = buildEvent({ ...base, automation }, NOW);
    assert.equal(r.ok, true, automation);
    assert.equal(r.event.team, TEAMS[automation]);
    assert.deepEqual(r.event.ts, NOW);
  }
  assert.deepEqual(AUTOMATIONS, ['intake', 'triage', 'booking', 'notices', 'voice', 'ops']);
  assert.deepEqual(TEAMS, { intake: 'intake', triage: 'front-office', booking: 'intake', notices: 'paralegals', voice: 'front-desk', ops: 'ops' });
});

test('an email address or a phone number never stays in a summary', () => {
  const a = buildEvent({ ...base, summary: 'Reply to jane.doe@example.com about a refund' }, NOW);
  assert.equal(a.ok, true);
  assert.ok(!a.event.summary.includes('@'));
  assert.match(a.event.summary, /\[address\]/);
  const b = buildEvent({ ...base, summary: 'Caller said 555 010 0199 and (555) 010-0123 and +1 555 010 0100' }, NOW);
  assert.doesNotMatch(b.event.summary, /\d{3}[ -]\d/);
  assert.equal((b.event.summary.match(/\[number\]/g) || []).length, 3);
  // references and short numbers are not phone numbers
  for (const ref of ['DY-B00001', 'DY-261111-AB12', 'DY-L00042', 'N-20261111-AB12-01']) assert.equal(cleanSummary('Ref ' + ref + ' done'), 'Ref ' + ref + ' done');
  assert.equal(cleanSummary('about 45 minutes, $150, 30 days'), 'about 45 minutes, $150, 30 days');
});

test('looksLikePhone sees a phone number and ignores the references this system issues', () => {
  const { looksLikePhone } = require('../lib/event.js');
  for (const yes of ['call 555 010 0199', '(555) 010-0123', '+1 555 010 0100', 'ref DY-B00001 phone 5550100199']) assert.equal(looksLikePhone(yes), true, yes);
  for (const no of ['Court notice N-20261111-AB12-01: summons', 'DY-261111-AB12', 'DY-L00042 booked', 'about 45 minutes, $150, 30 days', '', null, undefined]) assert.equal(looksLikePhone(no), false, String(no));
});

test('the summary is cut at 140 characters and may not be empty', () => {
  const r = buildEvent({ ...base, summary: 'x'.repeat(500) }, NOW);
  assert.equal(r.event.summary.length, MAX_SUMMARY);
  assert.equal(r.ok, true);
  assert.deepEqual(buildEvent({ ...base, summary: '   ' }, NOW).problems, ['summary']);
  assert.deepEqual(buildEvent({ ...base, summary: null }, NOW).problems, ['summary']);
});

test('refuses an unknown automation, source, status, run id or latency', () => {
  assert.deepEqual(buildEvent({ ...base, automation: 'billing' }, NOW).problems, ['automation']);
  assert.deepEqual(buildEvent({ ...base, source: 'fax' }, NOW).problems, ['source']);
  assert.deepEqual(buildEvent({ ...base, status: 'maybe' }, NOW).problems, ['status']);
  assert.deepEqual(buildEvent({ ...base, runId: '' }, NOW).problems, ['runId']);
  assert.deepEqual(buildEvent({ ...base, latencyMs: -5 }, NOW).problems, ['latencyMs']);
  assert.deepEqual(buildEvent({ ...base, latencyMs: 'slow' }, NOW).problems, ['latencyMs']);
  assert.equal(buildEvent({ ...base, latencyMs: 812.6 }, NOW).event.latencyMs, 813);
  assert.deepEqual(['gmail', 'web', 'voice', 'upload', 'seed', 'eval', 'schedule', 'handoff'].sort(), [...SOURCES].sort());
  assert.deepEqual(['ok', 'needs_human', 'blocked', 'error'], STATUSES);
});

test('a handoff names a known receiver and a reference, and a reference needs a receiver', () => {
  assert.equal(buildEvent({ ...base, handoffTo: 'intake', handoffRef: QUEUE }, NOW).ok, true);
  assert.equal(buildEvent({ ...base, automation: 'intake', source: 'web', handoffTo: 'booking', handoffRef: 'DY-L00001' }, NOW).ok, true);
  assert.deepEqual(buildEvent({ ...base, handoffTo: 'intake' }, NOW).problems, ['handoffRef']);
  assert.deepEqual(buildEvent({ ...base, handoffRef: 'x' }, NOW).problems, ['handoffTo']);
  assert.deepEqual(buildEvent({ ...base, handoffTo: 'billing', handoffRef: 'x' }, NOW).problems, ['handoffTo']);
});

test('never throws, whatever it is given', () => {
  for (const bad of [null, undefined, 5, 'x', [], { summary: { toString() { throw new Error('boom'); } } }]) {
    const r = buildEvent(bad, NOW);
    assert.equal(r.ok, false);
    assert.ok(Array.isArray(r.problems) && r.problems.length > 0);
  }
  assert.deepEqual(validateEvent({ ...buildEvent(base, NOW).event, ts: new Date('nope') }), ['ts']);
});

test('orFallback keeps a valid event and otherwise gives a valid error row, whatever it is given', () => {
  const good = buildEvent(base, NOW);
  assert.equal(orFallback(good, { automation: 'intake' }, NOW), good);
  const fb = { automation: 'booking', source: 'web', runId: 'DY-B00001', summary: 'The ops event for a booking could not be built' };
  for (const built of [null, undefined, { ok: false, event: null, problems: ['x'] }, buildEvent({ ...base, source: 'fax' }, NOW)]) {
    const r = orFallback(built, fb, NOW);
    assert.equal(r.ok, true);
    assert.equal(r.event.status, 'error');
    assert.equal(r.event.automation, 'booking');
    assert.equal(r.event.runId, 'DY-B00001');
  }
  // a fallback that is itself invalid still ends in a valid row, on the ops automation
  for (const bad of [{}, { automation: 'billing', source: 'fax', runId: '' }, null, { summary: 'x@y.example' }]) {
    const r = orFallback(null, bad, NOW);
    assert.equal(r.ok, true, JSON.stringify(bad));
    assert.equal(r.event.status, 'error');
    assert.ok(!r.event.summary.includes('@'));
  }
  assert.equal(orFallback(null, { status: 'ok' }, NOW).event.status, 'error', 'a fallback is never a success');
});

test('toRow gives exactly the columns of the table, with the time as text', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ops_events.schema.json'), 'utf8'));
  const row = toRow(buildEvent({ ...base, latencyMs: 40, handoffTo: 'intake', handoffRef: QUEUE }, NOW).event);
  assert.deepEqual(Object.keys(row), schema.columns.map((c) => c.name));
  assert.equal(row.ts, '2026-11-11T08:00:00.000Z');
  assert.equal(toRow(buildEvent(base, NOW).event).latencyMs, null);
  const enumOf = (name) => schema.columns.find((c) => c.name === name).enum;
  assert.deepEqual(enumOf('automation'), AUTOMATIONS);
  assert.deepEqual(enumOf('team'), [...new Set(Object.values(TEAMS))]);
  assert.deepEqual(enumOf('source'), SOURCES);
  assert.deepEqual(enumOf('status'), STATUSES);
  assert.equal(schema.columns.find((c) => c.name === 'summary').maxLength, MAX_SUMMARY);
});

test('the example config is the firm\'s, with nothing secret in it', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
  const firm = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'firm', 'firm.json'), 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['brand', 'domain', 'owner_address', 'timezone']);
  assert.equal(config.brand, firm.name);
  assert.equal(config.domain, firm.domain);
  assert.match(config.owner_address, /^SET_/);
  assert.doesNotMatch(JSON.stringify(config), /wrenbook/i);
});
