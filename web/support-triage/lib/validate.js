const { findSample } = require('./samples');

const LIMITS = { name: 60, subject: 200, body: 4000 };

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Letters, spaces, apostrophes and hyphens only, so a name can never smuggle an address or markup into the From header.
function cleanName(value) {
  const name = text(value).replace(/[^\p{L}\p{M} '-]/gu, '').replace(/\s+/g, ' ').trim();
  return name.slice(0, LIMITS.name);
}

// Returns { request } when valid, or { error } with a message that is safe to show visitors.
// A submitted sampleId only survives when the text matches that preset exactly.
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request.' };

  const subject = text(body.subject);
  const message = text(body.body);
  const sample = findSample(text(body.sampleId));

  if (sample) {
    if (subject === sample.subject && message === sample.body) {
      return { request: { source: 'playground', sampleId: sample.id, from: sample.from, subject: sample.subject, body: sample.body } };
    }
  }

  if (!message) return { error: 'Please write the email text.' };
  if (message.length > LIMITS.body) return { error: `Email text is too long (${LIMITS.body} characters max).` };
  if (subject.length > LIMITS.subject) return { error: `Subject is too long (${LIMITS.subject} characters max).` };

  const name = cleanName(body.name);
  const from = name ? `${name} <visitor@example.com>` : 'visitor@example.com';
  return { request: { source: 'playground', sampleId: '', from, subject, body: message } };
}

module.exports = { validate, LIMITS };
