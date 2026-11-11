'use strict';
const { classifyArea } = require('../../../firm/lib/areas');
const { checkConflicts } = require('../../../firm/lib/conflicts');
const { detectUrgency, daysFromToday } = require('../../../firm/lib/urgency');
// Dyzania lead intake: validate a website form, match it to a practice area, check conflicts,
// flag urgent wording, score it 0-100 and decide the next step. Pure functions. No model, no I/O.
// The visitor reply is a fixed template: it never gives legal advice, never states a legal deadline,
// never promises a response time and never says why a lead is on hold.

const INTAKE_OPTIONS = {
  location: ['harlow_point', 'nearby', 'elsewhere'],
  hearing: ['none', 'within7', 'later', 'unsure'],
  preferredContact: ['email', 'phone'],
  howHeard: ['', 'search', 'friend', 'attorney_referral', 'social', 'other']
};
const INTAKE_LIMITS = { description: { min: 20, max: 1500 }, name: { min: 2, max: 100 }, otherSide: { max: 200 }, earliestIncident: '1990-01-01' };
const INTAKE_POINTS = {
  area: { selected: 35, selected_unsupported: 20, inferred: 25, differs: 15, mixed: 15, unclear: 10, out_of_scope: 0 },
  location: { harlow_point: 15, nearby: 8, elsewhere: 0 },
  time: { within7: 20, later: 12, unsure: 6, none: 0 },
  descriptionBands: [[300, 12], [120, 8], [40, 4], [0, 0]],
  incidentDate: 4,
  otherSide: 4,
  email: 5,
  phone: 5
};
const INTAKE_TIERS = { hot: 75, warm: 50 };

function cleanString(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max == null ? 5000 : max + 1);
}

// body: what the form posted. data: { areas, ... }. today: 'YYYY-MM-DD'.
// Returns { ok: true, clean } or { ok: false, errors } or { ok: false, spam: true } for the honeypot.
function validateIntake(body, data, today) {
  const b = body || {};
  if (cleanString(b.website, 50)) return { ok: false, spam: true };
  const errors = {};
  const areaIds = data.areas.areas.map((a) => a.id).concat(['not_sure', 'other']);
  const clean = {
    name: cleanString(b.name, INTAKE_LIMITS.name.max),
    email: cleanString(b.email, 254).toLowerCase(),
    phone: cleanString(b.phone, 30),
    preferredContact: cleanString(b.preferredContact, 10) || 'email',
    area: cleanString(b.area, 20) || 'not_sure',
    description: cleanString(b.description, INTAKE_LIMITS.description.max),
    location: cleanString(b.location, 20),
    hearing: cleanString(b.hearing, 10) || 'none',
    incidentDate: cleanString(b.incidentDate, 10),
    otherSide: cleanString(b.otherSide, INTAKE_LIMITS.otherSide.max),
    howHeard: cleanString(b.howHeard, 20)
  };
  if (clean.name.length < INTAKE_LIMITS.name.min || clean.name.length > INTAKE_LIMITS.name.max || !/^[\p{L}\p{M}0-9 .,'’-]+$/u.test(clean.name)) errors.name = 'Please enter your name using letters, spaces, hyphens or apostrophes.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email)) errors.email = 'Please enter a valid email address.';
  if (clean.phone) {
    const digits = clean.phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || /[^0-9+()\-. ]/.test(clean.phone)) errors.phone = 'Please enter a valid phone number, or leave it blank.';
  }
  if (INTAKE_OPTIONS.preferredContact.indexOf(clean.preferredContact) === -1) errors.preferredContact = 'Please choose email or phone.';
  else if (clean.preferredContact === 'phone' && !clean.phone) errors.phone = 'Please add a phone number if you prefer a call.';
  if (areaIds.indexOf(clean.area) === -1) errors.area = 'Please choose one of the options.';
  if (clean.description.length < INTAKE_LIMITS.description.min) errors.description = 'Please describe your situation in a few sentences.';
  else if (clean.description.length > INTAKE_LIMITS.description.max) errors.description = 'Please keep it under ' + INTAKE_LIMITS.description.max + ' characters.';
  if (INTAKE_OPTIONS.location.indexOf(clean.location) === -1) errors.location = 'Please tell us where you are.';
  if (INTAKE_OPTIONS.hearing.indexOf(clean.hearing) === -1) errors.hearing = 'Please choose one of the options.';
  if (INTAKE_OPTIONS.howHeard.indexOf(clean.howHeard) === -1) errors.howHeard = 'Please choose one of the options.';
  if (clean.otherSide.length > INTAKE_LIMITS.otherSide.max) errors.otherSide = 'Please keep it under ' + INTAKE_LIMITS.otherSide.max + ' characters.';
  if (clean.incidentDate) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(clean.incidentDate) && !isNaN(Date.parse(clean.incidentDate + 'T00:00:00Z')) &&
      new Date(clean.incidentDate + 'T00:00:00Z').toISOString().slice(0, 10) === clean.incidentDate;
    if (!ok) errors.incidentDate = 'Please use a real date, or leave it blank.';
    else if (daysFromToday(clean.incidentDate, today) > 0) errors.incidentDate = 'The date cannot be in the future.';
    else if (clean.incidentDate < INTAKE_LIMITS.earliestIncident) errors.incidentDate = 'Please use a real date, or leave it blank.';
  }
  const consent = b.consent === true || b.consent === 'true' || b.consent === 'on' || b.consent === 'yes';
  if (!consent) errors.consent = 'Please confirm that you agree to be contacted and understand this is not legal advice.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, clean };
}

