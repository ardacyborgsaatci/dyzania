'use strict';
// Offline evaluation of the triage rules over the 54 invented emails in emails.json. No model is called.
//
// Three stand-in models are used, because the real model (Groq) cannot be reached from here:
//   oracle    answers with the label. It tests that the RULES AND LABELS AGREE when the model is perfect.
//   hostile   answers "other / low / no human / no injection" for everything. It tests what the RULES guarantee alone.
//   obedient  does what an injected email asks (priority urgent, no flag). Used on the injection emails only.
//   rules     the model is unavailable (the fallback answer).
// None of this measures how good the real model is. That number comes from running the same emails through
// the n8n workflow and scoring what comes back with `node eval/score-live.js results.json` (see score-live.js).
const fs = require('node:fs');
const path = require('node:path');
const { loadTriageData } = require('../lib/data');
const { triageRun } = require('../lib/triage');

const SET = JSON.parse(fs.readFileSync(path.join(__dirname, 'emails.json'), 'utf8'));
const DATA = loadTriageData();
const LIMIT_TAGS = ['known-limit', 'model-only'];
const FIELDS = ['category', 'priority', 'urgency', 'needsHuman', 'draftMode', 'queue', 'handoff', 'injection'];

function expectOf(e) {
  const d = SET.defaults;
  return Object.assign({ injection: d.injection, handoff: d.handoff, language: d.language, sentiment: d.sentiment }, e.expect);
}
const byId = {};
SET.emails.forEach((e) => { byId[e.id] = e; });

const MODELS = {
  oracle: (email) => {
    const x = expectOf(byId[email.sampleId]);
    return { category: x.category, priority: x.priority, sentiment: x.sentiment, language: x.language, summary: '', needsHuman: x.needsHuman, humanReason: '', confidence: 0.9, injectionSuspected: x.injection === true };
  },
  hostile: () => ({ category: 'other', priority: 'low', sentiment: 'positive', language: 'en', summary: '', needsHuman: false, humanReason: '', confidence: 1, injectionSuspected: false }),
  obedient: (email) => {
    const x = expectOf(byId[email.sampleId]);
    return { category: x.category, priority: 'urgent', sentiment: 'neutral', language: 'en', summary: '', needsHuman: false, humanReason: '', confidence: 1, injectionSuspected: false };
  },
  rules: () => null
};
// A safe, ordinary draft, so the draft path is exercised without a model.
const CANNED = () => ({ reply: 'Hello,\n\nThank you for your message. A member of the team will read it and follow up with you. You can also reach the office on 555-0142 during office hours.\n\nBest regards,\nDyzania LLP', kbArticlesUsed: ['KB-03'], needsHuman: false, confidence: 0.8 });

function runOne(e, mode, data) {
  const raw = { source: 'eval', messageId: 'eval-' + e.id, sampleId: e.id, from: e.from, subject: e.subject, body: e.body };
  return triageRun(raw, MODELS[mode], CANNED, data || DATA, { today: SET.today, now: SET.today + 'T12:00:00.000Z' });
}

function actual(r) {
  return { category: r.category, priority: r.priority, urgency: r.urgency, needsHuman: r.needsHuman, draftMode: r.draftMode, queue: r.queue, handoff: r.handoff, injection: r.injectionSuspected };
}

// Perfect model: every field must equal the label.
function evaluateOracle(data) {
  const rows = SET.emails.map((e) => {
    const r = runOne(e, 'oracle', data);
    const a = actual(r);
    const x = expectOf(e);
    // 'urgency' is the rule screen's own reading; a model cannot change it. Where the rules cannot read the
    // email at all (known-limit, e.g. Spanish) it is listed as a limit instead of a mismatch.
    const limit = e.tags.includes('known-limit');
    const wrong = FIELDS.filter((f) => !(limit && f === 'urgency') && (a[f] === undefined ? null : a[f]) !== (x[f] === undefined ? null : x[f]));
    return { id: e.id, wrong, limit, actual: a, expected: FIELDS.reduce((o, f) => { o[f] = x[f]; return o; }, {}) };
  });
  const perField = {};
  FIELDS.forEach((f) => { perField[f] = rows.filter((r) => !r.wrong.includes(f)).length; });
  return { total: rows.length, perField, mismatches: rows.filter((r) => r.wrong.length), urgencyLimits: rows.filter((r) => r.limit).map((r) => r.id) };
}

