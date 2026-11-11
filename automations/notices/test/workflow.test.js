'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../eval/run');
const N = require('../lib/notices');
const { loadColumns } = require('../lib/data');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8'));
const node = (name) => wf.nodes.find((n) => n.name === name);
const code = (name) => node(name).parameters.jsCode;
const plain = (x) => JSON.parse(JSON.stringify(x));
const SAMPLES = path.join(__dirname, '..', 'eval', 'samples');
const NOW = '2026-11-11T15:00:00Z';

// Run a Code node's text the way n8n would: $input and $('Node') are stubs, this.helpers reads the sample images,
// TEST_NOW and TEST_REF are plain arguments.
async function runNode(name, input, refs, nowIso, salt) {
  const fn = new AsyncFunction('$input', '$', 'TEST_NOW', 'TEST_REF', code(name));
  const $ = (n) => {
    if (!(n in (refs || {}))) throw new Error('node not available: ' + n);
    const items = refs[n];
    return { all: () => items, first: () => items[0], itemMatching: (i) => items[i] };
  };
  const helpers = { getBinaryDataBuffer: async (i, key) => fs.readFileSync(path.join(SAMPLES, input[i].binary[key].fileName)) };
  return fn.call({ helpers }, { all: () => input, first: () => input[0] }, $, nowIso || NOW, salt);
}
const upload = (names) => names.map((file) => ({ json: {}, binary: { notice: { mimeType: /\.png$/.test(file) ? 'image/png' : 'application/pdf', fileName: file } } }));
const answerOf = (text) => ({ json: { choices: [{ message: { content: text } }] } });

test('the generated "Prepare images" node builds one request per image, with a fixed ref and no date in the prompt', async () => {
  const { VISION_MODEL } = await import('../../../scripts/build-notices-workflow.mjs');
  const files = E.SET.cases.map((c) => c.file);
  const out = await runNode('Prepare images', upload(files), {}, NOW, 'test');
  assert.strictEqual(out.length, 12);
  out.forEach((o, i) => {
    assert.strictEqual(o.json.fileName, files[i]);
    assert.strictEqual(o.json.ref, 'N-20261111-TEST-' + String(i + 1).padStart(2, '0'));
    assert.strictEqual(o.json.today, '2026-11-11');
    assert.strictEqual(o.json.requestBody.model, VISION_MODEL);
    assert.deepStrictEqual(o.json.requestBody, N.noticeRequestBody(VISION_MODEL, E.DATA.prompt, o.json.requestBody.messages[0].content[1].image_url.url));
    const url = o.json.requestBody.messages[0].content[1].image_url.url;
    assert.strictEqual(url, 'data:image/png;base64,' + fs.readFileSync(path.join(SAMPLES, files[i])).toString('base64'));
    assert.strictEqual(o.pairedItem.item, i);
    assert.doesNotMatch(JSON.stringify(o.json.requestBody.messages[0].content[0]), /2026-11-1\d/);
  });
  // several files in one upload, and a pdf next to an image is skipped
  const mixed = [{ json: {}, binary: { notice_0: { mimeType: 'image/png', fileName: 'N01.png' }, notice_1: { mimeType: 'application/pdf', fileName: 'x.pdf' }, notice_2: { mimeType: 'image/png', fileName: 'N02.png' } } }];
  const two = await runNode('Prepare images', mixed, {}, NOW, 'test');
  assert.deepStrictEqual(two.map((o) => o.json.ref), ['N-20261111-TEST-01', 'N-20261111-TEST-02']);
  await assert.rejects(runNode('Prepare images', upload(['x.pdf']), {}, NOW, 'test'), /No PNG or JPG image found/);
});

test('"Prepare images" uses the firm\'s local date, and the reference is random only in production', async () => {
  const late = await runNode('Prepare images', upload(['N01.png']), {}, '2026-11-12T04:30:00Z', 'test');
  assert.strictEqual(late[0].json.today, '2026-11-11', '10:30 pm in Harlow Point is still the 11th');
  const early = await runNode('Prepare images', upload(['N01.png']), {}, '2026-11-12T06:00:00Z', 'test');
  assert.strictEqual(early[0].json.today, '2026-11-12');
  const a = (await runNode('Prepare images', upload(['N01.png']), {}, NOW))[0].json.ref;
  const b = (await runNode('Prepare images', upload(['N01.png']), {}, NOW))[0].json.ref;
  assert.match(a, /^N-20261111-[A-HJKMNP-Z2-9]{4}-01$/);
  assert.notStrictEqual(a, b);
});

