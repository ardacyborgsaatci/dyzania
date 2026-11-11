'use strict';
// Node-only loader for the shared firm data. Not bundled into n8n Code nodes (they get a DATA constant instead).
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
function loadFirmData() {
  return {
    firm: read('firm.json'),
    areas: read('practice-areas.json'),
    availability: read('availability.json'),
    urgency: read('urgency.json'),
    conflicts: read('conflicts.json')
  };
}
module.exports = { loadFirmData };
