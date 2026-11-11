'use strict';
// Node-only loader. The booking code gets exactly the firm data it uses; the n8n Code nodes get the same object as a DATA constant.
const fs = require('node:fs');
const path = require('node:path');
const { loadFirmData } = require('../../../firm/lib/data');

function loadBookingData() {
  const d = loadFirmData();
  return { firm: d.firm, areas: d.areas, availability: d.availability, conflicts: d.conflicts };
}
function loadColumns() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'columns.json'), 'utf8'));
}
module.exports = { loadBookingData, loadColumns };
