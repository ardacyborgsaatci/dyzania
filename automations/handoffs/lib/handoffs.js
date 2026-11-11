// Handoff helpers between Wrenbook automations. Pure functions: no network, no sending.
// Each one is pasted into a Code node at the cutover. Nothing here sends mail; the only
// outputs are data rows, ops events and the text of an owner-reviewed Gmail DRAFT.
const { buildEvent } = require("../../ops/lib/event.js");

const FREE_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same rules as the "Score Lead" node in automations/sales-leads/workflow.json (a test checks parity).
function scoreLead(f) {
  const email = String(f.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  const businessEmail = domain !== "" && !FREE_DOMAINS.includes(domain);
  const budget = { "Under $1k": 5, "$1k-$5k": 15, "$5k-$20k": 25, "$20k+": 35 }[f.budget] ?? 0;
  const size = { "1-10": 5, "11-50": 10, "51-200": 15, "200+": 20 }[f.companySize] ?? 0;
  const timeline = { "This month": 20, "1-3 months": 15, "3+ months": 5 }[f.timeline] ?? 0;
  const score = budget + size + timeline + (businessEmail ? 10 : 0);
  const tier = score >= 70 ? "Hot" : score >= 40 ? "Warm" : "Cold";
  return { score, tier, businessEmail };
}

// 1. support -> leads. A support email in the sales_inquiry category becomes a lead row.
// The sender gave no budget, size or timeline, so the lead is NOT scored: tier "Unscored".
// Nothing is replied to the sender; a person follows up.
function leadFromSupport(t) {
  if (!t || t.category !== "sales_inquiry") return null;
  if (t.injectionSuspected) return null;
  if (!EMAIL.test(String(t.fromEmail || ""))) return null;
  const domain = t.fromEmail.split("@")[1].toLowerCase();
  return {
    source: "support",
    refId: "gm-" + t.messageId,
    name: String(t.fromName || "").replace(/\s+/g, " ").trim().slice(0, 100) || "(not given)",
    email: t.fromEmail,
    company: "unknown",
    companySize: "unknown",
    budget: "unknown",
    timeline: "unknown",
    message: String(t.summary || "").replace(/\s+/g, " ").trim().slice(0, 300),
    businessEmail: !FREE_DOMAINS.includes(domain),
    score: null,
    tier: "Unscored",
  };
}

// 2. leads -> booking. A Hot lead gets an owner-reviewed DRAFT inviting them to book.
// Fixed template: the model writes nothing. The draft is saved in Gmail, never sent.
function bookAddress(ownerAddress) {
  const [local, host] = String(ownerAddress).split("@");
  if (!local || !host) return null;
  return local.split("+")[0] + "+book@" + host;
}

function safeName(name) {
  return String(name || "").replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function bookingInvite(lead, { ownerAddress, brand = "Wrenbook", domain = "wrenbook.example" }) {
  if (!lead || lead.tier !== "Hot") return null;
  if (!EMAIL.test(String(lead.email || ""))) return null;
  const book = bookAddress(ownerAddress);
  if (!book) return null;
  const name = safeName(lead.name);
  const body = [
    name ? "Hi " + name + "," : "Hi,",
    "",
    "Thanks for getting in touch with " + brand + ". The quickest way to see it working is a short demo call.",
    "",
    "You can pick a time at https://" + domain + "/demo, or reply to " + book + " with a few times that suit you. Calls run Monday to Friday between 10:00 and 16:00 UTC and last 30 minutes.",
    "",
    "Best,",
    brand + " Sales",
  ].join("\n");
  return { to: lead.email, subject: "Booking a " + brand + " demo", body, draftOnly: true, label: "Booking/Awaiting-Send" };
}

// 3. voice -> leads: see voice/demo_intent.py (Python) and web/lead-intake/contact.js.
// Only the fixed marker topic=demo travels in the URL; no personal data ever does.

// 4. invoices -> ops. A bill marked "Needs review" is logged, listed in the digest and,
// above a configured amount, alerts the owner.
function invoiceEvent(result, { alertAbove = 1000, runId, source = "web", now } = {}) {
  const needsReview = result && result.status === "Needs review";
  const summary = needsReview ? "Bill needs review: " + (result.issues || "unknown reason") : "Bill auto-approved";
  const built = buildEvent({ automation: "invoices", source, status: needsReview ? "needs_human" : "ok", runId, summary }, now);
  const total = Number(result && result.total);
  const alert = Boolean(needsReview && Number.isFinite(total) && total >= alertAbove);
  return { ...built, alert, digestLine: needsReview ? "Finance: " + built.event?.summary : null };
}

// Two linked events for one handoff. The sender row carries handoffTo + handoffRef; the
// receiver row uses source "handoff" and its runId equals that handoffRef.
function handoffEvents({ from, to, fromRunId, toRunId, fromSource, summary, now }) {
  const sender = buildEvent({ automation: from, source: fromSource, status: "ok", runId: fromRunId, summary: "Handoff to " + to + ": " + summary, handoffTo: to, handoffRef: toRunId }, now);
  const receiver = buildEvent({ automation: to, source: "handoff", status: "ok", runId: toRunId, summary: "From " + from + ": " + summary }, now);
  return { sender, receiver, ok: sender.ok && receiver.ok };
}

module.exports = { scoreLead, leadFromSupport, bookAddress, bookingInvite, invoiceEvent, handoffEvents };
