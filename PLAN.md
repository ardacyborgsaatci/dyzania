# Hollis & Marr LLP: turn the automations into a law-firm company

**Decision (2026-11-11):** the five Wrenbook automations are converted **in place** into the automations of a fictional law firm, **Hollis & Marr LLP** (Harlow Point, 11 people, founded 2014). Wrenbook is retired as a brand; its history is kept below. The dark design system stays; the accent changes from wren orange to brass. The repo and folder are still named `wrenbook`; renaming the GitHub repo is an owner task.

Defaults taken (owner can change any): fictional firm; US with no named state, so deadlines are illustrative settings and never real law; practice areas family, personal injury, employment, estate planning and probate; first consultation free for injury and employment, $150 for 45 minutes for family and estate (credited to the retainer); booking confirmations are the only automatic email, from a fixed template; voice booking takes an email by spelling and read-back, then falls back to the website after two failed tries; business timezone default America/Chicago, to be confirmed.

## The five automations, redefined

| Team | Automation | Was | Now |
|---|---|---|---|
| Client care | Triage | Support triage | Flags time-sensitive and court matters (hearing or deadline within 7 days, served papers, protective order, arrest, eviction), drafts acknowledgements only |
| Intake | Lead intake and scoring | Lead scoring | Matches web form entries to the four practice areas, scores, checks the other side's name against an invented conflict list |
| Intake | Booking agent | Demo booking | Books first consultations 24/7 through the website form, the voice line or email. Needs conflict clear |
| Front desk | Voice line | Voice line | Answers firm questions, can book a consultation |
| Records | Court-notice extraction | Invoice extraction | Reads hearing notices and summonses. Never auto-approved: every result is "Needs attorney confirmation" |

## Handoffs

1. Triage to Intake: a new case inquiry becomes a lead.
2. Intake to Booking: a Hot or Warm lead with no conflict is offered slots.
3. Voice to Booking: a caller books after a short screen.
4. Records to Ops: a notice with a date within 7 days raises an urgent attorney alert and appears in the daily digest.

## Law-firm rules that apply everywhere

No legal advice, never state a legal deadline as fact (only repeat a date as written), no case-merit opinions, no outcome promises, no testimonials. Disclaimers on every page and in every draft. Demos use invented data only. Logs hold metadata only. Wording lives in `firm/firm.json`.

## Phases

0. **Firm data, knowledge base, brand kit.** `firm/` (facts, practice areas, availability, urgency rules, invented conflict list) with tests; rewritten `knowledge/`; brass accent, new logo, `brand/BRAND.md`.
1. Lead intake and scoring, with conflict check and tests.
2. Triage: new classifier and draft prompts, a set of about 50 invented emails, evaluation scorer.
3. Booking: rules code that matches `firm/availability.json` exactly (15-minute buffer), form, voice and email paths, evaluation set.
4. Court-notice extraction: workflow, 12 invented notices, scorer, evaluation.
5. Voice: new knowledge, booking tool, email read-back, question set.
6. Site: home, practice areas, intake form with booking, voice page, ops page, privacy and disclaimers.
7. Handoffs, evaluations, one cutover (each publish and archive with owner OK), README and Loom.

The Wrenbook ops layer (event log, error alert, digest, cleanup, the budget check) is kept and renamed. The Wrenbook n8n copies built so far are unpublished and are renamed at the cutover. Pending Wrenbook approvals (publishing the digest and cleanup, a test digest email) are on hold; they apply to the renamed workflows.

## Progress log

- 2026-11-11: phase 2 built (not committed). `automations/triage`: rule screen (time-sensitive wording, instruction-like text, automatic replies, known-court and other-lawyer senders, language), classifier and draft prompts for the firm, decision rules (priority floors, draft modes none/acknowledgement/standard, queues, hand-off field), fixed English/Spanish acknowledgement, a draft check for advice, case opinions, deadlines stated as fact, promised times, invented fees and links, alert and log with no message text. 54 invented emails with labels written first; offline scorer with three stand-in models (no model was called, no Groq key here): perfect model 54/54, hostile or missing model 49/49 guarantees on the emails the rules can see, five listed as limits. Mutation check: 22 breakages, 21 caught, one needed a new test, one no-op. Two workflow files generated from the library by `scripts/build-triage-workflow.mjs` (core with two Groq nodes, Gmail wrapper that makes drafts and never sends). Shared rules changed: `firm/urgency.json` (+`spam`, +`respond by`, +`response due`), `firm/lib/text.js` ("I keep hearing" is not a hearing; intake re-checked, 48/48). Not imported or run in n8n; the real model's accuracy is not measured (live run is Phase 7). Tests: firm 20, intake 26, triage 46, site 65, ops 8, handoffs 8, finance eval 9, booking eval 9, voice 3.
- 2026-11-11: phase 1 built (not committed). Shared `firm/lib` (text, areas, conflicts, urgency) and `automations/intake` (rule-based validation, area match, conflict check, urgent wording, 0-100 score, next step, fixed visitor reply, alert without message text). 48 invented eval leads, all matching their labels (the set never failed, so it did not tune anything; it is a regression set from one author). `workflow.json` is generated from the library by `scripts/build-intake-workflow.mjs` and a test runs its Code node over every eval lead. Landlord-tenant added as a matter the firm does not handle (KB-01, KB-11). Data table `intake_leads` created in n8n. Not yet imported or run in n8n; that is the first step of the cutover. Tests: firm 20, intake 26, site 65, ops 8, handoffs 8, finance eval 9, booking eval 9, voice 3.
- 2026-11-11: phase 0 done. `firm/` data and 9 consistency tests, knowledge base rewritten for the firm (13 entries, synced to the voice copy and the triage draft prompt), brass accent and a courthouse-columns logo, `brand/BRAND.md` rewritten. The rest of the repo still says Wrenbook until its phase.