test('the generated "Read and check" node gives the same row and result as the library for every labelled notice', async () => {
  const prepared = E.SET.cases.map((c, i) => ({ json: { fileName: c.file, ref: 'N-TEST-' + c.id, today: E.SET.today, now: '2026-11-11T15:00:00.000Z', requestBody: { model: 'stand-in' } } }));
  const answers = E.SET.cases.map((c) => answerOf(JSON.stringify(c.truth)));
  const out = await runNode('Read and check', answers, { 'Prepare images': prepared }, NOW);
  assert.strictEqual(out.length, 12);
  E.SET.cases.forEach((c, i) => {
    const want = N.noticeAssess(JSON.stringify(c.truth), { today: E.SET.today, now: '2026-11-11T15:00:00.000Z', ref: 'N-TEST-' + c.id, fileName: c.file, model: 'stand-in', modelFailed: false }, E.DATA);
    assert.deepStrictEqual(plain(out[i].json.row), plain(want.row), c.id);
    assert.deepStrictEqual(plain(out[i].json.result), plain({ alert: want.alert, priority: want.priority, reasons: want.reasons, flags: want.flags, earliest: want.earliest, event: want.event }), c.id);
    assert.strictEqual(out[i].json.row.status, 'Needs attorney confirmation');
    assert.strictEqual(out[i].json.result.priority, c.expect.priority, c.id);
    assert.strictEqual(out[i].pairedItem.item, i);
  });
});

test('"Read and check" turns a failed model call, an error body and an empty answer into an urgent read, never a silence', async () => {
  const prepared = [0, 1, 2, 3].map((i) => ({ json: { fileName: 'f' + i + '.png', ref: 'N-T-' + i, today: E.SET.today, now: '2026-11-11T15:00:00.000Z', requestBody: { model: 'm' } } }));
  const answers = [{ json: { error: 'rate limited' } }, { json: { error: { message: 'x' }, choices: [{ message: { content: JSON.stringify(E.SET.cases[0].truth) } }] } }, { json: {} }, answerOf('Sorry, I cannot read this.')];
  const out = await runNode('Read and check', answers, { 'Prepare images': prepared }, NOW);
  out.forEach((o, i) => {
    assert.strictEqual(o.json.result.priority, 'urgent', 'answer ' + i);
    assert.deepStrictEqual(o.json.result.reasons, ['read_failed']);
    assert.strictEqual(o.json.row.status, 'Needs attorney confirmation');
    assert.strictEqual(o.json.row.ref, 'N-T-' + i);
    assert.strictEqual(o.json.result.alert, true);
  });
});

test('the generated "Collect urgent alert" node makes one alert for the run, or none, and reports a row that was not saved', async () => {
  const prepared = E.SET.cases.map((c) => ({ json: { fileName: c.file, ref: 'N-TEST-' + c.id, today: E.SET.today, now: '2026-11-11T15:00:00.000Z', requestBody: { model: 'stand-in' } } }));
  const read = await runNode('Read and check', E.SET.cases.map((c) => answerOf(JSON.stringify(c.truth))), { 'Prepare images': prepared }, NOW);
  const saved = read.map((_, i) => ({ json: { id: i + 1 } }));
  const one = await runNode('Collect urgent alert', saved, { 'Read and check': read }, NOW);
  assert.strictEqual(one.length, 1, 'exactly one email for the whole upload');
  assert.strictEqual(one[0].json.count, 8);
  assert.match(one[0].json.subject, /\(8\)$/);
  E.SET.cases.forEach((c) => assert.strictEqual(one[0].json.text.indexOf('N-TEST-' + c.id) !== -1, c.expect.priority === 'urgent', c.id));
  assert.doesNotMatch(one[0].json.text, /could not be saved/);
  // the row for N01 could not be saved
  const broken = saved.map((s, i) => (i === 0 ? { json: { error: 'table gone' } } : s));
  const warn = await runNode('Collect urgent alert', broken, { 'Read and check': read }, NOW);
  assert.strictEqual((warn[0].json.text.match(/could not be saved/g) || []).length, 1);
  assert.ok(warn[0].json.text.indexOf('N-TEST-N01') < warn[0].json.text.indexOf('could not be saved') && warn[0].json.text.indexOf('could not be saved') < warn[0].json.text.indexOf('N-TEST-N03'));
  // nothing urgent: no item, so the email node does not run
  const calm = read.filter((r) => !r.json.result.alert);
  const none = await runNode('Collect urgent alert', calm.map((_, i) => ({ json: { id: i } })), { 'Read and check': calm }, NOW);
  assert.deepStrictEqual(none, []);
});

