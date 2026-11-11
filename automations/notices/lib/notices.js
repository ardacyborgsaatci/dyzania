'use strict';
const { extractDates, daysFromToday } = require('../../../firm/lib/urgency');
// Hollis & Marr court-notice reading. Pure functions: no network, no clock of its own (every function that needs
// today takes it), no model call. A vision model copies what is printed on a scan into JSON. This file turns that
// copy into a row, a priority and an alert. The model gives an opinion about the page; these rules decide.
//
// What the rules are:
//   - every result has the status "Needs attorney confirmation", including a failed read. Nothing in this file,
//     and nothing a document says, can produce another status. Only a person changes it, in the table.
//   - the code never works out a deadline. It repeats a date as printed (dateText) and counts the days between
//     that date and today only to decide who looks first. A time limit counted from another event
//     ("within 21 days after service") is copied as printed and never turned into a date.
//   - the model's own ISO date is checked against the date as printed. If they disagree both are used, the
//     earlier one decides, and the row is flagged.
//   - urgent: a summons or subpoena, any date on the notice within the window or already passed (as printed),
//     a poor scan, a date that is printed but could not be read, or a read that failed. A passed date is urgent
//     because a vacated or replaced date is still a reason for a person to look; the code never suppresses
//     a date because of the words around it.
//   - high: every other court paper, and any document that carries text addressed to an automated system.
//   - normal: only a document the model says is not a court document, and only if nothing else is wrong with it.
//   - the alert holds no party names and no text copied from the page other than a date as printed.

const NOTICE_VERSION = 'hm-notices-v1';
const NOTICE_PROMPT_VERSION = 'hm-notice-extract-v1';
const NOTICE_STATUS = 'Needs attorney confirmation';
const NOTICE_TYPES = ['hearing_notice', 'summons', 'subpoena', 'order', 'motion_notice', 'other_court_paper', 'not_a_court_document'];
const NOTICE_KINDS = ['hearing', 'trial', 'conference', 'appearance', 'response_due', 'filing_due', 'other'];
const NOTICE_LEGIBILITY = ['clear', 'partial', 'poor'];
const NOTICE_CONFIDENCE = ['high', 'medium', 'low'];
const NOTICE_SERVED = ['summons', 'subpoena'];
const NOTICE_RANK = { normal: 0, high: 1, urgent: 2 };
const NOTICE_LIMITS = { court: 200, caseNumber: 60, party: 200, addressed: 200, dateText: 120, time: 40, label: 200, location: 200, relative: 300, unreadable: 100, events: 20, relativeCount: 5, unreadableCount: 5, summary: 400 };
const NOTICE_MAX_TOKENS = 3000;
const NOTICE_NULL_WORDS = ['null', 'none', 'n/a', 'na', 'unknown', 'not stated', 'not shown', 'not visible', 'not provided'];

const NOTICE_TYPE_TEXT = {
  hearing_notice: 'hearing notice', summons: 'summons', subpoena: 'subpoena', order: 'order', motion_notice: 'motion notice',
  other_court_paper: 'other court paper', not_a_court_document: 'not a court document'
};
const NOTICE_REASON_TEXT = {
  served_papers: 'a summons or subpoena (served papers)',
  date_within_window: 'a date on the notice is within the urgent window',
  date_passed: 'a date on the notice has already passed (as printed)',
  date_unreadable: 'a date appears on the notice but could not be read',
  legibility: 'the scan is hard to read',
  read_failed: 'the notice could not be read automatically',
  relative_deadline: 'the notice states a time limit counted from another event',
  injection_suspected: 'the document contains text that looks like instructions to an automated system',
  no_date_found: 'no date was found on the notice',
  not_court_document: 'the document does not look like a court paper'
};

