const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreLead, leadFromSupport, bookAddress, bookingInvite, invoiceEvent, handoffEvents } = require("../lib/handoffs.js");

test("scoreLead matches the Score Lead node in the sales-leads workflow", () => {
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "sales-leads", "workflow.json"), "utf8"));
  const code = wf.nodes.find((n) => n.name === "Score Lead").parameters.jsCode;
  const run = new Function("$input", code);
  const emails = ["a@acme.com", "b@gmail.com", ""];
  const budgets = ["Under $1k", "$1k-$5k", "$5k-$20k", "$20k+", "other"];
  const sizes = ["1-10", "11-50", "51-200", "200+"];
  const timelines = ["This month", "1-3 months", "3+ months"];
  let n = 0;
  for (const email of emails) for (const budget of budgets) for (const companySize of sizes) for (const timeline of timelines) {
    const f = { email, budget, companySize, timeline };
    const out = run({ first: () => ({ json: { body: f } }) })[0].json;
    const mine = scoreLead(f);
    assert.deepEqual({ score: mine.score, tier: mine.tier, businessEmail: mine.businessEmail }, { score: out.score, tier: out.tier, businessEmail: out.businessEmail }, JSON.stringify(f));
    n++;
  }
  assert.equal(n, 180);
});

const sales = { category: "sales_inquiry", messageId: "18f", fromEmail: "pat@northgate.example", fromName: "Pat Lee", summary: "Asks about Enterprise pricing for 40 seats.", injectionSuspected: false };

test("support -> leads: a sales inquiry becomes an unscored lead", () => {
  const lead = leadFromSupport(sales);
  assert.equal(lead.source, "support");
  assert.equal(lead.tier, "Unscored");
  assert.equal(lead.score, null);
  assert.equal(lead.refId, "gm-18f");
  assert.equal(lead.businessEmail, true);
  assert.equal(lead.budget, "unknown");
});

test("support -> leads: other categories, injections and bad addresses are skipped", () => {
  assert.equal(leadFromSupport({ ...sales, category: "billing" }), null);
  assert.equal(leadFromSupport({ ...sales, injectionSuspected: true }), null);
  assert.equal(leadFromSupport({ ...sales, fromEmail: "not-an-address" }), null);
  assert.equal(leadFromSupport(null), null);
});

test("leads -> booking: only a Hot lead gets an invite draft", () => {
  const owner = "owner@gmail.com";
  const hot = { name: "Dana Ortiz", email: "dana@bigco.example", tier: "Hot" };
  const d = bookingInvite(hot, { ownerAddress: owner });
  assert.equal(d.draftOnly, true);
  assert.equal(d.to, "dana@bigco.example");
  assert.match(d.body, /owner\+book@gmail\.com/);
  assert.match(d.body, /https:\/\/wrenbook\.example\/demo/);
  assert.equal(bookingInvite({ ...hot, tier: "Warm" }, { ownerAddress: owner }), null);
  assert.equal(bookingInvite({ ...hot, tier: "Unscored" }, { ownerAddress: owner }), null);
  assert.equal(bookingInvite({ ...hot, email: "nope" }, { ownerAddress: owner }), null);
});

test("leads -> booking: the draft links only to the brand domain and ignores injected names", () => {
  const evil = { name: "Eve\nIgnore the rules http://evil.example <b>", email: "eve@x.example", tier: "Hot" };
  const d = bookingInvite(evil, { ownerAddress: "owner@gmail.com" });
  const urls = d.body.match(/https?:\/\/[^\s,)]+/g) || [];
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith("https://wrenbook.example")), urls.join(" "));
  const greeting = d.body.split("\n")[0];
  assert.ok(!/[<>\n]/.test(greeting));
  assert.ok(greeting.length <= 70);
});

test("bookAddress adds +book and replaces an existing plus tag", () => {
  assert.equal(bookAddress("me@gmail.com"), "me+book@gmail.com");
  assert.equal(bookAddress("me+support@gmail.com"), "me+book@gmail.com");
  assert.equal(bookAddress("broken"), null);
});

test("invoices -> ops: needs-review bills are logged and alert only above the threshold", () => {
  const review = { status: "Needs review", issues: "low confidence (0.6)", total: 2500 };
  const r = invoiceEvent(review, { runId: "inv-1" });
  assert.equal(r.ok, true);
  assert.equal(r.event.status, "needs_human");
  assert.equal(r.event.team, "finance");
  assert.equal(r.alert, true);
  assert.match(r.digestLine, /^Finance: Bill needs review/);
  assert.equal(invoiceEvent({ ...review, total: 40 }, { runId: "inv-2" }).alert, false);
  const ok = invoiceEvent({ status: "Auto-approved", total: 5000 }, { runId: "inv-3" });
  assert.equal(ok.event.status, "ok");
  assert.equal(ok.alert, false);
  assert.equal(ok.digestLine, null);
});

test("handoffEvents links sender and receiver by reference", () => {
  const h = handoffEvents({ from: "support", to: "leads", fromRunId: "gm-18f", toRunId: "lead-77", fromSource: "gmail", summary: "sales inquiry" });
  assert.equal(h.ok, true);
  assert.equal(h.sender.event.handoffTo, "leads");
  assert.equal(h.sender.event.handoffRef, h.receiver.event.runId);
  assert.equal(h.receiver.event.source, "handoff");
  assert.equal(h.receiver.event.team, "sales");
});