test('a whole upload through all four Code nodes with a perfect stand-in model: 12 rows, none confirmed, 8 in the alert', async () => {
  const files = E.SET.cases.map((c) => c.file);
  const prepared = await runNode('Prepare images', upload(files), {}, NOW, 'test');
  const byFile = Object.fromEntries(E.SET.cases.map((c) => [c.file, c]));
  const answers = prepared.map((p) => answerOf(JSON.stringify(byFile[p.json.fileName].truth)));
  const read = await runNode('Read and check', answers, { 'Prepare images': prepared }, NOW);
  assert.ok(read.every((r) => r.json.row.status === 'Needs attorney confirmation' && r.json.row.confirmedBy === ''));
  const alert = await runNode('Collect urgent alert', read.map((_, i) => ({ json: { id: i + 1 } })), { 'Read and check': read }, NOW);
  assert.strictEqual(alert[0].json.count, 8);
  const scored = require('../eval/score').scoreAll(E.SET.cases, Object.fromEntries(read.map((r, i) => [E.SET.cases[i].id, r.json.row])));
  assert.deepStrictEqual([scored.approved, scored.missedUrgent, scored.wrongPriority, scored.wrongEarliest], [0, 0, 0, 0]);
});

test('the workflow shape: one authenticated upload form, one model call, one table, one email', () => {
  assert.strictEqual(wf.name, 'Dyzania Records - Court notice reading');
  const chain = ['Notice Upload Form', 'Prepare images', 'Ask vision model (OpenRouter)', 'Read and check', 'Save to court_notices', 'Collect urgent alert', 'Send urgent alert'];
  chain.forEach((n, i) => {
    const next = ((wf.connections[n] || {}).main || [])[0];
    if (i === chain.length - 1) assert.strictEqual(next, undefined, 'the email is the end');
    else assert.ok(next.map((l) => l.node).includes(chain[i + 1]), n);
  });
  // the alert path is the chain above; the ops event hangs beside it from the saved rows, so it cannot stop the alert
  assert.deepStrictEqual(wf.connections['Save to court_notices'].main[0].map((l) => l.node), ['Collect urgent alert', 'Build ops event']);
  assert.deepStrictEqual(wf.connections['Build ops event'].main[0].map((l) => l.node), ['Log ops event']);
  assert.strictEqual(wf.connections['Log ops event'], undefined, 'the ops log is the end of its branch');
  assert.deepStrictEqual(Object.keys(wf.connections).sort(), chain.slice(0, -1).concat(['Build ops event']).sort());
  const form = node('Notice Upload Form');
  assert.strictEqual(form.type, 'n8n-nodes-base.formTrigger');
  assert.strictEqual(form.parameters.authentication, 'basicAuth', 'notices are privileged: the form is not public');
  assert.deepStrictEqual(form.parameters.formFields.values.map((f) => [f.fieldType, f.multipleFiles, f.acceptFileTypes, f.requiredField]), [['file', true, '.png,.jpg,.jpeg', true]]);
  assert.match(form.parameters.formDescription, /fictional/);
  assert.match(form.parameters.formDescription, /Nothing is confirmed until an attorney confirms it/);
  assert.match(form.parameters.options.formSubmittedText, /Needs attorney confirmation/);
  const ask = node('Ask vision model (OpenRouter)');
  assert.strictEqual(ask.parameters.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(ask.parameters.jsonBody, '={{ $json.requestBody }}');
  assert.strictEqual(ask.onError, 'continueRegularOutput', 'a failed call must reach the rules as a failed read, not stop the run');
  assert.deepStrictEqual([ask.retryOnFail, ask.maxTries], [true, 3]);
  assert.deepStrictEqual(wf.nodes.filter((n) => /httpRequest/i.test(n.type)).map((n) => n.name), ['Ask vision model (OpenRouter)'], 'the only outside call is the model');
  const sends = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.strictEqual(sends.length, 1, 'one email node only');
  assert.strictEqual(sends[0].parameters.operation, 'send');
  assert.strictEqual(sends[0].parameters.sendTo, 'REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS', 'the recipient is fixed, never taken from a page');
  assert.strictEqual(sends[0].parameters.message, '={{ $json.text }}');
  assert.strictEqual(sends[0].onError, 'continueRegularOutput');
  assert.strictEqual(node('Save to court_notices').onError, 'continueRegularOutput', 'a failed save must not swallow an urgent alert');
});

test('the table node uses exactly the declared columns; no credentials, ids or secrets are stored', () => {
  const cols = loadColumns().map((c) => c.name);
  const save = node('Save to court_notices');
  assert.deepStrictEqual(Object.keys(save.parameters.columns.value), cols);
  assert.deepStrictEqual(save.parameters.columns.schema.map((s) => s.id), cols);
  Object.entries(save.parameters.columns.value).forEach(([k, v]) => assert.strictEqual(v, '={{ $json.row.' + k + ' }}'));
  assert.strictEqual(save.parameters.columns.schema.find((s) => s.id === 'daysAtReceipt').type, 'number');
  assert.deepStrictEqual(cols.filter((c) => !(c in E.assess('C', JSON.stringify(E.SET.cases[0].truth)).row)), [], 'every column is filled by the rules');
  const text = JSON.stringify(wf);
  wf.nodes.forEach((n) => Object.values(n.credentials || {}).forEach((c) => assert.deepStrictEqual(Object.keys(c), ['name'], n.name + ' names a credential without an id')));
  assert.deepStrictEqual(Array.from(new Set(text.match(/REPLACE_WITH_[A-Z_]+/g))).sort(), ['REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS', 'REPLACE_WITH_COURT_NOTICES_TABLE_ID', 'REPLACE_WITH_OPS_EVENTS_TABLE_ID']);
  assert.doesNotMatch(text, /sk-|gsk_|AIza|xox[bp]-|Bearer /);
  assert.deepStrictEqual({ a: wf.settings.saveDataSuccessExecution, b: wf.settings.saveDataErrorExecution, c: wf.settings.saveExecutionProgress, d: wf.settings.binaryMode }, { a: 'none', b: 'none', c: false, d: 'separate' });
});

// ---- the ops event ----
const opsAdapters = require('../../ops/lib/adapters');
const opsEvent = require('../../ops/lib/event');
const opsSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'ops_events.schema.json'), 'utf8'));

