// Scores invoice extraction results against invoices.json.
// Usage: node score.js results.json   (results: { "I01": { vendor, invoiceNumber, invoiceDate, currency, subtotal, tax, total, status }, ... })
'use strict';
const fs = require('fs');
const path = require('path');

const FIELDS = ['vendor', 'invoiceNumber', 'invoiceDate', 'currency', 'subtotal', 'tax', 'total'];
const norm = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? v : String(v).trim().toLowerCase());
const same = (a, b) => {
  a = norm(a); b = norm(b);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.005;
  return a === b;
};

function scoreCase(c, r) {
  if (!r) return { id: c.id, missing: true };
  const approved = r.status === 'Auto-approved';
  const out = { id: c.id, group: c.group, approved, fieldsRight: null, fieldsTotal: null, wrongFields: [], verdict: '' };
  if (c.truth) {
    out.fieldsTotal = FIELDS.length;
    out.wrongFields = FIELDS.filter((f) => !same(r[f], c.truth[f]));
    out.fieldsRight = FIELDS.length - out.wrongFields.length;
  }
  const exp = c.expect.status;
  if (exp === 'review') out.verdict = approved ? 'BAD: approved a bill that should be reviewed' : 'ok';
  else if (exp === 'approve') out.verdict = approved ? (out.wrongFields.length ? 'BAD: approved with wrong values' : 'ok') : 'over-cautious (sent to review)';
  else out.verdict = approved && out.wrongFields.length ? 'BAD: approved with wrong values' : 'ok';
  return out;
}

function scoreAll(cases, results) {
  const rows = cases.map((c) => scoreCase(c, results[c.id]));
  const ran = rows.filter((r) => !r.missing);
  const t = cases.filter((c) => c.truth);
  const fields = ran.filter((r) => r.fieldsTotal);
  return {
    ran: ran.length,
    total: cases.length,
    badApprovals: ran.filter((r) => r.verdict.startsWith('BAD')).length,
    overCautious: ran.filter((r) => r.verdict.startsWith('over')).length,
    fieldsRight: fields.reduce((n, r) => n + r.fieldsRight, 0),
    fieldsTotal: fields.reduce((n, r) => n + r.fieldsTotal, 0),
    rows,
  };
}

module.exports = { scoreCase, scoreAll, FIELDS };

if (require.main === module) {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'invoices.json'), 'utf8')).cases;
  const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const s = scoreAll(cases, results);
  for (const r of s.rows) console.log(r.id, r.missing ? 'not run' : `${r.verdict}${r.wrongFields.length ? ' [' + r.wrongFields.join(',') + ']' : ''}`);
  console.log(`\nran ${s.ran}/${s.total}; bad approvals ${s.badApprovals}; sent to review needlessly ${s.overCautious}; fields right ${s.fieldsRight}/${s.fieldsTotal}`);
}
