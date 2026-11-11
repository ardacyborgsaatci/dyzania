'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findPhrase, maskSpan, stripHarmlessPhrases, stripAmbiguousPhrases, lowerText } = require('../lib/text');
const { classifyArea } = require('../lib/areas');
const { normalizeName, splitNames, withinOneEdit, compareName, checkConflicts } = require('../lib/conflicts');
const { extractDates, detectUrgency } = require('../lib/urgency');
const { loadFirmData } = require('../lib/data');

const data = loadFirmData();
const TODAY = '2026-11-11'; // a Wednesday
const area = (text, selected) => classifyArea({ selected: selected || 'not_sure', text }, data.areas);
const urgency = (text, hearing) => detectUrgency({ text, hearing: hearing || 'none' }, data.urgency, TODAY);

test('phrases match whole words, with endings and hyphens', () => {
  assert.ok(findPhrase('he was rear-ended', 'rear-ended'));
  assert.ok(findPhrase('i was divorced', 'divorce'));
  assert.ok(findPhrase('two accidents', 'accident'));
  assert.strictEqual(findPhrase('a willing witness', 'a will'), null);
  assert.strictEqual(findPhrase('divorcee', 'divorce'), null);
  assert.strictEqual(findPhrase('i cant trust him', 'a trust'), null);
  assert.strictEqual(lowerText("It's  A  Test"), 'its a test');
});

test('masking and stripping keep text length so indexes stay valid', () => {
  assert.strictEqual(maskSpan('abcdef', 1, 3), 'a  def');
  const t = 'i am hard of hearing and i served in the army';
  assert.strictEqual(stripHarmlessPhrases(t).length, t.length);
  assert.doesNotMatch(stripHarmlessPhrases(t), /hearing|served/);
  assert.doesNotMatch(stripAmbiguousPhrases('real estate and in custody'), /estate|custody/);
});

test('practice areas: longest phrase wins and traps do not hit', () => {
  assert.strictEqual(area('guardianship of a child').area, 'family');
  assert.strictEqual(area('guardianship for my mother').area, 'estate');
  assert.strictEqual(area('the real estate agent said so').area, 'unclear');
  assert.strictEqual(area('my brother was in custody').area, 'unclear');
  assert.strictEqual(area('i do not trust my ex').area, 'unclear');
  assert.strictEqual(area('I will need a lawyer').area, 'unclear');
  assert.strictEqual(area('I was arrested for a dui').area, 'out_of_scope');
  assert.strictEqual(area('I was arrested for a dui').outOfScope.id, 'criminal');
});

test('practice areas: the longest phrase wins even when the shorter one is listed first', () => {
  const odd = {
    areas: [{ id: 'a', keywords: ['guardianship'] }, { id: 'b', keywords: ['guardianship of a child'] }],
    outOfScope: [{ id: 'z', name: 'Zed', keywords: ['child'], referral: 'x' }]
  };
  const r = classifyArea({ selected: 'not_sure', text: 'I need guardianship of a child' }, odd);
  assert.strictEqual(r.area, 'b');
  assert.deepStrictEqual(r.hits, { b: ['guardianship of a child'] });
  assert.deepStrictEqual(r.alsoOutOfScope, [], 'the word inside the longer phrase is not counted again');
});

test('practice areas: how the selection and the text are combined', () => {
  assert.strictEqual(area('divorce', 'family').basis, 'selected');
  assert.strictEqual(area('hello there, please call', 'family').basis, 'selected_unsupported');
  assert.strictEqual(area('fired and harassed', 'family').area, 'employment');
  assert.strictEqual(area('fired and harassed', 'family').basis, 'differs');
  assert.strictEqual(area('divorce', 'other').area, 'family');
  assert.strictEqual(area('injured and fired').basis, 'mixed');
  assert.strictEqual(area('divorce and the dui').area, 'family');
  assert.deepStrictEqual(area('divorce and the dui').alsoOutOfScope, ['criminal']);
  assert.strictEqual(area('').area, 'unclear');
  assert.strictEqual(area(null).area, 'unclear');
});

