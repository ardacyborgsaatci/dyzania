'use strict';
// Small text helpers shared by intake, triage and booking. Pure functions, no I/O.
// Files in firm/lib are bundled into n8n Code nodes by scripts/build-intake-workflow.mjs,
// so every top-level name in these files must be unique across the folder.

function lowerText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PHRASE_REGEX_CACHE = {};
function phraseRegex(phrase) {
  if (!PHRASE_REGEX_CACHE[phrase]) {
    const words = lowerText(phrase).replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    // Whole words only. A phrase may be followed by a plural or past-tense ending (divorce, divorced).
    PHRASE_REGEX_CACHE[phrase] = new RegExp('(^|[^a-z0-9])(' + words.join('[^a-z0-9]+') + ')(?:s|es|ed|d)?(?![a-z0-9])', 'g');
  }
  return PHRASE_REGEX_CACHE[phrase];
}

// First match of a phrase in already-lowercased text, or null. Indexes refer to the text as given.
function findPhrase(text, phrase) {
  const re = phraseRegex(phrase);
  re.lastIndex = 0;
  const m = re.exec(text);
  if (!m) return null;
  const index = m.index + m[1].length;
  return { index, end: index + m[2].length };
}

// Replace a span with spaces so later searches cannot match inside it and indexes stay stable.
function maskSpan(text, start, end) {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

// Phrases that would otherwise hit the wrong practice area ('real estate' is not estate planning,
// 'in custody' is not child custody).
function stripAmbiguousPhrases(text) {
  return text.replace(/\breal estate\b/g, ' ').replace(/\b(?:in|police|county|jail) custody\b/g, ' ');
}

// Phrases that would otherwise look like court dates or served papers.
// Same length as the input, so indexes still point into the original text.
function stripHarmlessPhrases(text) {
  const blank = (m) => ' '.repeat(m.length);
  return text
    .replace(/\bhard of hearing\b/g, blank)
    .replace(/\bhearing (?:aids?|loss|impaired|impairment|problems?)\b/g, blank)
    // 'I keep hearing that...', 'I have not been hearing from my lawyer': the verb, not a court hearing
    .replace(/\b(?:keep|keeps|kept|been|always|often|just|am|was|were) hearing\b/g, blank)
    .replace(/\bhearing (?:that|about|from|different|conflicting|things|rumou?rs|stories|voices)\b/g, blank)
    .replace(/\bserved (?:in|as|my country|with the (?:army|navy|air force|marines))\b/g, blank);
}

module.exports = { lowerText, phraseRegex, findPhrase, maskSpan, stripAmbiguousPhrases, stripHarmlessPhrases };
