// Builds and validates one ops_events row. The same logic is pasted into the
// "Wrenbook Ops - Log Event" sub-workflow, so keep it dependency-free.
const AUTOMATIONS = ["leads", "booking", "support", "voice", "invoices", "ops"];
const TEAMS = { leads: "sales", booking: "sales", support: "support", voice: "front-desk", invoices: "finance", ops: "ops" };
const SOURCES = ["gmail", "web", "voice", "seed", "eval", "schedule", "handoff"];
const STATUSES = ["ok", "needs_human", "blocked", "error"];
const MAX_SUMMARY = 140;

function cleanSummary(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\s@]*@[^\s@]*/g, "[address]")
    .slice(0, MAX_SUMMARY);
}

function validateEvent(e) {
  const problems = [];
  if (!AUTOMATIONS.includes(e.automation)) problems.push("automation");
  if (e.team !== TEAMS[e.automation]) problems.push("team");
  if (!SOURCES.includes(e.source)) problems.push("source");
  if (!STATUSES.includes(e.status)) problems.push("status");
  if (!e.runId || typeof e.runId !== "string") problems.push("runId");
  if (!(e.ts instanceof Date) || Number.isNaN(e.ts.getTime())) problems.push("ts");
  if (typeof e.summary !== "string" || e.summary.length > MAX_SUMMARY || e.summary.includes("@")) problems.push("summary");
  if (e.latencyMs != null && !(Number.isFinite(e.latencyMs) && e.latencyMs >= 0)) problems.push("latencyMs");
  if (e.handoffTo && !AUTOMATIONS.includes(e.handoffTo)) problems.push("handoffTo");
  if (e.handoffTo && !e.handoffRef) problems.push("handoffRef");
  return problems;
}

// Returns { ok, event, problems }. Never throws, so logging cannot break a run.
function buildEvent(input, now = new Date()) {
  try {
    const event = {
      ts: input.ts instanceof Date ? input.ts : now,
      automation: input.automation,
      team: TEAMS[input.automation],
      runId: input.runId == null ? "" : String(input.runId),
      source: input.source,
      status: input.status,
      summary: cleanSummary(input.summary),
      latencyMs: input.latencyMs == null ? null : Math.round(Number(input.latencyMs)),
      handoffTo: input.handoffTo || "",
      handoffRef: input.handoffRef || "",
    };
    const problems = validateEvent(event);
    return { ok: problems.length === 0, event, problems };
  } catch (err) {
    return { ok: false, event: null, problems: ["exception: " + err.message] };
  }
}

// Demo budget: count the last 24 hours of events for one automation.
function checkBudget(events, { automation, limit, combinedLimit, now = new Date() }) {
  const since = now.getTime() - 24 * 3600 * 1000;
  const demo = events.filter((e) => e.source === "web" || e.source === "voice").filter((e) => new Date(e.ts).getTime() >= since);
  const mine = demo.filter((e) => e.automation === automation).length;
  if (mine >= limit) return { allowed: false, reason: "bucket_cap", retryAfter: 3600 };
  if (demo.length >= combinedLimit) return { allowed: false, reason: "combined_cap", retryAfter: 3600 };
  return { allowed: true, reason: "ok", retryAfter: 0 };
}

module.exports = { AUTOMATIONS, TEAMS, SOURCES, STATUSES, MAX_SUMMARY, cleanSummary, validateEvent, buildEvent, checkBudget };
