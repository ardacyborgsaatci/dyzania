// Small fakes shared by the API tests (same approach as the lead-intake project).
function fakeRes() {
  const res = { headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

const ENV_KEYS = ['N8N_TRIAGE_URL', 'N8N_FEED_URL', 'N8N_TRIAGE_SECRET', 'IP_HASH_SALT'];

function withEnv(fn) {
  return async () => {
    const saved = { fetch: global.fetch };
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.N8N_TRIAGE_URL = 'https://n8n.test/webhook/triage-demo';
    process.env.N8N_FEED_URL = 'https://n8n.test/webhook/triage-feed';
    process.env.N8N_TRIAGE_SECRET = 'test-secret';
    process.env.IP_HASH_SALT = 'test-salt';
    try {
      await fn();
    } finally {
      global.fetch = saved.fetch;
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}

module.exports = { fakeRes, jsonResponse, withEnv };
