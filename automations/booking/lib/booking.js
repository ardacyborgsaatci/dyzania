'use strict';
const { checkConflicts } = require('../../../firm/lib/conflicts');
// Dyzania first-consultation booking. Pure functions: no model, no network, no clock of its own
// (every function takes `nowMs`). The same code backs the website form, the voice line and the email link.
//
// What the rules are (all numbers come from firm/availability.json and firm/practice-areas.json):
//   - a slot is a start time on the slot grid inside one attorney's weekly window, long enough for the
//     consultation (45 minutes family/estate, 30 minutes injury/employment) to end inside the window
//   - the start is at least minNoticeHours from now and on a local date at most horizonDays ahead (inclusive)
//   - one attorney's consultations keep at least bufferMinutes between the end of one and the start of the next,
//     counted ONCE (the previous build counted it twice and so enforced 30 minutes while documenting 15)
//   - a person (same email or same phone number) has at most maxActiveBookingsPerPerson future bookings
//   - the conflict check must be literally "clear"; anything else becomes a held row for a person to review,
//     and the visitor is never told why
// The visitor picks a TIME. The rules pick the attorney (fewest future bookings, then the order in practice-areas.json).
// Two requests can pass the free-slot check at the same moment, because the n8n data table has no unique
// constraint. bookVerify settles that after the insert: rows are taken in insertion order (the table's row id),
// and a row that clashes with an earlier accepted row loses and is cancelled.

const BOOK_RULES_VERSION = 'dy-booking-v1';
const BOOK_CHANNELS = ['form', 'voice', 'email'];
const BOOK_LIMITS = { name: { min: 2, max: 100 }, otherSide: { max: 200 }, leadRef: { max: 40 }, listDefault: 40, listMax: 100, alternatives: 3 };
const BOOK_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const BOOK_FORMATTERS = {};

// ---- time in the firm's time zone (Intl only; no library) ----
function bookFormatter(tz, kind) {
  const key = tz + '|' + kind;
  if (!BOOK_FORMATTERS[key]) {
    const opts = {
      parts: { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' },
      short: { timeZone: tz, timeZoneName: 'short', hour: 'numeric' },
      long: { timeZone: tz, timeZoneName: 'long', hour: 'numeric' },
      date: { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      day: { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }
    }[kind];
    BOOK_FORMATTERS[key] = new Intl.DateTimeFormat('en-US', opts);
  }
  return BOOK_FORMATTERS[key];
}
function bookPad(n) { return String(n).padStart(2, '0'); }
function bookLocalParts(ms, tz) {
  const p = {};
  bookFormatter(tz, 'parts').formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, hh: (+p.hour) % 24, mm: +p.minute, dow: String(p.weekday).toLowerCase().slice(0, 3) };
}
function bookStamp(ms, tz) {
  const p = bookLocalParts(ms, tz);
  return p.y + '-' + bookPad(p.m) + '-' + bookPad(p.d) + ' ' + bookPad(p.hh) + ':' + bookPad(p.mm);
}
function bookZoneName(ms, tz, kind) {
  const part = bookFormatter(tz, kind).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
  return part ? part.value : tz;
}
function bookClock(p) { return (p.hh % 12 || 12) + ':' + bookPad(p.mm) + ' ' + (p.hh < 12 ? 'AM' : 'PM'); }
function bookLabel(ms, tz) {
  const p = bookLocalParts(ms, tz);
  return bookFormatter(tz, 'day').format(new Date(ms)) + ', ' + bookClock(p) + ' ' + bookZoneName(ms, tz, 'short');
}
// Local wall-clock time to a UTC instant. A time that does not exist (the spring-forward gap) returns null.
// A time that happens twice (the fall-back hour) returns the first one.
function bookLocalToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t) => { const p = bookLocalParts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - t; };
  let t = guess - offset(guess);
  t = guess - offset(t);
  const p = bookLocalParts(t, tz);
  return (p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm) ? t : null;
}
function bookAddDays(ymd, n) {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
  return dt.getUTCFullYear() + '-' + bookPad(dt.getUTCMonth() + 1) + '-' + bookPad(dt.getUTCDate());
}
function bookDowOf(ymd) { return BOOK_DOW[new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay()]; }
function bookToday(nowMs, tz) { return bookStamp(nowMs, tz).slice(0, 10); }
function bookMinutes(hhmm) { const a = String(hhmm).split(':'); return (+a[0]) * 60 + (+a[1]); }
function bookIso(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); }

