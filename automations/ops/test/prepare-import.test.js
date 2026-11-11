'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', '..', '..');
const mod = () => import(pathToFileURL(path.join(root, 'scripts', 'prepare-import.mjs')).href);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const sourcesOf = (WORKFLOWS) => Object.fromEntries(WORKFLOWS.map((w) => [w.out, read(w.source)]));
const hash = (WORKFLOWS) => crypto.createHash('sha256').update(WORKFLOWS.map((w) => read(w.source)).join('\u0000')).digest('hex');

const FULL = {
  tables: { intake_leads: 'tblLeads0001', bookings: 'tblBook00002', triage_log: 'tblTriage003', court_notices: 'tblNotice004', ops_events: 'tblOps000005' },
  triageCoreWorkflowId: 'wfCore000006',
  ownerEmail: 'owner.person@mail.test-inbox.org',
  attorneyOnDutyEmail: 'duty.attorney@mail.test-inbox.org',
  triageMailbox: 'firm.mailbox@gmail.com',
  timezone: 'America/Chicago'
};

test('with a full config every workflow is written, with no placeholder left and the right value in the right node', async () => {
  const { prepare, WORKFLOWS } = await mod();
  const before = hash(WORKFLOWS);
  const r = prepare(FULL, sourcesOf(WORKFLOWS));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.waiting, {});
  assert.deepEqual(Object.keys(r.files), WORKFLOWS.map((w) => w.out));
  for (const [name, text] of Object.entries(r.files)) {
    assert.doesNotMatch(text, /REPLACE_WITH_|YOUR_ADDRESS/, name);
    JSON.parse(text);
  }
  const wf = (name) => JSON.parse(r.files[name]);
  const node = (name, n) => wf(name).nodes.find((x) => x.name === n);
  assert.equal(node('intake.json', 'Save lead').parameters.dataTableId.value, 'tblLeads0001');
  assert.equal(node('intake.json', 'Log ops event').parameters.dataTableId.value, 'tblOps000005');
  assert.equal(node('intake.json', 'Alert attorney on duty').parameters.sendTo, 'duty.attorney@mail.test-inbox.org');
  assert.equal(node('booking.json', 'Insert booking').parameters.dataTableId.value, 'tblBook00002');
  assert.equal(node('notices.json', 'Save to court_notices').parameters.dataTableId.value, 'tblNotice004');
  assert.equal(node('triage-gmail.json', 'Insert log row').parameters.dataTableId.value, 'tblTriage003');
  assert.equal(node('triage-gmail.json', 'Run triage core').parameters.workflowId.value, 'wfCore000006');
  assert.match(node('triage-gmail.json', 'New email').parameters.filters.q, /firm\.mailbox\+triage@gmail\.com/);
  assert.equal(node('ops-daily-digest.json', 'Email digest to owner').parameters.sendTo, 'owner.person@mail.test-inbox.org');
  assert.equal(node('ops-error-alert.json', 'Email alert to owner').parameters.sendTo, 'owner.person@mail.test-inbox.org');
  assert.equal(node('ops-cleanup.json', 'Delete expired triage rows').parameters.dataTableId.value, 'tblTriage003');
  assert.equal(node('ops-cleanup.json', 'Delete expired events').parameters.dataTableId.value, 'tblOps000005');
  // the shape is untouched: same nodes, same connections
  const src = sourcesOf(WORKFLOWS);
  for (const w of WORKFLOWS) {
    const a = JSON.parse(src[w.out]);
    const b = wf(w.out);
    assert.deepEqual(b.nodes.map((n) => n.name), a.nodes.map((n) => n.name), w.out);
    assert.deepEqual(b.connections, a.connections, w.out);
  }
  assert.equal(wf('ops-cleanup.json').settings.timezone, 'America/Chicago');
  // the committed files were not touched
  assert.equal(hash(WORKFLOWS), before);
});

test('a mail goes only where the config says: the owner for ops mail, the attorney on duty for alerts', async () => {
  const { prepare, WORKFLOWS } = await mod();
  const r = prepare(FULL, sourcesOf(WORKFLOWS));
  const to = {};
  for (const [name, text] of Object.entries(r.files)) for (const n of JSON.parse(text).nodes.filter((x) => x.type === 'n8n-nodes-base.gmail' && [undefined, 'send'].includes(x.parameters.operation))) to[name + ' / ' + n.name] = n.parameters.sendTo;
  assert.deepEqual(to, {
    'triage-gmail.json / Email urgent alert': FULL.attorneyOnDutyEmail,
    'intake.json / Alert attorney on duty': FULL.attorneyOnDutyEmail,
    'booking.json / Send confirmation': '={{ $json.decision.row.email }}',
    'notices.json / Send urgent alert': FULL.attorneyOnDutyEmail,
    'ops-error-alert.json / Email alert to owner': FULL.ownerEmail,
    'ops-daily-digest.json / Email digest to owner': FULL.ownerEmail
  });
});

