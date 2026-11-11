'use strict';
// Node-only loader. The notice code gets exactly the firm data it uses; the n8n Code nodes get the same object as a DATA constant.
const fs = require('node:fs');
const path = require('node:path');
const { loadFirmData } = require('../../../firm/lib/data');

function loadNoticeData() {
  const d = loadFirmData();
  const prompt = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'extract.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  return {
    firm: { name: d.firm.name, timezone: d.firm.timezone, language: d.firm.language, emails: d.firm.emails },
    urgency: { dayThreshold: d.urgency.dayThreshold },
    prompt
  };
}
function loadColumns() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'columns.json'), 'utf8'));
}
module.exports = { loadNoticeData, loadColumns };
