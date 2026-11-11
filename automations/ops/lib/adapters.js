'use strict';
// Turns what each automation already produces into one ops event. Pure functions: the events hold the reference, the
// area, a category and a status, never a name, an address, a phone number, a subject or any message text.
// Every adapter returns { ok, event, problems } like buildEvent, or null when there is nothing to log (spam, invalid).
const { buildEvent, QUEUE } = require('./event.js');

// automation: intake. `out` is processIntake's result.
// Who has to act: a person for anything urgent, unclear, mixed or on a conflict hold; nobody for a booking link or a referral out.
function intakeEvent(out, ctx) {
  const c = ctx || {};
  if (!out || out.ok !== true || out.spam || !out.lead) return null;
  const l = out.lead;
  const personSteps = ['attorney_now', 'ask_more', 'follow_up', 'hold_conflict'];
  // The visitor is shown the booking page, with this reference in the link, after `book` and after `follow_up`
  // (web/site/contact.js). Nothing else offers it: not a conflict hold, an urgent matter or a referral out.
  const offersBooking = l.nextStep === 'book' || l.nextStep === 'follow_up';
  return buildEvent({
    automation: 'intake', source: 'web', runId: l.ref,
    status: personSteps.includes(l.nextStep) ? 'needs_human' : 'ok',
    summary: 'Lead ' + l.ref + ': ' + (l.areaFinal || 'unknown') + ', tier ' + l.tier + ', next step ' + l.nextStep + ', time-sensitive ' + l.urgencyLevel,
    // Handoff intake -> booking: the receiving row is the booking, whose runId is this reference.
    handoffTo: offersBooking ? 'booking' : '', handoffRef: offersBooking ? l.ref : ''
  }, c.now);
}

// automation: booking. `r` is the result of bookDecide / bookRaceLost (it carries r.event); `ctx.leadRef` is the
// intake reference the booking came with, `ctx.ref` the booking reference.
function bookingEvent(r, ctx) {
  const c = ctx || {};
  const ev = r && r.event;
  if (!ev || ev.code === 'invalid' || ev.code === 'spam') return null;
  const ref = c.ref || (r.row && r.row.bookingRef) || '';
  // The visitor was told to contact the office for these two, so the office should expect them.
  const status = ev.code === 'booked' ? 'ok'
    : (ev.code === 'conflict_hold' || ev.code === 'already_booked') ? 'needs_human'
    : (ev.code === 'slot_taken' || ev.code === 'not_offered') ? 'blocked' : 'error';
  const channel = ev.channel || (r.row && r.row.channel) || '';
  const parts = ['Booking ' + (ref || 'none') + ': ' + ev.code + (ev.reason ? ' (' + ev.reason + ')' : ''), ev.area || 'no area', 'channel ' + (channel || 'unknown')];
  if (ev.attorney) parts.push('attorney ' + ev.attorney);
  return buildEvent({
    automation: 'booking',
    // A booking that arrived with an intake reference is the receiving end of the intake -> booking handoff:
    // its runId is that reference, so the two rows chain.
    source: c.leadRef ? 'handoff' : (channel === 'voice' ? 'voice' : 'web'),
    runId: c.leadRef || ref || String(ev.at || 'none'),
    status, summary: parts.join(', ')
  }, c.now);
}

// automation: notices. `out` is noticeAssess's result. Every notice needs an attorney, so every row is needs_human.
function noticeEvent(out, ctx) {
  const c = ctx || {};
  const ev = out && out.event;
  if (!ev) return null;
  const reasons = (ev.reasons || []).join(', ');
  return buildEvent({
    automation: 'notices', source: 'upload', runId: ev.ref || String(ev.at || 'none'), status: 'needs_human',
    summary: 'Court notice ' + (ev.ref || 'none') + ': ' + (ev.documentType || 'unknown') + ', priority ' + ev.priority + (reasons ? ' (' + reasons + ')' : '') + ', read ' + (ev.readStatus || 'unknown')
  }, c.now);
}

// automation: triage. `row` is triageLogRow's result. A handoff here is to a person's queue, so its reference is QUEUE.
function triageEvent(row, ctx) {
  const c = ctx || {};
  if (!row || !row.messageId) return null;
  const needsPerson = row.needsHuman === true || row.needsHuman === 'true' || row.classificationStatus === 'fallback';
  const to = row.handoff === 'intake' ? 'intake' : row.handoff === 'extraction' ? 'notices' : '';
  return buildEvent({
    automation: 'triage', source: 'gmail', runId: String(row.messageId), status: needsPerson ? 'needs_human' : 'ok',
    summary: 'Email sorted: ' + row.category + ', priority ' + row.priority + ', queue ' + row.queue + ', reply ' + row.draftStatus + (row.classificationStatus === 'fallback' ? ', classifier failed' : ''),
    latencyMs: row.latencyMs, handoffTo: to, handoffRef: to ? QUEUE : ''
  }, c.now);
}

module.exports = { intakeEvent, bookingEvent, noticeEvent, triageEvent };