test('conflict names are normalized and split', () => {
  assert.strictEqual(normalizeName('  Evergreen Mutual Insurance Co. '), 'evergreen mutual insurance');
  assert.strictEqual(normalizeName('José Müller'), 'jose muller');
  assert.deepStrictEqual(splitNames('Tobias Fenn and Calla Ibarra').sort(), ['calla ibarra', 'tobias fenn', 'tobias fenn and calla ibarra'].sort());
  assert.deepStrictEqual(splitNames(''), []);
});

test('conflict comparison rules', () => {
  const person = { name: 'Harlan Whitcombe', type: 'person' };
  assert.strictEqual(compareName('harlan whitcombe', person), 'match');
  assert.strictEqual(compareName('h whitcombe', person), 'near match');
  assert.strictEqual(compareName('harry whitcombe', person), 'near match');
  assert.strictEqual(compareName('elaine whitcombe', person), null);
  assert.strictEqual(compareName('my ex harlan whitcombe', person), 'near match');
  assert.strictEqual(compareName('whit', person), null);
  // one typo in a longer last name still holds the lead; two typos, a short name or another initial do not
  assert.strictEqual(compareName('oren kesler', { name: 'Oren Kessler', type: 'person' }), 'near match');
  assert.strictEqual(compareName('oren kessller', { name: 'Oren Kessler', type: 'person' }), 'near match');
  assert.strictEqual(compareName('oren kesller', { name: 'Oren Kessler', type: 'person' }), 'near match');
  assert.strictEqual(compareName('oren kesslr', { name: 'Oren Kessler', type: 'person' }), 'near match');
  assert.strictEqual(compareName('oren kessing', { name: 'Oren Kessler', type: 'person' }), null);
  assert.strictEqual(compareName('piotr kessler', { name: 'Oren Kessler', type: 'person' }), null);
  assert.strictEqual(compareName('tom lee', { name: 'Tom Lea', type: 'person' }), null, 'short last names are not fuzzy');
  assert.ok(withinOneEdit('abcde', 'abcdf') && withinOneEdit('abcde', 'abde') && withinOneEdit('abde', 'abcde') && !withinOneEdit('abcde', 'axcxe'));
  const common = { name: 'Maria Santos', type: 'person', commonName: true };
  assert.strictEqual(compareName('carlos santos', common), 'ambiguous');
  assert.strictEqual(compareName('carlos santo', common), null);
});

test('conflict status: hold, clear and not provided', () => {
  const e = data.conflicts.entries;
  assert.strictEqual(checkConflicts({ prospect: 'Ann Lee', otherSide: '', description: '' }, e).status, 'not_provided');
  assert.strictEqual(checkConflicts({ prospect: 'Ann Lee', otherSide: 'Nobody Known', description: '' }, e).status, 'clear');
  assert.strictEqual(checkConflicts({ prospect: 'Ann Lee', otherSide: 'Oren Kessler', description: '' }, e).status, 'hold');
  // adverse parties are not a problem on the other side, only as the prospect
  assert.strictEqual(checkConflicts({ prospect: 'Ann Lee', otherSide: 'Rowan Thackeray', description: '' }, e).status, 'clear');
  assert.strictEqual(checkConflicts({ prospect: 'Rowan Thackeray', otherSide: '', description: '' }, e).status, 'hold');
  const m = checkConflicts({ prospect: 'Ann Lee', otherSide: 'Oren Kessler', description: 'it was Oren Kessler' }, e).matches;
  assert.deepStrictEqual(m.map((x) => x.side).sort(), ['description', 'other_side']);
  assert.ok(m.every((x) => /^[cfa]\d{3}$/.test(x.id)), 'matches carry ids only, not names');
});

