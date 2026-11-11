const guard = require('../lib/guard');
const upstream = require('../lib/upstream');

// Free first-consultation times for one practice area, from the booking workflow. The page sends {area, limit?, after?}.
module.exports = async function handler(req, res) {
  if (guard.screen(req, res, { name: 'slots', method: 'POST', limit: 40, windowMs: 10 * 60 * 1000 })) return;
  const body = guard.readBody(req, res);
  if (!body) return;
  if (guard.verifyToken(res, body.formToken, { minAgeMs: 0 })) return;

  const config = upstream.bookingConfig('booking/slots');
  if (!config.url || !config.secret) {
    console.error('N8N_BOOKING_BASE or N8N_BOOKING_SECRET is not set');
    return guard.fail(res, 500, 'Online booking is not available right now.');
  }

  // The page may ask for fewer times at a time (1 to 100); anything else gets 100.
  const asked = Math.floor(Number(body.limit));
  const payload = { area: upstream.str(body.area, 20), limit: asked >= 1 && asked <= 100 ? asked : 100 };
  if (typeof body.after === 'string' && body.after) payload.after = body.after.slice(0, 40);

  let answer;
  try {
    answer = await upstream.postJson(config, payload, 15000);
  } catch (err) {
    console.error('slots: forwarding failed:', err.name);
    return guard.fail(res, 502, 'We could not load the available times. Please try again in a moment.');
  }

  const data = answer.data;
  if (answer.status === 200 && data && data.ok === false && data.code === 'invalid') {
    return res.status(422).json({ ok: false, code: 'invalid', errors: upstream.cleanErrors(data.errors) });
  }
  if (answer.status !== 200 || !data || data.ok !== true || !Array.isArray(data.slots)) {
    console.error('slots: n8n answered', answer.status);
    return guard.fail(res, 502, 'We could not load the available times. Please try again in a moment.');
  }
  return res.status(200).json({
    ok: true,
    area: upstream.str(data.area, 20),
    areaName: upstream.str(data.areaName, 60),
    timezoneName: upstream.str(data.timezoneName, 60),
    consultMinutes: upstream.num(data.consultMinutes),
    fee: upstream.str(data.fee, 200),
    slots: upstream.cleanSlots(data.slots, 100),
    more: data.more === true,
    note: upstream.str(data.note, 300),
  });
};
