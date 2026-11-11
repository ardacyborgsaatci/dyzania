const test = require('node:test');
const assert = require('node:assert');
const handler = require('../api/feed');
const { fakeRes, jsonResponse, withEnv } = require('./helpers');

const feed = { generatedAt: '2026-11-07T10:00:00.000Z', total: 3, byCategory: { billing: 2, how_to: 1 }, recent: [] };

test('rejects non-GET requests', async () => {
  const res = fakeRes();
  await handler({ method: 'POST' }, res);
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(res.headers.Allow, 'GET');
});

test('returns 500 when the environment is not configured', async () => {
  const saved = ['N8N_FEED_URL', 'N8N_TRIAGE_SECRET'].map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  try {
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.strictEqual(res.statusCode, 500);
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
});

test('proxies the feed with the secret header and CDN caching', withEnv(async () => {
  let seen;
  global.fetch = async (url, options) => { seen = { url, options }; return jsonResponse(200, feed); };
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(seen.url, 'https://n8n.test/webhook/triage-feed');
  assert.strictEqual(seen.options.headers['X-Triage-Secret'], 'test-secret');
  assert.strictEqual(res.headers['Cache-Control'], 's-maxage=30, stale-while-revalidate=60');
  assert.deepStrictEqual(res.body, feed);
}));

test('returns 502 without caching when n8n fails or answers oddly', withEnv(async () => {
  for (const fetchImpl of [
    async () => jsonResponse(500, {}),
    async () => { throw new Error('network down'); },
    async () => jsonResponse(200, { total: 1 }),
    async () => jsonResponse(200, null),
  ]) {
    global.fetch = fetchImpl;
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.headers['Cache-Control'], undefined);
  }
}));