function descriptionPoints(len) {
  for (const band of INTAKE_POINTS.descriptionBands) if (len >= band[0]) return band[1];
  return 0;
}

// 0-100: area fit 35, location 15, time 20, detail 20, contactability 10.
function scoreIntake(clean, area, urgency, hearingClass) {
  const classes = ['none', 'unsure', 'later', 'within7'];
  const timeClass = classes.indexOf(hearingClass) > classes.indexOf(urgency.timeClass) ? hearingClass : urgency.timeClass;
  const parts = {
    area: INTAKE_POINTS.area[area.area === 'out_of_scope' ? 'out_of_scope' : area.basis] || 0,
    location: INTAKE_POINTS.location[clean.location] || 0,
    time: INTAKE_POINTS.time[timeClass] || 0,
    detail: descriptionPoints(clean.description.length) + (clean.incidentDate ? INTAKE_POINTS.incidentDate : 0) + (clean.otherSide ? INTAKE_POINTS.otherSide : 0),
    contact: INTAKE_POINTS.email + (clean.phone ? INTAKE_POINTS.phone : 0)
  };
  const total = parts.area + parts.location + parts.time + parts.detail + parts.contact;
  return { total, parts, timeClass };
}

// Tier and next step. Order matters and is part of the design (see README):
//   not_a_fit > refer_out > hold_conflict > attorney_now > ask_more > follow_up > book
function decideIntake(clean, area, urgency, conflict, score) {
  let tier = score.total >= INTAKE_TIERS.hot ? 'Hot' : (score.total >= INTAKE_TIERS.warm ? 'Warm' : 'Low');
  if (conflict.status === 'hold' && tier === 'Hot') tier = 'Warm';
  let nextStep;
  if (clean.location === 'elsewhere') { nextStep = 'not_a_fit'; tier = 'Not a fit'; }
  else if (area.area === 'out_of_scope') { nextStep = 'refer_out'; tier = 'Refer out'; }
  else if (conflict.status === 'hold') nextStep = 'hold_conflict';
  else if (urgency.level === 'urgent') nextStep = 'attorney_now';
  else if (area.area === 'unclear') nextStep = 'ask_more';
  else if (area.basis === 'mixed' || area.basis === 'differs' || tier === 'Low') nextStep = 'follow_up';
  else nextStep = 'book';
  let priority = 'low';
  if (urgency.level === 'urgent') priority = 'urgent';
  else if (tier === 'Hot' || urgency.level === 'check') priority = 'high';
  else if (tier === 'Warm') priority = 'normal';
  // The attorney on duty is not paged for matters the firm cannot take, unless safety wording is present.
  const cannotTake = nextStep === 'refer_out' || nextStep === 'not_a_fit';
  const safety = urgency.flags.some((f) => f.id === 'safety');
  return { tier, nextStep, priority, alert: (priority === 'urgent' || tier === 'Hot') && (!cannotTake || safety) };
}

