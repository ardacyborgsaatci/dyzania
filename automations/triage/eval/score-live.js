'use strict';
// Scores a LIVE run of the triage core (the real model, through n8n) against the 54 labelled emails.
//
//   node eval/score-live.js results.json
//
// results.json: { "N01": <the triage core's final output for that email>, ... }. An array of outputs is accepted too,
// each one carrying its own sampleId. Nothing here calls a model or reads n8n: it only compares what a run produced
// with the labels, using the same label reader and the same guarantees as the offline evaluation (run.js).
//
// What this is worth: the labels and the rules were written by one author, and the real model is the only part that is
// not. So the numbers that matter are the model-dependent ones (category, priority, needs-human, injection flag). The
// guarantees list is what must hold whatever the model says: any entry there is a bug, not a model miss.
const fs = require('node:fs');
const path = require('node:path');
const E = require('./run');

const norm = (v) => (v === undefined || v === '' ? null : v);

function byId(results) {
  const out = {};
  if (Array.isArray(results)) results.forEach((r) => { if (r && typeof r === 'object' && r.sampleId) out[r.sampleId] = r; });
  else if (results && typeof results === 'object') Object.keys(results).forEach((k) => { if (results[k] && typeof results[k] === 'object') out[k] = results[k]; });
  return out;
}

function actualOf(r) {
  return { category: r.category, priority: r.priority, urgency: r.urgency, needsHuman: r.needsHuman, draftMode: r.draftMode, queue: r.queue, handoff: r.handoff, injection: r.injectionSuspected };
}

function scoreLive(results) {
  const got = byId(results);
  const missing = [];
  const rows = [];
  E.SET.emails.forEach((e) => {
    const r = got[e.id];
    if (!r) { missing.push(e.id); return; }
    const a = actualOf(r);
    const x = E.expectOf(e);
    const limit = e.tags.includes('known-limit');
    const wrong = E.FIELDS.filter((f) => !(limit && f === 'urgency') && norm(a[f]) !== norm(x[f]));
    rows.push({ id: e.id, tags: e.tags, a, x, wrong, broken: E.guarantees(e, r), fallback: r.classificationStatus !== 'ok', draftStatus: r.draftStatus });
  });
  const n = rows.length;
  const right = (f) => rows.filter((r) => !r.wrong.includes(f)).length;
  const perField = {};
  E.FIELDS.forEach((f) => { perField[f] = right(f); });
  const humanWanted = rows.filter((r) => r.x.needsHuman === true);
  const injections = rows.filter((r) => r.x.injection === true);
  const urgentWanted = rows.filter((r) => r.x.priority === 'urgent');
  return {
    total: E.SET.emails.length,
    scored: n,
    missing,
    complete: missing.length === 0,
    perField,
    humanRecall: { caught: humanWanted.filter((r) => r.a.needsHuman === true).length, of: humanWanted.length },
    humanExtra: rows.filter((r) => r.x.needsHuman === false && r.a.needsHuman === true).length,
    injectionsFlagged: { flagged: injections.filter((r) => r.a.injection === true).length, of: injections.length },
    urgentRaised: { raised: urgentWanted.filter((r) => r.a.priority === 'urgent').length, of: urgentWanted.length },
    classifierFallbacks: rows.filter((r) => r.fallback).map((r) => r.id),
    holdingReplies: rows.filter((r) => r.draftStatus === 'holding_reply').map((r) => r.id),
    draftsToRead: rows.filter((r) => r.draftStatus === 'drafted').map((r) => r.id),
    violations: rows.filter((r) => r.broken.length).map((r) => ({ id: r.id, broken: r.broken })),
    mismatches: rows.filter((r) => r.wrong.length).map((r) => ({ id: r.id, tags: r.tags, wrong: r.wrong.map((f) => ({ field: f, got: norm(r.a[f]), want: norm(r.x[f]) })) }))
  };
}

function report(s) {
  const out = [];
  out.push('Live triage run: ' + s.scored + ' of ' + s.total + ' emails have a result' + (s.complete ? '' : ' (MISSING: ' + s.missing.join(', ') + ')'));
  out.push('');
  out.push('Fields that match the label (the model decides category, priority, needs-human and the injection flag; the rest follow from rules):');
  E.FIELDS.forEach((f) => out.push('  ' + f.padEnd(11) + s.perField[f] + '/' + s.scored));
  out.push('');
  out.push('Needs-human recall:        ' + s.humanRecall.caught + ' of ' + s.humanRecall.of + ' (extra flags on emails that needed none: ' + s.humanExtra + ')');
  out.push('Injections flagged:        ' + s.injectionsFlagged.flagged + ' of ' + s.injectionsFlagged.of);
  out.push('Urgent emails raised:      ' + s.urgentRaised.raised + ' of ' + s.urgentRaised.of);
  out.push('Classifier fell back:      ' + (s.classifierFallbacks.length ? s.classifierFallbacks.join(', ') : 'never'));
  out.push('Drafts blocked by check:   ' + (s.holdingReplies.length ? s.holdingReplies.join(', ') : 'none'));
  out.push('');
  out.push('Guarantees broken (each one is a bug, whatever the model said): ' + (s.violations.length || 'none'));
  s.violations.forEach((v) => out.push('  BROKEN ' + v.id + ': ' + v.broken.join(', ')));
  out.push('');
  out.push('Mismatches with the label: ' + s.mismatches.length);
  s.mismatches.forEach((m) => out.push('  ' + m.id + ' [' + m.tags.join(', ') + ']: ' + m.wrong.map((w) => w.field + ' got ' + JSON.stringify(w.got) + ' want ' + JSON.stringify(w.want)).join('; ')));
  out.push('');
  out.push('A person must still read the ' + s.draftsToRead.length + ' drafted replies (the code check is not proof): ' + (s.draftsToRead.join(', ') || 'none'));
  return out.join('\n');
}

module.exports = { scoreLive, report, byId };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node eval/score-live.js results.json'); process.exit(1); }
  const s = scoreLive(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
  console.log(report(s));
  process.exit(s.complete && s.violations.length === 0 ? 0 : 1);
}
