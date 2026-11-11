const guard = require('../lib/guard');
const upstream = require('../lib/upstream');

const UNAVAILABLE = 'We could not complete this booking. Please try again in a moment, or contact the office using the details on this page.';

// Books one first consultation through the booking workflow. The booking rules (notice, horizon, buffer, one booking per
// person, conflict check, which attorney) all live there; this endpoint only screens the request and trims the answer.
module.exports = async function handler(req, res) {
  if (guard.screen(req, res, { name: 'book', method: 'POST', limit: 6, windowMs: guard.HOUR })) return;
  const body = guard.readBody(req, res);
  if (!body) return;

  // Honeypot: the same answer the workflow gives a filled honeypot.
  if (body.website) return res.status(503).json({ ok: false, code: 'unavailable', message: UNAVAILABLE });
  if (guard.verifyToken(res, body.formToken, { minAgeMs: guard.TOKEN_MIN_AGE_MS })) return;

  const config = upstream.bookingConfig('booking/book');
  if (!config.url || !config.secret) {
    console.error('N8N_BOOKING_BASE or N8N_BOOKING_SECRET is not set');
    return guard.fail(res, 500, 'Online booking is not available right now.');
  }

  const payload = {
    name: upstream.str(body.name, 200),
    email: upstream.str(body.email, 300),
    phone: upstream.str(body.phone, 60),
    area: upstream.str(body.area, 20),
    otherSide: upstream.str(body.otherSide, 400),
    noOtherSide: body.noOtherSide === true,
    consent: body.consent === true,
    start: upstream.str(body.start, 40),
    leadRef: upstream.str(body.leadRef, 40),
    channel: 'form',          // set here, never taken from the browser
    website: '',
  };

  let answer;
  try {
    answer = await upstream.postJson(config, payload, 20000);
  } catch (err) {
    console.error('book: forwarding failed:', err.name);
    return guard.fail(res, 502, UNAVAILABLE);
  }

  const data = answer.data;
  if (answer.status !== 200 || !data || typeof data !== 'object') {
    console.error('book: n8n answered', answer.status);
    return guard.fail(res, 502, UNAVAILABLE);
  }

  if (data.ok === true && data.code === 'booked') {
    const out = {
      ok: true, code: 'booked',
      ref: upstream.str(data.ref, 40), start: upstream.str(data.start, 40), label: upstream.str(data.label, 60),
      minutes: upstream.num(data.minutes), attorney: upstream.str(data.attorney, 100), address: upstream.str(data.address, 200),
      fee: upstream.str(data.fee, 200), message: upstream.str(data.message, 600),
    };
    if (typeof data.confirmationSent === 'boolean') out.confirmationSent = data.confirmationSent;
    return res.status(200).json(out);
  }
  if (data.code === 'invalid') {
    return res.status(422).json({ ok: false, code: 'invalid', errors: upstream.cleanErrors(data.errors) });
  }
  if (data.code === 'slot_unavailable') {
    return res.status(409).json({
      ok: false, code: 'slot_unavailable', message: upstream.str(data.message, 300), alternatives: upstream.cleanSlots(data.alternatives, 3),
    });
  }
  if (data.code === 'contact_office') {
    // A conflict hold and a repeat booking give the same words and the same status on purpose.
    return res.status(409).json({ ok: false, code: 'contact_office', message: upstream.str(data.message, 300) });
  }
  return res.status(503).json({ ok: false, code: 'unavailable', message: upstream.str(data.message, 300) || UNAVAILABLE });
};