test('a partial config writes what it can and says what each other workflow is waiting for', async () => {
  const { prepare, WORKFLOWS } = await mod();
  const only = { tables: { ops_events: 'tblOps000005' }, ownerEmail: 'owner.person@mail.test-inbox.org' };
  const r = prepare(only, sourcesOf(WORKFLOWS));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.files).sort(), ['ops-daily-digest.json', 'ops-error-alert.json', 'triage-core.json']);
  assert.deepEqual(r.waiting['ops-cleanup.json'], ['REPLACE_WITH_TRIAGE_LOG_TABLE_ID']);
  assert.ok(r.waiting['triage-gmail.json'].includes('REPLACE_WITH_TRIAGE_CORE_WORKFLOW_ID'));
  assert.ok(r.waiting['intake.json'].includes('REPLACE_WITH_INTAKE_LEADS_TABLE_ID'));
  // nothing half-filled is ever written
  assert.ok(!('intake.json' in r.files));
  // the example file counts as nothing provided: only the workflow that needs nothing is ready
  const example = JSON.parse(read('cutover.example.json'));
  const none = prepare(example, sourcesOf(WORKFLOWS));
  assert.deepEqual(Object.keys(none.files), ['triage-core.json']);
  assert.deepEqual(none.problems, []);
});

test('wrong values are reported and the workflows that need them are not written', async () => {
  const { prepare, WORKFLOWS } = await mod();
  const src = sourcesOf(WORKFLOWS);
  const bad = prepare(Object.assign({}, FULL, { tables: Object.assign({}, FULL.tables, { ops_events: 'has spaces' }), ownerEmail: 'not an email', triageMailbox: 'someone@outlook.com', timezone: 'Mars/Olympus' }), src);
  assert.deepEqual(bad.problems.sort(), ['ownerEmail does not look like an email address', 'tables.ops_events does not look like an id', 'timezone is not an IANA time zone name', 'triageMailbox does not look like a gmail.com address'].sort());
  assert.ok(!('ops-daily-digest.json' in bad.files) && !('intake.json' in bad.files) && !('triage-gmail.json' in bad.files));
  assert.ok('triage-core.json' in bad.files);
  // quotes or backslashes can never be smuggled into the JSON
  const sneaky = prepare(Object.assign({}, FULL, { ownerEmail: 'a"b@x.org', attorneyOnDutyEmail: 'a\\b@x.org' }), src);
  assert.equal(sneaky.problems.length, 2);
  assert.ok(!('ops-error-alert.json' in sneaky.files));
  // garbage config
  for (const junk of [null, undefined, 5, 'x', []]) assert.deepEqual(Object.keys(prepare(junk, src).files), ['triage-core.json']);
});

test('a reserved address is a warning, not a refusal', async () => {
  const { prepare, WORKFLOWS } = await mod();
  const r = prepare(Object.assign({}, FULL, { ownerEmail: 'me@hollismarr.example', attorneyOnDutyEmail: 'me@hollismarr.example' }), sourcesOf(WORKFLOWS));
  assert.equal(r.warnings.filter((w) => /reserved name/.test(w)).length, 2);
  assert.ok('ops-daily-digest.json' in r.files);
});

test('the local config and the output folder are ignored by git, and the example holds no real value', () => {
  const ig = read('.gitignore').split('\n').map((l) => l.trim());
  assert.ok(ig.includes('cutover.local.json'));
  assert.ok(ig.includes('cutover-out/'));
  const example = read('cutover.example.json');
  assert.doesNotMatch(example, /@(?!\s)[a-z0-9.-]+\.[a-z]{2,}/i.source ? /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/ : /x/, 'no address in the example');
  for (const v of example.match(/"(SET_[^"]*)"/g) || []) assert.match(v, /^"SET_/);
});

test('the command line writes only to the folder it is given, never prints an address, and refuses a bad config', async () => {
  const { WORKFLOWS } = await mod();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cutover-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(FULL));
    const run = (args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare-import.mjs'), ...args], { encoding: 'utf8' });
    const ok = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'out')]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'out')).sort(), WORKFLOWS.map((w) => w.out).sort());
    assert.doesNotMatch(ok.stdout + ok.stderr, /mail\.test-inbox\.org|firm\.mailbox/);
    assert.match(ok.stdout, /Nothing was imported or published/);
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(Object.assign({}, FULL, { ownerEmail: 'nope' })));
    const bad = run(['--config', path.join(dir, 'bad.json'), '--out', path.join(dir, 'out2')]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /ownerEmail does not look like an email address/);
    assert.ok(!fs.existsSync(path.join(dir, 'out2')), 'nothing is written when the config has a problem');
    const list = run(['--list']);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /1\. triage-core\.json/);
    assert.match(list.stdout, /8\. ops-cleanup\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
