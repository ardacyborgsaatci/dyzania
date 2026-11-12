'use strict';
// Offline evaluation of the booking rules. No model is involved: booking is pure rules, so this checks the rules themselves.
//
// Four checks, from most to least independent:
//   1. oracle     a brute-force re-implementation (walks every 15-minute UTC instant, asks Intl what the local time is,
//                 and counts occupied minutes one by one) must give the same free slots as lib/booking.js, on the
//                 fixed offer cases and on random scenarios that include daylight-saving changes
//   2. simulate   random people book random offered times one after another; at the end no attorney has two
//                 consultations closer than the buffer and nobody has two future bookings
//   3. race       several requests decide against the same stale snapshot and are all inserted; bookVerify must keep
//                 a valid set, give each row the same verdict whoever asks, and never double-book
//   4. cases      86 hand-labelled cases in cases.json (written before the code; a same-author regression set)
// It does NOT measure anything about the real n8n workflow, a real calendar, or real people.
const fs = require('node:fs');
const path = require('node:path');
const { loadBookingData, loadColumns } = require('../lib/data');
const B = require('../lib/booking');

const SET = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const DATA = loadBookingData();
const TZ = SET.timezone;
const COLUMNS = loadColumns().map((c) => c.name);

// ---- time helpers written separately from the library ----
const FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
const PARTS = new Map();
function parts(ms) {
  let p = PARTS.get(ms);
  if (!p) {
    const o = {};
    FMT.formatToParts(new Date(ms)).forEach((x) => { o[x.type] = x.value; });
    p = { date: o.year + '-' + o.month + '-' + o.day, hh: (+o.hour) % 24, mm: +o.minute, dow: o.weekday.slice(0, 3), stamp: o.year + '-' + o.month + '-' + o.day + ' ' + String((+o.hour) % 24).padStart(2, '0') + ':' + o.minute };
    PARTS.set(ms, p);
  }
  return p;
}
const stampOf = (ms) => parts(ms).stamp;
// 'YYYY-MM-DD HH:MM' local -> UTC ms, found by trying every plausible UTC offset (15-minute steps) and checking with Intl.
function brute(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(stamp);
  if (!m) throw new Error('bad local stamp ' + stamp);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const found = [];
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const t = naive - off * 60000;
    if (stampOf(t) === stamp) found.push(t);
  }
  if (!found.length) throw new Error('local time does not exist: ' + stamp);
  return Math.min.apply(null, found);
}
const addDays = (ymd, n) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const areaOf = (id) => DATA.areas.areas.find((a) => a.id === id);

// ---- fixtures to table rows ----
function fixtureRow(f) {
  const d = SET.defaults.booking;
  const r = Object.assign({}, d, f);
  const area = areaOf(r.area);
  const row = {
    id: r.id, bookingRef: 'DY-FIX-' + r.id, bookedAt: '2026-11-01T12:00:00Z', status: r.status, area: r.area, attorney: r.attorney || '',
    startUtc: '', endUtc: '', localDate: '', localTime: '', minutes: 0, name: 'Fixture Person', email: r.email, phone: r.phone, channel: 'form', leadRef: '', confirmation: 'sent', note: '', rulesVersion: B.BOOK_RULES_VERSION
  };
  if (r.startLocal) {
    const s = brute(r.startLocal), mins = r.minutes || area.consult.minutes;
    row.startUtc = iso(s); row.endUtc = iso(s + mins * 60000); row.minutes = mins; row.localDate = r.startLocal.slice(0, 10); row.localTime = r.startLocal.slice(11);
  }
  return row;
}
const nowOf = (c) => brute(c.now || SET.defaults.now);

// ---- 1. the oracle ----
// Every free start for an area, found by looking at each 15-minute UTC instant. Returns Map(startMs -> sorted attorney ids).
// Gap after a consultation of `minutes` length: its length plus the buffer. Between two bookings the earlier one's gap applies.
function gapMs(minutes) { return (minutes + DATA.availability.booking.bufferMinutes) * 60000; }
function rowMinutes(r) { return (Date.parse(r.endUtc) - Date.parse(r.startUtc)) / 60000; }
function pairGapMs(x, y) { const first = Date.parse(x.startUtc) <= Date.parse(y.startUtc) ? x : y; return gapMs(rowMinutes(first)); }

