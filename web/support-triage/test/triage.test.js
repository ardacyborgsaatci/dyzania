const test = require('node:test');
const assert = require('node:assert');
const handler = require('../api/triage');
const { fakeRes, jsonResponse, withEnv } = require('./helpers');

const good = { name: 'Ada', subject: 'Invoice question', body: 'Where do I find my invoices?' };
const reqFor = (body, headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }) => ({ method: 'POST', headers, body });
const upstreamOk = {
  ok: true, category: 'how_to', priority: 'normal', sentiment: 'neutral', language: 'en', summary: 'Wants to find invoices.',
  confidence: 0.95, needsHuman: false, humanReason: '', injectionSuspected: false, skipReason: '', draftStatus: 'drafted',
  draftReply: 'Hi there, ...', kbArticlesUsed: ['KB-06'], status: 'auto_triaged', latencyMs: 4100, promptVersion: 'v2', remaining: 3,
  draftProblems: ['internal'], models: 'gpt-oss-20b + gpt-oss-120b (Groq)', classificationStatus: 'ok',
};

test('rejects non-POST requests', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(res.headers.Allow, 'POST');
});

test('returns 400 for invalid input without calling n8n', withEnv(async () => {
  let called = false;
  global.fetch = async () => { called = true; return jsonResponse(200, upstreamOk); };
  const res = fakeRes();
  await handler(reqFor({ body: '   ' }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(called, false);
}));

test('silently accepts honeypot submissions without calling n8n', withEnv(async () => {
  let called = false;
  global.fetch = async () => { called = true; return jsonResponse(200, upstreamOk); };
  const res = fakeRes();
  await handler(reqFor({ ...good, website: 'http://spam.example' }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(called, false);
}));

test('returns 500 when the environment is not configured', async () => {
  const saved = ['N8N_TRIAGE_URL', 'N8N_TRIAGE_SECRET', 'IP_HASH_SALT'].map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  try {
    const res = fakeRes();
    await handler(reqFor(good), res);
    assert.strictEqual(res.statusCode, 500);
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
});

test('forwards a hashed visitor id and the secret header, never the raw IP', withEnv(async () => {
  let seen;
  global.fetch = async (url, options) => { seen = { url, options }; return jsonResponse(200, upstreamOk); };
  const res = fakeRes();
  await handler(reqFor(good), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(seen.url, 'https://n8n.test/webhook/triage-demo');
  assert.strictEqual(seen.options.headers['X-Triage-Secret'], 'test-secret');
  const sent = JSON.parse(seen.options.body);
  assert.match(sent.ipHash, /^[0-9a-f]{32}$/);
  assert.ok(!seen.options.body.includes('203.0.113.9'));
  assert.strictEqual(sent.source, 'playground');
  assert.strictEqual(sent.sampleId, '');
  assert.strictEqual(sent.body, good.body);
  assert.strictEqual(sent.website, undefined);
}));

test('the same visitor gets the same hash and a different visitor a different one', withEnv(async () => {
  const hashes = [];
  global.fetch = async (url, options) => { hashes.push(JSON.parse(options.body).ipHash); return jsonResponse(200, upstreamOk); };
  await handler(reqFor(good, { 'x-forwarded-for': '203.0.113.9' }), fakeRes());
  await handler(reqFor(good, { 'x-forwarded-for': '203.0.113.9' }), fakeRes());
  await handler(reqFor(good, { 'x-forwarded-for': '198.51.100.4' }), fakeRes());
  assert.strictEqual(hashes[0], hashes[1]);
  assert.notStrictEqual(hashes[0], hashes[2]);
}));

test('returns only whitelisted result fields', withEnv(async () => {
  global.fetch = async () => jsonResponse(200, upstreamOk);
  const res = fakeRes();
  await handler(reqFor(good), res);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.result.category, 'how_to');
  assert.strictEqual(res.body.result.remaining, 3);
  assert.strictEqual(res.body.result.draftProblems, undefined);
  assert.strictEqual(res.body.result.models, undefined);
  assert.strictEqual(res.body.result.classificationStatus, undefined);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
}));

test('passes a per-visitor 429 through with Retry-After', withEnv(async () => {
  global.fetch = async () => jsonResponse(429, { ok: false, error: 'rate_limited', reason: 'visitor_cap', retryAfterSec: 1800 });
  const res = fakeRes();
  await handler(reqFor(good), res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.headers['Retry-After'], '1800');
  assert.match(res.body.error, /5 demo requests/);
}));

test('explains the daily cap differently', withEnv(async () => {
  global.fetch = async () => jsonResponse(429, { ok: false, error: 'rate_limited', reason: 'daily_cap', retryAfterSec: 7200 });
  const res = fakeRes();
  await handler(reqFor(good), res);
  assert.strictEqual(res.statusCode, 429);
  assert.match(res.body.error, /daily limit/);
}));

test('returns 502 when n8n fails, is unreachable, or answers oddly', withEnv(async () => {
  for (const fetchImpl of [
    async () => jsonResponse(500, {}),
    async () => { throw new Error('network down'); },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    async () => jsonResponse(200, { ok: true }),
    async () => jsonResponse(200, null),
  ]) {
    global.fetch = fetchImpl;
    const res = fakeRes();
    await handler(reqFor(good), res);
    assert.strictEqual(res.statusCode, 502);
  }
}));

test('returns 503 with Retry-After when the AI model is unavailable', withEnv(async () => {
  global.fetch = async () => jsonResponse(503, { ok: false, error: 'ai_unavailable' });
  const res = fakeRes();
  await handler(reqFor(good), res);
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.headers['Retry-After'], '300');
  assert.match(res.body.error, /unavailable/);
}));
