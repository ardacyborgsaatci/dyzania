'use strict';
// Shared checks for the three form endpoints (intake, slots, book) and the token endpoint.
//
// What this is: a speed bump for scripts, not a wall. Four layers, cheapest first:
//   1. same-origin check   a browser on another site cannot post here (Origin / Referer / Sec-Fetch-Site)
//   2. rate limit          per visitor address, kept in memory
//   3. honeypot            a hidden field real visitors never fill (handled by each endpoint: it answers a quiet success)
//   4. signed form token   issued by /api/token when the page loads, valid 3 seconds to 2 hours after it was issued
//
// What it is not: the rate limit lives in the memory of one serverless instance, so it resets when the instance is
// replaced and each instance counts on its own. A determined script can fetch a token and spread its requests. The real
// limit is a Vercel Firewall rate-limit rule (set at the cutover); a CAPTCHA such as Turnstile would be the next step and
// needs an account the owner has to create. Nothing here logs an address, a name or an email.
const crypto = require('node:crypto');

const TOKEN_MIN_AGE_MS = 3000;            // a person needs a few seconds to fill in a form
const TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8000;
const HOUR = 60 * 60 * 1000;

function tokenSecret() {
  return process.env.FORM_TOKEN_SECRET || '';
}

function sign(timestamp, secret) {
  return crypto.createHmac('sha256', secret).update('form:' + timestamp).digest('base64url');
}

function issueToken(now = Date.now()) {
  const secret = tokenSecret();
  if (!secret) throw new Error('FORM_TOKEN_SECRET is not set');
  return now + '.' + sign(now, secret);
}

// { ok: true } or { ok: false, reason: 'unconfigured' | 'missing' | 'bad' | 'too_fast' | 'expired' }
function checkToken(token, { minAgeMs = TOKEN_MIN_AGE_MS, now = Date.now() } = {}) {
  const secret = tokenSecret();
  if (!secret) return { ok: false, reason: 'unconfigured' };
  const parts = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(typeof token === 'string' ? token : '');
  if (!parts) return { ok: false, reason: 'missing' };
  const issued = Number(parts[1]);
  const expected = Buffer.from(sign(issued, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'bad' };
  const age = now - issued;
  if (age < minAgeMs) return { ok: false, reason: 'too_fast' };
  if (age > TOKEN_MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// ---- rate limit (in memory; see the note at the top) ----
const buckets = new Map();

function rateLimit(key, limit, windowMs, now = Date.now()) {
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) {
    for (const [k, times] of buckets) if (!times.length || now - times[times.length - 1] > HOUR) buckets.delete(k);
    if (buckets.size > 5000) buckets.clear();   // under a flood, fail open: the firewall rule is the real limit
  }
  return { ok: true };
}

function resetRateLimits() {
  buckets.clear();
}

function clientIp(req) {
  const h = req.headers || {};
  const raw = h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || '';
  const first = String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// A browser always sends Origin on a POST and Referer or Sec-Fetch-Site on a same-site GET. A script that sends none is refused.
function sameOrigin(req) {
  const h = req.headers || {};
  if (h['sec-fetch-site'] === 'same-origin') return true;
  const host = String(h.host || h['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  const source = h.origin || h.referer;
  if (!host || !source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function fail(res, status, error, extra) {
  res.status(status).json({ ok: false, error, ...(extra || {}) });
  return true;
}

// Runs the checks that need no body. Returns true when it has already answered (the handler must return).
function screen(req, res, { name, method, limit, windowMs }) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== method) {
    res.setHeader('Allow', method);
    return fail(res, 405, 'Method not allowed.');
  }
  if (!sameOrigin(req)) return fail(res, 403, 'This request did not come from this site.');
  if (Number((req.headers || {})['content-length'] || 0) > MAX_BODY_BYTES) return fail(res, 413, 'That request is too large.');
  const rate = rateLimit(name + ':' + clientIp(req), limit, windowMs);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return fail(res, 429, 'Too many requests. Please wait a little and try again.', { retryAfterSec: rate.retryAfterSec });
  }
  return false;
}

// The parsed JSON body, or null after answering 400.
function readBody(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(res, 400, 'Invalid request.');
    return null;
  }
  return body;
}

const TOKEN_MESSAGES = {
  too_fast: 'That was quick. Please check your details and send it again.',
  expired: 'This page has been open for a while. Please reload it and try again.',
  missing: 'Please reload the page and try again.',
  bad: 'Please reload the page and try again.',
};

// Returns true when it has already answered.
function verifyToken(res, token, options) {
  const result = checkToken(token, options);
  if (result.ok) return false;
  if (result.reason === 'unconfigured') {
    console.error('FORM_TOKEN_SECRET is not set');
    return fail(res, 500, 'Server is not configured.');
  }
  return fail(res, 400, TOKEN_MESSAGES[result.reason] || TOKEN_MESSAGES.bad, { code: result.reason });
}

module.exports = {
  HOUR, MAX_BODY_BYTES, TOKEN_MIN_AGE_MS, TOKEN_MAX_AGE_MS,
  issueToken, checkToken, rateLimit, resetRateLimits, clientIp, sameOrigin, screen, readBody, verifyToken, fail,
};
