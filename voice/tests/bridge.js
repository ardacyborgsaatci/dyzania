'use strict';
// Lets the voice tests talk to the REAL booking rules (automations/booking/lib/booking.js), not a copy of them.
// Reads one JSON request on stdin and prints one JSON answer, the way the two n8n endpoints would:
//   { op: 'slots', body, rows, now }  ->  { result }
//   { op: 'book',  body, rows, now }  ->  { result, rows }   (a booked row is added to rows with the next id)
// The caller keeps `rows` between calls, so a test can book twice and watch the second one be refused.
const fs = require('node:fs');
const { loadFirmData } = require('../../firm/lib/data');
const b = require('../../automations/booking/lib/booking.js');

const data = loadFirmData();
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const nowMs = Date.parse(req.now);
const rows = Array.isArray(req.rows) ? req.rows.slice() : [];
let out;

if (req.op === 'slots') {
  out = { result: b.bookListSlots(req.body || {}, rows, nowMs, data), rows };
} else if (req.op === 'book') {
  const refNo = String(rows.length + 1).padStart(6, '0');
  const dec = b.bookDecide(req.body || {}, rows, nowMs, data, { ref: 'HM-' + refNo, now: new Date(nowMs).toISOString() });
  if (dec.row) {
    const id = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const row = Object.assign({ id }, dec.row);
    rows.push(row);
    if (dec.code === 'booked') {
      const v = b.bookVerify(id, rows, nowMs, data);
      if (!v.won) {
        rows.pop();
        out = { result: b.bookRaceLost(dec.row, v.lost[id] || 'slot_taken', rows, nowMs, data).public, rows };
      } else {
        out = { result: b.bookConfirmedPublic(dec.public, req.confirmationSent !== false, data), rows, confirmation: dec.confirmation };
      }
    } else {
      out = { result: dec.public, rows };
    }
  } else {
    out = { result: dec.public, rows };
  }
} else {
  out = { error: 'unknown op' };
}
process.stdout.write(JSON.stringify(out));