function oracleOffers(areaId, nowMs, rows) {
  const area = areaOf(areaId), cfg = DATA.availability.booking, dur = area.consult.minutes;
  const out = new Map();
  const today = parts(nowMs).date, lastDate = addDays(today, cfg.horizonDays);
  const grid0 = Math.ceil(nowMs / 900000) * 900000;
  const gridEnd = nowMs + (cfg.horizonDays + 2) * 86400000;
  const booked = rows.filter((r) => r.status === 'booked' && r.startUtc);
  for (let t = grid0; t <= gridEnd; t += 900000) {
    if (t < nowMs + cfg.minNoticeHours * 3600000) continue;
    const p = parts(t);
    if (p.date > lastDate) continue;
    const mod = p.hh * 60 + p.mm;
    area.attorneys.forEach((att) => {
      const ok = (DATA.availability.windows[att] || []).some((w) => {
        const s = +w.start.slice(0, 2) * 60 + +w.start.slice(3), e = +w.end.slice(0, 2) * 60 + +w.end.slice(3);
        return w.day === p.dow.toLowerCase() && mod >= s && (mod - s) % cfg.slotStepMinutes === 0 && mod + dur <= e;
      });
      if (!ok) return;
      // the gap, counted from the earlier consultation: a booking that starts before the other one's gap has run out clashes
      const candEnd = t + dur * 60000, candGap = gapMs(dur);
      if (booked.some((r) => r.attorney === att && t < Date.parse(r.endUtc) + pairGapMs(r, { startUtc: new Date(t).toISOString(), endUtc: new Date(candEnd).toISOString() }) && Date.parse(r.startUtc) < candEnd + candGap)) return;
      if (!out.has(t)) out.set(t, []);
      out.get(t).push(att);
    });
  }
  out.forEach((v) => v.sort());
  return out;
}
function libOffers(areaId, nowMs, rows) {
  const out = new Map();
  B.bookOffers(areaId, rows, nowMs, DATA, {}).forEach((o) => out.set(o.startMs, o.attorneys.slice().sort()));
  return out;
}
function diffOffers(a, b) {
  const only = [];
  a.forEach((v, k) => { if (!b.has(k)) only.push('library-only ' + stampOf(k) + ' ' + v.join('+')); else if (b.get(k).join() !== v.join()) only.push('attorneys differ at ' + stampOf(k) + ': ' + v.join('+') + ' vs ' + b.get(k).join('+')); });
  b.forEach((v, k) => { if (!a.has(k)) only.push('oracle-only ' + stampOf(k) + ' ' + v.join('+')); });
  return only;
}

// small seeded generator so the random scenarios are the same on every run
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];
const AREAS = DATA.areas.areas.map((a) => a.id);
const ATTORNEYS = DATA.firm.staff.filter((s) => s.attorney).map((s) => s.id);

// Random "now" between 2026-10-20 and 2027-03-10 (the horizon crosses both daylight-saving changes), on any minute of any day.
function randomNow(r) { return Date.UTC(2026, 9, 20) + Math.floor(r() * (Date.UTC(2027, 2, 10) - Date.UTC(2026, 9, 20))); }
function randomRows(r, nowMs, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const att = pick(r, ATTORNEYS), area = pick(r, DATA.areas.areas.filter((a) => a.attorneys.indexOf(att) !== -1)).id;
    const s = Math.floor((nowMs + r() * 31 * 86400000) / 60000) * 60000, mins = areaOf(area).consult.minutes;
    rows.push({ id: i + 1, bookingRef: 'DY-R' + i, status: pick(r, ['booked', 'booked', 'booked', 'cancelled', 'cancelled_race']), area, attorney: att, startUtc: iso(s), endUtc: iso(s + mins * 60000), email: 'p' + i + '@mail.example', phone: '', minutes: mins });
  }
  return rows;
}
// Rows that sit exactly on slot starts, so the buffer edge cases (gap of exactly 15 minutes) come up often.
function slotRows(r, nowMs, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const area = pick(r, AREAS), slots = B.bookGenerate(area, nowMs, DATA);
    if (!slots.length) continue;
    const s = pick(r, slots);
    rows.push({ id: i + 1, bookingRef: 'DY-S' + i, status: 'booked', area, attorney: s.attorney, startUtc: iso(s.startMs), endUtc: iso(s.endMs), email: 's' + i + '@mail.example', phone: '', minutes: (s.endMs - s.startMs) / 60000 });
  }
  return rows;
}

