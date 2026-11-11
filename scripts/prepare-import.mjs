#!/usr/bin/env node
// Turns the committed workflow files into ones ready to import into n8n, by filling in the placeholders from a LOCAL file.
//
//   node scripts/prepare-import.mjs --list
//       shows each workflow, what it needs and the order to import them (needs no config)
//   node scripts/prepare-import.mjs --config cutover.local.json [--out cutover-out]
//       writes the workflows whose placeholders are all provided; says what the others are waiting for
//
// cutover.local.json and cutover-out/ are gitignored: the table ids and the owner's addresses never go in the repo.
// The committed workflow files are never changed. This script does not talk to n8n and does not import anything:
// importing, publishing and attaching credentials are the owner's steps (see CUTOVER.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(root, ...p);

// In import order: the triage core first (the Gmail workflow calls it by id), the ops jobs last.
export const WORKFLOWS = [
  { out: 'triage-core.json', source: 'automations/triage/workflow-core.json', note: 'import first; copy its workflow id into the config as triageCoreWorkflowId' },
  { out: 'triage-gmail.json', source: 'automations/triage/workflow-gmail.json', note: 'needs the triage core id' },
  { out: 'intake.json', source: 'automations/intake/workflow.json', note: 'webhook: header-auth credential' },
  { out: 'booking.json', source: 'automations/booking/workflow.json', note: 'two webhooks: header-auth credential; confirmation uses Gmail' },
  { out: 'notices.json', source: 'automations/notices/workflow.json', note: 'upload form: basic-auth credential; vision model: OpenRouter credential' },
  { out: 'ops-error-alert.json', source: 'automations/ops/workflows/error-alert.json', note: 'then set it as the Error Workflow of every other Dyzania workflow' },
  { out: 'ops-daily-digest.json', source: 'automations/ops/workflows/daily-digest.json', note: 'Gmail credential' },
  { out: 'ops-cleanup.json', source: 'automations/ops/workflows/cleanup.json', note: 'deletes only ops_events and triage_log rows older than 90 days' }
];

const EMAIL = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const unset = (v) => typeof v !== 'string' || v.trim() === '' || /^SET_/.test(v.trim());

// placeholder text -> { key, check, value(config) }. Longer texts first so one never eats part of another.
const PLACEHOLDERS = [
  ['REPLACE_WITH_INTAKE_LEADS_TABLE_ID', 'tables.intake_leads', 'id', (c) => (c.tables || {}).intake_leads],
  ['REPLACE_WITH_BOOKINGS_TABLE_ID', 'tables.bookings', 'id', (c) => (c.tables || {}).bookings],
  ['REPLACE_WITH_TRIAGE_LOG_TABLE_ID', 'tables.triage_log', 'id', (c) => (c.tables || {}).triage_log],
  ['REPLACE_WITH_COURT_NOTICES_TABLE_ID', 'tables.court_notices', 'id', (c) => (c.tables || {}).court_notices],
  ['REPLACE_WITH_OPS_EVENTS_TABLE_ID', 'tables.ops_events', 'id', (c) => (c.tables || {}).ops_events],
  ['REPLACE_WITH_TRIAGE_CORE_WORKFLOW_ID', 'triageCoreWorkflowId', 'id', (c) => c.triageCoreWorkflowId],
  ['REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS', 'attorneyOnDutyEmail', 'email', (c) => c.attorneyOnDutyEmail],
  ['REPLACE_WITH_YOUR_EMAIL', 'ownerEmail', 'email', (c) => c.ownerEmail],
  // the Gmail address n8n is connected to; the triage workflow reads mail sent to its +triage alias
  ['YOUR_ADDRESS+triage@gmail.com', 'triageMailbox', 'gmail', (c) => (isGmail(c.triageMailbox) ? c.triageMailbox.replace('@', '+triage@') : undefined)],
  ['YOUR_ADDRESS@gmail.com', 'triageMailbox', 'gmail', (c) => c.triageMailbox]
];
function isGmail(v) { return typeof v === 'string' && /^[A-Za-z0-9._-]+@gmail\.com$/i.test(v.trim()); }

const CHECKS = {
  id: (v) => ID.test(v),
  email: (v) => EMAIL.test(v),
  gmail: (v) => isGmail(v)
};

export function placeholdersIn(text) {
  return PLACEHOLDERS.map((p) => p[0]).filter((p) => text.includes(p));
}

