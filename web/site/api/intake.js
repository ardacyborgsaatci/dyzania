const guard = require('../lib/guard');
const upstream = require('../lib/upstream');

// The fields the intake workflow reads. Anything else the browser sends is dropped.
const FIELDS = ['name', 'email', 'phone', 'preferredContact', 'area', 'description', 'location', 'hearing', 'incidentDate', 'otherSide', 'howHeard'];

// What the page may learn about the decision. The workflow's own next step is NOT passed on: "hold_conflict" would tell a
// visitor that a conflict check matched, which the visitor message is written never to reveal.
function kindOf(nextStep) {
  if (nextStep === 'book') return 'book';
  if (nextStep === 'follow_up') return 'follow_up';
  if (nextStep === 'attorney_now') return 'urgent';
  if (nextStep === 'refer_out' || nextStep === 'not_a_fit') return 'refer';
  return 'review';
}

module.exports = async function handler(req, res) {
  if (guard.screen(req, res, { name: 'intake', method: 'POST', limit: 5, windowMs: guard.HOUR })) return;
  const body = guard.readBody(req, res);
  if (!body) return;

  // Honeypot: real visitors never see or fill this field. A quiet success teaches a script nothing.
  if (body.website) return res.status(200).json({ ok: true });
  if (guard.verifyToken(res, body.formToken, { minAgeMs: guard.TOKEN_MIN_AGE_MS })) return;

  const config = upstream.intakeConfig();
  if (!config.url || !config.secret) {
    console.error('N8N_INTAKE_URL or N8N_INTAKE_SECRET is not set');
    return guard.fail(res, 500, 'Server is not configured.');
  }

  const payload = { consent: body.consent === true, website: '' };
  for (const field of FIELDS) payload[field] = typeof body[field] === 'string' ? body[field].slice(0, 2000) : '';

  let answer;
  try {
    answer = await upstream.postJson(config, payload, 20000);
  } catch (err) {
    console.error('intake: forwarding failed:', err.name);
    return guard.fail(res, 502, 'We could not send your message. Please try again in a moment.');
  }

  const data = answer.data;
  if (answer.status === 422 && data && data.errors) {
    return res.status(422).json({ ok: false, errors: upstream.cleanErrors(data.errors) });
  }
  if (answer.status !== 200 || !data || data.ok !== true) {
    console.error('intake: n8n answered', answer.status);
    return guard.fail(res, 502, 'We could not send your message. Please try again in a moment.');
  }
  if (!data.ref) return res.status(200).json({ ok: true });   // a quiet answer from the workflow
  return res.status(200).json({
    ok: true,
    ref: upstream.str(data.ref, 40),
    kind: kindOf(data.nextStep),
    headline: upstream.str(data.headline, 300),
    message: upstream.str(data.message, 3000),
  });
};

module.exports.kindOf = kindOf;