function evaluateOracle(scenarios) {
  const n = scenarios == null ? 60 : scenarios;
  const mismatches = [];
  let checked = 0, slotsChecked = 0;
  const run = (label, areaId, nowMs, rows) => {
    const a = libOffers(areaId, nowMs, rows), b = oracleOffers(areaId, nowMs, rows);
    checked++; slotsChecked += b.size;
    const d = diffOffers(a, b);
    if (d.length) mismatches.push({ label, area: areaId, now: stampOf(nowMs), diff: d.slice(0, 5) });
  };
  SET.cases.filter((c) => c.kind === 'offer' && AREAS.indexOf(c.area) !== -1).forEach((c) => run(c.id, c.area, nowOf(c), (c.bookings || []).map(fixtureRow)));
  const r = rng(20261111);
  for (let i = 0; i < n; i++) {
    const nowMs = randomNow(r), area = pick(r, AREAS);
    const rows = i % 2 ? randomRows(r, nowMs, Math.floor(r() * 10)) : slotRows(r, nowMs, Math.floor(r() * 14));
    run('random-' + i, area, nowMs, rows);
  }
  return { checked, slotsChecked, mismatches };
}

// ---- 2. one person at a time, many bookings in a row ----
function invariantProblems(rows, nowMs) {
  const cfg = DATA.availability.booking, problems = [];
  const act = rows.filter((r) => r.status === 'booked' && Date.parse(r.endUtc) > nowMs);
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (a.attorney === b.attorney) {
        const gap = Math.max(Date.parse(b.startUtc) - Date.parse(a.endUtc), Date.parse(a.startUtc) - Date.parse(b.endUtc));
        if (gap < pairGapMs(a, b)) problems.push('gap under buffer: ' + a.attorney + ' ' + stampOf(Date.parse(a.startUtc)) + ' / ' + stampOf(Date.parse(b.startUtc)));
      }
      const pa = String(a.phone).replace(/\D/g, ''), pb = String(b.phone).replace(/\D/g, '');
      if ((a.email && a.email === b.email) || (pa.length >= 7 && pa === pb)) problems.push('same person twice: ' + a.email + ' / ' + b.email);
    }
  }
  // every booked time is a time the rules allow for its area and attorney, whatever else is booked
  act.forEach((a) => {
    const t = Date.parse(a.startUtc), p = parts(t), area = areaOf(a.area);
    const ok = (DATA.availability.windows[a.attorney] || []).some((w) => {
      const s = +w.start.slice(0, 2) * 60 + +w.start.slice(3), e = +w.end.slice(0, 2) * 60 + +w.end.slice(3), mod = p.hh * 60 + p.mm;
      return w.day === p.dow.toLowerCase() && mod >= s && (mod - s) % cfg.slotStepMinutes === 0 && mod + area.consult.minutes <= e;
    });
    if (!ok || area.attorneys.indexOf(a.attorney) === -1) problems.push('booked outside the rules: ' + a.attorney + ' ' + stampOf(t));
  });
  return problems;
}
function evaluateSimulation(runs) {
  const n = runs == null ? 12 : runs;
  const problems = [];
  let booked = 0, refused = 0;
  for (let k = 0; k < n; k++) {
    const r = rng(1000 + k), nowMs = randomNow(r), rows = [];
    const people = Array.from({ length: 14 }, (_, i) => ({ name: 'Person ' + String.fromCharCode(65 + i), email: 'sim' + i + '@mail.example', phone: i % 3 === 0 ? '555-010-' + String(1000 + i) : '' }));
    for (let step = 0; step < 30; step++) {
      const area = pick(r, AREAS), person = pick(r, people), offers = B.bookOffers(area, rows, nowMs, DATA, {});
      if (!offers.length) continue;
      const slot = r() < 0.85 ? pick(r, offers) : { startMs: nowMs + Math.floor(r() * 40 * 86400000 / 60000) * 60000 };
      const d = B.bookDecide({ name: person.name, email: person.email, phone: person.phone, area, otherSide: 'Quiet Pines Cafe', consent: true, channel: 'form', start: iso(slot.startMs) }, rows, nowMs, DATA, { ref: 'DY-SIM' + k + '-' + step, now: iso(nowMs) });
      if (d.code === 'booked') { rows.push(Object.assign({ id: rows.length + 1 }, d.row)); booked++; } else refused++;
    }
    invariantProblems(rows, nowMs).forEach((p) => problems.push('run ' + k + ': ' + p));
  }
  return { runs: n, booked, refused, problems };
}