// An ISO date-time WITH an explicit offset. A time with no offset is refused: it could mean any time zone.
function bookParseStart(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.exec(s);
  if (!m) return null;
  // Date.parse accepts 2026-02-30 as March 2. Check the calendar fields first so an impossible date is refused, not moved.
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mi = +m[5], ss = m[6] == null ? 0 : +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || hh > 23 || mi > 59 || ss > 59) return null;
  const ms = Date.parse(/[+-]\d{4}$/.test(s) ? s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : s);
  return isFinite(ms) ? ms : null;
}

// ---- data helpers ----
function bookArea(data, id) { return data.areas.areas.find((a) => a.id === id) || null; }
function bookAttorneyName(data, id) { const s = data.firm.staff.find((x) => x.id === id); return s ? s.name : id; }
function bookAttorneyRole(data, id) { const s = data.firm.staff.find((x) => x.id === id); return s ? s.role : 'Attorney'; }
function bookRows(items) {
  return (Array.isArray(items) ? items : []).map((i) => (i && i.json && typeof i.json === 'object' ? i.json : i)).filter((r) => r && typeof r === 'object' && r.bookingRef);
}
function bookRowSpan(r) { return { s: Date.parse(r.startUtc), e: Date.parse(r.endUtc) }; }
function bookIsBooked(r) { return !!r && r.status === 'booked' && isFinite(Date.parse(r.startUtc)) && isFinite(Date.parse(r.endUtc)); }
function bookDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function bookSamePerson(a, b) {
  const ea = String(a.email || '').trim().toLowerCase(), eb = String(b.email || '').trim().toLowerCase();
  const pa = bookDigits(a.phone), pb = bookDigits(b.phone);
  return (!!ea && ea === eb) || (pa.length >= 7 && pa === pb);
}
// Two spans clash when the gap between them is less than the buffer. A gap of exactly the buffer is allowed.
function bookClash(a, b, bufferMinutes) { const buf = bufferMinutes * 60000; return a.s < b.e + buf && b.s < a.e + buf; }
function bookFree(attorney, span, rows, bufferMinutes) {
  return !rows.some((r) => bookIsBooked(r) && r.attorney === attorney && bookClash(span, bookRowSpan(r), bufferMinutes));
}
function bookFeeText(area) {
  const c = area.consult;
  if (!c.feeUsd) return 'No charge for this first consultation.';
  return '$' + c.feeUsd + ' for this first consultation' + (c.creditedToRetainer ? ', credited toward the retainer if you hire the firm.' : '.');
}

// ---- slots ----
// Every slot the RULES allow, before any existing booking is considered.
function bookGenerate(areaId, nowMs, data) {
  const area = bookArea(data, areaId);
  if (!area) return [];
  const cfg = data.availability.booking, tz = data.firm.timezone;
  const dur = area.consult.minutes;
  const earliest = nowMs + cfg.minNoticeHours * 3600000;
  const today = bookToday(nowMs, tz);
  const out = [];
  for (let i = 0; i <= cfg.horizonDays; i++) {
    const date = bookAddDays(today, i), dow = bookDowOf(date);
    area.attorneys.forEach((att) => {
      (data.availability.windows[att] || []).forEach((w) => {
        if (w.day !== dow) return;
        const from = bookMinutes(w.start), to = bookMinutes(w.end);
        for (let t = from; t + dur <= to; t += cfg.slotStepMinutes) {
          const ms = bookLocalToUtc(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10), Math.floor(t / 60), t % 60, tz);
          if (ms === null || ms < earliest) continue;
          out.push({ attorney: att, startMs: ms, endMs: ms + dur * 60000 });
        }
      });
    });
  }
  return out;
}
// Free start times for an area: [{ startMs, endMs, attorneys: [ids free at that time] }] in time order.
function bookOffers(areaId, rows, nowMs, data, opts) {
  const o = opts || {}, buf = data.availability.booking.bufferMinutes;
  const byStart = {};
  bookGenerate(areaId, nowMs, data).forEach((s) => {
    if (o.afterMs != null && s.startMs <= o.afterMs) return;
    if (!bookFree(s.attorney, { s: s.startMs, e: s.endMs }, rows, buf)) return;
    (byStart[s.startMs] = byStart[s.startMs] || { startMs: s.startMs, endMs: s.endMs, attorneys: [] }).attorneys.push(s.attorney);
  });
  const list = Object.keys(byStart).map(Number).sort((a, b) => a - b).map((k) => byStart[k]);
  return o.limit ? list.slice(0, o.limit) : list;
}
function bookPublicSlot(s, tz) { const p = bookLocalParts(s.startMs, tz); return { start: bookIso(s.startMs), date: p.y + '-' + bookPad(p.m) + '-' + bookPad(p.d), time: bookPad(p.hh) + ':' + bookPad(p.mm), label: bookLabel(s.startMs, tz) }; }

