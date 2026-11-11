'use strict';
// Calls to the firm's n8n webhooks, made only from the server (the browser never sees a URL or a secret), and the
// small cleaning functions that decide which parts of an n8n answer the browser may see. Anything not listed is dropped.

function setting(prefix) {
  return {
    url: (process.env[prefix + '_URL'] || '').trim(),
    secret: (process.env[prefix + '_SECRET'] || '').trim(),
    header: (process.env[prefix + '_HEADER'] || '').trim(),
  };
}

// The booking webhooks share one base URL: N8N_BOOKING_BASE/booking/slots and /booking/book.
function bookingConfig(path) {
  const base = (process.env.N8N_BOOKING_BASE || '').trim().replace(/\/+$/, '');
  return {
    url: base ? base + '/' + path : '',
    secret: (process.env.N8N_BOOKING_SECRET || '').trim(),
    header: (process.env.N8N_BOOKING_HEADER || '').trim() || 'X-Booking-Secret',
  };
}

function intakeConfig() {
  const c = setting('N8N_INTAKE');
  return { ...c, header: c.header || 'X-Intake-Secret' };
}

// { status, data }. Throws on a network error or a timeout; the caller logs the error name only.
async function postJson(config, payload, timeoutMs = 15000) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [config.header]: config.secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function str(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

// { field: message }, strings only, capped.
function cleanErrors(errors) {
  const out = {};
  if (!errors || typeof errors !== 'object') return out;
  for (const key of Object.keys(errors).slice(0, 20)) {
    if (/^[A-Za-z]{1,30}$/.test(key) && typeof errors[key] === 'string') out[key] = errors[key].slice(0, 300);
  }
  return out;
}

function cleanSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  return { start: str(slot.start, 40), date: str(slot.date, 10), time: str(slot.time, 5), label: str(slot.label, 60) };
}

function cleanSlots(list, max) {
  return (Array.isArray(list) ? list : []).slice(0, max).map(cleanSlot).filter((s) => s && s.start);
}

module.exports = { intakeConfig, bookingConfig, postJson, str, num, cleanErrors, cleanSlot, cleanSlots };