// ---- 3. several requests against the same stale snapshot ----
function evaluateRace(runs) {
  const n = runs == null ? 30 : runs;
  const problems = [];
  let rowsChecked = 0, losers = 0;
  for (let k = 0; k < n; k++) {
    const r = rng(5000 + k), nowMs = randomNow(r);
    const area = pick(r, AREAS), offers = B.bookOffers(area, [], nowMs, DATA, {});
    if (offers.length < 3) continue;
    // a small cluster of start times near each other, so clashes (same slot, inside the buffer) are common
    const base = Math.floor(r() * (offers.length - 3));
    const cluster = offers.slice(base, base + 4);
    const decisions = [];
    for (let i = 0; i < 6; i++) {
      const slot = pick(r, cluster), who = i % 4 === 3 ? 0 : i;
      const d = B.bookDecide({ name: 'Racer ' + 'ABCDEF'[who], email: 'race' + who + '@mail.example', area, otherSide: 'Quiet Pines Cafe', consent: true, channel: 'form', start: iso(slot.startMs) }, [], nowMs, DATA, { ref: 'DY-RACE' + k + '-' + i, now: iso(nowMs) });
      if (d.code === 'booked') decisions.push(d.row);
    }
    // insertion order is random; ids follow insertion order
    const order = decisions.slice().sort(() => r() - 0.5);
    const rows = order.map((row, i) => Object.assign({ id: i + 1 }, row));
    const all = B.bookVerify(0, rows, nowMs, DATA);
    const acceptedRows = rows.filter((x) => all.accepted.indexOf(x.id) !== -1);
    invariantProblems(acceptedRows, nowMs).forEach((p) => problems.push('race ' + k + ': ' + p));
    // the verdict for row i must not depend on rows inserted after it
    rows.forEach((row, i) => {
      rowsChecked++;
      const early = B.bookVerify(row.id, rows.slice(0, i + 1), nowMs, DATA), late = B.bookVerify(row.id, rows, nowMs, DATA);
      if (early.won !== late.won) problems.push('race ' + k + ': row ' + row.id + ' verdict changes with later rows');
      if (late.won !== (all.accepted.indexOf(row.id) !== -1)) problems.push('race ' + k + ': row ' + row.id + ' won flag disagrees with the accepted list');
      if (!late.won) losers++;
    });
    // nothing accepted may clash, and a rejected row must clash with, or repeat, an earlier accepted row
    rows.filter((x) => all.accepted.indexOf(x.id) === -1).forEach((lo) => {
      const earlier = acceptedRows.filter((a) => a.id < lo.id);
      const clash = earlier.some((a) => a.attorney === lo.attorney && Math.max(Date.parse(lo.startUtc) - Date.parse(a.endUtc), Date.parse(a.startUtc) - Date.parse(lo.endUtc)) < pairGapMs(lo, a));
      const same = earlier.some((a) => a.email === lo.email);
      if (!clash && !same) problems.push('race ' + k + ': row ' + lo.id + ' lost without a reason');
    });
  }
  return { runs: n, rowsChecked, losers, problems };
}

