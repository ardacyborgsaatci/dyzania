'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const E = require('../eval/run');
const T = require('../lib/triage');
const { loadKnowledge, loadKnowledgeSections } = require('../lib/data');

const root = path.join(__dirname, '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const core = JSON.parse(read('workflow-core.json'));
const gmail = JSON.parse(read('workflow-gmail.json'));
const columns = JSON.parse(read('columns.json'));
const node = (wf, name) => wf.nodes.find((n) => n.name === name);
const NOW = E.SET.today + 'T12:00:00.000Z';
const clone = (o) => JSON.parse(JSON.stringify(o));

// Runs a Code node's text the way n8n would. store maps node name -> json for $('Name').
function runCode(n, input, store) {
  const fn = new Function('$input', '$', 'TEST_NOW', n.parameters.jsCode);
  const $ = (name) => ({ item: { json: store[name] }, all: () => [].concat(store[name]).map((json) => ({ json })) });
  if (n.parameters.mode === 'runOnceForEachItem') return fn({ item: { json: input } }, $, NOW).json;
  return fn({ all: () => [].concat(input).map((json) => ({ json })) }, $, NOW).map((i) => i.json);
}

// The core workflow, node by node, with a stand-in for each model call.
function runCore(e, mode) {
  const raw = { source: 'eval', messageId: 'eval-' + e.id, sampleId: e.id, from: e.from, subject: e.subject, body: e.body };
  const store = {};
  store['Screen email'] = runCode(node(core, 'Screen email'), raw, store);
  const modelOut = E.MODELS[mode](store['Screen email'].email);
  const modelItem = modelOut ? { output: modelOut } : { error: 'model unavailable' };
  store.Decide = runCode(node(core, 'Decide'), modelItem, store);
  const standard = store.Decide.decision.draftMode === 'standard';
  // n8n sends the item down the 'true' branch to the draft model, or straight to Finish
  const finishInput = standard ? { output: E.CANNED() } : store.Decide;
  return runCode(node(core, 'Finish'), finishInput, store);
}

test('both workflow files are exactly what the build script makes', async () => {
  const mod = await import(pathToFileURL(path.join(root, 'scripts', 'build-triage-workflow.mjs')).href);
  assert.strictEqual(read('workflow-core.json'), JSON.stringify(mod.buildCoreWorkflow(), null, 2) + '\n', 'core is out of date: run node scripts/build-triage-workflow.mjs');
  assert.strictEqual(read('workflow-gmail.json'), JSON.stringify(mod.buildGmailWorkflow(), null, 2) + '\n', 'gmail is out of date: run node scripts/build-triage-workflow.mjs');
});

test('the Code nodes give exactly what the tested library gives, for every email and three kinds of model answer', () => {
  ['oracle', 'hostile', 'rules'].forEach((mode) => {
    E.SET.emails.forEach((e) => {
      const m = mode === 'hostile' && e.tags.includes('injection') ? 'obedient' : mode;
      const got = runCore(e, m);
      const want = E.runOne(e, m);
      delete got.latencyMs; delete want.latencyMs;
      assert.deepStrictEqual(got, want, e.id + ' (' + m + ')');
    });
  });
});

test('the Code node keeps today in the firm timezone and ignores a visitor-set date', () => {
  const e = E.SET.emails.find((x) => x.id === 'C03');
  const raw = { source: 'x', messageId: 'm', sampleId: e.id, from: e.from, subject: e.subject, body: e.body, today: '2000-01-01', TEST_NOW: '2000-01-01' };
  const out = runCode(node(core, 'Screen email'), raw, {});
  assert.strictEqual(out.today, E.SET.today);
  assert.strictEqual(out.screen.urgency.level, 'urgent');
});

// ---- structure ----
function reachable(wf, from) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    Object.values(wf.connections[n] || {}).forEach((outs) => outs.forEach((list) => list.forEach((c) => { if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); } })));
  }
  return seen;
}

