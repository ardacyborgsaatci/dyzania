module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const url = process.env.N8N_FEED_URL;
  const secret = process.env.N8N_TRIAGE_SECRET;
  if (!url || !secret) {
    console.error('N8N_FEED_URL or N8N_TRIAGE_SECRET is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { 'X-Triage-Secret': secret },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.error('n8n feed responded with status', upstream.status);
      return res.status(502).json({ error: 'The live feed is unavailable right now.' });
    }
    const data = await upstream.json();
    if (!data || typeof data !== 'object' || !Array.isArray(data.recent)) {
      console.error('n8n feed returned an unexpected shape');
      return res.status(502).json({ error: 'The live feed is unavailable right now.' });
    }
    // The dashboard can be refreshed often; the CDN absorbs repeat requests so n8n is hit at most about twice a minute.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    console.error('Reading the feed failed:', err.message);
    return res.status(502).json({ error: 'The live feed is unavailable right now.' });
  }
};
