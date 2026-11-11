'use strict';
// One row of the ops_events table, built and checked in one place. Dependency-free: the generated n8n Code nodes
// contain this file as it is (see scripts/build-*-workflow.mjs), so what the tests run is what n8n runs.
//
// Rules held here, not by hand in each workflow:
//   - metadata only: a summary has no email address, no phone number and is at most 140 characters;
//   - a known automation, team, source and status, or the event is refused (never thrown: logging must not break a run);
//   - a handoff names its receiver and a reference (the receiver's own row, or QUEUE when a person receives it).

const AUTOMATIONS = ['intake', 'triage', 'booking', 'notices', 'voice', 'ops'];
const TEAMS = { intake: 'intake', triage: 'front-office', booking: 'intake', notices: 'paralegals', voice: 'front-desk', ops: 'ops' };
const SOURCES = ['web', 'gmail', 'voice', 'upload', 'seed', 'eval', 'schedule', 'handoff'];
const STATUSES = ['ok', 'needs_human', 'blocked', 'error'];
const MAX_SUMMARY = 140;
// handoffRef when the receiver is a person's queue (the intake coordinator, the paralegals), not another workflow.
const QUEUE = 'queue';

// A reference this system issues (DY-..., N-...): kept whole, whatever digits it holds.
const REFERENCE = /\b(?:DY|N)-[A-Z0-9][A-Z0-9-]*/g;

function cleanSummary(text) {
  const scrub = (part) => part
    // A run of 7 or more digits (with the usual separators) looks like a phone number: never keep one.
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[number]' : m));
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().replace(/[^\s@]*@[^\s@]*/g, '[address]');
  let out = '';
  let last = 0;
  for (const m of flat.matchAll(REFERENCE)) {
    out += scrub(flat.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return (out + scrub(flat.slice(last))).slice(0, MAX_SUMMARY);
}

// True when the text holds something that looks like a phone number. References this system issues are not counted.
function looksLikePhone(text) {
  const bare = String(text == null ? '' : text).replace(REFERENCE, ' ');
  return (bare.match(/\+?\d[\d\s().-]{5,}\d/g) || []).some((m) => m.replace(/\D/g, '').length >= 7);
}

function validateEvent(e) {
  const problems = [];
  if (!AUTOMATIONS.includes(e.automation)) problems.push('automation');
  if (e.team !== TEAMS[e.automation]) problems.push('team');
  if (!SOURCES.includes(e.source)) problems.push('source');
  if (!STATUSES.includes(e.status)) problems.push('status');
  if (!e.runId || typeof e.runId !== 'string') problems.push('runId');
  if (!(e.ts instanceof Date) || Number.isNaN(e.ts.getTime())) problems.push('ts');
  if (typeof e.summary !== 'string' || e.summary.length === 0 || e.summary.length > MAX_SUMMARY || e.summary.includes('@')) problems.push('summary');
  if (e.latencyMs != null && !(Number.isFinite(e.latencyMs) && e.latencyMs >= 0)) problems.push('latencyMs');
  if (e.handoffTo && !AUTOMATIONS.includes(e.handoffTo)) problems.push('handoffTo');
  if (e.handoffTo && !e.handoffRef) problems.push('handoffRef');
  if (!e.handoffTo && e.handoffRef) problems.push('handoffTo');
  return problems;
}

// Returns { ok, event, problems }. Never throws.
function buildEvent(input, now) {
  try {
    const at = now instanceof Date ? now : new Date();
    const event = {
      ts: input.ts instanceof Date ? input.ts : at,
      automation: input.automation,
      team: TEAMS[input.automation],
      runId: input.runId == null ? '' : String(input.runId),
      source: input.source,
      status: input.status,
      summary: cleanSummary(input.summary),
      latencyMs: input.latencyMs == null ? null : Math.round(Number(input.latencyMs)),
      handoffTo: input.handoffTo || '',
      handoffRef: input.handoffRef || ''
    };
    const problems = validateEvent(event);
    return { ok: problems.length === 0, event, problems };
  } catch (err) {
    return { ok: false, event: null, problems: ['exception: ' + err.message] };
  }
}

// Always gives back a valid { ok: true, event }: `built` when it passed its checks, else an error row that says an event
// could not be built, so a missing log line is loud in the digest instead of silent. `fallback` names the automation,
// source and run id to put on that row; status is always 'error'.
function orFallback(built, fallback, now) {
  if (built && built.ok) return built;
  const again = buildEvent(Object.assign({ automation: 'ops', source: 'schedule', summary: 'An ops event could not be built' }, fallback, { status: 'error' }), now);
  if (again.ok) return again;
  return buildEvent({ automation: 'ops', source: 'schedule', status: 'error', runId: 'unknown', summary: 'An ops event could not be built' }, now);
}

// The row as the data table takes it: the time as an ISO string, an empty number as null.
function toRow(event) {
  return {
    ts: event.ts.toISOString(), automation: event.automation, team: event.team, runId: event.runId, source: event.source,
    status: event.status, summary: event.summary, latencyMs: event.latencyMs, handoffTo: event.handoffTo, handoffRef: event.handoffRef
  };
}

module.exports = { AUTOMATIONS, TEAMS, SOURCES, STATUSES, MAX_SUMMARY, QUEUE, cleanSummary, looksLikePhone, validateEvent, buildEvent, orFallback, toRow };