// Words aimed at an automated reader. Kept in step with the triage list on purpose (a test compares them),
// with extra patterns for text printed on a document.
const NOTICE_INJECTION = [
  { id: 'ignore_instructions', re: /(?:ignore|disregard) (?:all |any |the )?(?:previous|prior|above|earlier|your) (?:instructions|prompts?|rules|guidelines)/i },
  { id: 'reveal_prompt', re: /(?:reveal|print|show|disclose|repeat|output|display) (?:me )?(?:your |the )?(?:full |complete |entire |hidden )?(?:system|initial) ?(?:prompt|instructions|message)/i },
  { id: 'system_override', re: /system (?:override|prompt|message)/i },
  { id: 'role_change', re: /you are (?:now )?(?:no longer|now in|dan\b)/i },
  { id: 'mode_switch', re: /(?:admin|developer|god|jailbreak) mode/i },
  { id: 'markup_tag', re: /<\/?(?:instructions?|system|assistant|prompt|document|notice)>/i },
  { id: 'do_not_alert', re: /do not (?:escalate|flag|alert|notify)/i },
  { id: 'force_priority', re: /\b(?:set|mark|change|lower|downgrade|treat)\b[^.\n]{0,30}\b(?:priority|urgency)\b/i },
  { id: 'force_status', re: /\b(?:mark|set|treat|record|log)\b[^.\n]{0,40}\b(?:as|to) (?:reviewed|approved|confirmed|routine|low priority|not urgent)\b/i },
  { id: 'to_automated', re: /(?:note|message|instructions?) (?:to|for) (?:the )?(?:automated|ai|assistant|model|llm|document[- ]processing|processing)/i }
];

const NOTICE_HIDDEN = /[​-‏‪-‮⁠-⁤﻿]/g;
const NOTICE_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NOTICE_MONTH_WORD = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/i;

function noticeUnique(list) {
  const out = [];
  list.forEach((x) => { if (out.indexOf(x) === -1) out.push(x); });
  return out;
}

function noticeInjectionHits(text) {
  const t = String(text == null ? '' : text);
  return NOTICE_INJECTION.filter((p) => p.re.test(t)).map((p) => p.id);
}

// One string from the model: control and zero-width characters out, white space collapsed, length capped.
// Objects, arrays, and the words models use for "nothing" become null.
function noticeClean(v, max) {
  if (v === null || v === undefined || typeof v === 'object' || typeof v === 'function' || typeof v === 'boolean') return null;
  const s = String(v).replace(NOTICE_HIDDEN, '').replace(NOTICE_CTRL, ' ').replace(/\s+/g, ' ').trim();
  if (!s || NOTICE_NULL_WORDS.indexOf(s.toLowerCase()) !== -1) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

// 'YYYY-MM-DD' that is a real calendar date between 2000 and 2100, or null.
function noticeValidIso(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const y = +t.slice(0, 4), m = +t.slice(5, 7), d = +t.slice(8, 10);
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : null;
}

function noticeToday(nowMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function noticeMakeRef(today, salt, seq) {
  return 'N-' + String(today).replace(/-/g, '') + '-' + String(salt || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) + '-' + String(seq).padStart(2, '0');
}

// ---- the model's text -> a plain object ----
function noticeParseModel(text) {
  if (typeof text !== 'string') return { ok: false, error: 'no_output' };
  let t = text.trim();
  if (!t) return { ok: false, error: 'empty' };
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, error: 'no_json' };
  try {
    const v = JSON.parse(t.slice(a, b + 1));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not_object' };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: 'bad_json' };
  }
}

function noticePick(v, list) {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  return list.indexOf(s) !== -1 ? s : null;
}

function noticeEvent(e) {
  const rawIso = e.dateIso;
  const iso = noticeValidIso(rawIso);
  return {
    kind: noticePick(e.kind, NOTICE_KINDS) || 'other',
    label: noticeClean(e.label, NOTICE_LIMITS.label),
    dateText: noticeClean(e.dateText, NOTICE_LIMITS.dateText),
    dateIso: iso,
    dateIsoInvalid: noticeClean(rawIso, 40) !== null && iso === null,
    timeText: noticeClean(e.timeText, NOTICE_LIMITS.time),
    location: noticeClean(e.location, NOTICE_LIMITS.location)
  };
}

// Known fields only. Anything else the model returned (a priority, a status, an "approved") is dropped here.
function noticeNormalize(o) {
  const flags = [];
  let type = noticePick(o.documentType, NOTICE_TYPES);
  if (!type) { type = 'other_court_paper'; flags.push('type_unrecognized'); }
  const rawEvents = Array.isArray(o.events) ? o.events : [];
  if (rawEvents.length > NOTICE_LIMITS.events) flags.push('events_truncated');
  const events = rawEvents.slice(0, NOTICE_LIMITS.events).filter((e) => e && typeof e === 'object' && !Array.isArray(e)).map(noticeEvent);
  const rawRel = Array.isArray(o.relativeDeadlines) ? o.relativeDeadlines : [];
  const relativeDeadlines = rawRel.map((x) => noticeClean(x, NOTICE_LIMITS.relative)).filter((x) => x !== null).slice(0, NOTICE_LIMITS.relativeCount);
  const rawUnread = Array.isArray(o.unreadable) ? o.unreadable : [];
  const unreadable = rawUnread.map((x) => noticeClean(x, NOTICE_LIMITS.unreadable)).filter((x) => x !== null).slice(0, NOTICE_LIMITS.unreadableCount);
  let legibility = noticePick(o.legibility, NOTICE_LEGIBILITY);
  if (!legibility) { legibility = 'partial'; flags.push('legibility_missing'); }
  const v = {
    documentType: type,
    court: noticeClean(o.court, NOTICE_LIMITS.court),
    caseNumber: noticeClean(o.caseNumber, NOTICE_LIMITS.caseNumber),
    partyOne: noticeClean(o.partyOne, NOTICE_LIMITS.party),
    partyTwo: noticeClean(o.partyTwo, NOTICE_LIMITS.party),
    addressedTo: noticeClean(o.addressedTo, NOTICE_LIMITS.addressed),
    documentDateText: noticeClean(o.documentDateText, NOTICE_LIMITS.dateText),
    documentDateIso: noticeValidIso(o.documentDateIso),
    events, relativeDeadlines, unreadable, legibility,
    confidence: noticePick(o.confidence, NOTICE_CONFIDENCE),
    modelInjection: o.injectionSuspected === true
  };
  // A document called "not a court document" that nevertheless has a court, a case number, an event or a time limit
  // is not trusted as "not a court document".
  if (v.documentType === 'not_a_court_document' && (v.court || v.caseNumber || events.length || relativeDeadlines.length)) {
    v.documentType = 'other_court_paper';
    flags.push('type_inconsistent');
  }
  return { value: v, flags };
}

// Dates that are really written in a piece of text (a month name, 11/16 or 2026-11-16), not 'tomorrow' or 'Monday'.
function noticeWrittenDates(text, today) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  return extractDates(lower, today, text).filter((d) => NOTICE_MONTH_WORD.test(d.raw) || /\d{1,2}\/\d{1,2}/.test(d.raw) || /\d{4}-\d{2}-\d{2}/.test(d.raw))
    .map((d) => ({ iso: d.iso, hasYear: /\b\d{4}\b/.test(d.raw) || /\d{1,2}\/\d{1,2}\/\d{2}\b/.test(d.raw) }));
}