test('dates in text, written as people write them', () => {
  const days = (t) => extractDates(t.toLowerCase(), TODAY, t).map((d) => d.days);
  assert.deepStrictEqual(days('Nov 16'), [5]);
  assert.deepStrictEqual(days('November 16th, 2026'), [5]);
  assert.deepStrictEqual(days('16 November'), [5]);
  assert.deepStrictEqual(days('11/16'), [5]);
  assert.deepStrictEqual(days('11/16/26'), [5]);
  assert.deepStrictEqual(days('2026-11-18'), [7]);
  assert.deepStrictEqual(days('tomorrow'), [1]);
  assert.deepStrictEqual(days('yesterday'), [-1]);
  assert.deepStrictEqual(days('in 3 days'), [3]);
  assert.deepStrictEqual(days('on Friday'), [2]);
  assert.deepStrictEqual(days('next Monday'), [5], 'next Monday is read as the nearer Monday, the safe direction');
  assert.deepStrictEqual(days('the 16th'), [5]);
  assert.deepStrictEqual(days('the 5th'), [24]);
  assert.deepStrictEqual(days('Nov 5'), [-6]);
  assert.deepStrictEqual(days('Mar 2'), [111], 'a date with no year is the next one that is not far in the past');
  assert.deepStrictEqual(days('Feb 30'), []);
  assert.deepStrictEqual(days('13/45'), []);
  assert.strictEqual(extractDates('nov 16', TODAY, 'NOV 16')[0].raw, 'NOV 16', 'the sender\'s own wording is kept');
});

test('urgency: flags, windows and the never-state-a-deadline rule', () => {
  assert.strictEqual(urgency('hello').level, 'none');
  assert.strictEqual(urgency('my hearing is on Nov 18').level, 'urgent');
  assert.strictEqual(urgency('my hearing is on Nov 19').level, 'check');
  assert.strictEqual(urgency('my hearing is on Nov 19').timeClass, 'later');
  assert.strictEqual(urgency('I missed my hearing on Nov 5').flags[0].reason, 'date has passed (as written)');
  assert.strictEqual(urgency('I have a hearing soon').timeClass, 'unsure');
  assert.strictEqual(urgency('I was served yesterday').level, 'urgent');
  assert.strictEqual(urgency('I am afraid for my safety').alsoShow[0], 'emergency');
  assert.strictEqual(urgency('he was arrested').alsoShow[0], 'referral');
  assert.strictEqual(urgency('I am hard of hearing').level, 'none');
  assert.strictEqual(urgency('I served in the army').level, 'none');
  // the verb 'hearing' is not a court hearing; a real hearing next to the same words still is
  assert.strictEqual(urgency('I keep hearing that I need a lawyer for a divorce').level, 'none');
  assert.strictEqual(urgency('I have not been hearing from my lawyer in weeks').level, 'none');
  assert.strictEqual(urgency('I keep hearing it is soon, but my hearing is on Nov 14').level, 'urgent');
  assert.strictEqual(urgency('Please respond by Nov 30').flags[0].id, 'filing_deadline');
  assert.strictEqual(urgency('The response due Dec 1 is on my mind').flags[0].date.raw, 'Dec 1');
  assert.strictEqual(urgency('', 'within7').level, 'urgent');
  assert.strictEqual(urgency('', 'later').timeClass, 'later');
  assert.strictEqual(urgency('', 'unsure').level, 'check');
  assert.strictEqual(urgency(null).level, 'none');
  const f = urgency('The deadline is Nov 20').flags[0];
  assert.strictEqual(f.date.raw, 'Nov 20');
  assert.doesNotMatch(JSON.stringify(f), /statute|legal deadline is|must be filed/i);
});

test('urgency: only the date next to the phrase counts', () => {
  const r = urgency('I was fired on Oct 3 and the labor board set a hearing on Nov 25.');
  assert.strictEqual(r.flags.length, 1);
  assert.strictEqual(r.flags[0].date.raw, 'Nov 25');
  assert.strictEqual(r.level, 'check');
  // a date far from the phrase is ignored
  const far = urgency('hearing ' + 'x '.repeat(80) + 'Nov 12');
  assert.strictEqual(far.flags[0].date, null);
});
