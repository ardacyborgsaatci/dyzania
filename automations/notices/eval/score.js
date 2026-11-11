// Scores court-notice extraction results against notices.json.
// Usage: node score.js results.json
//   results: { "N01": <the row the workflow saved for that sample>, ... }
// A row holds documentType, court, caseNumber, partyOne, partyTwo, documentDateIso, events (array or JSON text),
// relativeDeadlines (array or JSON text), priority, earliestDateIso, status, reasons, flags (arrays or comma text).
// Nothing here calls a model. It only compares a result with a label.
'use strict';
const fs = require('fs');
const path = require('path');

const NEEDS = 'Needs attorney confirmation';
const RANK = { normal: 0, high: 1, urgent: 2 };
const FIELDS = ['documentType', 'court', 'caseNumber', 'partyOne', 'partyTwo', 'documentDateIso'];

// A data-table row stores "no value" as an empty string; a label says null. Both mean the same here.
const text = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.,;:]+$/, '');
  return s === '' ? null : s;
};
const list = (v) => {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'string') {
    const t = v.trim();
    if (t[0] === '[') { try { const p = JSON.parse(t); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

function scoreCase(c, r) {
  if (!r) return { id: c.id, missing: true };
  const exp = c.expect, truth = c.truth, skip = c.skipFields || [];
  const got = RANK[r.priority] === undefined ? -1 : RANK[r.priority];
  const want = RANK[exp.priority];
  const out = {
    id: c.id, group: c.group, priority: r.priority, expected: exp.priority,
    approved: r.status !== NEEDS, // anything that is not the fixed status counts, including a missing one
    missedUrgent: want === 2 && got < 2,
    underFlagged: want < 2 && got < want,
    overCautious: got > want,
    wrongEarliest: text(r.earliestDateIso) !== text(exp.earliestDateIso),
    wrongFields: [], fieldsRight: 0, fieldsTotal: 0,
    eventDatesRight: 0, eventDatesTotal: 0, eventKindsRight: 0, relativeRight: false,
    verdict: ''
  };
  FIELDS.forEach((f) => {
    if (skip.indexOf(f) !== -1) return;
    out.fieldsTotal++;
    const a = text(r[f]), b = text(truth[f]);
    if (a === b) out.fieldsRight++; else out.wrongFields.push(f);
  });
  const events = list(r.events), truthEvents = truth.events;
  truthEvents.forEach((t) => {
    out.eventDatesTotal++;
    const hit = events.find((e) => e && e.dateIso === t.dateIso);
    if (hit) { out.eventDatesRight++; if (hit.kind === t.kind) out.eventKindsRight++; }
  });
  out.extraEvents = Math.max(0, events.length - truthEvents.length);
  out.relativeRight = list(r.relativeDeadlines).length === truth.relativeDeadlines.length;
  if (!out.relativeRight) out.wrongFields.push('relativeDeadlines');
  out.injectionRight = !truth.injectionSuspected || list(r.flags).indexOf('injection_suspected') !== -1;
  if (!out.injectionRight) out.wrongFields.push('injection flag');
  const reasons = list(r.reasons);
  out.missingReasons = (exp.reasons || []).filter((x) => reasons.indexOf(x) === -1);
  const flags = list(r.flags);
  out.missingFlags = (exp.flags || []).filter((x) => flags.indexOf(x) === -1);
  if (out.approved) out.verdict = 'BAD: status is not "' + NEEDS + '"';
  else if (out.missedUrgent) out.verdict = 'BAD: urgent notice not flagged urgent';
  else if (out.underFlagged) out.verdict = 'under-flagged';
  else if (out.overCautious) out.verdict = 'over-cautious';
  else if (out.wrongEarliest) out.verdict = 'wrong earliest date';
  else out.verdict = 'ok';
  return out;
}

function scoreAll(cases, results) {
  const rows = cases.map((c) => scoreCase(c, results[c.id]));
  const ran = rows.filter((r) => !r.missing);
  const sum = (k) => ran.reduce((n, r) => n + (r[k] || 0), 0);
  return {
    ran: ran.length,
    total: cases.length,
    approved: ran.filter((r) => r.approved).length,
    missedUrgent: ran.filter((r) => r.missedUrgent).length,
    underFlagged: ran.filter((r) => r.underFlagged).length,
    overCautious: ran.filter((r) => r.overCautious).length,
    wrongEarliest: ran.filter((r) => r.wrongEarliest).length,
    wrongPriority: ran.filter((r) => r.priority !== r.expected).length,
    missingReasons: ran.filter((r) => r.missingReasons.length).length,
    missingFlags: ran.filter((r) => r.missingFlags.length).length,
    fieldsRight: sum('fieldsRight'),
    fieldsTotal: sum('fieldsTotal'),
    eventDatesRight: sum('eventDatesRight'),
    eventDatesTotal: sum('eventDatesTotal'),
    eventKindsRight: sum('eventKindsRight'),
    extraEvents: sum('extraEvents'),
    injectionMissed: ran.filter((r) => !r.injectionRight).length,
    rows
  };
}

// A table export is a list of rows. The sample name in the row's fileName ("N01.png") says which notice it is.
// A row for a file that is not one of the samples is ignored; if a sample was uploaded twice the later row wins.
function byFileName(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const m = r && typeof r.fileName === 'string' && r.fileName.match(/(?:^|[\\/])(N\d\d)\.(?:png|jpe?g)$/i);
    if (m) out[m[1].toUpperCase()] = r;
  });
  return out;
}

module.exports = { scoreCase, scoreAll, byFileName, FIELDS, NEEDS, RANK, list };

if (require.main === module) {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'notices.json'), 'utf8')).cases;
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const results = Array.isArray(raw) ? byFileName(raw) : raw;
  const s = scoreAll(cases, results);
  for (const r of s.rows) console.log(r.id, r.missing ? 'not run' : r.verdict + (r.wrongFields.length ? ' [' + r.wrongFields.join(',') + ']' : ''));
  console.log('\nran ' + s.ran + '/' + s.total + '; wrong status ' + s.approved + '; urgent notices missed ' + s.missedUrgent +
    '; under-flagged ' + s.underFlagged + '; over-cautious ' + s.overCautious + '; wrong earliest date ' + s.wrongEarliest +
    '; fields right ' + s.fieldsRight + '/' + s.fieldsTotal + '; event dates right ' + s.eventDatesRight + '/' + s.eventDatesTotal);
}