// The dates one event counts for. The date as printed and the model's ISO date are both read; if they differ,
// both count and the row is flagged.
function noticeEventDates(ev, today) {
  const flags = [];
  const written = noticeWrittenDates(ev.dateText, today);
  const iso = ev.dateIso;
  let candidates = [];
  let unreadable = false;
  if (iso && written.length) {
    if (written.some((w) => w.iso === iso)) candidates = [iso];
    else { candidates = noticeUnique(written.map((w) => w.iso).concat(iso)); flags.push('date_mismatch'); }
  } else if (iso) {
    candidates = [iso];
    flags.push('date_unverified');
  } else if (written.length) {
    candidates = noticeUnique(written.map((w) => w.iso));
    flags.push('date_from_text');
  } else if (ev.dateText || ev.dateIsoInvalid) {
    unreadable = true;
    flags.push('date_unreadable');
  }
  if (ev.dateIsoInvalid) flags.push('date_invalid');
  if (written.some((w) => !w.hasYear)) flags.push('year_inferred');
  return { candidates, flags, unreadable };
}

function noticeSummary(events) {
  const s = events.map((e) => e.kind + ': ' + (e.dateText || e.dateIso || 'no date') + (e.timeText ? ' ' + e.timeText : '')).join('; ');
  return s.length > NOTICE_LIMITS.summary ? s.slice(0, NOTICE_LIMITS.summary - 1) + '…' : s;
}

function noticeEmptyRow(ctx, data) {
  const c = ctx || {};
  return {
    ref: c.ref || '', receivedAt: c.now || '', fileName: noticeClean(c.fileName, 200) || '', readStatus: 'failed',
    documentType: '', court: '', caseNumber: '', partyOne: '', partyTwo: '', addressedTo: '', documentDateText: '', documentDateIso: '',
    events: '[]', relativeDeadlines: '[]', eventsSummary: '', earliestDateIso: '', daysAtReceipt: null,
    priority: 'urgent', reasons: '', flags: '', legibility: '', confidence: '',
    status: NOTICE_STATUS, confirmedBy: '', confirmedAt: '', promptVersion: NOTICE_PROMPT_VERSION, rulesVersion: NOTICE_VERSION, model: c.model || ''
  };
}

