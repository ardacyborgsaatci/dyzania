#!/usr/bin/env node
// Builds the three scheduled/ops workflows from the tested library in automations/ops/lib.
//
//   node scripts/build-ops-workflows.mjs           write the files
//   node scripts/build-ops-workflows.mjs --check   fail if a file on disk is out of date
//
//   automations/ops/workflows/daily-digest.json   08:00: counts the last 24 hours, mails the owner
//   automations/ops/workflows/error-alert.json    error workflow: a production workflow failed -> log it, mail the owner
//   automations/ops/workflows/cleanup.json        03:30: deletes ops_events and triage_log rows older than 90 days
//
// The Code nodes hold the SAME functions the tests run (automations/ops/lib/event.js and digest.js). Every mail goes to
// the owner address only (a placeholder here, filled in at import by scripts/prepare-import.mjs). None goes to a client.
import { opsBuildNode, opsLogNode, OPS_JOB_FILES, OPS_TABLE_PLACEHOLDER } from './lib/ops-nodes.mjs';
import { readJson, nodeIds, isMain, writeOrCheck } from './lib/workflow-kit.mjs';

const firm = readJson('firm/firm.json');

export const OWNER_PLACEHOLDER = 'REPLACE_WITH_YOUR_EMAIL';
export const TRIAGE_LOG_PLACEHOLDER = 'REPLACE_WITH_TRIAGE_LOG_TABLE_ID';

const ID = nodeIds('05');
const link = (to) => ({ node: to, type: 'main', index: 0 });
const table = (value) => ({ __rl: true, mode: 'id', value });
const SETTINGS = {
  executionOrder: 'v1',
  // The schedule runs in the firm's time zone (firm/firm.json; the owner confirms it at cutover).
  timezone: firm.timezone,
  // Nothing here needs its data kept: counts and ids only, and the rows read are metadata.
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveExecutionProgress: false
};
const schedule = (id, name, position, hour, minute) => ({
  id: ID(id), name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.4, position,
  parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: hour, triggerAtMinute: minute }] } }
});
const getRows = (id, name, position, tableId) => ({
  id: ID(id), name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position, alwaysOutputData: true,
  // An empty table gives no item in n8n; alwaysOutputData gives one empty item so the chain keeps going. The code ignores it.
  parameters: { resource: 'row', operation: 'get', dataTableId: table(tableId), returnAll: true }
});
const ownerMail = (id, name, position, from) => ({
  id: ID(id), name, type: 'n8n-nodes-base.gmail', typeVersion: 2.2, position,
  parameters: {
    resource: 'message', operation: 'send', sendTo: OWNER_PLACEHOLDER,
    subject: "={{ $('" + from + "').first().json.subject }}", emailType: 'text', message: "={{ $('" + from + "').first().json.text }}",
    options: { appendAttribution: false }
  }
});
const note = (id, position, content, width, height) => ({ id: ID(id), name: 'Notes', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { content, width, height } });

// ---- the glue lines of each Code node ----
const DIGEST_GLUE = `
const FIRM = ${JSON.stringify(firm.name)};
const rows = $input.all().map((i) => i.json);
const d = buildDigest(rows, { now: NOW, firm: FIRM });
const run = 'digest-' + NOW.toISOString().slice(0, 10);
const ev = orFallback(buildEvent({ automation: 'ops', source: 'schedule', status: 'ok', runId: run, summary: 'Digest built: ' + d.events + ' events, ' + d.attention + ' need a person' }, NOW), { automation: 'ops', source: 'schedule', runId: run, summary: 'The daily digest ran' }, NOW);
return [{ json: { subject: d.subject, text: d.text, row: toRow(ev.event) } }];
`;
const ALERT_GLUE = `
const FIRM = ${JSON.stringify(firm.name)};
const a = errorAlert($input.first().json, { now: NOW, firm: FIRM });
return [{ json: { subject: a.subject, text: a.text, row: toRow(a.event.event) } }];
`;
const expiredGlue = (tableName) => `
const r = selectExpired($input.all().map((i) => i.json), ${JSON.stringify(tableName)}, NOW);
return r.ids.map((id) => ({ json: { id } }));
`;
const deleteRows = (id, name, position, tableId) => ({
  id: ID(id), name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position,
  parameters: {
    resource: 'row', operation: 'deleteRows', dataTableId: table(tableId), matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.id }}' }] }
  }
});