// The slots endpoint. body: { area, after?, limit? }. Returns only times, never who is booked or why a time is missing.
function bookListSlots(body, rowsIn, nowMs, data) {
  const b = body || {};
  const area = bookArea(data, String(b.area == null ? '' : b.area));
  if (!area) return { ok: false, code: 'invalid', errors: { area: 'Please choose one of the practice areas.' } };
  let afterMs = null;
  if (b.after != null && b.after !== '') {
    afterMs = bookParseStart(b.after);
    if (afterMs === null) return { ok: false, code: 'invalid', errors: { after: 'Please use a date and time with a time zone, or leave it out.' } };
  }
  const n = Math.floor(Number(b.limit));
  const limit = n >= 1 ? Math.min(n, BOOK_LIMITS.listMax) : BOOK_LIMITS.listDefault;
  const tz = data.firm.timezone;
  const all = bookOffers(area.id, bookRows(rowsIn), nowMs, data, { afterMs });
  const shown = all.slice(0, limit);
  return {
    ok: true, area: area.id, areaName: area.name, timezone: tz, timezoneName: bookZoneName(nowMs, tz, 'long'),
    consultMinutes: area.consult.minutes, fee: bookFeeText(area),
    slots: shown.map((s) => bookPublicSlot(s, tz)), more: all.length > shown.length,
    note: 'Times are in the firm\'s local time (' + tz + '). Booking a time does not create an attorney-client relationship.'
  };
}

// ---- validating a booking request ----
function bookClean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max == null ? 5000 : max + 1);
}
function bookValidate(body, data) {
  const b = body || {};
  if (bookClean(b.website, 50)) return { ok: false, spam: true };
  const errors = {};
  const areaIds = data.areas.areas.map((a) => a.id);
  const clean = {
    name: bookClean(b.name, BOOK_LIMITS.name.max),
    email: bookClean(b.email, 254).toLowerCase(),
    phone: bookClean(b.phone, 30),
    area: bookClean(b.area, 20),
    otherSide: bookClean(b.otherSide, BOOK_LIMITS.otherSide.max),
    noOtherSide: b.noOtherSide === true || b.noOtherSide === 'true' || b.noOtherSide === 'on' || b.noOtherSide === 'yes',
    channel: bookClean(b.channel, 10) || 'form',
    leadRef: bookClean(b.leadRef, BOOK_LIMITS.leadRef.max),
    startMs: bookParseStart(b.start)
  };
  if (clean.name.length < BOOK_LIMITS.name.min || clean.name.length > BOOK_LIMITS.name.max || !/^[\p{L}\p{M}0-9 .,'’-]+$/u.test(clean.name)) errors.name = 'Please enter your name using letters, spaces, hyphens or apostrophes.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email)) errors.email = 'Please enter a valid email address.';
  if (clean.phone) {
    const digits = bookDigits(clean.phone);
    if (digits.length < 7 || digits.length > 15 || /[^0-9+()\-. ]/.test(clean.phone)) errors.phone = 'Please enter a valid phone number, or leave it blank.';
  }
  if (areaIds.indexOf(clean.area) === -1) errors.area = 'Please choose one of the practice areas.';
  if (BOOK_CHANNELS.indexOf(clean.channel) === -1) errors.channel = 'Unknown booking channel.';
  if (clean.otherSide.length > BOOK_LIMITS.otherSide.max) errors.otherSide = 'Please keep it under ' + BOOK_LIMITS.otherSide.max + ' characters.';
  else if (!clean.otherSide && !clean.noOtherSide) errors.otherSide = 'Please enter the other person or organization, or confirm that there is no other side.';
  if (!/^[A-Za-z0-9-]*$/.test(clean.leadRef) || clean.leadRef.length > BOOK_LIMITS.leadRef.max) errors.leadRef = 'Unknown reference.';
  if (clean.startMs === null) errors.start = 'Please choose a time from the list.';
  const consent = b.consent === true || b.consent === 'true' || b.consent === 'on' || b.consent === 'yes';
  if (!consent) errors.consent = 'Please confirm that you agree to be contacted and understand this is not legal advice.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, clean };
}