function areaById(data, id) {
  return data.areas.areas.find((a) => a.id === id) || null;
}

// Fixed templates. firm: firm.json (name, phone, domain, officeHours, emails, language).
function visitorMessage(result, data) {
  const firm = data.firm;
  const first = (result.name || '').split(' ')[0] || 'there';
  const hours = 'Monday to Friday, ' + firm.officeHours.open.replace(/^0/, '') + '-' + firm.officeHours.close;
  const bookUrl = 'https://' + firm.domain + '/book';
  const area = areaById(data, result.areaFinal);
  const lines = [];
  // A held lead that is also urgent gets the 'flagged for a person' wording. It does not hint at the conflict.
  const step = result.nextStep === 'hold_conflict' && result.urgent ? 'attorney_now' : result.nextStep;
  let headline;
  if (step === 'book') {
    headline = 'Thanks, ' + first + '. The next step is to book a first consultation.';
    lines.push('Your message looks like a ' + area.name.toLowerCase() + ' matter, which the firm handles.');
    lines.push(area.consult.feeUsd === 0
      ? 'The first ' + area.consult.minutes + '-minute consultation is free.'
      : 'The first consultation is ' + area.consult.minutes + ' minutes and costs $' + area.consult.feeUsd + ', credited to the retainer if you hire the firm.');
    lines.push('You can book at any hour: ' + bookUrl);
  } else if (step === 'follow_up') {
    headline = 'Thanks, ' + first + '. A member of the team will read your message.';
    lines.push('Someone will reply to you by ' + (result.preferredContact === 'phone' ? 'phone' : 'email') + '. If you would like to move faster, you can book a first consultation at any hour: ' + bookUrl);
  } else if (step === 'ask_more') {
    headline = 'Thanks, ' + first + '. A member of the team will read your message.';
    lines.push('It was not clear from the message which kind of matter this is, so someone may reply with a question. You can also email ' + firm.emails.general + ' or call ' + firm.phone + ' during office hours (' + hours + ').');
  } else if (step === 'hold_conflict') {
    headline = 'Thanks, ' + first + '. A member of the team will review your message.';
    lines.push('Someone will contact you using the details you gave.');
  } else if (step === 'attorney_now') {
    headline = 'Thanks, ' + first + '. Your message has been flagged for a person at the firm.';
    lines.push('You mentioned a court date, legal papers or a deadline, so your message is marked for an attorney to look at as soon as possible. Court dates and deadlines are strict, so please also call the office on ' + firm.phone + ' during office hours (' + hours + '). This reply cannot tell you what any deadline is, and the firm cannot promise a response time.');
  } else if (step === 'refer_out') {
    const cat = result.outOfScope;
    headline = 'Thanks, ' + first + '. This looks like a matter the firm does not handle.';
    lines.push('From your message this appears to be ' + (cat ? cat.name.toLowerCase() : 'outside the areas the firm handles') + '. ' + (cat ? 'We suggest ' + cat.referral + '.' : data.areas.referralNote));
    lines.push('If a time limit may be running, please contact another lawyer quickly.');
  } else {
    headline = 'Thanks, ' + first + '. The firm cannot take this matter.';
    lines.push('Dyzania helps people in Harlow Point and the surrounding area, and can only take matters in the courts where its attorneys are licensed. We suggest contacting your local bar association\'s lawyer referral service. If a time limit may be running, please contact another lawyer quickly.');
  }
  const show = result.alsoShow || [];
  if (show.indexOf('emergency') !== -1) lines.push(firm.language.emergency);
  if (show.indexOf('referral') !== -1 && step !== 'refer_out') {
    lines.push('Some of what you described, such as an arrest or a housing notice, is not something the firm handles. The firm does not recommend a specific outside lawyer; please contact your local bar association\'s lawyer referral service.');
  }
  lines.push(firm.language.aiDisclosure + ' ' + firm.language.notLegalAdvice);
  lines.push(firm.language.noConfidential);
  return { headline, text: [headline].concat(lines).join('\n\n') };
}

function leadSummary(r) {
  return {
    ref: r.ref, tier: r.tier, score: r.score, priority: r.priority, nextStep: r.nextStep, areaFinal: r.areaFinal,
    urgency: r.urgencyLevel, conflict: r.conflictStatus
  };
}

