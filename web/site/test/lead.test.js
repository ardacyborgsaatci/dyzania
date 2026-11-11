const test = require('node:test');
const assert = require('node:assert');
const { validate } = require('../lib/lead-validate');
const handler = require('../api/lead');

const good = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Co',
  companySize: '200+',
  budget: '$20k+',
  timeline: 'This month',
  message: 'Hello',
  consent: true,
  website: '',
};

function fakeRes() {
  const res = { headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function withEnv(fn) {
  return async () => {
    const saved = { url: process.env.N8N_WEBHOOK_URL, secret: process.env.N8N_WEBHOOK_SECRET, fetch: global.fetch };
    process.env.N8N_WEBHOOK_URL = 'https://n8n.test/webhook/lead';
    process.env.N8N_WEBHOOK_SECRET = 'test-secret';
    try {
      await fn();
    } finally {
      process.env.N8N_WEBHOOK_URL = saved.url;
      process.env.N8N_WEBHOOK_SECRET = saved.secret;
      global.fetch = saved.fetch;
      if (saved.url === undefined) delete process.env.N8N_WEBHOOK_URL;
      if (saved.secret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
    }
  };
}

test('validate accepts a good lead and trims values', () => {
  const { lead, error } = validate({ ...good, name: '  Ada  ' });
  assert.strictEqual(error, undefined);
  assert.strictEqual(lead.name, 'Ada');
  assert.strictEqual(lead.consent, undefined);
  assert.strictEqual(lead.website, undefined);
});

test('validate rejects bad input', () => {
  assert.ok(validate(null).error);
  assert.ok(validate({ ...good, name: '' }).error);
  assert.ok(validate({ ...good, email: 'not-an-email' }).error);
  assert.ok(validate({ ...good, budget: '$1 million' }).error);
  assert.ok(validate({ ...good, companySize: '' }).error);
  assert.ok(validate({ ...good, message: 'x'.repeat(2001) }).error);
  assert.ok(validate({ ...good, consent: false }).error);
});

test('handler rejects non-POST', async () => {
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(res.headers.Allow, 'POST');
});

test('handler returns 400 for invalid lead without calling n8n', withEnv(async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true }; };
  const res = fakeRes();
  await handler({ method: 'POST', body: { ...good, email: 'bad' } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(called, false);
}));

test('handler silently accepts honeypot submissions without calling n8n', withEnv(async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true }; };
  const res = fakeRes();
  await handler({ method: 'POST', body: { ...good, website: 'http://spam.example' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(called, false);
}));

test('handler forwards a valid lead with the secret header', withEnv(async () => {
  let seen;
  global.fetch = async (url, options) => { seen = { url, options }; return { ok: true }; };
  const res = fakeRes();
  await handler({ method: 'POST', body: good }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(seen.url, 'https://n8n.test/webhook/lead');
  assert.strictEqual(seen.options.headers['X-Lead-Secret'], 'test-secret');
  const sent = JSON.parse(seen.options.body);
  assert.strictEqual(sent.email, 'ada@example.com');
  assert.strictEqual(sent.consent, undefined);
}));

test('handler returns 502 when n8n fails', withEnv(async () => {
  global.fetch = async () => ({ ok: false, status: 500 });
  const res = fakeRes();
  await handler({ method: 'POST', body: good }, res);
  assert.strictEqual(res.statusCode, 502);
}));

test('handler returns 502 when n8n is unreachable', withEnv(async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const res = fakeRes();
  await handler({ method: 'POST', body: good }, res);
  assert.strictEqual(res.statusCode, 502);
}));

test('handler returns 500 when env vars are missing', async () => {
  const saved = { url: process.env.N8N_WEBHOOK_URL, secret: process.env.N8N_WEBHOOK_SECRET };
  delete process.env.N8N_WEBHOOK_URL;
  delete process.env.N8N_WEBHOOK_SECRET;
  try {
    const res = fakeRes();
    await handler({ method: 'POST', body: good }, res);
    assert.strictEqual(res.statusCode, 500);
  } finally {
    if (saved.url !== undefined) process.env.N8N_WEBHOOK_URL = saved.url;
    if (saved.secret !== undefined) process.env.N8N_WEBHOOK_SECRET = saved.secret;
  }
});
