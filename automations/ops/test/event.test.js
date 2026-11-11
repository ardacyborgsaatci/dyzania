const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildEvent, checkBudget, TEAMS, AUTOMATIONS } = require("../lib/event.js");

const base = { automation: "support", source: "gmail", status: "ok", runId: "gm-1", summary: "Billing question, draft saved" };

test("builds a valid event and fills the team", () => {
  const r = buildEvent(base, new Date("2026-11-11T08:00:00Z"));
  assert.equal(r.ok, true);
  assert.equal(r.event.team, "support");
  assert.equal(r.event.handoffTo, "");
});

test("strips email addresses from the summary", () => {
  const r = buildEvent({ ...base, summary: "Reply to jane@example.com about a refund" });
  assert.equal(r.ok, true);
  assert.ok(!r.event.summary.includes("@"));
  assert.match(r.event.summary, /\[address\]/);
});

test("caps the summary at 140 characters", () => {
  const r = buildEvent({ ...base, summary: "x".repeat(500) });
  assert.equal(r.event.summary.length, 140);
  assert.equal(r.ok, true);
});

test("rejects unknown automation, status and source", () => {
  assert.equal(buildEvent({ ...base, automation: "billing" }).ok, false);
  assert.equal(buildEvent({ ...base, status: "great" }).ok, false);
  assert.equal(buildEvent({ ...base, source: "fax" }).ok, false);
});

test("a handoff needs a target that exists and a reference", () => {
  assert.equal(buildEvent({ ...base, handoffTo: "leads" }).ok, false);
  assert.equal(buildEvent({ ...base, handoffTo: "leads", handoffRef: "lead-9" }).ok, true);
  assert.equal(buildEvent({ ...base, handoffTo: "nobody", handoffRef: "x" }).ok, false);
});

test("never throws on bad input", () => {
  assert.doesNotThrow(() => buildEvent(null));
  assert.equal(buildEvent(null).ok, false);
});

test("every automation maps to a team and the schema file agrees", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "ops_events.schema.json"), "utf8"));
  const col = (n) => schema.columns.find((c) => c.name === n);
  assert.deepEqual(col("automation").enum, AUTOMATIONS);
  assert.deepEqual(col("team").enum.sort(), [...new Set(Object.values(TEAMS))].sort());
  assert.equal(col("summary").maxLength, 140);
});

test("budget: bucket cap, combined cap, and the inbox is not counted", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const ev = (automation, source, hoursAgo) => ({ automation, source, ts: new Date(now.getTime() - hoursAgo * 3600 * 1000) });
  const events = [
    ...Array.from({ length: 15 }, () => ev("support", "web", 1)),
    ...Array.from({ length: 30 }, () => ev("support", "gmail", 1)), // real inbox: ignored
    ev("support", "web", 30), // older than 24 hours: ignored
  ];
  const o = { automation: "support", limit: 15, combinedLimit: 40, now };
  assert.deepEqual(checkBudget(events, o), { allowed: false, reason: "bucket_cap", retryAfter: 3600 });
  assert.equal(checkBudget(events, { ...o, automation: "booking", limit: 10 }).allowed, true);
  const crowded = [...events, ...Array.from({ length: 25 }, () => ev("voice", "voice", 2))];
  assert.equal(checkBudget(crowded, { ...o, automation: "booking", limit: 10 }).reason, "combined_cap");
});