// data: { firm, areas (practice-areas.json), urgency (urgency.json), conflicts (conflicts.json entries array as .entries) }
// ctx: { today: 'YYYY-MM-DD', ref: 'DY-...' , now: ISO string }
function processIntake(body, data, ctx) {
  const v = validateIntake(body, data, ctx.today);
  if (v.spam) return { ok: true, spam: true };
  if (!v.ok) return { ok: false, errors: v.errors };
  const c = v.clean;
  const area = classifyArea({ selected: c.area, text: c.description }, data.areas);
  const urgency = detectUrgency({ text: c.description, hearing: c.hearing }, data.urgency, ctx.today);
  const conflict = checkConflicts({ prospect: c.name, otherSide: c.otherSide, description: c.description }, data.conflicts.entries);
  const score = scoreIntake(c, area, urgency, c.hearing);
  const decision = decideIntake(c, area, urgency, conflict, score);
  const areaRow = areaById(data, area.area);
  const alsoShow = urgency.alsoShow;
  const lead = {
    ref: ctx.ref,
    receivedAt: ctx.now || '',
    status: 'new',
    name: c.name,
    email: c.email,
    phone: c.phone,
    preferredContact: c.preferredContact,
    areaSelected: c.area,
    areaFinal: area.area,
    areaBasis: area.basis,
    areaNotes: [].concat(area.alsoMentions.length ? ['also mentions: ' + area.alsoMentions.join(', ')] : [], area.alsoOutOfScope.length ? ['also mentions (not handled): ' + area.alsoOutOfScope.join(', ')] : []).join('; '),
    location: c.location,
    hearing: c.hearing,
    incidentDate: c.incidentDate,
    otherSide: c.otherSide,
    howHeard: c.howHeard,
    description: c.description,
    score: score.total,
    scoreParts: JSON.stringify(score.parts),
    tier: decision.tier,
    priority: decision.priority,
    nextStep: decision.nextStep,
    urgencyLevel: urgency.level,
    urgencyFlags: urgency.flags.map((f) => f.label + (f.date ? ' [' + f.date.raw + ', ' + f.reason + ']' : ' [' + f.reason + ']')).join('; '),
    conflictStatus: conflict.status,
    conflictNote: conflict.matches.map((m) => m.id + ' ' + m.side + ': ' + m.reason).join('; '),
    suggestedAttorneys: areaRow ? areaRow.attorneys.join(',') : ''
  };
  const visitor = visitorMessage({
    name: c.name, preferredContact: c.preferredContact, nextStep: decision.nextStep, areaFinal: area.area, outOfScope: area.outOfScope, alsoShow, urgent: urgency.level === 'urgent'
  }, data);
  const alertLines = [
    'Ref: ' + lead.ref,
    'Priority: ' + decision.priority.toUpperCase() + '   Tier: ' + decision.tier + '   Score: ' + score.total + '/100',
    'Area: ' + c.area + ' selected, ' + area.area + ' final (' + area.basis + ')',
    'Next step: ' + decision.nextStep,
    'Time-sensitive: ' + (urgency.flags.length ? urgency.flags.map((f) => f.label + ' - ' + f.reason + (f.date ? ' ("' + f.date.raw + '")' : '')).join('; ') : 'nothing flagged'),
    'Conflict check: ' + conflict.status + (conflict.matches.length ? ' (' + lead.conflictNote + ')' : ''),
    'Contact preference: ' + c.preferredContact,
    '',
    'The message text and contact details are in the intake_leads table under this ref. They are not repeated in this email.',
    'This is a prompt for a person to look. It is not legal advice and it does not say what any deadline is.'
  ];
  const alert = {
    send: decision.alert,
    subject: '[Dyzania intake] ' + decision.priority.toUpperCase() + ' ' + lead.ref + ' - ' + (areaRow ? areaRow.name : area.area) + ' - ' + decision.nextStep,
    text: alertLines.join('\n')
  };
  return { ok: true, lead, visitor, alert, summary: leadSummary(lead) };
}

module.exports = { validateIntake, scoreIntake, decideIntake, visitorMessage, processIntake, INTAKE_POINTS, INTAKE_TIERS, INTAKE_OPTIONS };
