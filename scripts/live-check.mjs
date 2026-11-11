#!/usr/bin/env node
// A live check of the intake -> booking path, in two steps that never put real data anywhere.
//
//   node scripts/live-check.mjs journey --base https://YOUR-SITE [--email you@yourmail] [--report cutover-out/live-report.json]
//       acts as one invented visitor against the DEPLOYED site: loads a token, sends an intake form, asks for free times,
//       books one with the lead reference the intake returned. Prints and saves what came back (references, codes).
//       It books ONE real consultation slot for an invented person; cancel it in the bookings table afterwards.
//       Without --email the confirmation goes to an address that cannot receive mail, so "confirmationSent" will be false.
//
//   node scripts/live-check.mjs verify --rows rows.json --report cutover-out/live-report.json
//       checks the ops_events rows (exported from the data table) against that journey: both events exist, they chain by the
//       lead reference, nothing private is in any summary, every row is valid, and the digest reads them.
//
// The journey talks to a URL you give it. It never reads n8n, never sends mail itself and never uses a real person's data.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { validateEvent, looksLikePhone } = require(path.join(root, 'automations', 'ops', 'lib', 'event.js'));
const { buildDigest } = require(path.join(root, 'automations', 'ops', 'lib', 'digest.js'));
const { chainProblems } = require(path.join(root, 'automations', 'handoffs', 'lib', 'handoffs.js'));

// The one invented visitor. Nothing here is a real person; the address ends in .example unless the owner passes --email.
export const PERSON = {
  name: 'Live Check Visitor',
  email: 'live-check@mail.example',
  phone: '',
  otherSide: 'Invented Cafe Supplies',
  description: 'This is an automated live check by the site owner using an invented person. I want to start a divorce and need to talk about custody of our two children after a few months of separation.',
  area: 'family'
};
const TOKEN_WAIT_MS = 3300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// request(method, path, body) -> { status, data }. wait(ms) lets a test skip the real pause.
export async function runJourney({ request, wait = sleep, email, now = () => new Date() }) {
  const steps = [];
  const fail = (step, detail) => { steps.push({ step, ok: false, detail }); return { ok: false, steps, report: null }; };
  const person = Object.assign({}, PERSON, email ? { email } : {});
  const token = async () => { const r = await request('GET', '/api/token'); return r.status === 200 && r.data && r.data.token; };

  let t = await token();
  if (!t) return fail('token', 'no token from /api/token');
  steps.push({ step: 'token', ok: true });
  await wait(TOKEN_WAIT_MS);

  const startedAt = now().toISOString();
  const intake = await request('POST', '/api/intake', {
    name: person.name, email: person.email, phone: person.phone, preferredContact: 'email', area: person.area, description: person.description,
    location: 'harlow_point', hearing: 'none', incidentDate: '', otherSide: person.otherSide, howHeard: 'search', consent: true, website: '', formToken: t
  });
  if (intake.status !== 200 || !intake.data || intake.data.ok !== true || !intake.data.ref) return fail('intake', 'status ' + intake.status + ' ' + JSON.stringify(intake.data || {}).slice(0, 200));
  const leadRef = intake.data.ref;
  steps.push({ step: 'intake', ok: true, detail: 'ref ' + leadRef + ', kind ' + intake.data.kind });
  if (!['book', 'follow_up'].includes(intake.data.kind)) return fail('intake kind', 'expected the booking page to be offered, got ' + intake.data.kind);

  t = await token();
  if (!t) return fail('token', 'no second token');
  const slots = await request('POST', '/api/slots', { area: person.area, limit: 3, formToken: t });
  if (slots.status !== 200 || !slots.data || !Array.isArray(slots.data.slots) || !slots.data.slots.length) return fail('slots', 'status ' + slots.status + ' ' + JSON.stringify(slots.data || {}).slice(0, 200));
  steps.push({ step: 'slots', ok: true, detail: slots.data.slots.length + ' times offered' });
  await wait(TOKEN_WAIT_MS);

  const book = await request('POST', '/api/book', {
    name: person.name, email: person.email, phone: person.phone, area: person.area, otherSide: person.otherSide, noOtherSide: false, consent: true,
    start: slots.data.slots[0].start, leadRef, formToken: t
  });
  if (book.status !== 200 || !book.data || book.data.code !== 'booked') return fail('book', 'status ' + book.status + ' ' + JSON.stringify(book.data || {}).slice(0, 200));
  steps.push({ step: 'book', ok: true, detail: 'ref ' + book.data.ref + ', confirmationSent ' + book.data.confirmationSent });

  const report = {
    startedAt, finishedAt: now().toISOString(), leadRef, intakeKind: intake.data.kind, bookingRef: book.data.ref, bookedStart: book.data.start,
    confirmationSent: book.data.confirmationSent === true, person: { name: person.name, email: person.email, otherSide: person.otherSide }
  };
  return { ok: true, steps, report };
}

const hasPhone = looksLikePhone;

