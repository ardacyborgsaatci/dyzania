#!/usr/bin/env node
// Runs eval/emails.json through the live demo webhook and writes metrics.
// Usage: node run-eval.js [--ids E01,E02] [--limit 10] [--no-site] [--delay-ms 30000]
// The free Groq tier allows about 8,000 tokens per minute per model, so the runner waits 30 s between emails
// by default and retries 429/502/503 answers. Use --delay-ms 0 to disable the pause on a paid model.
// Config: TRIAGE_URL and TRIAGE_SECRET from the environment or from eval/.env.local
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function parseArgs(argv) {
  const args = { ids: null, limit: Infinity, site: true, delayMs: 30000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ids') args.ids = argv[++i].split(',');
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--no-site') args.site = false;
    else if (argv[i] === '--delay-ms') args.delayMs = Number(argv[++i]);
  }
  return args;
}

async function triage(email, url, secret) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Triage-Secret': secret },
    body: JSON.stringify({ source: 'eval', ipHash: 'eval', sampleId: '', from: email.from, subject: email.subject, body: email.body }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, data, roundTripMs: Date.now() - started };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : null; };

function summarize(rows) {
  const ok = rows.filter((r) => r.actual);
  const labels = [...new Set(rows.map((r) => r.expect.category).concat(ok.map((r) => r.actual.category)))].sort();
  const matrix = labels.map((e) => labels.map((a) => ok.filter((r) => r.expect.category === e && r.actual.category === a).length));
  const perCategory = {};
  for (const l of labels) {
    const of = rows.filter((r) => r.expect.category === l);
    perCategory[l] = { total: of.length, correct: of.filter((r) => r.actual && r.actual.category === l).length };
  }
  const needs = rows.filter((r) => r.expect.needsHuman);
  const notNeeds = rows.filter((r) => !r.expect.needsHuman);
  const inj = rows.filter((r) => r.expect.injection);
  const notInj = rows.filter((r) => !r.expect.injection);
  const mustSkip = rows.filter((r) => r.expect.injection || r.expect.category === 'spam' || r.tags.includes('ooo'));
  const lat = ok.map((r) => r.actual.latencyMs).filter(Number.isFinite);
  return {
    generatedAt: new Date().toISOString(),
    promptVersion: ok.length ? ok[0].actual.promptVersion : null,
    models: ok.length ? ok[0].actual.models || null : null,
    total: rows.length,
    answered: ok.length,
    errors: rows.length - ok.length,
    categoryAccuracy: pct(ok.filter((r) => r.actual.category === r.expect.category).length, rows.length),
    priorityExact: pct(ok.filter((r) => r.actual.priority === r.expect.priority).length, rows.length),
    priorityWithinOne: pct(ok.filter((r) => Math.abs(PRIORITIES.indexOf(r.actual.priority) - PRIORITIES.indexOf(r.expect.priority)) <= 1).length, rows.length),
    needsHumanRecall: pct(needs.filter((r) => r.actual && r.actual.needsHuman).length, needs.length),
    needsHumanFalseFlagRate: pct(notNeeds.filter((r) => r.actual && r.actual.needsHuman).length, notNeeds.length),
    injectionRecall: pct(inj.filter((r) => r.actual && r.actual.injectionSuspected).length, inj.length),
    injectionFalsePositives: notInj.filter((r) => r.actual && r.actual.injectionSuspected).length,
    unsafeDrafts: mustSkip.filter((r) => r.actual && r.actual.draftStatus !== 'skipped').length,
    holdingReplies: ok.filter((r) => r.actual.draftStatus === 'holding_reply').length,
    medianLatencyMs: median(lat),
    p95LatencyMs: p95(lat),
    perCategory,
    confusion: { labels, matrix },
  };
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env.local'));
  const url = process.env.TRIAGE_URL;
  const secret = process.env.TRIAGE_SECRET;
  if (!url || !secret) {
    console.error('Set TRIAGE_URL and TRIAGE_SECRET (environment or eval/.env.local). See .env.example.');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  let emails = JSON.parse(fs.readFileSync(path.join(ROOT, 'emails.json'), 'utf8'));
  if (args.ids) emails = emails.filter((e) => args.ids.includes(e.id));
  emails = emails.slice(0, args.limit);

  const rows = [];
  for (const email of emails) {
    let actual = null;
    let note = '';
    try {
      let r = await triage(email, url, secret);
      for (let attempt = 0; attempt < 3 && [429, 502, 503].includes(r.status); attempt++) {
        const wait = Math.max(30, Math.min(120, Number(r.data && r.data.retryAfterSec) || 60));
        console.log('  HTTP ' + r.status + ' for ' + email.id + ', waiting ' + wait + 's before retry ' + (attempt + 1));
        await sleep(wait * 1000);
        r = await triage(email, url, secret);
      }
      if (r.status === 200 && r.data && r.data.category) actual = { ...r.data, roundTripMs: r.roundTripMs };
      else note = 'HTTP ' + r.status;
    } catch (err) {
      note = err.message;
    }
    rows.push({ id: email.id, tags: email.tags, subject: email.subject, expect: email.expect, actual, note });
    const flag = actual ? (actual.category === email.expect.category ? 'ok ' : 'MISS') : 'ERR ';
    console.log(`${flag} ${email.id} expected ${email.expect.category}/${email.expect.priority} got ${actual ? actual.category + '/' + actual.priority : note}`);
    if (args.delayMs > 0 && email !== emails[emails.length - 1]) await sleep(args.delayMs);
  }

  const summary = summarize(rows);
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify({ summary, rows }, null, 2) + '\n');
  if (args.site && !args.ids && !Number.isFinite(args.limit)) {
    const siteFile = path.join(ROOT, '..', 'website', 'data', 'eval-results.json');
    fs.mkdirSync(path.dirname(siteFile), { recursive: true });
    fs.writeFileSync(siteFile, JSON.stringify(summary, null, 2) + '\n');
  }
  const { confusion, perCategory, ...headline } = summary;
  console.log('\n' + JSON.stringify(headline, null, 2));
}

module.exports = { summarize };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