async function readAll() {
  const prepared = E.SET.cases.map((c) => ({ json: { fileName: c.file, ref: 'N-TEST-' + c.id, today: E.SET.today, now: '2026-11-11T15:00:00.000Z', requestBody: { model: 'stand-in' } } }));
  return runNode('Read and check', E.SET.cases.map((c) => answerOf(JSON.stringify(c.truth))), { 'Prepare images': prepared }, NOW);
}

test('the ops event node gives the row the library gives for every notice, and no private text from the page', async () => {
  const read = await readAll();
  const saved = read.map((_, i) => ({ json: { id: i + 1 } }));
  const out = await runNode('Build ops event', saved, { 'Read and check': read }, NOW);
  assert.strictEqual(out.length, 12);
  E.SET.cases.forEach((c, i) => {
    const want = opsAdapters.noticeEvent(read[i].json.result, { now: new Date(NOW) });
    assert.deepStrictEqual(out[i].json.row, opsEvent.toRow(want.event), c.id);
    assert.deepStrictEqual(Object.keys(out[i].json.row), opsSchema.columns.map((x) => x.name));
    assert.strictEqual(out[i].json.row.status, 'needs_human', c.id);
    assert.strictEqual(out[i].json.row.runId, 'N-TEST-' + c.id);
    assert.deepStrictEqual(out[i].pairedItem, { item: i });
    const t = c.truth;
    const text = JSON.stringify(out[i].json.row).toLowerCase();
    [t.court, t.caseNumber, t.partyOne, t.partyTwo].concat(t.events.map((e) => e.label), t.events.map((e) => e.location), t.relativeDeadlines || []).forEach((x) => { if (x && x.length >= 4) assert.ok(!text.includes(String(x).toLowerCase()), c.id + ' repeats ' + x); });
  });
});

