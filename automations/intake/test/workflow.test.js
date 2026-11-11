'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadFirmData } = require('../../../firm/lib/data');
const { processIntake } = require('../lib/intake');

const root = path.join(__dirname, '..', '..', '..');
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8'));
const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
const columns = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'columns.json'), 'utf8'));
const data = loadFirmData();
const node = (name) => workflow.nodes.find((n) => n.name === name);
const NOW = setup.today + 'T12:00:00Z';

// Runs the Code node's text the way n8n would: $input.all() in, items out.
function runNode(body, wrap) {
  const code = node('Validate and score').parameters.jsCode;
  const item = { json: wrap === 'flat' ? body : { headers: {}, params: {}, query: {}, body } };
  const fn = new Function('$input', 'TEST_NOW', code);
  return fn({ all: () => [item] }, NOW);
}

test('workflow.json is exactly what the build script makes from the library', async () => {
  const mod = await import(pathToFileURL(path.join(root, 'scripts', 'build-intake-workflow.mjs')).href);
  const fresh = JSON.stringify(mod.buildWorkflow(), null, 2) + '\n';
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8').replace(/\r\n/g, '\n'), fresh,
    'out of date: run node scripts/build-intake-workflow.mjs');
});

test('the Code node returns exactly what the tested library returns, for every eval case', () => {
  for (const c of setup.cases) {
    const body = Object.assign({}, setup.defaults, c.input);
    const out = runNode(body);
    assert.strictEqual(out.length, 1, c.id);
    const got = out[0].json;
    assert.match(got.lead.ref, /^HM-261111-[A-Z0-9]{1,4}$/, c.id + ' ref format');
    const want = processIntake(body, data, { today: setup.today, ref: got.lead.ref, now: new Date(NOW).toISOString() });
    assert.deepStrictEqual(got, want, c.id);
  }
});

test('the Code node handles a body with or without the webhook wrapper, bad input and the honeypot', () => {
  const good = Object.assign({}, setup.defaults, setup.cases[0].input);
  assert.deepStrictEqual(runNode(good, 'flat')[0].json.summary.nextStep, 'book');
  assert.strictEqual(runNode(good)[0].json.summary.nextStep, 'book');
  const bad = runNode({ name: '' })[0].json;
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.name && bad.errors.email);
  assert.deepStrictEqual(runNode(Object.assign({}, good, { website: 'x' }))[0].json, { ok: true, spam: true });
  assert.strictEqual(runNode({})[0].json.ok, false);
});

test('"today" comes from the clock in the firm timezone, and a visitor cannot change it', () => {
  const code = node('Validate and score').parameters.jsCode;
  assert.match(code, /timeZone: DATA\.firm\.timezone/);
  const late = new Function('$input', 'TEST_NOW', code);
  const body = Object.assign({}, setup.defaults, setup.cases[0].input);
  // 2026-11-12 03:00 UTC is still 2026-11-11 evening in Chicago
  const r = late({ all: () => [{ json: { body } }] }, '2026-11-12T03:00:00Z')[0].json;
  assert.match(r.lead.ref, /^HM-261111-/);
  // fields a visitor might add never reach the code's clock
  const sneaky = runNode(Object.assign({}, body, { TEST_NOW: '2020-01-01', today: '2020-01-01', now: '2020-01-01' }))[0].json;
  assert.match(sneaky.lead.ref, /^HM-261111-/);
});

test('every connection points at a real node and every path to a visitor ends in a reply', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, outs] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const branch of outs.main) for (const l of branch) assert.ok(names.has(l.node), l.node);
  }
  const type = (n) => node(n).type;
  const next = (n, i) => ((workflow.connections[n] || { main: [] }).main[i || 0] || []).map((l) => l.node);
  // valid -> save -> reply; invalid -> spam? -> quiet reply or error reply
  assert.deepStrictEqual(next('Valid?', 0), ['Save lead']);
  assert.strictEqual(type(next('Save lead')[0]), 'n8n-nodes-base.respondToWebhook');
  assert.strictEqual(type(next('Spam?', 0)[0]), 'n8n-nodes-base.respondToWebhook');
  assert.strictEqual(type(next('Spam?', 1)[0]), 'n8n-nodes-base.respondToWebhook');
  assert.strictEqual(node('Reply with errors').parameters.options.responseCode, 422);
  // nothing is sent to a person before the visitor has their answer
  assert.deepStrictEqual(next('Reply to visitor'), ['Send alert?']);
  assert.deepStrictEqual(next('Send alert?', 0), ['Alert attorney on duty']);
});

test('expressions only refer to nodes and fields that exist', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  const text = JSON.stringify(workflow.nodes.filter((n) => n.name !== 'Validate and score'));
  for (const m of text.matchAll(/\$\('([^']+)'\)/g)) assert.ok(names.has(m[1]), m[1]);
  const lead = Object.keys(processIntake(Object.assign({}, setup.defaults, setup.cases[0].input), data, { today: setup.today, ref: 'R', now: NOW }).lead);
  for (const m of text.matchAll(/json\.lead\.([A-Za-z]+)/g)) assert.ok(lead.includes(m[1]), m[1]);
});

test('the lead table node maps every column, with numbers as numbers', () => {
  const p = node('Save lead').parameters;
  assert.strictEqual(p.operation, 'insert');
  assert.deepStrictEqual(Object.keys(p.columns.value).sort(), columns.map((c) => c.name).sort());
  for (const c of columns) assert.strictEqual(p.columns.schema.find((s) => s.id === c.name).type, c.type === 'number' ? 'number' : 'string');
  assert.match(p.dataTableId.value, /^REPLACE_WITH_/);
});

test('the export is safe to commit: placeholders for addresses and ids, no secrets, no real mailboxes, inactive', () => {
  const text = JSON.stringify(workflow);
  assert.match(node('Alert attorney on duty').parameters.sendTo, /^REPLACE_WITH_/);
  assert.doesNotMatch(text, /"credentials"/);
  assert.doesNotMatch(text, /gsk_|sk-[A-Za-z0-9]{10}|Bearer |password/i);
  assert.doesNotMatch(text, /wrenbook/i);
  assert.ok(!('active' in workflow) || workflow.active === false);
  assert.strictEqual(node('Intake form').parameters.authentication, 'headerAuth');
  assert.strictEqual(node('Intake form').parameters.httpMethod, 'POST');
  assert.strictEqual(workflow.settings.saveDataSuccessExecution, 'none', 'the form text stays out of execution history');
  assert.strictEqual(workflow.settings.saveDataErrorExecution, 'none');
  assert.strictEqual(node('Alert attorney on duty').parameters.options.appendAttribution, false);
});

test('the Code node has no network, file or module access', () => {
  const code = node('Validate and score').parameters.jsCode;
  assert.doesNotMatch(code, /\brequire\(|\bimport\s|\bfetch\(|XMLHttpRequest|\bprocess\.|child_process|\beval\(|new Function/);
  assert.match(code, /^\/\/ GENERATED/);
});