// ---- the fixed confirmation email ----
function bookConfirmation(row, data) {
  const f = data.firm, area = bookArea(data, row.area), startMs = Date.parse(row.startUtc), tz = f.timezone;
  const when = bookFormatter(tz, 'date').format(new Date(startMs)) + ' at ' + bookClock(bookLocalParts(startMs, tz)) + ' ' + bookZoneName(startMs, tz, 'short');
  const lines = [
    'Hello ' + row.name + ',',
    '',
    'Your first consultation with ' + f.name + ' is booked.',
    '',
    'When: ' + when,
    'Time zone: ' + bookZoneName(startMs, tz, 'long') + ' (the firm\'s local time)',
    'How long: ' + row.minutes + ' minutes',
    'With: ' + bookAttorneyName(data, row.attorney) + ', ' + bookAttorneyRole(data, row.attorney).toLowerCase(),
    'Where: ' + f.address,
    'Fee: ' + bookFeeText(area),
    'Reference: ' + row.bookingRef,
    '',
    'Please bring:'
  ].concat(area.bring.map((x) => '- ' + x), [
    '',
    f.language.noConfidential,
    '',
    'To change or cancel, call ' + f.phone + ' or email ' + f.emails.general + ' at least ' + data.availability.booking.cancelNoticeHours + ' hours before your appointment. Replying to this message does not change your booking.',
    '',
    f.language.notLegalAdvice,
    f.language.fictional
  ]);
  return { subject: 'Your consultation with ' + f.name + ': ' + bookLabel(startMs, tz), text: lines.join('\n') };
}

// ---- what the visitor sees. Fixed words; nothing from the request is repeated except the name in the email. ----
function bookPublic(r, data) {
  const f = data.firm, contact = 'We cannot confirm this booking online. Please call ' + f.phone + ' or email ' + f.emails.general + ' and the office will help you.';
  if (r.code === 'booked') {
    const row = r.row, startMs = Date.parse(row.startUtc);
    return {
      ok: true, code: 'booked', ref: row.bookingRef, start: row.startUtc, label: bookLabel(startMs, f.timezone), minutes: row.minutes,
      attorney: bookAttorneyName(data, row.attorney), address: f.address, fee: bookFeeText(bookArea(data, row.area)),
      message: 'Your first consultation is booked. We are sending a confirmation email to the address you gave. ' + f.language.notLegalAdvice
    };
  }
  if (r.code === 'invalid') return { ok: false, code: 'invalid', errors: r.errors };
  if (r.code === 'not_offered' || r.code === 'slot_taken') {
    return { ok: false, code: 'slot_unavailable', message: 'That time is not available. Please choose another time.', alternatives: r.alternatives || [] };
  }
  if (r.code === 'already_booked' || r.code === 'conflict_hold') return { ok: false, code: 'contact_office', message: contact };
  return { ok: false, code: 'unavailable', message: 'We could not complete this request. Please try again later or call ' + f.phone + '.' };
}