// ---- 4. the labelled cases ----
const norm = (s) => String(s).toLowerCase();
function stamps(list) { return list.map((o) => stampOf(o.startMs)); }

function checkOffer(c) {
  const f = [], ex = c.expect, nowMs = nowOf(c), rows = (c.bookings || []).map(fixtureRow);
  if (ex.ok === false) {
    const r = B.bookListSlots({ area: c.area }, rows, nowMs, DATA);
    if (r.ok !== false) f.push('expected a refusal, got slots');
    return f;
  }
  const offers = B.bookOffers(c.area, rows, nowMs, DATA, {});
  const st = stamps(offers), utc = offers.map((o) => iso(o.startMs));
  if (ex.first && st.slice(0, ex.first.length).join() !== ex.first.join()) f.push('first ' + ex.first.length + ' expected ' + ex.first.join(', ') + ' got ' + st.slice(0, ex.first.length).join(', '));
  if (ex.last && st[st.length - 1] !== ex.last) f.push('last expected ' + ex.last + ' got ' + st[st.length - 1]);
  if (ex.weekdays) st.forEach((s) => { const d = new Date(s.slice(0, 10) + 'T12:00:00Z').toUTCString().slice(0, 3); if (ex.weekdays.indexOf(d) === -1 && f.length < 3) f.push('offered on a ' + d + ': ' + s); });
  (ex.includes || []).forEach((s) => { if (st.indexOf(s) === -1) f.push('missing ' + s); });
  (ex.excludes || []).forEach((s) => { if (st.indexOf(s) !== -1) f.push('should not offer ' + s); });
  (ex.includesUtc || []).forEach((s) => { if (utc.indexOf(s) === -1) f.push('missing ' + s); });
  (ex.excludesUtc || []).forEach((s) => { if (utc.indexOf(s) !== -1) f.push('should not offer ' + s); });
  return f;
}