// rows: the ops_events rows (ts as a string or Date). report: what runJourney saved. Returns { ok, problems, found }.
export function verifyRows(rows, report, opts) {
  const problems = [];
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object');
  const rep = report || {};
  if (!rep.leadRef || !rep.bookingRef) return { ok: false, problems: ['the report has no leadRef or bookingRef: run the journey first'], found: {} };

  list.forEach((r, i) => {
    const bad = validateEvent(Object.assign({}, r, { ts: new Date(r.ts), latencyMs: r.latencyMs == null || r.latencyMs === '' ? null : Number(r.latencyMs) }));
    if (bad.length) problems.push('row ' + (i + 1) + ' (' + r.automation + ' ' + r.runId + ') fails its own checks: ' + bad.join(', '));
  });

  const intake = list.filter((r) => r.automation === 'intake' && r.runId === rep.leadRef);
  const booking = list.filter((r) => r.automation === 'booking' && r.runId === rep.leadRef);
  if (intake.length !== 1) problems.push('expected exactly one intake event for ' + rep.leadRef + ', found ' + intake.length);
  else {
    const e = intake[0];
    if (e.source !== 'web') problems.push('the intake event has source ' + e.source + ', expected web');
    if (e.handoffTo !== 'booking' || e.handoffRef !== rep.leadRef) problems.push('the intake event does not hand off to booking with the lead reference');
    if (!['ok', 'needs_human'].includes(e.status)) problems.push('the intake event has status ' + e.status);
  }
  const booked = booking.filter((r) => /: booked,/.test(String(r.summary)));
  if (booked.length !== 1) problems.push('expected exactly one booked event for ' + rep.leadRef + ', found ' + booked.length + ' of ' + booking.length + ' booking events');
  else {
    const e = booked[0];
    if (e.source !== 'handoff') problems.push('the booking event has source ' + e.source + ', expected handoff');
    if (e.status !== 'ok') problems.push('the booking event has status ' + e.status);
    if (!String(e.summary).includes(rep.bookingRef)) problems.push('the booking event summary does not carry the booking reference ' + rep.bookingRef);
    if (intake.length === 1 && new Date(e.ts).getTime() < new Date(intake[0].ts).getTime()) problems.push('the booking event is older than the intake event');
  }
  chainProblems(list).forEach((p) => problems.push('chain: ' + p));

  const secrets = [rep.person && rep.person.name, rep.person && rep.person.email, rep.person && rep.person.otherSide, PERSON.name, PERSON.otherSide].filter(Boolean);
  list.forEach((r, i) => {
    const s = String(r.summary || '');
    if (s.includes('@')) problems.push('row ' + (i + 1) + ' summary has an @');
    if (hasPhone(s)) problems.push('row ' + (i + 1) + ' summary has a phone-like number');
    secrets.forEach((x) => { if (s.toLowerCase().includes(String(x).toLowerCase())) problems.push('row ' + (i + 1) + ' summary repeats private text: ' + x); });
  });

  const at = new Date((opts && opts.now) || rep.finishedAt || Date.now());
  const digest = buildDigest(list, { now: new Date(at.getTime() + 60 * 1000) });
  if (digest.counts.intake.runs < 1) problems.push('the digest counts no intake run');
  if (digest.booked < 1) problems.push('the digest counts no booked consultation');
  return { ok: problems.length === 0, problems, found: { intake: intake.length, booking: booking.length, digestBooked: digest.booked } };
}

function httpRequest(base) {
  const origin = new URL(base).origin;
  return async (method, p, body) => {
    const res = await fetch(origin + p, {
      method, headers: Object.assign({ origin, 'user-agent': 'dy-live-check' }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data };
  };
}

async function main(argv) {
  const mode = argv[0];
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  if (mode === 'journey') {
    if (!arg('--base')) { console.error('Usage: node scripts/live-check.mjs journey --base https://YOUR-SITE [--email you@yourmail] [--report file]'); return 1; }
    const r = await runJourney({ request: httpRequest(arg('--base')), email: arg('--email') || undefined });
    r.steps.forEach((s) => console.log((s.ok ? 'ok     ' : 'FAILED ') + s.step + (s.detail ? ' - ' + s.detail : '')));
    if (!r.ok) return 1;
    const file = path.resolve(arg('--report') || path.join(root, 'cutover-out', 'live-report.json'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(r.report, null, 2) + '\n');
    console.log('\nSaved ' + path.relative(root, file) + '. Now export the ops_events rows to a JSON file and run: verify --rows <file> --report <report>');
    console.log('The report holds the invented visitor only. Cancel the booking ' + r.report.bookingRef + ' in the bookings table when you are done.');
    return 0;
  }
  if (mode === 'verify') {
    if (!arg('--rows') || !arg('--report')) { console.error('Usage: node scripts/live-check.mjs verify --rows rows.json --report live-report.json'); return 1; }
    const raw = JSON.parse(fs.readFileSync(path.resolve(arg('--rows')), 'utf8'));
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : Array.isArray(raw.rows) ? raw.rows : [];
    const out = verifyRows(rows, JSON.parse(fs.readFileSync(path.resolve(arg('--report')), 'utf8')));
    console.log(out.ok ? 'PASS: the intake and booking events exist, chain by the lead reference and hold nothing private.' : 'FAIL:');
    out.problems.forEach((p) => console.log('  - ' + p));
    console.log('found:', JSON.stringify(out.found));
    return out.ok ? 0 : 1;
  }
  console.error('Usage: node scripts/live-check.mjs journey|verify ...');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
