'use strict';
// Conflict check against the firm's invented conflict list (firm/conflicts.json).
// A match never decides anything. It holds the lead so an attorney can clear it, and the person
// is never told why. The check does not model relatives, subsidiaries or aliases; a real firm's
// practice-management system does. See automations/intake/README.md for the limits.

function normalizeName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|company|llp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 'A and B', 'A, B', 'A vs B' become separate names. The whole string is checked as well.
function splitNames(s) {
  const whole = normalizeName(s);
  if (!whole) return [];
  const parts = String(s)
    .split(/\s*(?:,|;|\n|&|\/|\band\b|\bvs\.?\s|\bv\.\s)\s*/i)
    .map(normalizeName)
    .filter((x) => x.length >= 2);
  return Array.from(new Set([whole].concat(parts)));
}

function containsPhrase(haystack, needle) {
  return (' ' + haystack + ' ').indexOf(' ' + needle + ' ') !== -1;
}

// True when two words differ by at most one inserted, deleted or changed letter.
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Returns 'match', 'near match', 'ambiguous' or null for one normalized name against one entry.
function compareName(q, entry) {
  const e = normalizeName(entry.name);
  if (!q || !e) return null;
  if (q === e) return 'match';
  const qt = q.split(' ');
  const et = e.split(' ');
  if (entry.type === 'person' && qt.length >= 2 && et.length >= 2 && qt[0].charAt(0) === et[0].charAt(0)) {
    const ql = qt[qt.length - 1];
    const el = et[et.length - 1];
    // Same first initial and the same last name, allowing one typo in a longer last name (Kesler, Kessler).
    if (ql === el || (ql.length >= 5 && el.length >= 5 && withinOneEdit(ql, el))) return 'near match';
  }
  const shorter = q.length <= e.length ? q : e;
  const longer = q.length <= e.length ? e : q;
  if (shorter.length >= 6 && containsPhrase(longer, shorter)) return 'near match';
  if (entry.commonName && qt[qt.length - 1] === et[et.length - 1]) return 'ambiguous';
  return null;
}

// input: { prospect, otherSide, description }. entries: firm/conflicts.json "entries".
// Returns { status: 'clear' | 'hold' | 'not_provided', matches: [{ id, side, role, reason }] }.
function checkConflicts(input, entries) {
  const matches = [];
  const seen = {};
  const add = (entry, side, reason) => {
    const key = entry.id + '|' + side;
    if (seen[key]) return;
    seen[key] = true;
    matches.push({ id: entry.id, side, role: entry.role, reason });
  };
  const isClientRole = (e) => e.role === 'client' || e.role === 'former_client';

  const otherNames = splitNames(input.otherSide);
  for (const entry of entries) {
    if (!isClientRole(entry)) continue;
    for (const q of otherNames) {
      const reason = compareName(q, entry);
      if (reason) { add(entry, 'other_side', reason); break; }
    }
  }

  const prospect = normalizeName(input.prospect);
  if (prospect) {
    for (const entry of entries) {
      const reason = compareName(prospect, entry);
      if (reason) add(entry, 'prospect', reason);
    }
  }

  const description = normalizeName(input.description);
  if (description) {
    for (const entry of entries) {
      if (!isClientRole(entry)) continue;
      const full = normalizeName(entry.name);
      if (full.split(' ').length >= 2 && containsPhrase(description, full)) add(entry, 'description', 'named in description');
    }
  }

  const status = matches.length ? 'hold' : (otherNames.length ? 'clear' : 'not_provided');
  return { status, matches };
}

module.exports = { normalizeName, splitNames, withinOneEdit, compareName, checkConflicts };