function requestOf(c) {
  const req = Object.assign({}, SET.defaults.request, c.request || {});
  req.start = c.startRaw != null ? c.startRaw : iso(brute(c.startLocal));
  return req;
}
function runBook(c) {
  const nowMs = nowOf(c), rows = (c.bookings || []).map(fixtureRow), req = requestOf(c);
  return { req, rows, nowMs, result: B.bookDecide(req, rows, nowMs, DATA, { ref: 'DY-TEST01', now: iso(nowMs) }) };
}
function checkBook(c) {
  const f = [], ex = c.expect, { result: r } = runBook(c);
  if (r.code !== ex.code) f.push('code expected ' + ex.code + ' got ' + r.code + (r.errors ? ' (' + Object.keys(r.errors).join(',') + ')' : r.reason ? ' (' + r.reason + ')' : ''));
  if (ex.reason !== undefined && r.reason !== ex.reason) f.push('reason expected ' + ex.reason + ' got ' + r.reason);
  if (ex.publicCode && r.public.code !== ex.publicCode) f.push('public code expected ' + ex.publicCode + ' got ' + r.public.code);
  if (ex.attorney && (!r.row || r.row.attorney !== ex.attorney)) f.push('attorney expected ' + ex.attorney + ' got ' + (r.row && r.row.attorney));
  if (ex.endLocal && (!r.row || stampOf(Date.parse(r.row.endUtc)) !== ex.endLocal)) f.push('end expected ' + ex.endLocal + ' got ' + (r.row && r.row.endUtc && stampOf(Date.parse(r.row.endUtc))));
  if (ex.channel && (!r.row || r.row.channel !== ex.channel)) f.push('channel expected ' + ex.channel);
  if (ex.held && !(r.row && r.row.status === 'held' && r.row.startUtc === '' && r.row.attorney === '' && !r.confirmation)) f.push('expected a held row with no time, no attorney and no confirmation');
  if (ex.errors && Object.keys(r.errors || {}).sort().join() !== ex.errors.slice().sort().join()) f.push('errors expected ' + ex.errors.join(',') + ' got ' + Object.keys(r.errors || {}).join(','));
  if (ex.alternativesFirst && !(r.alternatives && r.alternatives.length && r.public.alternatives[0].start === iso(brute(ex.alternativesFirst)))) f.push('first alternative expected ' + ex.alternativesFirst);
  (ex.confirmationHas || []).forEach((s) => { if (!r.confirmation || norm(r.confirmation.text).indexOf(norm(s)) === -1) f.push('confirmation missing "' + s + '"'); });
  if (ex.rowOnlyKnownKeys && r.row) Object.keys(r.row).forEach((k) => { if (COLUMNS.indexOf(k) === -1) f.push('row has an unknown field ' + k); });
  return f;
}
function checkVerify(c) {
  const f = [], ex = c.expect, rows = c.rows.map(fixtureRow), nowMs = nowOf(c);
  const r = B.bookVerify(c.forRow, rows, nowMs, DATA);
  if (r.accepted.join() !== ex.accepted.join()) f.push('accepted expected ' + ex.accepted.join() + ' got ' + r.accepted.join());
  if (JSON.stringify(r.lost) !== JSON.stringify(ex.lost)) f.push('lost expected ' + JSON.stringify(ex.lost) + ' got ' + JSON.stringify(r.lost));
  const wantWon = ex.accepted.indexOf(c.forRow) !== -1;
  if (r.won !== wantWon) f.push('won expected ' + wantWon + ' got ' + r.won + ' for row ' + c.forRow);
  return f;
}
function checkCancel(c) {
  const f = [], ex = c.expect, r = B.bookCancelDecision(fixtureRow(c.booking), nowOf(c), DATA);
  if (r.allowed !== ex.allowed) f.push('allowed expected ' + ex.allowed + ' got ' + r.allowed);
  if (ex.reason !== undefined && r.reason !== ex.reason) f.push('reason expected ' + ex.reason + ' got ' + r.reason);
  return f;
}
const CHECKS = { offer: checkOffer, book: checkBook, verify: checkVerify, cancel: checkCancel };

function evaluateCases() {
  const results = SET.cases.map((c) => ({ id: c.id, kind: c.kind, failures: CHECKS[c.kind](c) }));
  return { total: results.length, passed: results.filter((x) => !x.failures.length).length, failed: results.filter((x) => x.failures.length) };
}