// ---- the booking decision ----
// body: the request. rows: the bookings table. ctx: { ref, now (ISO) }. Returns a result with the table row (booked or held),
// the confirmation email, a metadata-only event and the public answer.
function bookDecide(body, rowsIn, nowMs, data, ctx) {
  const c0 = ctx || {}, cfg = data.availability.booking, tz = data.firm.timezone;
  const rows = bookRows(rowsIn);
  const finish = (r) => {
    r.public = bookPublic(r, data);
    r.event = { at: c0.now || bookIso(nowMs), source: 'booking', code: r.code, reason: r.reason || '', area: r.area || '', channel: r.channel || '', attorney: (r.row && r.row.attorney) || '', rulesVersion: BOOK_RULES_VERSION };
    return r;
  };
  const v = bookValidate(body, data);
  if (v.spam) return finish({ ok: false, code: 'spam' });
  if (!v.ok) return finish({ ok: false, code: 'invalid', errors: v.errors });
  const c = v.clean, area = bookArea(data, c.area);
  const base = { area: area.id, channel: c.channel };
  const rowBase = { bookingRef: c0.ref || '', createdAt: c0.now || bookIso(nowMs), area: area.id, name: c.name, email: c.email, phone: c.phone, channel: c.channel, leadRef: c.leadRef, confirmation: '', rulesVersion: BOOK_RULES_VERSION };

  // 1. conflict check. Held people get a row with no time so a person can follow up; they are never told why.
  const conflict = checkConflicts({ prospect: c.name, otherSide: c.otherSide, description: '' }, data.conflicts.entries);
  const status = (conflict.status === 'not_provided' && c.noOtherSide) ? 'clear' : conflict.status;
  if (cfg.requiresConflictClear && status !== 'clear') {
    const row = Object.assign({}, rowBase, { status: 'held', attorney: '', startUtc: '', endUtc: '', localDate: '', localTime: '', minutes: 0, note: conflict.matches.map((m) => m.id + ' ' + m.side + ': ' + m.reason).join('; ') || 'conflict check: ' + status });
    return finish(Object.assign({ ok: false, code: 'conflict_hold', reason: 'conflict_' + status, row }, base));
  }

  // 2. one active booking per person
  const mine = rows.filter((r) => bookIsBooked(r) && bookRowSpan(r).e > nowMs && bookSamePerson(r, c)).length;
  if (mine >= cfg.maxActiveBookingsPerPerson) return finish(Object.assign({ ok: false, code: 'already_booked', reason: 'person_limit' }, base));

  // 3. the time
  const startMs = c.startMs, endMs = startMs + area.consult.minutes * 60000;
  const alternatives = () => {
    let alt = bookOffers(area.id, rows, nowMs, data, { afterMs: startMs, limit: BOOK_LIMITS.alternatives });
    if (!alt.length) alt = bookOffers(area.id, rows, nowMs, data, { limit: BOOK_LIMITS.alternatives });
    return alt.map((s) => bookPublicSlot(s, tz));
  };
  if (startMs < nowMs + cfg.minNoticeHours * 3600000) return finish(Object.assign({ ok: false, code: 'not_offered', reason: 'too_soon', alternatives: alternatives() }, base));
  if (bookStamp(startMs, tz).slice(0, 10) > bookAddDays(bookToday(nowMs, tz), cfg.horizonDays)) return finish(Object.assign({ ok: false, code: 'not_offered', reason: 'beyond_horizon', alternatives: alternatives() }, base));
  const ruleSlots = bookGenerate(area.id, nowMs, data).filter((s) => s.startMs === startMs);
  if (!ruleSlots.length) return finish(Object.assign({ ok: false, code: 'not_offered', reason: 'outside_hours', alternatives: alternatives() }, base));
  const free = ruleSlots.filter((s) => bookFree(s.attorney, { s: startMs, e: endMs }, rows, cfg.bufferMinutes)).map((s) => s.attorney);
  if (!free.length) return finish(Object.assign({ ok: false, code: 'slot_taken', reason: 'attorney_busy', alternatives: alternatives() }, base));

  // 4. assign the attorney: fewest future bookings, then the order in practice-areas.json
  const load = (att) => rows.filter((r) => bookIsBooked(r) && r.attorney === att && bookRowSpan(r).e > nowMs).length;
  const attorney = free.slice().sort((a, b) => load(a) - load(b) || area.attorneys.indexOf(a) - area.attorneys.indexOf(b))[0];
  const p = bookLocalParts(startMs, tz);
  const row = Object.assign({}, rowBase, {
    status: 'booked', attorney, startUtc: bookIso(startMs), endUtc: bookIso(endMs),
    localDate: p.y + '-' + bookPad(p.m) + '-' + bookPad(p.d), localTime: bookPad(p.hh) + ':' + bookPad(p.mm), minutes: area.consult.minutes, note: ''
  });
  return finish(Object.assign({ ok: true, code: 'booked', row, confirmation: bookConfirmation(row, data) }, base));
}