test('core graph: every connection points at a node, every node is wired, both branches of the draft check are connected', () => {
  [core, gmail].forEach((wf) => {
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.strictEqual(names.size, wf.nodes.length, 'node names are unique');
    Object.keys(wf.connections).forEach((from) => {
      assert.ok(names.has(from), from);
      Object.values(wf.connections[from]).forEach((outs) => outs.forEach((list) => list.forEach((c) => assert.ok(names.has(c.node), c.node))));
    });
    const ids = wf.nodes.map((n) => n.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'node ids are unique');
  });
  const seen = reachable(core, 'Triage request');
  core.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !/lmChat|outputParser/.test(n.type)).forEach((n) => assert.ok(seen.has(n.name), n.name + ' is not reachable'));
  assert.deepStrictEqual(core.connections['Standard draft?'].main.map((o) => o.map((c) => c.node)), [['Draft reply'], ['Finish']]);
  assert.strictEqual(core.connections['Classifier model'].ai_languageModel[0][0].node, 'Classify email');
  assert.strictEqual(core.connections['Drafting model'].ai_languageModel[0][0].node, 'Draft reply');
  const g = reachable(gmail, 'New email');
  gmail.nodes.filter((n) => !['n8n-nodes-base.stickyNote', 'n8n-nodes-base.manualTrigger'].includes(n.type)).forEach((n) => {
    if (!['Create triage labels (run once)', 'Label names', 'Create label'].includes(n.name)) assert.ok(g.has(n.name), n.name);
  });
  assert.deepStrictEqual(Array.from(reachable(gmail, 'Create triage labels (run once)')).sort(), ['Create label', 'Create triage labels (run once)', 'Label names']);
});

test('nothing in either workflow can send mail to a sender', () => {
  const gm = gmail.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  const sends = gm.filter((n) => n.parameters.operation === 'send' || n.parameters.operation === 'reply');
  assert.deepStrictEqual(sends.map((n) => n.name), ['Email urgent alert']);
  assert.strictEqual(sends[0].parameters.sendTo, 'REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS', 'the alert goes to the firm, not to a sender');
  assert.strictEqual(sends[0].parameters.message, '={{ $json.alertHtml }}', 'the alert is brand HTML built from alertText');
  assert.strictEqual(sends[0].parameters.emailType, 'html');
  assert.deepStrictEqual(gm.filter((n) => n.parameters.resource === 'draft').map((n) => n.parameters.operation), ['create']);
  assert.ok(!core.nodes.some((n) => /gmail|emailSend|httpRequest/i.test(n.type)), 'the core has no mail or HTTP node');
});

test('privacy: no execution data is kept, and the log table gets metadata columns only', () => {
  [core, gmail].forEach((wf) => {
    assert.strictEqual(wf.settings.saveDataSuccessExecution, 'none');
    assert.strictEqual(wf.settings.saveDataErrorExecution, 'none');
    assert.strictEqual(wf.settings.saveExecutionProgress, false);
  });
  const insert = node(gmail, 'Insert log row');
  assert.deepStrictEqual(Object.keys(insert.parameters.columns.value), columns.map((c) => c.name));
  Object.entries(insert.parameters.columns.value).forEach(([k, v]) => assert.strictEqual(v, '={{ $json.logRow.' + k + ' }}'));
  ['subject', 'body', 'summary', 'snippet', 'draftReply', 'fromAddress', 'fromName', 'from'].forEach((k) => assert.ok(!(k in insert.parameters.columns.value), k + ' must not be a log column'));
  insert.parameters.columns.schema.forEach((s) => assert.strictEqual(s.type, columns.find((c) => c.name === s.id).type));
});