// ---- guarantees that must hold for EVERY decision, labelled or random ----
const FORBIDDEN_WORDS = /guarantee|will win|you will (win|recover|get)|strong case|good case|we will get you|promise/i;
function guaranteeProblems(req, result, rows, nowMs) {
  const p = [], f = DATA.firm;
  const pub = JSON.stringify(result.public);
  const secrets = [req.email, req.phone, req.otherSide].filter((x) => x && String(x).length > 3);
  secrets.forEach((s) => { if (pub.indexOf(String(s)) !== -1) p.push('public answer repeats ' + s); });
  if (/\b[cfa]\d{3}\b/.test(pub)) p.push('public answer shows a conflict list id');
  DATA.conflicts.entries.forEach((e) => { if (pub.toLowerCase().indexOf(e.name.toLowerCase()) !== -1) p.push('public answer names a conflict list entry'); });
  const ev = JSON.stringify(result.event);
  [req.name, req.email, req.phone, req.otherSide].filter((x) => x && String(x).length > 2).forEach((s) => { if (ev.indexOf(String(s)) !== -1) p.push('event holds personal data: ' + s); });
  if (result.code === 'booked') {
    const t = result.confirmation.text, startMs = Date.parse(result.row.startUtc);
    if (t.indexOf(f.language.notLegalAdvice) === -1) p.push('confirmation lacks the not-legal-advice line');
    if (t.indexOf(f.language.fictional) === -1) p.push('confirmation lacks the fictional-firm line');
    if (t.indexOf(f.address) === -1) p.push('confirmation lacks the address');
    if (FORBIDDEN_WORDS.test(t)) p.push('confirmation has outcome wording');
    const clocks = t.match(/\b\d{1,2}:\d{2} [AP]M\b/g) || [];
    const hh = parts(startMs).hh, mm = parts(startMs).mm, want = (hh % 12 || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
    if (clocks.length !== 1 || clocks[0] !== want) p.push('confirmation shows a time other than the booked one: ' + clocks.join(','));
    (t.match(/https?:\/\/[^\s]+/g) || []).forEach((u) => { if (!/^https?:\/\/[^/]*dyzania\.example/.test(u)) p.push('confirmation links outside the firm domain: ' + u); });
    if (result.confirmation.subject.indexOf('\n') !== -1) p.push('subject has a line break');
    const body = t.split('\n').slice(2).join('\n');
    if (body.indexOf(req.otherSide) !== -1 && req.otherSide.length > 3) p.push('confirmation repeats the other side');
    invariantProblems(rows.concat([Object.assign({ id: rows.length + 1 }, result.row)]), nowMs).forEach((x) => p.push(x));
  }
  if (result.code === 'conflict_hold') {
    if (result.row.startUtc || result.row.attorney || result.confirmation) p.push('a held row has a time, attorney or confirmation');
  }
  return p;
}
function evaluateGuarantees() {
  const problems = [];
  let checked = 0;
  SET.cases.filter((c) => c.kind === 'book').forEach((c) => {
    const { req, rows, nowMs, result } = runBook(c);
    checked++;
    guaranteeProblems(req, result, rows, nowMs).forEach((x) => problems.push(c.id + ': ' + x));
  });
  // a person on hold and a person with a booking see exactly the same words
  const hold = runBook(SET.cases.find((c) => c.id === 'B29')).result.public, dup = runBook(SET.cases.find((c) => c.id === 'B24')).result.public;
  if (JSON.stringify(hold) !== JSON.stringify(dup)) problems.push('hold and already-booked answers differ');
  return { checked, problems };
}

function evaluateAll() {
  const cases = evaluateCases(), oracle = evaluateOracle(), sim = evaluateSimulation(), race = evaluateRace(), guar = evaluateGuarantees();
  return { cases, oracle, sim, race, guar };
}

module.exports = { SET, DATA, COLUMNS, brute, stampOf, iso, fixtureRow, oracleOffers, libOffers, evaluateCases, evaluateOracle, evaluateSimulation, evaluateRace, evaluateGuarantees, evaluateAll, runBook, invariantProblems };

if (require.main === module) {
  const r = evaluateAll();
  console.log('cases       ' + r.cases.passed + '/' + r.cases.total + ' match their labels');
  r.cases.failed.forEach((x) => console.log('  FAIL ' + x.id + ': ' + x.failures.join(' | ')));
  console.log('oracle      ' + (r.oracle.checked - r.oracle.mismatches.length) + '/' + r.oracle.checked + ' scenarios agree (' + r.oracle.slotsChecked + ' free start times compared)');
  r.oracle.mismatches.slice(0, 5).forEach((m) => console.log('  DIFF ' + m.label + ' ' + m.area + ' @' + m.now + ': ' + m.diff.join('; ')));
  console.log('simulation  ' + r.sim.runs + ' runs, ' + r.sim.booked + ' bookings made, ' + r.sim.refused + ' refused, ' + r.sim.problems.length + ' problems');
  r.sim.problems.slice(0, 5).forEach((x) => console.log('  ' + x));
  console.log('race        ' + r.race.runs + ' runs, ' + r.race.rowsChecked + ' rows checked, ' + r.race.losers + ' lost their slot, ' + r.race.problems.length + ' problems');
  r.race.problems.slice(0, 5).forEach((x) => console.log('  ' + x));
  console.log('guarantees  ' + r.guar.checked + ' booking cases, ' + r.guar.problems.length + ' problems');
  r.guar.problems.slice(0, 8).forEach((x) => console.log('  ' + x));
  const bad = r.cases.failed.length + r.oracle.mismatches.length + r.sim.problems.length + r.race.problems.length + r.guar.problems.length;
  process.exit(bad ? 1 : 0);
}