// After the insert: which rows keep their slot? Rows are taken in insertion order (the table's row id). A row that
// clashes with an accepted row (same attorney inside the buffer) or repeats an accepted person loses.
// Only rows with a smaller id can beat a row, and every smaller id was inserted before this one, so every caller
// sees the same answer.
function bookVerify(rowId, rowsIn, nowMs, data) {
  const cfg = data.availability.booking;
  const list = bookRows(rowsIn).filter((r) => bookIsBooked(r) && bookRowSpan(r).e > nowMs).sort((a, b) => Number(a.id) - Number(b.id));
  const accepted = [], lost = {};
  list.forEach((r) => {
    if (accepted.filter((a) => bookSamePerson(a, r)).length >= cfg.maxActiveBookingsPerPerson) { lost[r.id] = 'already_booked'; return; }
    if (accepted.some((a) => a.attorney === r.attorney && bookClash(bookRowSpan(a), bookRowSpan(r), cfg.bufferMinutes))) { lost[r.id] = 'slot_taken'; return; }
    accepted.push(r);
  });
  return { accepted: accepted.map((r) => r.id), lost, won: accepted.some((r) => String(r.id) === String(rowId)) };
}

// The row was inserted but lost the race (or the person already had a booking). The visitor gets the same
// "that time is not available" answer as any other taken slot, with fresh alternatives. The loser's own row is left out of the list.
function bookRaceLost(row, reason, rowsIn, nowMs, data) {
  const others = bookRows(rowsIn).filter((r) => r.bookingRef !== row.bookingRef);
  const r = { ok: false, code: reason === 'already_booked' ? 'already_booked' : 'slot_taken', reason: 'race_lost', area: row.area, channel: row.channel };
  r.alternatives = bookOffers(row.area, others, nowMs, data, { afterMs: Date.parse(row.startUtc), limit: BOOK_LIMITS.alternatives }).map((s) => bookPublicSlot(s, data.firm.timezone));
  r.public = bookPublic(r, data);
  r.event = { at: bookIso(nowMs), source: 'booking', code: r.code, reason: r.reason, area: row.area, channel: row.channel, attorney: row.attorney, rulesVersion: BOOK_RULES_VERSION };
  return r;
}

// What the visitor is told once the confirmation email has been tried. If it could not be sent they are told so,
// and given the reference to keep. The booking itself stands either way.
function bookConfirmedPublic(pub, sent, data) {
  return Object.assign({}, pub, {
    confirmationSent: !!sent,
    message: sent ? pub.message : 'Your first consultation is booked, but we could not send the confirmation email. Please keep this reference (' + pub.ref + ') and call ' + data.firm.phone + ' if you have a question. ' + data.firm.language.notLegalAdvice
  });
}

// Cancelling on the website is allowed up to cancelNoticeHours before the start. Later changes go through the office.
function bookCancelDecision(row, nowMs, data) {
  const cfg = data.availability.booking;
  if (!bookIsBooked(row) || bookRowSpan(row).e <= nowMs) return { allowed: false, reason: 'not_active' };
  if (nowMs > bookRowSpan(row).s - cfg.cancelNoticeHours * 3600000) return { allowed: false, reason: 'late' };
  return { allowed: true, reason: '' };
}

module.exports = {
  BOOK_RULES_VERSION, BOOK_LIMITS, bookLocalParts, bookStamp, bookLocalToUtc, bookLabel, bookParseStart, bookGenerate, bookOffers, bookListSlots,
  bookValidate, bookConfirmation, bookPublic, bookDecide, bookVerify, bookRaceLost, bookConfirmedPublic, bookCancelDecision, bookRows, bookIso, bookFeeText
};