// The whole decision for one notice. Never throws for any model text; never returns another status.
//   modelText: the model's reply (a string), or null if the call failed.
//   ctx: { today: 'YYYY-MM-DD', now: ISO time, ref, fileName, model, modelFailed }
//   data: { urgency: { dayThreshold } }
function noticeAssess(modelText, ctx, data) {
  const c = ctx || {};
  if (noticeValidIso(c.today) === null) throw new Error('noticeAssess needs ctx.today as YYYY-MM-DD');
  const threshold = data.urgency.dayThreshold;
  const row = noticeEmptyRow(c, data);
  const reasons = [];
  let flags = [];
  let level = 'normal';
  const raise = (to, why) => {
    if (why && reasons.indexOf(why) === -1) reasons.push(why);
    if (NOTICE_RANK[to] > NOTICE_RANK[level]) level = to;
  };
  const out = { status: NOTICE_STATUS, extraction: null, dates: [], earliest: null };
  const fail = (why) => {
    flags.push(why);
    raise('urgent', 'read_failed');
    return noticeFinish(out, row, level, reasons, flags, c, 0);
  };
  const parsed = c.modelFailed ? { ok: false, error: 'model_failed' } : noticeParseModel(modelText);
  if (!parsed.ok) return fail(parsed.error);
  let norm;
  try { norm = noticeNormalize(parsed.value); } catch (e) { return fail('normalize_error'); }
  const x = norm.value;
  flags = flags.concat(norm.flags);
  out.extraction = x;
  row.readStatus = 'ok';

  // text the page put into the answer, checked for words aimed at a machine
  const texts = [x.court, x.caseNumber, x.partyOne, x.partyTwo, x.addressedTo, x.documentDateText].concat(x.relativeDeadlines, x.unreadable);
  x.events.forEach((e) => { texts.push(e.label, e.dateText, e.timeText, e.location); });
  const hits = noticeInjectionHits(texts.filter((t) => t).join('\n'));
  const injection = x.modelInjection || hits.length > 0;

  const court = x.documentType !== 'not_a_court_document';
  if (court) level = 'high';
  if (NOTICE_SERVED.indexOf(x.documentType) !== -1) raise('urgent', 'served_papers');

  let anyUnreadable = false;
  const dates = [];
  x.events.forEach((e) => {
    const r = noticeEventDates(e, c.today);
    flags = flags.concat(r.flags);
    if (r.unreadable) anyUnreadable = true;
    r.candidates.forEach((iso) => dates.push({ iso, days: daysFromToday(iso, c.today), kind: e.kind, label: e.label, dateText: e.dateText }));
  });
  dates.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  dates.forEach((d) => {
    if (d.days < 0) raise('urgent', 'date_passed');
    else if (d.days <= threshold) raise('urgent', 'date_within_window');
  });
  if (anyUnreadable || x.unreadable.some((u) => /\b(?:date|day|time|hearing|month|deadline|due|appear)/i.test(u))) raise('urgent', 'date_unreadable');
  if (x.unreadable.length) flags.push('parts_unreadable');
  if (x.relativeDeadlines.length) raise('high', 'relative_deadline');
  if (x.legibility === 'poor') raise('urgent', 'legibility');
  else if (x.legibility === 'partial') flags.push('legibility_partial');
  if (injection) { raise('high', 'injection_suspected'); flags.push('injection_suspected'); }
  if (court && !dates.length && !anyUnreadable && !x.relativeDeadlines.length) reasons.push('no_date_found');
  if (!court) reasons.push('not_court_document');
  if (x.confidence === 'low') flags.push('low_confidence');

  out.dates = dates;
  out.earliest = dates.length ? dates[0] : null;
  Object.assign(row, {
    documentType: x.documentType, court: x.court || '', caseNumber: x.caseNumber || '', partyOne: x.partyOne || '', partyTwo: x.partyTwo || '',
    addressedTo: x.addressedTo || '', documentDateText: x.documentDateText || '', documentDateIso: x.documentDateIso || '',
    events: JSON.stringify(x.events.map((e) => ({ kind: e.kind, label: e.label, dateText: e.dateText, dateIso: e.dateIso, timeText: e.timeText, location: e.location }))),
    relativeDeadlines: JSON.stringify(x.relativeDeadlines), eventsSummary: noticeSummary(x.events),
    earliestDateIso: out.earliest ? out.earliest.iso : '', daysAtReceipt: out.earliest ? out.earliest.days : null,
    legibility: x.legibility, confidence: x.confidence || ''
  });
  return noticeFinish(out, row, level, reasons, flags, c, x.events.length);
}

