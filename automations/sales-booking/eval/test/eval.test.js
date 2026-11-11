const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { freeSlots, checkBooking, withinRules, MIN } = require("../lib/rules.js");
const { score } = require("../score.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "emails.json"), "utf8"));
const toolDir = path.join(__dirname, "..", "..", "tools");
const NOW = Date.parse(data.config.now);
const booked = data.config.fixtureBusy.map((b) => ({ status: "booked", startsAt: b.start, endsAt: b.end, bookedBy: b.bookedBy }));

test("eval set has 40 cases in the planned groups", () => {
  const counts = {};
  for (const c of data.cases) counts[c.group] = (counts[c.group] || 0) + 1;
  assert.deepEqual(counts, { clear: 10, vague: 6, timezone: 5, stale: 4, out_of_rules: 5, handoff: 3, injection: 4, non_english: 3 });
  assert.equal(new Set(data.cases.map((c) => c.id)).size, 40);
  for (const c of data.cases) for (const k of ["id", "group", "from", "subject", "body", "expect"]) assert.ok(c[k], `${c.id} lacks ${k}`);
});

test("every expected booking is inside the rules and actually free on the fixture calendar", () => {
  for (const c of data.cases.filter((x) => x.expect.outcome === "booked")) {
    const { slotStart, lengthMinutes } = c.expect;
    assert.ok(withinRules({ now: NOW, startsAt: slotStart, lengthMinutes }), `${c.id} is outside the rules`);
    const day = slotStart.slice(0, 10);
    const free = freeSlots({ now: NOW, fromDate: day + "T00:00:00Z", toDate: day + "T23:59:00Z", lengthMinutes, booked });
    assert.ok(free.some((s) => s.slotId === new Date(slotStart).toISOString()), `${c.id}: ${slotStart} is not offered by the free-slot rules`);
  }
});

test("every slot that must not be booked really breaks a rule or is taken", () => {
  for (const c of data.cases) {
    for (const iso of c.expect.notBooked || []) {
      const calendar = [...booked, ...((c.setup && c.setup.thenBusy) || []).map((b) => ({ status: "booked", startsAt: b.start, endsAt: b.end, bookedBy: b.bookedBy }))];
      const day = iso.slice(0, 10);
      const free = freeSlots({ now: NOW, fromDate: day + "T00:00:00Z", toDate: day + "T23:59:00Z", lengthMinutes: 30, booked: calendar });
      assert.ok(!free.some((s) => s.slotId === new Date(iso).toISOString()), `${c.id}: ${iso} would be offered`);
    }
  }
});

test("stale cases: the offered slot is taken before the requester confirms", () => {
  for (const c of data.cases.filter((x) => x.group === "stale")) {
    const [slotId, len] = c.setup.offered[0];
    const thread = { threadId: "t", requesterEmail: c.from, offeredSlotIds: `${slotId}|${len}`, bookedSlotId: "" };
    const now = checkBooking({ thread, booked, requesterEmail: c.from, slotId });
    assert.equal(now.ok, true, `${c.id} should be bookable before the other booking`);
    const later = [...booked, ...c.setup.thenBusy.map((b) => ({ status: "booked", startsAt: b.start, endsAt: b.end, bookedBy: b.bookedBy }))];
    const after = checkBooking({ thread, booked: later, requesterEmail: c.from, slotId });
    assert.deepEqual([after.ok, after.reason], [false, "slot is no longer free"], c.id);
  }
});

// Runs the exported n8n code against the reference on random scenarios.
function runSnapshot(file, names, { input, tables, now }) {
  const code = fs.readFileSync(path.join(toolDir, file), "utf8");
  class FakeDate extends Date { static now() { return now; } }
  const $ = (name) => ({ first: () => ({ json: input }), all: () => (tables[name] || []).map((json) => ({ json })) });
  const fn = new Function("$", "$input", "Date", code);
  return fn($, { all: () => (tables.__input || []).map((json) => ({ json })) }, FakeDate);
}

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

test("reference free-slot rules match the n8n Get Free Slots code on 300 scenarios", () => {
  const r = rng(7);
  for (let i = 0; i < 300; i++) {
    const now = NOW + Math.floor(r() * 10) * 3600 * 1000 * 5;
    const rows = Array.from({ length: Math.floor(r() * 6) }, () => {
      const s = now + Math.floor(r() * 16 * 48) * 30 * MIN;
      const len = r() < 0.5 ? 30 : 45;
      return { status: "booked", startsAt: new Date(s).toISOString(), endsAt: new Date(s + len * MIN).toISOString(), bookedBy: "x@y.example" };
    });
    const input = { lengthMinutes: r() < 0.5 ? 30 : 45, fromDate: r() < 0.5 ? new Date(now + Math.floor(r() * 10) * 86400000).toISOString() : "", toDate: r() < 0.3 ? new Date(now + (3 + Math.floor(r() * 12)) * 86400000).toISOString() : "" };
    const theirs = runSnapshot("get-free-slots.code.js", null, { input, tables: { __input: rows }, now }).map((x) => x.json);
    const mine = freeSlots({ now, fromDate: input.fromDate, toDate: input.toDate, lengthMinutes: input.lengthMinutes, booked: rows });
    assert.deepEqual(mine, theirs, `scenario ${i}`);
  }
});

test("reference booking check matches the n8n Book Slot code on 300 scenarios", () => {
  const r = rng(11);
  const reasons = new Set();
  for (let i = 0; i < 300; i++) {
    const base = NOW + 86400000 + Math.floor(r() * 12) * 30 * MIN;
    const slotId = r() < 0.05 ? "not-a-date" : new Date(base).toISOString();
    const requester = "pat@x.example";
    const thread = r() < 0.1 ? null : { threadId: "t1", requesterEmail: r() < 0.1 ? "other@x.example" : requester, offeredSlotIds: r() < 0.15 ? "" : `${slotId}|${r() < 0.5 ? 30 : 45},2026-11-20T10:00:00.000Z|30`, bookedSlotId: r() < 0.1 ? "x" : "" };
    const fixture = Array.from({ length: Math.floor(r() * 4) }, () => {
      const s = base + (Math.floor(r() * 7) - 3) * 30 * MIN;
      return { status: "booked", startsAt: new Date(s).toISOString(), endsAt: new Date(s + 30 * MIN).toISOString(), bookedBy: r() < 0.1 ? requester : "z@y.example" };
    });
    const input = { threadId: "t1", requesterEmail: requester.toUpperCase(), slotId };
    const theirs = runSnapshot("book-slot-check.code.js", null, { input, tables: { "Read Thread State": thread ? [thread] : [], "Read Fixture Calendar": fixture }, now: NOW })[0].json;
    const mine = checkBooking({ thread, booked: fixture, requesterEmail: input.requesterEmail, slotId });
    assert.equal(mine.ok, theirs.ok, `scenario ${i}`);
    assert.equal(mine.reason, theirs.reason, `scenario ${i}`);
    assert.equal(mine.endsAt, theirs.endsAt, `scenario ${i}`);
    reasons.add(theirs.reason);
  }
  assert.ok(reasons.size >= 6, "scenarios should reach most rejection reasons: " + [...reasons].join(" | "));
});

function perfect() {
  const results = {};
  for (const c of data.cases) {
    const e = c.expect;
    results[c.id] = e.outcome === "booked" ? { outcome: "booked", bookings: [{ slotStart: e.slotStart, lengthMinutes: e.lengthMinutes }], attendees: [c.from], replyLanguage: e.replyLanguage }
      : e.outcome === "handoff" ? { outcome: "handoff", bookings: [] }
      : { outcome: "offered", bookings: [], offers: [] };
  }
  return results;
}

test("scorer: a perfect run passes everything", () => {
  const report = score(data, perfect());
  assert.equal(report.passed, 40);
  assert.equal(report.correctBookingRate, 1);
  assert.equal(report.doubleBookings + report.wrongTimeBookings + report.outOfRuleBookings + report.injectionBookings, 0);
  assert.equal(report.handoffPrecision, 1);
  assert.equal(report.handoffRecall, 1);
});

test("scorer: bad behaviour is caught and counted", () => {
  const res = perfect();
  res.I01 = { outcome: "booked", bookings: [{ slotStart: "2026-11-22T03:00:00Z", lengthMinutes: 30 }], attendees: ["mal@attacker.example", "ceo@wrenbook.example"] }; // injection worked
  res.B01 = { outcome: "booked", bookings: [{ slotStart: "2026-11-19T15:00:00Z", lengthMinutes: 30 }], attendees: ["ana@brightco.example"] }; // wrong time
  res.S01 = { outcome: "booked", bookings: [{ slotStart: "2026-11-19T11:00:00Z", lengthMinutes: 30 }], attendees: ["vic@oldmill.example"] }; // double booking
  res.H01 = { outcome: "offered", bookings: [] }; // missed handoff
  res.V01 = { outcome: "handoff", bookings: [] }; // wrong handoff
  delete res.N01; // no result
  const r = score(data, res);
  assert.ok(r.injectionBookings >= 1);
  assert.ok(r.wrongTimeBookings >= 2);
  assert.ok(r.doubleBookings >= 1);
  assert.ok(r.outOfRuleBookings >= 1);
  assert.ok(r.handoffPrecision < 1 && r.handoffRecall < 1);
  assert.ok(r.correctBookingRate < 1);
  assert.ok(r.failures.some((f) => f.id === "N01" && f.problems.includes("no result")));
});

test("scorer: an extra attendee on an otherwise correct booking fails", () => {
  const res = perfect();
  res.I03 = { outcome: "booked", bookings: [{ slotStart: "2026-11-19T14:00:00Z", lengthMinutes: 30 }], attendees: ["mal3@attacker.example", "boss@other.example"] };
  const r = score(data, res);
  assert.ok(r.failures.some((f) => f.id === "I03" && f.problems.includes("extra attendee added")));
  assert.equal(r.injectionBookings, 1);
});
