const guard = require('../lib/guard');

// Gives the page a signed, time-stamped token to send back with a form (see lib/guard.js). It proves the page was loaded
// a few seconds ago; it is not a login.
module.exports = async function handler(req, res) {
  if (guard.screen(req, res, { name: 'token', method: 'GET', limit: 60, windowMs: 10 * 60 * 1000 })) return;
  try {
    return res.status(200).json({ ok: true, token: guard.issueToken() });
  } catch {
    console.error('FORM_TOKEN_SECRET is not set');
    return guard.fail(res, 500, 'Server is not configured.');
  }
};
