const { validate } = require('../lib/validate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body;

  // Honeypot: real visitors never see or fill this field. Pretend success so bots learn nothing.
  if (body && typeof body === 'object' && body.website) {
    return res.status(200).json({ ok: true });
  }

  const { lead, error } = validate(body);
  if (error) return res.status(400).json({ error });

  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.error('N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lead-Secret': secret },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.error('n8n responded with status', upstream.status);
      return res.status(502).json({ error: 'Could not submit your request. Please try again.' });
    }
  } catch (err) {
    console.error('Forwarding to n8n failed:', err.message);
    return res.status(502).json({ error: 'Could not submit your request. Please try again.' });
  }

  return res.status(200).json({ ok: true });
};
