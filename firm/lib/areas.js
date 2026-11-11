'use strict';
const { lowerText, findPhrase, maskSpan, stripAmbiguousPhrases } = require('./text');
// Match a message to the firm's practice areas. Input: what the person selected and what they wrote.
// data is firm/practice-areas.json. Returns the area, how sure we are (basis) and which keywords hit.
// This never gives legal advice: it only decides where a message should go.

function classifyArea(input, data) {
  const selected = (input && input.selected) || 'not_sure';
  const ids = data.areas.map((a) => a.id);
  const hits = {};
  ids.forEach((id) => { hits[id] = []; });
  const outHits = {};
  data.outOfScope.forEach((o) => { outHits[o.id] = []; });

  // Longest phrases first, across both lists, and mask each match, so that
  // 'guardianship of a child' (family) is not also counted as 'guardianship' (estate).
  const all = [];
  data.areas.forEach((a) => a.keywords.forEach((k) => all.push({ k, kind: 'area', id: a.id })));
  data.outOfScope.forEach((o) => o.keywords.forEach((k) => all.push({ k, kind: 'out', id: o.id })));
  all.sort((x, y) => y.k.length - x.k.length);
  let work = stripAmbiguousPhrases(lowerText(input && input.text));
  for (const e of all) {
    let m = findPhrase(work, e.k);
    if (!m) continue;
    (e.kind === 'area' ? hits[e.id] : outHits[e.id]).push(e.k);
    while (m) {
      work = maskSpan(work, m.index, m.end);
      m = findPhrase(work, e.k);
    }
  }

  const count = {};
  ids.forEach((id) => { count[id] = hits[id].length; });
  const order = ids.slice().sort((a, b) => count[b] - count[a] || ids.indexOf(a) - ids.indexOf(b));
  const top = order[0];
  const topCount = count[top];
  const tied = ids.filter((id) => count[id] === topCount && topCount > 0);
  const withHits = ids.filter((id) => count[id] > 0);
  const outRanked = data.outOfScope
    .map((o) => ({ o, n: outHits[o.id].length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const outTop = outRanked.length ? outRanked[0].o : null;

  let area;
  let basis;
  let also = [];
  if (topCount === 0 && outTop) {
    area = 'out_of_scope';
    basis = 'inferred';
  } else if (ids.includes(selected)) {
    const others = order.filter((id) => id !== selected);
    const bestOther = others[0];
    const bestOtherCount = count[bestOther];
    if (count[selected] >= 1 && count[selected] >= bestOtherCount) {
      area = selected; basis = 'selected'; also = withHits.filter((id) => id !== selected);
    } else if (count[selected] >= 1) {
      area = selected; basis = 'mixed'; also = withHits.filter((id) => id !== selected);
    } else if (bestOtherCount >= 2) {
      area = bestOther; basis = 'differs'; also = withHits.filter((id) => id !== bestOther);
    } else {
      area = selected; basis = 'selected_unsupported'; also = withHits;
    }
  } else if (topCount === 0) {
    area = 'unclear'; basis = 'unclear';
  } else if (tied.length === 1) {
    area = top; basis = 'inferred'; also = withHits.filter((id) => id !== top);
  } else {
    area = top; basis = 'mixed'; also = tied.filter((id) => id !== top);
  }

  const shown = {};
  ids.forEach((id) => { if (hits[id].length) shown[id] = hits[id]; });
  return {
    area,
    basis,
    hits: shown,
    alsoMentions: also,
    outOfScope: area === 'out_of_scope' && outTop ? { id: outTop.id, name: outTop.name, referral: outTop.referral } : null,
    alsoOutOfScope: area === 'out_of_scope' ? [] : outRanked.map((x) => x.o.id)
  };
}

module.exports = { classifyArea };