---

# Earlier plan: Wrenbook (kept for history)

## Wrenbook: combine the five automations

Approved brand: **Wrenbook**, a fictional invoicing and bills app for small businesses (12 people). Its own team runs on the five automations. Name still needs a trademark and domain check (owner task).

## Automations being merged

| Team | Automation | Old brand | Entry point |
|---|---|---|---|
| Sales | Lead intake & scoring | Brightline | "Talk to sales" form |
| Sales | Demo-booking agent | Larkwell Studio | `+book` alias |
| Support | Inbox triage | Fernbill | `+support` alias, website playground |
| Front desk | Voice line | Marlow & Pine | `/call` page |
| Finance | Supplier invoice extraction | none | Upload form, later `+invoices` |

## Handoffs (all drafts-only, nothing sent to customers automatically)

1. Support -> Sales: `sales_inquiry` emails become leads.
2. Sales -> Booking: Hot leads get a draft inviting them to book via `+book`.
3. Voice -> Sales: a caller wanting a demo gets the sales form pre-filled.
4. Finance -> Ops: "Needs review" invoices go to the shared alert and digest.

## Shared ops layer

- One `ops_events` table (metadata only), one row per run.
- One error alert, one daily ops digest, one cleanup.
- One shared Groq demo budget.
- One shared config: brand name, owner address, timezone, domain.

## Target layout

```
wrenbook/
  brand/        BRAND.md, tokens, logo
  knowledge/    one knowledge base for voice + support drafts
  automations/  sales-leads, sales-booking, support, finance-invoices, ops
  web/          Vercel: site + Node API functions
  voice/        Vercel: FastAPI voice agent
```

One GitHub repo, two Vercel projects (voice is Python). New n8n copies go in a "Wrenbook Ops" folder; old workflows stay live until the new ones pass.

## Steps

0. Lock brand. Export invoice workflow to files. Find the lead-intake repo.
1. Brand kit (own palette) and merged knowledge base.
2. Single repo; move code in unchanged; tests must pass.
3. Rebrand each automation as new n8n copies. Build the booking Gmail path directly as Wrenbook.
4. Shared ops layer.
5. The four handoffs.
6. Combined site and `/ops` dashboard.
7. Evals over several days (Groq limits): triage re-run, 40 booking emails, 10-15 invoices, voice questions.
8. README, one Loom, retire old sites/workflows (each with owner OK).

## Owner-only tasks

- Approve name; trademark and domain check.
- Google Calendar OAuth credential in n8n and business timezone (blocks live booking).
- Approve each publish, seed email, eval run, archive.
- Decide whether `/call` stays behind Vercel Authentication.
- Rotate any chat-pasted keys (Groq, Fish, OpenRouter).
- Record the Loom.

## Progress log

- 2026-11-11: steps 0, 1, 2 done. Step 3 done at repo level (all text rebranded, shared knowledge with `scripts/sync-knowledge.mjs`).
- 2026-11-11 decision: **n8n copies are deferred to one cutover.** The old Gmail workflow polls `+support` and the old Demo API owns its webhook paths, so a published copy would double every draft. Old workflows stay live until the cutover (after step 5, with owner OK for each publish and archive).
- Consequence: steps 4 and 5 (ops layer, handoffs) are written as specs and workflow exports in the repo first, then imported at cutover.
- 2026-11-11: step 4 done as a spec: `automations/ops/SPEC.md`, event schema, config defaults, and a tested event/budget helper (8 tests).
- 2026-11-11: step 5 done in the repo: `automations/handoffs/` (support->leads, leads->booking draft, invoices->ops, linked events), voice->leads wired in the voice page and the lead form. 16 new tests. Not yet deployed or imported into n8n.
- 2026-11-11: step 6 built: `web/site` merges the lead-intake and support sites, adds /ops, /call, a Wrenbook home page and brand CSS (65 tests). The two interim sites were removed from this repo (history keeps them). Not deployed; Vercel root dir will be `web/site` at the cutover.
- 2026-11-11: step 7 started. Booking: 40-case eval set, scorer and rule-parity tests written (`automations/sales-booking/eval`, 9 tests). Found that the effective buffer is 30 min, not the documented 15. No model run has happened; triage re-run, invoice eval and voice questions need owner approval (Groq/OpenRouter tokens) and the cutover for the Wrenbook versions.
- 2026-11-11: voice questions run as text on Groq (3 runs, prompt tightened twice): 15 of 15 on facts/refusals in run 3, dev-set caveat; results in `voice/RESULTS.md`. Owed: real microphone test, shorter answers.
- 2026-11-11: invoice evaluation run (12 invented bills, one multi-file upload): 1 bad approval (blurred I08), 72 of 77 fields right, all flawed bills sent to review. The form now reads several files per upload. Dark design system applied to brand and site.
- 2026-11-11: step 8 done in the repo: final README, `LOOM-SCRIPT.md` (one video, about 3 minutes), `CUTOVER.md` (cutover order and the retire list). **Nothing was retired**: old workflows, Vercel projects and folders stay until the cutover, each with owner OK. Still owner-only: record the Loom, the credential and trademark tasks, the buffer decision.
