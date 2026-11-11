'use strict';
// The daily digest, the error alert and the retention rule, as pure functions. The generated n8n Code nodes contain this
// file as it is. Everything is counts, references and short summaries: no names, no message text. Nothing here sends mail;
// the workflows send the result only to the owner address, which is put in at import.
const { AUTOMATIONS, TEAMS, buildEvent, orFallback } = require('./event.js');

const NAMES = { intake: 'Lead intake', triage: 'Inbox triage', booking: 'Consultation booking', notices: 'Court notices', voice: 'Voice line', ops: 'Ops jobs' };
// Rows older than this are deleted by the nightly job. Leads, bookings and notices are NOT in this list: nothing deletes them yet.
const RETENTION_DAYS = { ops_events: 90, triage_log: 90 };
const HOURS = 24;
const MAX_ATTENTION = 15;

const when = (e) => (e.ts instanceof Date ? e.ts : new Date(e.ts)).getTime();

function buildDigest(rows, ctx) {
  const c = ctx || {};
  const now = c.now instanceof Date ? c.now : new Date();
  const firm = c.firm || 'Hollis & Marr LLP';
  const since = now.getTime() - HOURS * 3600 * 1000;
  const inWindow = (Array.isArray(rows) ? rows : []).filter((e) => e && AUTOMATIONS.includes(e.automation) && when(e) >= since && when(e) <= now.getTime() + 60000);
  // Test runs are listed but never counted, so an evaluation does not look like real work.
  const tests = inWindow.filter((e) => e.source === 'seed' || e.source === 'eval');
  const events = inWindow.filter((e) => e.source !== 'seed' && e.source !== 'eval').sort((a, b) => when(b) - when(a));

  const counts = {};
  for (const key of AUTOMATIONS) {
    const mine = events.filter((e) => e.automation === key);
    counts[key] = { runs: mine.length, ok: 0, needs_human: 0, blocked: 0, error: 0 };
    for (const e of mine) if (counts[key][e.status] !== undefined) counts[key][e.status] += 1;
  }

  const notices = events.filter((e) => e.automation === 'notices');
  const urgentNotices = notices.filter((e) => / priority urgent\b/.test(String(e.summary)));
  const booked = events.filter((e) => e.automation === 'booking' && / booked(?: |,|$)/.test(String(e.summary)) && e.status === 'ok');
  const byChannel = (name) => booked.filter((e) => new RegExp('channel ' + name + '\\b').test(String(e.summary))).length;
  const betweenWorkflows = events.filter((e) => e.handoffTo && e.handoffRef !== 'queue').length;
  const toQueues = events.filter((e) => e.handoffTo && e.handoffRef === 'queue').length;
  const attention = events.filter((e) => e.status === 'needs_human' || e.status === 'error' || e.status === 'blocked');
  const shown = attention.slice(0, MAX_ATTENTION).map((e) => '- [' + e.automation + '] ' + String(e.summary).slice(0, 140));

  const lines = [];
  for (const key of AUTOMATIONS) {
    const n = counts[key];
    lines.push(NAMES[key] + ': ' + n.runs + ' runs, ' + n.ok + ' ok, ' + n.needs_human + ' need a person, ' + n.blocked + ' blocked, ' + n.error + ' errors');
  }
  const text = [
    firm + ' ops digest, last ' + HOURS + ' hours (to ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC)',
    '',
    events.length + ' events. ' + betweenWorkflows + ' handoffs between automations, ' + toQueues + ' to a person\'s queue.',
    '',
    lines.join('\n'),
    '',
    'Court notices waiting for an attorney to confirm: ' + notices.length + (urgentNotices.length ? ' (' + urgentNotices.length + ' urgent)' : ''),
    'Consultations booked: ' + booked.length + ' (website ' + byChannel('form') + ', voice ' + byChannel('voice') + ')',
    '',
    shown.length ? 'Needs a person, was blocked or failed:\n' + shown.join('\n') + (attention.length > shown.length ? '\n...and ' + (attention.length - shown.length) + ' more' : '') : 'Nothing needs a person.',
    '',
    tests.length ? tests.length + ' test events (seed or evaluation) are not counted.' : '',
    'Counts, references and short summaries only: no names and no message text. The only email any automation sends to a client is the fixed booking confirmation.'
  ].filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');

  return {
    subject: '[' + firm + '] Daily ops digest' + (urgentNotices.length ? ' - ' + urgentNotices.length + ' urgent court notice' + (urgentNotices.length === 1 ? '' : 's') : ''),
    text, counts, events: events.length, attention: attention.length, notices: notices.length, urgentNotices: urgentNotices.length,
    booked: booked.length, handoffs: { betweenWorkflows, toQueues }, tests: tests.length
  };
}

