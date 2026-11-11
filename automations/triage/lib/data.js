'use strict';
// Node-only loader for the data the triage rules need. Not bundled into n8n: the builder
// (scripts/build-triage-workflow.mjs) calls this and inlines the result as the DATA constant.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

function loadKnowledge() {
  const dir = path.join(ROOT, 'knowledge');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n');
}

// Dollar amounts that appear in the knowledge base. A draft may only quote these.
function knowledgeAmounts(kb) {
  return Array.from(new Set((kb.match(/\$\d[\d,]*(?:\.\d+)?/g) || []).map((s) => s.replace(/,/g, ''))));
}

function loadTriageData() {
  const firm = readJson('firm', 'firm.json');
  const kb = loadKnowledge();
  return {
    firm: {
      name: firm.name, short: firm.short, domain: firm.domain, phone: firm.phone, timezone: firm.timezone,
      emails: firm.emails, officeHours: firm.officeHours, language: firm.language
    },
    urgency: readJson('firm', 'urgency.json'),
    rules: readJson('automations', 'triage', 'rules.json'),
    kbAmounts: knowledgeAmounts(kb)
  };
}

module.exports = { loadTriageData, loadKnowledge, knowledgeAmounts, ROOT };