test('a notice whose table row could not be saved is logged as an error, because nobody can find it; the others are unaffected', async () => {
  const read = await readAll();
  const saved = read.map((_, i) => (i === 2 ? { json: { error: 'table gone' } } : i === 5 ? { json: {} } : { json: { id: i + 1 } }));
  const out = await runNode('Build ops event', saved, { 'Read and check': read }, NOW);
  assert.deepStrictEqual(out.map((o) => o.json.row.status), read.map((_, i) => (i === 2 || i === 5 ? 'error' : 'needs_human')));
  assert.match(out[2].json.row.summary, /was read but its table row could not be saved/);
  assert.strictEqual(out[2].json.row.runId, 'N-TEST-' + E.SET.cases[2].id);
  // the alert still comes out whether or not the ops branch ran
  const alert = await runNode('Collect urgent alert', saved, { 'Read and check': read }, NOW);
  assert.strictEqual(alert.length, 1);
});

test('the ops log writes the table the schema describes, continues on failure, and ends its own branch', () => {
  const log = node('Log ops event');
  assert.strictEqual(log.parameters.operation, 'insert');
  assert.strictEqual(log.onError, 'continueRegularOutput');
  assert.strictEqual(log.parameters.dataTableId.value, 'REPLACE_WITH_OPS_EVENTS_TABLE_ID');
  assert.deepStrictEqual(Object.keys(log.parameters.columns.value), opsSchema.columns.map((x) => x.name));
  const text = code('Build ops event');
  assert.match(text, /^\/\/ GENERATED by scripts\/build-notices-workflow\.mjs/);
  assert.doesNotMatch(text, /\brequire\(|module\.exports|\bfetch\(|\bprocess\./);
  assert.strictEqual(wf.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail').length, 1, 'logging adds no email node');
});

test('the library has no clock and no randomness of its own; the Code nodes are the library plus a few glue lines', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'notices.js'), 'utf8');
  assert.doesNotMatch(lib, /Date\.now\(|new Date\(\)|Math\.random|process\.|fetch\(|require\((?!'\.\.\/\.\.\/\.\.\/firm\/lib\/urgency')/);
  ['Prepare images', 'Read and check', 'Collect urgent alert'].forEach((n) => {
    const c = code(n);
    assert.match(c, /^\/\/ GENERATED by scripts\/build-notices-workflow\.mjs/);
    assert.doesNotMatch(c, /\brequire\(|module\.exports/);
    assert.ok(c.indexOf('function noticeAssess(') !== -1 && c.indexOf('function extractDates(') !== -1 && c.indexOf('const DATA = {') !== -1, n);
    const names = (c.match(/^(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/gm) || []).map((s) => s.split(' ').pop());
    assert.deepStrictEqual(names.filter((x, i) => names.indexOf(x) !== i), [], n + ' has a name declared twice');
  });
  assert.strictEqual((code('Prepare images').match(/Math\.random/g) || []).length, 1, 'randomness only in the reference glue');
  assert.strictEqual((code('Read and check').match(/Math\.random/g) || []).length, 0);
  // the one place the status word is written is the library constant
  const libCode = lib.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.strictEqual((libCode.match(/Needs attorney confirmation/g) || []).length, 1);
  assert.match(libCode, /const NOTICE_STATUS = 'Needs attorney confirmation';/);
  const statusValues = Array.from(libCode.matchAll(/\bstatus\s*(?::|=)\s*([^,;\s}]+)/g)).map((m) => m[1]);
  assert.ok(statusValues.length >= 3, 'the library does set the status');
  assert.deepStrictEqual(statusValues.filter((v) => v !== 'NOTICE_STATUS'), [], 'every status the library sets is the constant');
});

test('the prompt inside the workflow is the prompt file, and the model is named in one place', async () => {
  const { VISION_MODEL, dataObject } = await import('../../../scripts/build-notices-workflow.mjs');
  assert.strictEqual(dataObject().prompt, E.DATA.prompt);
  assert.ok(code('Prepare images').indexOf(E.DATA.prompt.split('\n')[0]) !== -1);
  assert.strictEqual((code('Prepare images').match(new RegExp(VISION_MODEL.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'), 'g')) || []).length, 1);
  assert.strictEqual(code('Read and check').indexOf(VISION_MODEL), -1, 'the other nodes read the model name from the request');
});

test('the workflow file on disk is what the builder produces from the library today', async () => {
  const { buildWorkflow } = await import('../../../scripts/build-notices-workflow.mjs');
  assert.strictEqual(JSON.stringify(buildWorkflow(), null, 2) + '\n', fs.readFileSync(path.join(__dirname, '..', 'workflow.json'), 'utf8').replace(/\r\n/g, '\n'));
});