function noticeFinish(out, row, level, reasons, flags, c, eventCount) {
  const uniqFlags = noticeUnique(flags);
  row.priority = level;
  row.reasons = reasons.join(',');
  row.flags = uniqFlags.join(',');
  row.status = NOTICE_STATUS;
  out.row = row;
  out.readStatus = row.readStatus;
  out.priority = level;
  out.reasons = reasons.slice();
  out.flags = uniqFlags;
  out.alert = level === 'urgent';
  out.status = NOTICE_STATUS;
  // metadata only: no names, no page text
  out.event = { at: c.now || '', source: 'notices', ref: c.ref || '', documentType: row.documentType, priority: level, reasons: reasons.slice(), flags: uniqFlags, events: eventCount, readStatus: row.readStatus, rulesVersion: NOTICE_VERSION };
  return out;
}

// One alert for a whole run, or null when nothing is urgent. No party names. A date appears only as printed.
function noticeAlert(results, data, today) {
  const items = (results || []).filter((r) => r && r.alert);
  if (!items.length) return null;
  const lang = data.firm.language;
  const lines = [];
  lines.push(items.length === 1 ? 'A court notice needs attorney attention.' : items.length + ' court notices need attorney attention.');
  lines.push('');
  lines.push('An automated assistant read each notice. Nothing has been confirmed by a person. Open the notice and check it yourself.');
  lines.push('');
  items.forEach((r, i) => {
    const e = r.earliest;
    lines.push((i + 1) + '. Reference ' + r.row.ref + ' - ' + (NOTICE_TYPE_TEXT[r.row.documentType] || 'notice that could not be read'));
    if (e) {
      const shown = e.dateText && noticeInjectionHits(e.dateText).length === 0 ? e.dateText : e.iso;
      const n = Math.abs(e.days);
      lines.push('   Earliest date on the notice, as printed: ' + shown + ' (' + (e.days === 0 ? 'the same day it was read' : n + (n === 1 ? ' day ' : ' days ') + (e.days > 0 ? 'after' : 'before') + ' it was read') + '; a person must confirm it)');
    } else lines.push('   No calendar date was taken from this notice.');
    lines.push('   Why it is flagged: ' + r.reasons.map((x) => NOTICE_REASON_TEXT[x] || x).join('; '));
    if (r.flags.indexOf('injection_suspected') !== -1) lines.push('   Note: the page contained text aimed at an automated system. None of it was followed.');
    if (r.saved === false) lines.push('   The row for this notice could not be saved to the table. Keep the original file.');
  });
  lines.push('');
  lines.push('Find the reference in the court_notices table to see what was read and to read the original notice.');
  lines.push('');
  lines.push(lang.notLegalAdvice);
  lines.push(lang.fictional);
  return { subject: 'Court notice needs attorney attention (' + items.length + ')', text: lines.join('\n'), count: items.length, refs: items.map((r) => r.row.ref), today: today || '' };
}

// The request body for the vision model. The prompt carries no date: the model is never asked what today is.
function noticeRequestBody(model, prompt, dataUrl) {
  return {
    model, max_tokens: NOTICE_MAX_TOKENS, temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }]
  };
}

// The text of a chat-completions answer, or null when the call failed or came back without any.
function noticeModelText(body) {
  try {
    const m = body && body.choices && body.choices[0] && body.choices[0].message;
    const t = m && m.content;
    if (typeof t === 'string') return t;
    if (Array.isArray(t)) return t.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    return null;
  } catch (e) { return null; }
}

module.exports = {
  NOTICE_VERSION, NOTICE_PROMPT_VERSION, NOTICE_STATUS, NOTICE_TYPES, NOTICE_KINDS, NOTICE_RANK, NOTICE_INJECTION, NOTICE_REASON_TEXT, NOTICE_TYPE_TEXT,
  noticeInjectionHits, noticeClean, noticeValidIso, noticeToday, noticeMakeRef, noticeParseModel, noticeNormalize, noticeWrittenDates,
  noticeEventDates, noticeSummary, noticeAssess, noticeAlert, noticeRequestBody, noticeModelText
};