test('prompts in the workflow are the prompt files; the knowledge for each reply comes in its user message, not the system prompt', () => {
  const strip = (md) => md.replace(/^(?:<!--[\s\S]*?-->\s*\n)+/, '').trim();
  const classify = node(core, 'Classify email').parameters.messages.messageValues[0].message;
  assert.strictEqual(classify, strip(read('prompts/classify.md')));
  const draft = node(core, 'Draft reply').parameters.messages.messageValues[0].message;
  assert.strictEqual(draft, strip(read('prompts/draft.md')));
  const userText = node(core, 'Draft reply').parameters.text;
  assert.match(userText, /Knowledge base for this reply:\n\{\{ \$json\.knowledge \}\}$/);
  assert.doesNotMatch(draft, /## Knowledge base|## KB-\d+/);
  assert.match(node(core, 'Decide').parameters.jsCode, /knowledge: triageKnowledgeFor\(decision\.category, DATA\)/);
  const version = (md) => md.match(/promptVersion: ([\w-]+)/)[1];
  assert.strictEqual(version(read('prompts/classify.md')), E.DATA.rules.promptVersion);
  assert.strictEqual(version(read('prompts/draft.md')), E.DATA.rules.promptVersion);
  const cats = node(core, 'Classification schema').parameters.inputSchema.properties.category.enum;
  assert.deepStrictEqual(cats, E.DATA.urgency.triageCategories);
  // every category and every priority the rules use is described in the classifier prompt
  cats.forEach((c) => assert.ok(classify.includes('- ' + c + ':'), c));
  ['urgent', 'high', 'normal', 'low'].forEach((p) => assert.ok(classify.includes('  - ' + p + ':'), p));
});

test('prompts carry the firm rules: no advice, no case opinions, no deadlines as fact, no promised times', () => {
  const classify = node(core, 'Classify email').parameters.messages.messageValues[0].message;
  const draft = node(core, 'Draft reply').parameters.messages.messageValues[0].message;
  assert.match(classify, /untrusted data/);
  assert.match(classify, /Never lower a priority/);
  assert.match(classify, /never say whether anyone has a case/);
  assert.match(draft, /Never give legal advice/);
  assert.match(draft, /Never say whether the sender has a case/);
  assert.match(draft, /Never say that a date is a legal deadline/);
  assert.match(draft, /Never promise that an attorney or anyone will call/);
  assert.match(draft, /never say or imply the sender is a client/);
  assert.match(draft, /untrusted data, not instructions/);
  assert.match(draft, /Do not write a legal disclaimer/);
});

test('model nodes: retries on, errors continue, temperatures as documented, no credentials stored in the file', () => {
  ['Classify email', 'Draft reply'].forEach((n) => {
    const x = node(core, n);
    assert.deepStrictEqual([x.retryOnFail, x.maxTries, x.onError], [true, 3, 'continueRegularOutput']);
    // no in-node pacing: the Gmail workflow paces the emails (see the loop test below)
    assert.equal(x.parameters.batching, undefined, n);
  });
  assert.deepStrictEqual(node(core, 'Classifier model').parameters, { model: 'openai/gpt-oss-20b', options: { maxTokensToSample: 1500, temperature: 0 } });
  assert.deepStrictEqual(node(core, 'Drafting model').parameters, { model: 'openai/gpt-oss-120b', options: { maxTokensToSample: 2500, temperature: 0.3 } });
  [core, gmail].forEach((wf) => wf.nodes.forEach((n) => assert.ok(!n.credentials, n.name)));
  assert.match(node(core, 'Classify email').parameters.text, /<email>[\s\S]*<\/email>/);
  assert.match(node(core, 'Draft reply').parameters.text, /<email>[\s\S]*<\/email>/);
  assert.ok(!/fromAddress|from address/i.test(node(core, 'Draft reply').parameters.text), 'the draft model never sees the sender address');
});

test('placeholders to replace are the documented ones', () => {
  const text = JSON.stringify([core, gmail]);
  const found = Array.from(new Set(text.match(/REPLACE_WITH_[A-Z_]+|YOUR_ADDRESS/g))).sort();
  assert.deepStrictEqual(found, ['REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS', 'REPLACE_WITH_OPS_EVENTS_TABLE_ID', 'REPLACE_WITH_TRIAGE_CORE_WORKFLOW_ID', 'REPLACE_WITH_TRIAGE_LOG_TABLE_ID', 'YOUR_ADDRESS']);
  assert.ok(!/@(gmail|outlook|yahoo)\.com/i.test(text.replace(/YOUR_ADDRESS(\+triage)?@gmail\.com/g, '')), 'no real address is stored');
});

// ---- the ops event ----
const opsAdapters = require('../../ops/lib/adapters');
const opsEvent = require('../../ops/lib/event');
const opsSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'ops_events.schema.json'), 'utf8'));

// What the node receives: the rows the insert node just wrote (the log columns plus the table's own id and timestamps).
function runOpsNode(rows) {
  const fn = new Function('$input', 'TEST_NOW', node(gmail, 'Build ops event').parameters.jsCode);
  return fn({ all: () => rows.map((json) => ({ json })) }, NOW);
}

