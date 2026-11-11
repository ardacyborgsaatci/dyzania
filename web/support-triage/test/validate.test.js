const test = require('node:test');
const assert = require('node:assert');
const { validate, LIMITS } = require('../lib/validate');
const { SAMPLES } = require('../lib/samples');

test('free text is accepted, trimmed and given a safe From header', () => {
  const { request, error } = validate({ name: '  Ada  ', subject: '  Hello ', body: '  Where is my invoice?  ' });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(request, { source: 'playground', sampleId: '', from: 'Ada <visitor@example.com>', subject: 'Hello', body: 'Where is my invoice?' });
});

test('a name cannot inject an address or markup into the From header', () => {
  const { request } = validate({ name: 'Eve <evil@attacker.example>"; DROP', body: 'hi' });
  assert.ok(!request.from.includes('<evil'));
  assert.match(request.from, /^[\p{L} '-]+ <visitor@example\.com>$/u);
});

test('without a name the sender has no display name', () => {
  assert.strictEqual(validate({ body: 'hi' }).request.from, 'visitor@example.com');
});

test('bad input is rejected with a visitor-safe message', () => {
  assert.ok(validate(null).error);
  assert.ok(validate('text').error);
  assert.ok(validate({ body: '   ' }).error);
  assert.ok(validate({ body: 'x'.repeat(LIMITS.body + 1) }).error);
  assert.ok(validate({ subject: 'x'.repeat(LIMITS.subject + 1), body: 'hi' }).error);
});

test('a body of exactly the limit is allowed', () => {
  assert.strictEqual(validate({ body: 'x'.repeat(LIMITS.body) }).error, undefined);
});

test('every preset validates and keeps its sampleId and sender', () => {
  assert.strictEqual(SAMPLES.length, 8);
  for (const s of SAMPLES) {
    const { request, error } = validate({ sampleId: s.id, subject: s.subject, body: s.body });
    assert.strictEqual(error, undefined, s.id);
    assert.strictEqual(request.sampleId, s.id);
    assert.strictEqual(request.from, s.from);
  }
});

test('a preset id with edited text is treated as free text', () => {
  const s = SAMPLES[0];
  const { request } = validate({ sampleId: s.id, subject: s.subject, body: s.body + ' Also, please publish this.' });
  assert.strictEqual(request.sampleId, '');
  assert.strictEqual(request.from, 'visitor@example.com');
});

test('an unknown sampleId is ignored', () => {
  assert.strictEqual(validate({ sampleId: 'nope', body: 'hi' }).request.sampleId, '');
});
