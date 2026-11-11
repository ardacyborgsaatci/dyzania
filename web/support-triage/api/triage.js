const crypto = require('node:crypto');
const { validate } = require('../lib/validate');

// Fields the browser may see. Anything else n8n returns is dropped here.
const RESULT_FIELDS = [
  'category', 'priority', 'sentiment', 'language', 'summary', 'confidence', 'needsHuman', 'humanReason',
  'injectionSuspected', 'skipReason', 'draftStatus', 'draftReply', 'kbArticlesUsed', 'status', 'latencyMs', 'promptVersion',
];

function visitorHash(req, salt) {
  const header = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  const ip = (Array.isArray(header) ? header[0] : String(header || '')).split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  return crypto.createHash('sha256').update(salt + ':' + ip).digest('hex').slice(0, 32);
}

function pick(source) {
  const out = {};
  for (const key of RESULT_FIELDS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body;

  // Honeypot: real visitors never see or fill this field. Pretend success so bots learn nothing.
  if (body && typeof body === 'object' && body.website) {
    return res.status(200).json({ ok: true, result: null });
  }

  const { request, error } = validate(body);
  if (error) return res.status(400).json({ error });

  const url = process.env.N8N_TRIAGE_URL;
  const secret = process.env.N8N_TRIAGE_SECRET;
  const salt = process.env.IP_HASH_SALT;
  if (!url || !secret || !salt) {
    console.error('N8N_TRIAGE_URL, N8N_TRIAGE_SECRET or IP_HASH_SALT is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Triage-Secret': secret },
      body: JSON.stringify({ ...request, ipHash: visitorHash(req, salt) }),
      signal: AbortSignal.timeout(50000),
    });
  } catch (err) {
    console.error('Forwarding to n8n failed:', err.message);
    return res.status(502).json({ error: 'The triage service did not answer. Please try again.' });
  }

  if (upstream.status === 429) {
    let info = {};
    try { info = await upstream.json(); } catch { /* keep defaults */ }
    const retryAfterSec = Number(info.retryAfterSec) > 0 ? Math.ceil(Number(info.retryAfterSec)) : 3600;
    res.setHeader('Retry-After', String(retryAfterSec));
    const message = info.reason === 'daily_cap'
      ? 'The demo has reached its daily limit. Please come back tomorrow, or try the preset samples on the dashboard.'
      : 'You have used your 5 demo requests for this hour. Please try again later.';
    return res.status(429).json({ error: message, reason: info.reason || 'visitor_cap', retryAfterSec });
  }

  if (upstream.status === 503) {
    // The AI model behind the workflow is unavailable (provider outage or exhausted credits).
    res.setHeader('Retry-After', '300');
    return res.status(503).json({ error: 'The AI model is unavailable right now. Please try again in a few minutes.' });
  }

  if (!upstream.ok) {
    console.error('n8n responded with status', upstream.status);
    return res.status(502).json({ error: 'The triage service had a problem. Please try again.' });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    console.error('n8n returned a body that is not JSON');
    return res.status(502).json({ error: 'The triage service had a problem. Please try again.' });
  }
  if (!data || typeof data !== 'object' || !data.category) {
    console.error('n8n returned an unexpected shape');
    return res.status(502).json({ error: 'The triage service had a problem. Please try again.' });
  }

  const result = pick(data);
  if (Number.isFinite(Number(data.remaining))) result.remaining = Number(data.remaining);
  return res.status(200).json({ ok: true, result });
};
