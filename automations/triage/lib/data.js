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

// The knowledge base as sections: the help-center block every draft gets, and one text per article (## KB-NN).
// A draft is given only its category's articles (rules.json knowledgeByCategory), which keeps each request small.
function loadKnowledgeSections() {
  const parts = loadKnowledge().split('\n\n').map((p) => p.trim()).filter((p) => p && p !== '---');
  const helpAt = parts.findIndex((p) => p.startsWith('# Dyzania LLP Help Center'));
  const firstArticle = parts.findIndex((p) => /^## KB-\d+/.test(p));
  if (helpAt < 0 || firstArticle < 0) throw new Error('knowledge base needs a help-center block and KB articles');
  const general = parts.slice(helpAt, firstArticle).join('\n\n');
  const articles = {};
  let current = null;
  parts.slice(firstArticle).forEach((p) => {
    const m = p.match(/^## (KB-\d+)/);
    if (m) { current = m[1]; articles[current] = p; } else if (current) articles[current] += '\n\n' + p;
  });
  return { general, articles };
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
    kb: loadKnowledgeSections(),
    kbAmounts: knowledgeAmounts(kb)
  };
}

module.exports = { loadTriageData, loadKnowledge, loadKnowledgeSections, knowledgeAmounts, ROOT };