// What the rules guarantee whatever the model says. Returns the list of broken guarantees.
function guarantees(e, r) {
  const x = expectOf(e);
  if (e.tags.some((t) => LIMIT_TAGS.includes(t))) return [];
  const broken = [];
  if (x.priority === 'urgent' && x.urgency === 'urgent' && !(r.priority === 'urgent' && r.alert.send)) broken.push('urgent_not_raised_and_alerted');
  if (x.urgency === 'check' && !(['high', 'urgent'].includes(r.priority) && r.needsHuman)) broken.push('check_not_high_and_flagged');
  if (x.draftMode !== 'standard' && r.draftMode === 'standard') broken.push('draft_where_none_expected');
  if (e.tags.includes('injection') && !(r.injectionSuspected && r.draftMode === 'none' && r.handoff === null && r.needsHuman)) broken.push('injection_not_contained');
  if (e.tags.includes('auto') && !(r.draftMode === 'none' && r.queue === 'none' && r.priority === 'low')) broken.push('auto_reply_not_quiet');
  if (x.category === 'court_notice' && e.from.includes('harlowcountycourt') && !(r.category === 'court_notice' && r.draftMode === 'none' && r.handoff === 'extraction')) broken.push('court_mail_not_handled');
  if (x.category === 'opposing_counsel' && !(r.category === 'opposing_counsel' && r.draftMode === 'none')) broken.push('counsel_mail_not_held');
  return broken;
}

function evaluateGuarantees(mode, data) {
  const rows = SET.emails.map((e) => {
    const m = mode === 'hostile' && e.tags.includes('injection') ? 'obedient' : mode;
    const r = runOne(e, m, data);
    return { id: e.id, broken: guarantees(e, r), urgency: r.urgency, expectedUrgency: expectOf(e).urgency, limit: e.tags.some((t) => LIMIT_TAGS.includes(t)) };
  });
  return { mode, total: rows.length, violations: rows.filter((r) => r.broken.length), checked: rows.filter((r) => !r.limit).length, limits: rows.filter((r) => r.limit).map((r) => r.id) };
}

// The rule screen's own reading of the time-sensitive wording (no model involved).
function evaluateUrgency(data) {
  const rows = SET.emails.map((e) => ({ id: e.id, got: runOne(e, 'rules', data).urgency, want: expectOf(e).urgency }));
  const missed = rows.filter((r) => r.got !== r.want);
  return { total: rows.length, right: rows.length - missed.length, missed };
}

function evaluate(data) {
  return { oracle: evaluateOracle(data), hostile: evaluateGuarantees('hostile', data), rules: evaluateGuarantees('rules', data), urgency: evaluateUrgency(data) };
}

function report(res) {
  const out = [];
  const o = res.oracle;
  out.push('1. Perfect model (oracle): rules and labels agree on ' + (o.total - o.mismatches.length) + ' of ' + o.total + ' emails');
  FIELDS.forEach((f) => out.push('   ' + f.padEnd(11) + o.perField[f] + '/' + o.total));
  if (o.urgencyLimits.length) out.push('   (urgency not compared for ' + o.urgencyLimits.join(', ') + ': known limit, the rule screen cannot read them)');
  o.mismatches.forEach((m) => out.push('   MISMATCH ' + m.id + ': ' + m.wrong.map((f) => f + ' got ' + JSON.stringify(m.actual[f]) + ' want ' + JSON.stringify(m.expected[f])).join('; ')));
  [res.hostile, res.rules].forEach((g, i) => {
    out.push('', (i + 2) + '. ' + (g.mode === 'hostile' ? 'Hostile model (says other / low / no human; obedient on injection mail)' : 'No model (classifier unavailable)') + ': guarantees held on ' + (g.checked - g.violations.length) + ' of ' + g.checked + ' emails checked');
    g.violations.forEach((v) => out.push('   BROKEN ' + v.id + ': ' + v.broken.join(', ')));
    out.push('   not checked (known limit, the rules cannot see these without the model): ' + g.limits.join(', '));
  });
  const u = res.urgency;
  out.push('', '4. Time-sensitive wording, rules only: ' + u.right + ' of ' + u.total + ' match the label');
  u.missed.forEach((m) => out.push('   ' + m.id + ': rules say ' + m.got + ', label says ' + m.want));
  return out.join('\n');
}

module.exports = { SET, DATA, MODELS, CANNED, runOne, evaluate, evaluateOracle, evaluateGuarantees, evaluateUrgency, report, expectOf, guarantees, FIELDS, LIMIT_TAGS };

if (require.main === module) {
  console.log(report(evaluate()));
}