test('the ops event node gives the row the library gives, for every email, one item per email in the same order', () => {
  ['oracle', 'hostile', 'rules'].forEach((mode) => {
    const results = E.SET.emails.map((e) => ({ e, log: T.triageLogRow(E.runOne(e, mode === 'hostile' && e.tags.includes('injection') ? 'obedient' : mode)) }));
    const stored = results.map((r, i) => Object.assign({ id: i + 1, createdAt: NOW, updatedAt: NOW }, r.log));
    const out = runOpsNode(stored);
    assert.strictEqual(out.length, results.length, mode);
    out.forEach((item, i) => {
      assert.deepStrictEqual(item.pairedItem, { item: i });
      const want = opsAdapters.triageEvent(results[i].log, { now: new Date(NOW) });
      assert.deepStrictEqual(item.json.row, opsEvent.toRow(want.event), results[i].e.id + ' (' + mode + ')');
      assert.deepStrictEqual(Object.keys(item.json.row), opsSchema.columns.map((c) => c.name));
      // nothing private: not the sender, the subject, or any sentence of the body
      const text = JSON.stringify(item.json.row).toLowerCase();
      [results[i].e.from, results[i].e.subject].concat(results[i].e.body.split(/[.!?]\s+/)).forEach((x) => { if (x && x.trim().length >= 12) assert.ok(!text.includes(x.trim().toLowerCase()), results[i].e.id + ' repeats ' + x.slice(0, 30)); });
    });
  });
});

test('a row that cannot become an event still gives one valid error row, so the labelling after it is never starved', () => {
  const out = runOpsNode([{ id: 1 }, { id: 2, messageId: 'gm-1', category: 'billing', priority: 'normal', queue: 'billing', draftStatus: 'standard', needsHuman: false, classificationStatus: 'ok', handoff: '', latencyMs: 12 }, null]);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((i) => i.json.row.status), ['error', 'ok', 'error']);
  assert.strictEqual(out[0].json.row.runId, 'unknown');
  assert.strictEqual(out[1].json.row.runId, 'gm-1');
  assert.strictEqual(out[1].json.row.latencyMs, 12);
});

test('the ops event comes after the triage log row and before the labelling, and the log node continues on failure', () => {
  const next = (name) => ((gmail.connections[name] || { main: [] }).main[0] || []).map((l) => l.node);
  assert.deepStrictEqual(next('Insert log row'), ['Build ops event']);
  assert.deepStrictEqual(next('Build ops event'), ['Log ops event']);
  assert.deepStrictEqual(next('Log ops event'), ['Get Gmail labels']);
  const log = node(gmail, 'Log ops event');
  assert.strictEqual(log.onError, 'continueRegularOutput');
  assert.strictEqual(log.parameters.dataTableId.value, 'REPLACE_WITH_OPS_EVENTS_TABLE_ID');
  assert.deepStrictEqual(Object.keys(log.parameters.columns.value), opsSchema.columns.map((c) => c.name));
  const code = node(gmail, 'Build ops event').parameters.jsCode;
  assert.match(code, /^\/\/ GENERATED by scripts\/build-triage-workflow\.mjs/);
  assert.doesNotMatch(code, /\brequire\(|module\.exports|\bfetch\(|\bprocess\./);
  // the core workflow does not log: only the Gmail path does, so a mail is never logged twice
  assert.ok(!core.nodes.some((n) => /ops event/i.test(n.name)));
});

// ---- the Gmail wrapper's Code nodes ----
test('Gmail Code nodes give what the library gives', () => {
  const cfg = { owner: 'YOUR_ADDRESS@gmail.com', alias: 'YOUR_ADDRESS+triage@gmail.com' };
  const msg = { id: 'abc', threadId: 't1', from: { value: [{ address: 'maya@mail.example', name: 'Maya Rao' }] }, to: { text: cfg.alias }, subject: 'Re: Question', text: 'I was served with papers yesterday and need help.', headers: {} };
  const prep = runCode(node(gmail, 'Prepare email'), msg, {});
  assert.deepStrictEqual(prep, T.triagePrepareGmail(msg, cfg));
  assert.strictEqual(prep.forAlias, true);
  const result = T.triageRun({ source: prep.source, messageId: prep.messageId, from: prep.from, subject: prep.subject, body: prep.body }, E.MODELS.hostile, E.CANNED, E.DATA, { today: E.SET.today, now: NOW });
  const store = { 'Prepare email': [prep], 'Combine result': null };
  const combined = runCode(node(gmail, 'Combine result'), result, store);
  assert.deepStrictEqual(combined, T.triageCombine(result, prep));
  assert.strictEqual(combined.draftSubject, 'Re: Question');
  store['Combine result'] = [combined];
  const labelItems = T.triageAllLabelNames().map((name, i) => ({ id: 'L' + i, name }));
  const picked = runCode(node(gmail, 'Pick label IDs'), labelItems, store);
  assert.deepStrictEqual(picked, T.triagePickLabelIds(labelItems, [combined]));
  assert.strictEqual(picked[0].alertSend, true);
  store['Pick label IDs'] = picked;
  const alerts = runCode(node(gmail, 'Collect urgent alerts'), picked, store);
  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0].alertText, /Nothing was sent to the sender/);
  const quiet = Object.assign({}, picked[0], { alertSend: false });
  assert.strictEqual(runCode(node(gmail, 'Collect urgent alerts'), quiet, { 'Pick label IDs': [quiet] }).length, 0);
  assert.deepStrictEqual(runCode(node(gmail, 'Label names'), {}, {}).map((j) => j.name), T.triageAllLabelNames());
  assert.throws(() => runCode(node(gmail, 'Pick label IDs'), [{ id: 'L0', name: 'Triage' }], store), /Missing Gmail labels/);
});