export function buildDigestWorkflow() {
  const code = (id, name, position, glue) => opsBuildNode({ id: ID(id), name, position, generator: 'build-ops-workflows.mjs', glue, files: OPS_JOB_FILES });
  const nodes = [
    schedule(1, 'Every morning', [0, 0], 8, 0),
    getRows(2, 'Get ops events', [224, 0], OPS_TABLE_PLACEHOLDER),
    code(3, 'Build digest', [448, 0], DIGEST_GLUE),
    opsLogNode({ id: ID(4), name: 'Log ops event', position: [672, 0] }),
    ownerMail(5, 'Email digest to owner', [896, 0], 'Build digest'),
    note(6, [0, -220], 'Daily digest for ' + firm.name + ' (fictional). Every morning: reads ops_events, counts the last 24 hours per automation and status, lists what needs a person (15 at most), and mails ONE summary to the owner address. Counts, references and short summaries only: no names and no message text. Seed and evaluation events are listed but not counted. The Code node is generated from automations/ops/lib. Nothing here sends mail to a client.', 900, 170)
  ];
  const connections = {
    'Every morning': { main: [[link('Get ops events')]] },
    'Get ops events': { main: [[link('Build digest')]] },
    'Build digest': { main: [[link('Log ops event')]] },
    'Log ops event': { main: [[link('Email digest to owner')]] }
  };
  return { name: 'Dyzania Ops - Daily digest', nodes, connections, settings: SETTINGS };
}

export function buildErrorAlertWorkflow() {
  const nodes = [
    { id: ID(1), name: 'Workflow failed', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    opsBuildNode({ id: ID(2), name: 'Build alert', position: [224, 0], generator: 'build-ops-workflows.mjs', glue: ALERT_GLUE, files: OPS_JOB_FILES }),
    opsLogNode({ id: ID(3), name: 'Log ops event', position: [448, 0] }),
    ownerMail(4, 'Email alert to owner', [672, 0], 'Build alert'),
    note(5, [0, -220], 'Error alert for ' + firm.name + ' (fictional). Set this as the Error Workflow of every Dyzania workflow. When one fails: writes an ops_events row with status error, then mails the owner address the workflow name, the node and a cut error message (any address in it removed). The message n8n gives can quote a few characters of the data that failed, so this mail goes to the owner address only. No client is told anything by this workflow.', 900, 170)
  ];
  const connections = {
    'Workflow failed': { main: [[link('Build alert')]] },
    'Build alert': { main: [[link('Log ops event')]] },
    'Log ops event': { main: [[link('Email alert to owner')]] }
  };
  return { name: 'Dyzania Ops - Error alert', nodes, connections, settings: SETTINGS };
}

export function buildCleanupWorkflow() {
  const code = (id, name, position, glue) => opsBuildNode({ id: ID(id), name, position, generator: 'build-ops-workflows.mjs', glue, files: OPS_JOB_FILES });
  const nodes = [
    schedule(1, 'Every night', [0, 120], 3, 30),
    getRows(2, 'Get ops events', [224, 0], OPS_TABLE_PLACEHOLDER),
    code(3, 'Select expired events', [448, 0], expiredGlue('ops_events')),
    deleteRows(4, 'Delete expired events', [672, 0], OPS_TABLE_PLACEHOLDER),
    getRows(5, 'Get triage log', [224, 240], TRIAGE_LOG_PLACEHOLDER),
    code(6, 'Select expired triage rows', [448, 240], expiredGlue('triage_log')),
    deleteRows(7, 'Delete expired triage rows', [672, 240], TRIAGE_LOG_PLACEHOLDER),
    note(8, [0, -220], 'Nightly cleanup for ' + firm.name + ' (fictional). Deletes ops_events and triage_log rows older than 90 days, at most 1000 per table per night, and never a row without a readable date. Nothing else is deleted: leads, bookings and court notices have no automatic deletion, and the code refuses any table that has no retention rule. The two tables are cleaned on separate branches so one cannot block the other. Delete nodes act only on the ids the Code node selected.', 900, 170)
  ];
  const connections = {
    'Every night': { main: [[link('Get ops events'), link('Get triage log')]] },
    'Get ops events': { main: [[link('Select expired events')]] },
    'Select expired events': { main: [[link('Delete expired events')]] },
    'Get triage log': { main: [[link('Select expired triage rows')]] },
    'Select expired triage rows': { main: [[link('Delete expired triage rows')]] }
  };
  return { name: 'Dyzania Ops - Cleanup', nodes, connections, settings: SETTINGS };
}

export const TARGETS = [
  ['automations/ops/workflows/daily-digest.json', buildDigestWorkflow],
  ['automations/ops/workflows/error-alert.json', buildErrorAlertWorkflow],
  ['automations/ops/workflows/cleanup.json', buildCleanupWorkflow]
];

if (isMain(import.meta.url)) writeOrCheck(TARGETS, 'build-ops-workflows.mjs');
