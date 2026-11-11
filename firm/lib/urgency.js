'use strict';
const { lowerText, findPhrase, maskSpan, stripHarmlessPhrases } = require('./text');
// Flag messages that look time-sensitive: court dates, served papers, deadlines, safety, arrest, lockout.
// data is firm/urgency.json. today is 'YYYY-MM-DD' in the firm's timezone.
// Rules this code follows (see firm/urgency.json "neverDo"):
//   - it only repeats a date as the sender wrote it; it never says what a legal deadline is,
//   - a flag is a request for a person to look, never advice.

const URGENCY_MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12
};
const URGENCY_WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const URGENCY_NEAR_CHARS = 90;

function isoToUtc(iso) {
  const p = iso.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
function utcToIso(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function daysFromToday(iso, today) {
  return Math.round((isoToUtc(iso) - isoToUtc(today)) / 86400000);
}
function validParts(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// A date written without a year means the nearest one that is not much in the past.
function resolveYear(m, d, today) {
  const ty = Number(today.slice(0, 4));
  let y = ty;
  if (validParts(y, m, d) && daysFromToday(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), today) < -30) y = ty + 1;
  return y;
}
function makeDate(y, m, d, today, raw, index) {
  const year = y == null ? resolveYear(m, d, today) : (y < 100 ? 2000 + y : y);
  if (!validParts(year, m, d)) return null;
  const iso = year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return { raw, iso, days: daysFromToday(iso, today), index };
}

// Dates written in the text: 2026-11-16, 11/16, 11/16/2026, Nov 16, November 16th 2026, 16 November,
// plus tomorrow, today, tonight, yesterday, 'in 3 days' and weekday names.
function extractDates(text, today, original) {
  const out = [];
  const orig = original || text;
  let work = text;
  const monthNames = Object.keys(URGENCY_MONTHS).join('|');
  const todayWd = new Date(isoToUtc(today)).getUTCDay();
  const take = (re, build0) => {
    // builders see m.raw: the sender's own wording of the date, with their capital letters
    const build = (m) => { m.raw = orig.substr(m.index, m[0].length); return build0(m); };
    re.lastIndex = 0;
    let m;
    const spans = [];
    while ((m = re.exec(work))) {
      const d = build(m);
      if (d) out.push(d);
      spans.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
    spans.forEach((s) => { work = maskSpan(work, s[0], s[1]); });
  };
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => makeDate(+m[1], +m[2], +m[3], today, m.raw, m.index));
  take(new RegExp('\\b(' + monthNames + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'g'),
    (m) => makeDate(m[3] ? +m[3] : null, URGENCY_MONTHS[m[1]], +m[2], today, m.raw, m.index));
  take(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + monthNames + ')\\b\\.?(?:,?\\s+(\\d{4}))?', 'g'),
    (m) => makeDate(m[3] ? +m[3] : null, URGENCY_MONTHS[m[2]], +m[1], today, m.raw, m.index));
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (m) => makeDate(m[3] ? +m[3] : null, +m[1], +m[2], today, m.raw, m.index));
  const rel = (days) => (m) => ({ raw: m.raw, iso: utcToIso(isoToUtc(today) + days * 86400000), days, index: m.index });
  take(/\btomorrow\b/g, rel(1));
  take(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/g, rel(0));
  take(/\byesterday\b/g, rel(-1));
  take(/\b(?:in|within) (\d{1,2}) days?\b/g, (m) => rel(+m[1])(m));
  take(/\b(\d{1,2}) days? (?:left|to respond|to file|from now)\b/g, (m) => rel(+m[1])(m));
  // 'the 16th' with no month: the next time that day of the month comes round.
  take(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/g, (m) => {
    const t = today.split('-').map(Number);
    let y = t[0];
    let mo = t[1];
    if (+m[1] < t[2]) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    return makeDate(y, mo, +m[1], today, m.raw, m.index);
  });
  // A weekday means the next one coming. 'next Monday' is read the same way, because the other
  // reading (the Monday after) would make a hearing look further away than it may be.
  take(/\b(?:next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g, (m) => {
    const days = ((URGENCY_WEEKDAYS[m[1]] - todayWd + 7) % 7) || 7;
    return rel(days)(m);
  });
  return out.sort((a, b) => a.index - b.index);
}

// input: { text, hearing } where hearing is the form answer: none | within7 | later | unsure.
// Returns { level: 'urgent' | 'check' | 'none', timeClass, flags, alsoShow }.
//   urgent = a person should look straight away; check = time-sensitive but nothing says it is within the window.
function detectUrgency(input, data, today) {
  // A lowercase copy with the same length as the original, so indexes line up and dates keep the sender's wording.
  const original = String((input && input.text) || '');
  const text = stripHarmlessPhrases(original.toLowerCase());
  const hearing = (input && input.hearing) || 'none';
  const threshold = data.dayThreshold;
  const dates = extractDates(text, today, original);
  const flags = [];

  for (const cat of data.categories) {
    const found = [];
    for (const phrase of cat.phrases) {
      const m = findPhrase(text, phrase);
      if (m) found.push({ phrase, index: m.index });
    }
    if (!found.length) continue;
    const flag = { id: cat.id, label: cat.label, why: cat.why, phrases: found.map((f) => f.phrase), level: 'urgent', reason: 'raised on sight', date: null, alsoShow: cat.alsoShow || null };
    if (cat.usesDateWindow) {
      let best = null;
      for (const f of found) {
        for (const d of dates) {
          const dist = Math.abs(d.index - f.index);
          if (dist > URGENCY_NEAR_CHARS) continue;
          if (!best || dist < best.dist || (dist === best.dist && d.days > best.d.days)) best = { dist, d };
        }
      }
      if (!best) {
        flag.level = 'check'; flag.reason = 'no date given';
      } else {
        flag.date = { raw: best.d.raw, iso: best.d.iso, days: best.d.days };
        if (best.d.days < 0) { flag.level = 'urgent'; flag.reason = 'date has passed (as written)'; }
        else if (best.d.days <= threshold) { flag.level = 'urgent'; flag.reason = 'date within ' + threshold + ' days (as written)'; }
        else { flag.level = 'check'; flag.reason = 'date later than ' + threshold + ' days (as written)'; }
      }
    }
    flags.push(flag);
  }

  if (hearing === 'within7') {
    flags.push({ id: 'self_reported', label: 'Sender says a hearing or deadline is within ' + threshold + ' days', why: 'Stated on the form.', phrases: [], level: 'urgent', reason: 'form answer', date: null, alsoShow: null });
  } else if (hearing === 'later') {
    flags.push({ id: 'self_reported_later', label: 'Sender says a hearing or deadline is later than ' + threshold + ' days', why: 'Stated on the form.', phrases: [], level: 'check', reason: 'form answer', date: null, alsoShow: null });
  } else if (hearing === 'unsure') {
    flags.push({ id: 'self_reported_unsure', label: 'Sender is not sure whether a hearing or deadline is close', why: 'Stated on the form.', phrases: [], level: 'check', reason: 'form answer', date: null, alsoShow: null });
  }

  const urgent = flags.some((f) => f.level === 'urgent');
  const level = urgent ? 'urgent' : (flags.length ? 'check' : 'none');
  let timeClass = 'none';
  if (urgent) timeClass = 'within7';
  else if (flags.some((f) => (f.date && f.date.days > threshold) || f.id === 'self_reported_later')) timeClass = 'later';
  else if (flags.length) timeClass = 'unsure';
  const alsoShow = Array.from(new Set(flags.map((f) => f.alsoShow).filter(Boolean)));
  return { level, timeClass, flags, alsoShow };
}

module.exports = { extractDates, detectUrgency, daysFromToday };