// Which automation a failed workflow belongs to, from its name ("H&M Booking - ...").
function automationFromWorkflowName(name) {
  const n = String(name || '').toLowerCase().replace(/h&m/g, '');
  if (n.includes('intake') || n.includes('lead')) return 'intake';
  if (n.includes('triage') || n.includes('inbox')) return 'triage';
  if (n.includes('booking')) return 'booking';
  if (n.includes('notice') || n.includes('court')) return 'notices';
  if (n.includes('voice')) return 'voice';
  return 'ops';
}

// failure: n8n's error trigger payload ({ workflow: { name }, execution: { id, url, mode, lastNodeExecuted, error: { message } } }).
// The message is cut and carries no address; the owner opens the execution to see more.
function errorAlert(failure, ctx) {
  const c = ctx || {};
  const f = failure || {};
  const wf = (f.workflow && f.workflow.name) || 'Unknown workflow';
  const ex = f.execution || {};
  const err = ex.error || {};
  const message = String(err.message || 'Unknown error').replace(/[^\s@]*@[^\s@]*/g, '[address]').slice(0, 300);
  const lastNode = ex.lastNodeExecuted || (err.node && err.node.name) || 'unknown node';
  const automation = automationFromWorkflowName(wf);
  const runId = String(ex.id || 'unknown');
  const built = orFallback(buildEvent({ automation, source: 'schedule', runId, status: 'error', summary: 'Failure in ' + wf + ' at ' + lastNode }, c.now), { automation, source: 'schedule', runId, summary: 'A workflow failed' }, c.now);
  const firm = c.firm || 'Hollis & Marr LLP';
  const text = [
    'A workflow failed.', '',
    'Workflow: ' + wf, 'Node: ' + lastNode, 'Error: ' + message, 'Mode: ' + (ex.mode || ''), 'Execution: ' + (ex.url || ex.id || ''), '',
    'No client email was sent because of this failure. A visitor may have seen an error message; check the form or booking page.'
  ].join('\n');
  return { event: built, subject: '[' + firm + '] Failure in ' + wf, text, team: TEAMS[automation] };
}

// The cut-off for one table, as an ISO time. `table` must be a key of RETENTION_DAYS.
function retentionCutoff(table, now) {
  const days = RETENTION_DAYS[table];
  if (!days) throw new Error('no retention rule for ' + table);
  return new Date((now instanceof Date ? now : new Date()).getTime() - days * 86400000).toISOString();
}

// Which column dates a row for the cleanup. triage_log has no time column of its own that is ours, so the table's createdAt is used.
const RETENTION_FIELD = { ops_events: 'ts', triage_log: 'createdAt' };
const MAX_DELETE = 1000;

// The rows to delete from one table: older than its retention rule, never one without a readable date, at most `max` per run
// (the next night takes the rest). Returns { cutoff, ids, found, capped }. Throws for a table with no rule.
function selectExpired(rows, table, now, max) {
  const cutoff = retentionCutoff(table, now);
  const field = RETENTION_FIELD[table];
  const limit = max > 0 ? max : MAX_DELETE;
  const old = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.id == null || r[field] == null || r[field] === '') continue;
    const t = new Date(r[field]).getTime();
    if (Number.isFinite(t) && t < new Date(cutoff).getTime()) old.push(r.id);
  }
  return { cutoff, ids: old.slice(0, limit), found: old.length, capped: old.length > limit };
}

module.exports = { NAMES, RETENTION_DAYS, RETENTION_FIELD, HOURS, MAX_ATTENTION, MAX_DELETE, buildDigest, automationFromWorkflowName, errorAlert, retentionCutoff, selectExpired };
