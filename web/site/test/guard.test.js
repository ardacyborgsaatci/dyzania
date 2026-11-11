const test = require('node:test');
const assert = require('node:assert');
const guard = require('../lib/guard');
const { fakeRes, fakeReq, withSite } = require('./helpers');

test('a token issued a few seconds ago is accepted', withSite(async () => {
  const token = guard.issueToken(Date.now() - 10000);
  assert.deepStrictEqual(guard.checkToken(token), { ok: true });
}));

test('a token that is too fresh, too old, altered, missing or signed with another key is refused', withSite(async () => {
  const now = Date.now();
  assert.strictEqual(guard.checkToken(guard.issueToken(now - 500), { now }).reason, 'too_fast');
  assert.strictEqual(guard.checkToken(guard.issueToken(now - 3 * 60 * 60 * 1000), { now }).reason, 'expired');
  const good = guard.issueToken(now - 10000);
  const [stamp, signature] = good.split('.');
  assert.strictEqual(guard.checkToken(`${Number(stamp) - 1}.${signature}`, { now }).reason, 'bad');
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);   // always a different signature
  assert.strictEqual(guard.checkToken(`${stamp}.${flipped}`, { now }).reason, 'bad');
  for (const junk of [undefined, null, '', 'abc', 42, {}, '1.2']) assert.strictEqual(guard.checkToken(junk, { now }).reason, 'missing');
  process.env.FORM_TOKEN_SECRET = 'a-different-secret';
  assert.strictEqual(guard.checkToken(good, { now }).reason, 'bad');
}));

test('without a secret no token is issued or accepted', withSite(async () => {
  const good = guard.issueToken(Date.now() - 10000);
  delete process.env.FORM_TOKEN_SECRET;
  assert.throws(() => guard.issueToken());
  assert.strictEqual(guard.checkToken(good).reason, 'unconfigured');
}));

test('the rate limit counts per key inside a window and then lets go', () => {
  guard.resetRateLimits();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) assert.ok(guard.rateLimit('a', 3, 60000, t0 + i).ok);
  const refused = guard.rateLimit('a', 3, 60000, t0 + 10);
  assert.strictEqual(refused.ok, false);
  assert.ok(refused.retryAfterSec >= 59 && refused.retryAfterSec <= 60);
  assert.ok(guard.rateLimit('b', 3, 60000, t0 + 10).ok, 'another key has its own count');
  assert.ok(guard.rateLimit('a', 3, 60000, t0 + 60001).ok, 'the oldest request has left the window');
  guard.resetRateLimits();
});

test('same-origin: this site is accepted, other sites and bare scripts are not', () => {
  const ok = (headers) => guard.sameOrigin({ headers: { host: 'site.test', ...headers } });
  assert.ok(ok({ origin: 'https://site.test' }));
  assert.ok(ok({ referer: 'https://site.test/book?area=family' }));
  assert.ok(ok({ 'sec-fetch-site': 'same-origin' }));
  assert.ok(!ok({ origin: 'https://evil.test' }));
  assert.ok(!ok({ origin: 'https://site.test.evil.test' }));
  assert.ok(!ok({ referer: 'https://evil.test/' }));
  assert.ok(!ok({ 'sec-fetch-site': 'cross-site' }));
  assert.ok(!ok({}));
  assert.ok(!ok({ origin: 'not a url' }));
  assert.ok(!guard.sameOrigin({ headers: { origin: 'https://site.test' } }), 'no host header');
});

test('the visitor address comes from the platform headers', () => {
  assert.strictEqual(guard.clientIp({ headers: { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' } }), '198.51.100.7');
  assert.strictEqual(guard.clientIp({ headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.1' } }), '198.51.100.8');
  assert.strictEqual(guard.clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
  assert.strictEqual(guard.clientIp({ headers: {} }), 'unknown');
});

test('screen: method, origin, size and rate are checked, and answers are never cached', withSite(async () => {
  const options = { name: 't', method: 'POST', limit: 2, windowMs: 60000 };

  let res = fakeRes();
  assert.ok(guard.screen(fakeReq({ method: 'GET' }), res, options));
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(res.headers.Allow, 'POST');

  res = fakeRes();
  assert.ok(guard.screen(fakeReq({ headers: { origin: 'https://evil.test' } }), res, options));
  assert.strictEqual(res.statusCode, 403);

  res = fakeRes();
  assert.ok(guard.screen(fakeReq({ headers: { 'content-length': String(guard.MAX_BODY_BYTES + 1) } }), res, options));
  assert.strictEqual(res.statusCode, 413);

  guard.resetRateLimits();
  for (let i = 0; i < 2; i += 1) {
    res = fakeRes();
    assert.strictEqual(guard.screen(fakeReq({}), res, options), false);
    assert.strictEqual(res.headers['Cache-Control'], 'no-store');
  }
  res = fakeRes();
  assert.ok(guard.screen(fakeReq({}), res, options));
  assert.strictEqual(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) >= 1);
  assert.ok(res.body.retryAfterSec >= 1);

  res = fakeRes();
  assert.strictEqual(guard.screen(fakeReq({ ip: '198.51.100.99' }), res, options), false, 'another visitor is not limited');
}));

test('readBody refuses a body that is not a JSON object', () => {
  for (const body of [undefined, null, 'text', 5, [1, 2]]) {
    const res = fakeRes();
    assert.strictEqual(guard.readBody({ body }, res), null);
    assert.strictEqual(res.statusCode, 400);
  }
  assert.deepStrictEqual(guard.readBody({ body: { a: 1 } }, fakeRes()), { a: 1 });
});

test('the guard keeps no address, name or email in its source', () => {
  const source = require('node:fs').readFileSync(require.resolve('../lib/guard'), 'utf8');
  assert.doesNotMatch(source, /console\.(log|info|warn)/);
  assert.doesNotMatch(source, /console\.error\([^)]*(ip|req\.|body)/i);
});
