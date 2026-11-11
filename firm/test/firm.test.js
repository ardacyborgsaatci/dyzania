'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const firm = read('firm.json');
const areas = read('practice-areas.json');
const avail = read('availability.json');
const urgency = read('urgency.json');
const conflicts = read('conflicts.json');
const kbDir = path.join(dir, '..', 'knowledge');
const kb = fs.readdirSync(kbDir).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(kbDir, f), 'utf8')).join('\n');
const attorneyIds = firm.staff.filter((s) => s.attorney).map((s) => s.id);
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('staff and headcount agree', () => {
  assert.strictEqual(firm.staff.length, firm.headcount.total);
  assert.strictEqual(new Set(firm.staff.map((s) => s.id)).size, firm.staff.length);
  assert.strictEqual(attorneyIds.length, firm.headcount.partners + firm.headcount.associates);
});

test('every email and the domain use the reserved .example domain', () => {
  const text = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + kb;
  const addresses = (text.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g) || []).map((a) => a.replace(/\.$/, ''));
  assert.ok(addresses.length > 5);
  for (const a of addresses) assert.match(a, /@dyzania\.example$/, a);
  assert.strictEqual(firm.domain, 'dyzania.example');
});

test('every practice area has real attorneys with consultation windows long enough for its consult', () => {
  for (const area of areas.areas) {
    assert.ok(area.attorneys.length >= 2, area.id + ' needs two attorneys for cover');
    for (const id of area.attorneys) {
      assert.ok(attorneyIds.includes(id), id + ' is not an attorney');
      const windows = avail.windows[id];
      assert.ok(windows && windows.length, id + ' has no windows');
      assert.ok(windows.some((w) => mins(w.end) - mins(w.start) >= area.consult.minutes + avail.booking.bufferMinutes), id + ' windows too short');
    }
    assert.ok([30, 45].includes(area.consult.minutes));
    assert.ok(area.keywords.length >= 8 && area.bring.length >= 4);
  }
});

test('availability windows are well formed and inside office hours', () => {
  const open = mins(firm.officeHours.open);
  const close = mins(firm.officeHours.close);
  for (const [id, windows] of Object.entries(avail.windows)) {
    assert.ok(attorneyIds.includes(id), id);
    for (const w of windows) {
      assert.ok(firm.officeHours.days.includes(w.day), id + ' ' + w.day);
      assert.ok(mins(w.start) >= open && mins(w.end) <= close && mins(w.end) > mins(w.start), id + ' ' + w.day);
    }
  }
  assert.strictEqual(avail.booking.bufferMinutes, 15);
});

test('out-of-scope areas do not overlap the practice areas', () => {
  const inScope = new Set(areas.areas.flatMap((a) => a.keywords));
  for (const o of areas.outOfScope) {
    for (const k of o.keywords) assert.ok(!inScope.has(k), k + ' is in both lists');
  }
});

test('the conflict list is unique, invented and has the traps the intake tests need', () => {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(inc|llc|ltd|co|corp|company|llp)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const ids = conflicts.entries.map((e) => e.id);
  const names = conflicts.entries.map((e) => norm(e.name));
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(new Set(names).size, names.length);
  assert.ok(conflicts.entries.some((e) => e.commonName), 'needs a common-name entry');
  assert.ok(conflicts.entries.some((e) => e.role === 'former_client'));
  assert.ok(conflicts.entries.some((e) => e.type === 'org' && e.role === 'adverse'));
});

test('the knowledge base matches the firm data', () => {
  for (const a of areas.areas) assert.ok(kb.includes(a.name.split(' ')[0]), a.name);
  for (const o of areas.outOfScope) {
    const first = o.name.split(/[ ,]/)[0].toLowerCase();
    assert.ok(kb.toLowerCase().includes(first), o.name);
  }
  assert.match(kb, /\$150/);
  assert.match(kb, /30-minute consultation is free/);
  assert.match(kb, /45 minutes and costs \$150/);
  assert.match(kb, /at least 4 hours of notice/);
  assert.match(kb, /up to 30 days ahead/);
  assert.match(kb, /at least 24 hours of notice/);
  assert.ok(kb.includes('8:30') && kb.includes('17:30'));
  assert.ok(kb.includes(firm.phone) && kb.includes(firm.address));
  assert.ok(kb.includes('deadline within ' + urgency.dayThreshold + ' days'));
  assert.ok(kb.includes('11 people'));
  const ids = [...kb.matchAll(/^## (KB-\d\d) /gm)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ids.map((_, i) => 'KB-' + String(i + 1).padStart(2, '0')));
});

test('the old brand is gone from the shared facts', () => {
  assert.doesNotMatch(kb, /wrenbook/i);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /wrenbook/i, f);
});

test('urgency data is complete', () => {
  assert.strictEqual(urgency.dayThreshold, 7);
  assert.ok(urgency.categories.length >= 5);
  for (const c of urgency.categories) assert.ok(c.phrases.length >= 3 && c.why, c.id);
  assert.ok(urgency.neverDo.length >= 4);
});
