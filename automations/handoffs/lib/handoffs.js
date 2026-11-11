'use strict';
// The links between Dyzania's automations, as data and as a contract check. Pure functions: no network, and nothing
// here sends mail. A handoff is never a message to a client: it is a reference, a label on an email, or a log row.
//
// How the rows chain (see ops/SPEC.md): the sender's event carries handoffTo and handoffRef. When a person's queue is the
// receiver, handoffRef is QUEUE and nobody writes a receiving row. When another automation is the receiver, its row has
// source "handoff" and its runId equals the sender's handoffRef.
const { AUTOMATIONS, QUEUE } = require('../../ops/lib/event.js');

// The four links. `how` says what actually carries the handoff in the built system.
const HANDOFFS = [
  { id: 'intake-booking', from: 'intake', to: 'booking', how: 'reference', trigger: 'the visitor is shown the booking page: next step book or follow_up', result: 'the booking page link carries the lead reference; the booking row keeps it as leadRef and its event runId' },
  { id: 'voice-booking', from: 'voice', to: 'booking', how: 'channel', trigger: 'a caller asks to book', result: 'the call books through the same rules as the website; the event has source voice and the same decision' },
  { id: 'triage-intake', from: 'triage', to: 'intake', how: 'queue', trigger: 'an email is a new inquiry', result: 'the email is labelled for the intake coordinator; no lead row is created and nothing is sent to the sender' },
  { id: 'notices-ops', from: 'notices', to: 'ops', how: 'event', trigger: 'a court notice is read', result: 'a needs_human row, a line in the digest and, if urgent, an owner-only alert; never an automatic confirmation' }
];

// Checks a list of ops_events rows against the contract. Returns problems as text; an empty list means the chain holds.
function chainProblems(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const problems = [];
  const time = (r) => new Date(r.ts).getTime();
  const senders = list.filter((r) => r && r.handoffTo);
  for (const s of senders) {
    if (!AUTOMATIONS.includes(s.handoffTo)) problems.push('sender ' + s.runId + ' hands off to an unknown automation: ' + s.handoffTo);
    if (!s.handoffRef) problems.push('sender ' + s.runId + ' has no handoffRef');
    if (s.handoffTo === s.automation) problems.push('sender ' + s.runId + ' hands off to itself');
  }
  for (const r of list.filter((x) => x && x.source === 'handoff')) {
    const from = senders.filter((s) => s.handoffTo === r.automation && s.handoffRef === r.runId && s.handoffRef !== QUEUE);
    if (from.length === 0) problems.push('receiver ' + r.automation + ' ' + r.runId + ' has no sender');
    else if (!from.some((s) => time(s) <= time(r))) problems.push('receiver ' + r.automation + ' ' + r.runId + ' is older than every sender');
  }
  return problems;
}

// Offers that have not been taken up: a sender whose receiver is another automation and has no receiving row yet.
// (A visitor offered the booking page may simply never book; that is not a fault.)
function openHandoffs(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const received = new Set(list.filter((r) => r && r.source === 'handoff').map((r) => r.automation + '|' + r.runId));
  return list.filter((s) => s && s.handoffTo && s.handoffRef && s.handoffRef !== QUEUE && !received.has(s.handoffTo + '|' + s.handoffRef))
    .map((s) => ({ ref: s.handoffRef, from: s.automation, to: s.handoffTo, ts: s.ts }));
}

module.exports = { HANDOFFS, QUEUE, chainProblems, openHandoffs };
