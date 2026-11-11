// Fakes shared by the API tests. The "n8n" here is not a stub that returns canned answers: it runs the REAL intake and
// booking libraries (automations/intake, automations/booking) behind the same header-secret check the webhooks have, so a
// test of the site's endpoints exercises the real rules end to end, except the HTTP hop and the n8n nodes themselves.
const guard = require('../lib/guard');
const { loadFirmData } = require('../../../firm/lib/data');
const booking = require('../../../automations/booking/lib/booking');
const intake = require('../../../automations/intake/lib/intake');

function fakeRes() {
  const res = { headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

// A request from a browser on the site itself.
function fakeReq({ method = 'POST', body, headers, ip = '203.0.113.5' } = {}) {
  return {
    method,
    body,
    headers: { host: 'site.test', origin: 'https://site.test', 'x-real-ip': ip, ...(headers || {}) },
  };
}

// A token that was issued 10 seconds ago.
function oldToken(ageMs = 10000) {
  return guard.issueToken(Date.now() - ageMs);
}

const SECRETS = { intake: 'test-intake-secret', booking: 'test-booking-secret' };
const NOW = '2026-11-11T15:00:00Z';   // a Wednesday, 9:00 in the firm's zone

function fakeN8n({ now = NOW, confirmationSent = true } = {}) {
  const data = loadFirmData();
  const nowMs = Date.parse(now);
  const rows = [];
  const calls = [];
  let refNo = 0;

  function reply(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  async function fetchFn(url, init) {
    const path = new URL(url).pathname;
    const headers = init.headers || {};
    const body = JSON.parse(init.body);
    calls.push({ path, headers, body });

    const wanted = path.endsWith('/intake') ? ['X-Intake-Secret', SECRETS.intake] : ['X-Booking-Secret', SECRETS.booking];
    if (headers[wanted[0]] !== wanted[1]) return reply(403, { message: 'Authorization data is wrong!' });

    if (path.endsWith('/intake')) {
      refNo += 1;
      const out = intake.processIntake(body, data, { today: now.slice(0, 10), ref: 'DY-L' + String(refNo).padStart(5, '0'), now });
      if (out.spam) return reply(200, { ok: true });
      if (!out.ok) return reply(422, { ok: false, errors: out.errors });
      return reply(200, { ok: true, ref: out.lead.ref, nextStep: out.lead.nextStep, headline: out.visitor.headline, message: out.visitor.text });
    }
    if (path.endsWith('/booking/slots')) {
      return reply(200, booking.bookListSlots(body, rows, nowMs, data));
    }
    if (path.endsWith('/booking/book')) {
      const dec = booking.bookDecide(body, rows, nowMs, data, { ref: 'DY-B' + String(rows.length + 1).padStart(5, '0'), now });
      if (!dec.row) return reply(200, dec.public);
      const id = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      rows.push({ id, ...dec.row });
      if (dec.code !== 'booked') return reply(200, dec.public);
      const verdict = booking.bookVerify(id, rows, nowMs, data);
      if (!verdict.won) {
        rows.pop();
        return reply(200, booking.bookRaceLost(dec.row, verdict.lost[id] || 'slot_taken', rows, nowMs, data).public);
      }
      return reply(200, booking.bookConfirmedPublic(dec.public, confirmationSent, data));
    }
    return reply(404, { message: 'not found' });
  }
  return { fetch: fetchFn, rows, calls, data };
}

const ENV_KEYS = [
  'FORM_TOKEN_SECRET', 'N8N_INTAKE_URL', 'N8N_INTAKE_SECRET', 'N8N_INTAKE_HEADER',
  'N8N_BOOKING_BASE', 'N8N_BOOKING_SECRET', 'N8N_BOOKING_HEADER',
];

// Sets the environment the endpoints need, installs a fake n8n as global fetch, and puts everything back afterwards.
function withSite(fn, options = {}) {
  return async () => {
    const saved = { fetch: global.fetch };
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.FORM_TOKEN_SECRET = 'test-token-secret';
    process.env.N8N_INTAKE_URL = 'https://n8n.test/webhook/intake';
    process.env.N8N_INTAKE_SECRET = SECRETS.intake;
    delete process.env.N8N_INTAKE_HEADER;
    process.env.N8N_BOOKING_BASE = 'https://n8n.test/webhook/';
    process.env.N8N_BOOKING_SECRET = SECRETS.booking;
    delete process.env.N8N_BOOKING_HEADER;
    guard.resetRateLimits();
    const n8n = fakeN8n(options);
    global.fetch = n8n.fetch;
    try {
      await fn(n8n);
    } finally {
      global.fetch = saved.fetch;
      guard.resetRateLimits();
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}

// A form that the intake workflow accepts.
const goodIntake = {
  name: 'Jane Doe', email: 'jane.doe@example.com', phone: '555 010 0199', preferredContact: 'email', area: 'family',
  description: 'I want to start a divorce and need help with custody of our two children. We have been separated for a few months.',
  location: 'harlow_point', hearing: 'none', incidentDate: '', otherSide: 'John Doe', howHeard: 'search', consent: true, website: '',
};

module.exports = { fakeRes, fakeReq, oldToken, withSite, fakeN8n, goodIntake, SECRETS, NOW };