// config: the parsed local file. sources: { out name: file text }. Returns { files, waiting, problems, warnings }.
// `problems` are config values that are present but wrong; a workflow with a problem is not written.
export function prepare(config, sources) {
  const c = config && typeof config === 'object' ? config : {};
  const files = {};
  const waiting = {};
  const problems = [];
  const warnings = [];
  const bad = new Set();
  for (const [, key, kind, get] of PLACEHOLDERS) {
    // the Gmail alias is built from the mailbox, so the mailbox itself is what gets checked
    const v = kind === 'gmail' ? c.triageMailbox : get(c);
    if (unset(v)) continue;
    if (!CHECKS[kind](v.trim())) { if (!bad.has(key)) { problems.push(key + ' does not look like ' + (kind === 'id' ? 'an id' : kind === 'gmail' ? 'a gmail.com address' : 'an email address')); bad.add(key); } }
  }
  for (const key of ['ownerEmail', 'attorneyOnDutyEmail']) {
    if (!unset(c[key]) && /\.(example|test|invalid|localhost)$/i.test(String(c[key]).trim())) warnings.push(key + ' ends in a reserved name that cannot receive mail');
  }
  if (!unset(c.ownerEmail) && !unset(c.attorneyOnDutyEmail) && c.ownerEmail.trim().toLowerCase() === c.attorneyOnDutyEmail.trim().toLowerCase()) warnings.push('the owner and the attorney on duty are the same address (fine for a demo)');
  let tz = null;
  if (!unset(c.timezone)) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: c.timezone }); tz = c.timezone.trim(); } catch { problems.push('timezone is not an IANA time zone name'); }
  }

  for (const w of WORKFLOWS) {
    const text = sources[w.out];
    if (typeof text !== 'string') continue;
    const needs = placeholdersIn(text);
    const missing = needs.filter((p) => { const [, key, , get] = PLACEHOLDERS.find((x) => x[0] === p); return unset(get(c)) || bad.has(key); });
    if (missing.length) { waiting[w.out] = missing; continue; }
    let out = text;
    for (const [p, , , get] of PLACEHOLDERS) out = out.split(p).join(String(get(c)).trim());
    const wf = JSON.parse(out);
    if (tz && w.out.startsWith('ops-')) wf.settings = Object.assign({}, wf.settings, { timezone: tz });
    const result = JSON.stringify(wf, null, 2) + '\n';
    if (/REPLACE_WITH_|YOUR_ADDRESS/.test(result)) throw new Error(w.out + ' still has a placeholder after substitution');
    files[w.out] = result;
  }
  return { files, waiting, problems, warnings };
}

function readSources() {
  const out = {};
  for (const w of WORKFLOWS) out[w.out] = fs.readFileSync(rel(w.source), 'utf8').replace(/\r\n/g, '\n');
  return out;
}

function ignored(file) {
  const ig = fs.existsSync(rel('.gitignore')) ? fs.readFileSync(rel('.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return ig.some((l) => l && (l.replace(/\/$/, '') === norm || l.replace(/^\//, '').replace(/\/$/, '') === norm));
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const sources = readSources();
  if (argv.includes('--list') || !arg('--config')) {
    console.log('Workflows, in the order to import them:\n');
    WORKFLOWS.forEach((w, i) => console.log((i + 1) + '. ' + w.out.padEnd(24) + ' needs: ' + (placeholdersIn(sources[w.out]).join(', ') || '(nothing)') + '\n   ' + w.note));
    console.log('\nNext: copy cutover.example.json to cutover.local.json, fill it in, then run with --config cutover.local.json');
    return 0;
  }
  const configPath = path.resolve(arg('--config'));
  const outDir = path.resolve(arg('--out') || rel('cutover-out'));
  const relOf = (p) => path.relative(root, p);
  if (!ignored(relOf(configPath)) && path.dirname(configPath) === root) { console.error('Refusing: ' + relOf(configPath) + ' is not listed in .gitignore, so it could be committed with real addresses.'); return 1; }
  if (!ignored(relOf(outDir)) && !relOf(outDir).startsWith('..')) { console.error('Refusing: ' + relOf(outDir) + ' is not listed in .gitignore, so the prepared files could be committed with real addresses.'); return 1; }
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (err) { console.error('Cannot read ' + configPath + ': ' + err.message); return 1; }
  const r = prepare(config, sources);
  r.problems.forEach((p) => console.error('Problem: ' + p));
  r.warnings.forEach((p) => console.error('Note: ' + p));
  if (r.problems.length) return 1;
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(r.files)) fs.writeFileSync(path.join(outDir, name), text);
  console.log('Wrote ' + Object.keys(r.files).length + ' of ' + WORKFLOWS.length + ' workflows to ' + relOf(outDir) + '/ (never committed):');
  for (const w of WORKFLOWS) console.log('  ' + (r.files[w.out] ? 'ready   ' : 'waiting ') + w.out + (r.waiting[w.out] ? '  (needs ' + r.waiting[w.out].join(', ') + ')' : ''));
  console.log('\nNothing was imported or published. Import the ready files in the order above (CUTOVER.md has each step).');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
