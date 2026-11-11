const OPTIONS = {
  companySize: ['1-10', '11-50', '51-200', '200+'],
  budget: ['Under $1k', '$1k-$5k', '$5k-$20k', '$20k+'],
  timeline: ['This month', '1-3 months', '3+ months'],
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Returns { lead } when valid, or { error } with a message safe to show visitors.
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request.' };

  const lead = {
    name: text(body.name),
    email: text(body.email),
    company: text(body.company),
    companySize: text(body.companySize),
    budget: text(body.budget),
    timeline: text(body.timeline),
    message: text(body.message),
  };

  if (!lead.name || !lead.company) return { error: 'Please fill in your name and company.' };
  if (lead.name.length > 100 || lead.company.length > 100) return { error: 'Name or company is too long.' };
  if (lead.email.length > 254 || !EMAIL.test(lead.email)) return { error: 'Please enter a valid email address.' };
  if (lead.message.length > 2000) return { error: 'Message is too long (2000 characters max).' };

  for (const field of Object.keys(OPTIONS)) {
    if (!OPTIONS[field].includes(lead[field])) return { error: 'Please choose a valid option for every dropdown.' };
  }

  if (body.consent !== true) return { error: 'Please agree to be contacted.' };

  return { lead };
}

module.exports = { validate, OPTIONS };
