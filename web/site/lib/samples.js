// Preset emails offered in the playground. The browser loads the same file (data/samples.json), and the
// server re-checks any submitted sampleId against it, so only these exact texts are ever shown with
// their subject and summary in the public feed.
const SAMPLES = require('../data/samples.json');

function findSample(id) {
  return SAMPLES.find((s) => s.id === id) || null;
}

module.exports = { SAMPLES, findSample };