test('the Gmail workflow runs one email at a time, with a Wait between emails and every result collected', () => {
  const loop = node(gmail, 'One email at a time');
  assert.strictEqual(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.strictEqual(loop.parameters.batchSize, 1);
  const to = (name, out) => ((gmail.connections[name] || { main: [] }).main[out] || []).map((l) => l.node);
  assert.deepStrictEqual(to('Not seen before?', 0), ['One email at a time']);
  assert.deepStrictEqual(to('One email at a time', 1), ['Run triage core'], 'loop body');
  assert.deepStrictEqual(to('One email at a time', 0), ['Combine result'], 'done: every result');
  assert.deepStrictEqual(to('Run triage core', 0), ['Pace between emails']);
  assert.deepStrictEqual(to('Pace between emails', 0), ['One email at a time']);
  const wait = node(gmail, 'Pace between emails');
  assert.strictEqual(wait.type, 'n8n-nodes-base.wait');
  assert.ok(wait.parameters.amount >= 10, 'the wait between emails is at least 10 seconds');
});

test('the Gmail workflow keeps one email, one log row: the log is skipped for mail already seen', () => {
  const seen = node(gmail, 'Not seen before?');
  assert.strictEqual(seen.parameters.operation, 'rowNotExists');
  assert.deepStrictEqual(seen.parameters.filters.conditions, [{ keyName: 'messageId', keyValue: '={{ $json.messageId }}' }]);
  assert.strictEqual(clone(node(gmail, 'New email').parameters.filters.q).includes('-label:Triage-Processed'), true);
  assert.match(node(gmail, 'New email').parameters.filters.q, /\+triage@/);
});

test('each category is given its own knowledge articles, every id exists, and a reply gets less than the whole base', () => {
  const sections = loadKnowledgeSections();
  const map = E.DATA.rules.knowledgeByCategory;
  Object.values(map).concat([E.DATA.rules.knowledgeFallback]).flat().forEach((id) => assert.ok(sections.articles[id], 'unknown article ' + id));
  E.DATA.urgency.triageCategories.forEach((cat) => {
    const text = T.triageKnowledgeFor(cat, E.DATA);
    assert.ok(text.startsWith(sections.general), cat);
    (map[cat] || E.DATA.rules.knowledgeFallback).forEach((id) => assert.ok(text.includes(sections.articles[id]), cat + ' ' + id));
  });
  assert.ok(T.triageKnowledgeFor('new_inquiry', E.DATA).length < loadKnowledge().length * 0.7, 'the new-inquiry reply carries under 70% of the base');
});
