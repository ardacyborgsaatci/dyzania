# Hollis & Marr LLP: turn the automations into a law-firm company

**Decision (2026-11-11):** the five Wrenbook automations are converted **in place** into the automations of a fictional law firm, **Hollis & Marr LLP** (Harlow Point, 11 people, founded 2014). Wrenbook is retired as a brand; its history is kept below. The dark design system stays; the accent changes from wren orange to brass. The repo and folder are still named `wrenbook`; renaming the GitHub repo is an owner task.

**Renamed (2026-11-11, owner's choice): the firm is now Dyzania LLP** (short name Dyzania, placeholder domain `dyzania.example`). Everything below this note is the log as it was written and still says Hollis & Marr, `H&M` workflow names and the `HM-` reference prefix. The code, data, site, prompts and docs outside this file were renamed in one commit: references are now `DY-...`, workflows are named `Dyzania ...`, packages are `dyzania-*`, the CSS tokens are `--dy-*`. The two founding partners keep their names (Dana Hollis, Marcus Marr), since they are people and not the brand. No trademark or domain search has been done for "Dyzania".

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

- 2026-11-11: phase 7 code done (not committed; phases 5 and 6 are also uncommitted, phases 1 to 4 are committed locally, none pushed). **No live step has been taken**: nothing is imported into n8n, published, deployed or archived, and no real model has run. Built and tested: (1) The ops layer is the firm's: `automations/ops/lib/event.js` (automations intake, triage, booking, notices, voice, ops; sources web, gmail, voice, upload, seed, eval, schedule, handoff; summary at most 140 characters, `@` and 7-digit runs scrubbed but `HM-`/`N-` references kept, a handoff names a receiver and a reference; `orFallback` always yields a valid error row so a missing log line is loud), `adapters.js` (intake, booking, notice and triage decisions into events; intake hands off to booking for `book` and `follow_up`, triage hands to a person's queue), `digest.js` (24 hour window, seed and eval rows listed but not counted, notices waiting and urgent, bookings by channel, handoffs, an attention list of at most 15, the error alert, retention rules: `ops_events` and the triage log 90 days, nothing else ever). (2) The four generated workflows each gained a "Build ops event" Code node and a "Log ops event" data-table insert that continues on error (`scripts/lib/ops-nodes.mjs`); parity tests run each Code node's text against the adapters. (3) Three generated ops workflows (`scripts/build-ops-workflows.mjs`): daily digest 08:00, error alert, nightly cleanup 03:30 (two branches, at most 1000 deletes a night, undated rows skipped). (4) `automations/handoffs`: the four links as data, `chainProblems` and `openHandoffs` over event rows. (5) `scripts/prepare-import.mjs`: fills the placeholders of eight workflow files from a git-ignored local config into a git-ignored folder, validates ids, addresses, mailbox and time zone, writes nothing for a workflow with a missing value, never touches n8n. (6) `scripts/live-check.mjs`: `journey` acts as one invented visitor against a deployed site (token, intake, slots, book with the lead reference); `verify` checks the exported `ops_events` rows (both events exist, chain by the lead reference, valid, no name, address or phone-like number, digest counts them); tested against the real site endpoints with a stand-in n8n. (7) `automations/triage/eval/score-live.js`: scores a live run of the triage core against the 54 labels (fields, needs-human recall, injections flagged, urgent raised, classifier fallbacks, broken guarantees, drafts a person must read); tested on stand-in results only. (8) `CUTOVER.md` is now the runbook for the firm, written after a read-only look at n8n: `intake_leads`, `court_notices` and `ops_events` already match their schemas and are empty; the old `triage_log` has Wrenbook columns and a live workflow, so the firm's is created as `hm_triage_log`; `bookings` does not exist; 12 old workflows are active; no firm workflow exists in n8n. The root README, the Loom script and the READMEs of triage, intake, booking, notices and ops were brought in line; the site's status data now lists the event log and digest as written and tested, not running. Found by the checks: the phone scrubber mangled `N-20261111-AB12-01` (references are now protected, one shared `looksLikePhone`); the intake handoff was too narrow (`book` only, now also `follow_up`); `prepare-import` validated the transformed `+triage` alias instead of the mailbox; several of my own test expectations were wrong (the code was right). Tests: firm 20, intake 29, triage 55, notices 52, booking 47, handoffs 8, ops 48, site 98, voice 124 (legacy finance eval 9, old booking eval 9). All generators pass `--check`. **Not done:** every cutover step (OK needed for each), the live runs (triage 54 emails, notices 12 PNGs, voice 54 questions, a real call), the Vercel deploy and Firewall rule, the Loom, the push of the local commits, the cleanup of the Wrenbook-era folders and the old n8n workflows.
- 2026-11-11: phase 6 built (not committed; phase 5 is also uncommitted, phases 1 to 4 are committed locally, none pushed). `web/site` is the firm's now: home, practice areas (fees, attorneys, what to bring, matters not handled), contact (the intake form), book (area, times, details), voice line page, "how it runs" (from `data/status.json`), privacy and disclaimers, 404. The old Wrenbook pages, demo endpoints and their tests are deleted. One header and footer on every page (a test enforces it), carrying the firm facts and the four disclaimers from `firm/firm.json`. Four endpoints: `/api/token`, `/api/intake`, `/api/slots`, `/api/book`. Guards in `lib/guard.js`: same-origin check, per-IP rate limit in memory, honeypot field, signed form token (valid 3 seconds to 2 hours), 8 KB body cap. `lib/upstream.js` calls n8n with a header secret, forwards only whitelisted fields and never shows an upstream message. Privacy rules held in the proxies: the intake `nextStep` becomes book / follow_up / urgent / refer / review, a conflict hold is never exposed, a repeat booking and a conflict hold get the same "contact the office" words and status, the channel is forced to `form`, nothing with a name is logged. Design follows the UI UX Pro Max guidance (Trust & Authority + Conversion pattern, one primary action per screen, visible labels, errors beside the field joined with `aria-describedby` plus a focusable summary that links to each field, validate on blur, 44 px targets, a skeleton with `aria-busy` while times load, reduced motion honoured, inline SVG icons, no gradients). Its light navy palette and serif were rejected because the brand is dark with brass and Inter. The Taste skill was requested but is not installed (no install command was given), so it was not used. Checked: 93 site tests (the endpoints run the real intake and booking rules behind a stand-in n8n; page tests compare each fact, fee, option list and id with `firm/*.json`, the intake rules and the scripts, and three deliberate page breakages were each caught), plus a browser run at phone, tablet and desktop widths through both forms (validation errors, urgent reply, booked, a time taken meanwhile, a repeat booking) and a scan of every page for heading order, landmarks, names, target sizes and overflow. **Not measured or not done:** nothing has run against real n8n (the intake and booking workflows are not imported, so the forms answer "unavailable" until the cutover); the rate limit is per server instance (the real limit is a Vercel Firewall rule at cutover); a determined script can still fetch a token (Cloudflare Turnstile is an optional owner-only step); no screen reader test; the fonts come from Google Fonts. Tests: firm 20, intake 26, triage 46, booking 43, notices 49, site 93, voice 124.
- 2026-11-11: phase 5 built (not committed; phases 1 to 4 are committed locally, none pushed). `voice/`: the voice line is the firm's. A router (`router.py`) decides what answers each turn: time-sensitive wording gets fixed words (even in the middle of a booking, which is paused and not saved), then the booking dialog, then change/advice/person fixed replies, and only then the chat model, whose reply goes through an answer check (`guards.py`: advice, case opinion, outcome, deadline as fact, promised time, legal conclusion, invented fee, email, link or phone). The booking dialog (`booking_flow.py`) calls the two Phase 3 endpoints from the server: area, three times spread at least two hours apart from a pool of 40, name, phone (skippable), email read back letter by letter (two failed tries go to the website), other side, a summary and the consent sentence, then the booking. Stop, repeat and corrections work; a service outage or two failed tries sends the caller to the website and nothing is saved. The server is stateless: the dialog state travels sealed (HMAC, 30 minutes) and a state it did not make is ignored. Turns that carry personal details are `private`, so the page keeps them out of the history sent to the chat model. `firmdata.py` mirrors the website's area and urgency matching, and `tests/parity.js` runs the real JavaScript and the Python on the same 34 sentences. `spoken.py` parses what was said (yes/no, phone, email, name, other side, a choice) and makes text fit to be spoken (emails spelled, phone digits grouped, "L L P"). The page has the brand design and a disclaimer; the terminal version uses the same router. 54 invented questions in `questions.json` (dev 39, holdout 15) with the holdout not tuned on. Offline: 124 Python tests, with the booking tests running the real `booking.js` rules through a Node bridge (double booking race, repeat booking, stale slot, outage, failed confirmation email); retrieval sends a section that holds the answer for 28 of 28 dev and 15 of 15 holdout model questions; the 11 fixed-path questions all answer without the model. Found by the checks: yes/no negation, "a" and "i" read as part of an email, bare number words choosing an option, weekday ambiguity, "just Jane", a refusal wrongly blocked by the answer check, state mutated in place, an intro said before a refusal, adjacent 15-minute slots read out, and asking for the office address did not retrieve the address (fixed, two dev questions added). **Not measured:** the chat model's answers (needs a Groq key: `python run_questions.py`), speech recognition and the voice with a real microphone (`voice/MANUAL-CALL.md`), booking through n8n (workflow not imported yet, Phase 7). Not done: rate limiting (a stateless function cannot; Phase 7 plans a Vercel Firewall rule) and a decision on access (Vercel Authentication). Tests: firm 20, intake 26, triage 46, booking 43, notices 49, site 65, ops 8, handoffs 8, finance eval 9, old booking eval 9, voice 124.
- 2026-11-11: phase 4 built (not committed; phases 1 to 3 are committed locally, none pushed). `automations/notices`: a vision model copies a scanned court paper into JSON and tested rules (`lib/notices.js`) decide the priority; the model's opinion never does. Every result, including a failed read, is saved as "Needs attorney confirmation" and nothing can approve a notice. Urgent = summons or subpoena, any date within 7 days or already passed (as printed), a poor scan, a printed date that could not be read, or a failed read; high = every other court paper; normal = only a non-court document. It never computes a deadline: a date is repeated as printed, and a time limit counted from another event is copied as printed. The model's ISO date is checked against the printed date (a disagreement uses both, the earlier decides, and the row is flagged). One alert email per upload, no party names or page text. 12 invented notices drawn as PNGs (`eval/draw` redraws them) with labels written before the code. Offline evaluation, no model: a perfect reader reproduces 12 of 12 labels, 800 random readings agree with a separately written restatement of the rules, 415 odd answers produce 0 problems, and stand-in models (obedient, garbage, failing) never change the status. A model that says every page is "not a court document" leaves 8 of 8 urgent notices without an alert; that is listed as a limit. 53 mutants of the library were all caught on the first run (one test was added beforehand for the mutant I expected to survive). Found by the checks: the scorer treated an empty table cell as different from null (fixed), and one label said "poor" for a scan I could read (now "partial"). One workflow generated by `scripts/build-notices-workflow.mjs` (basic-auth upload form, OpenRouter vision call, rules, data table `court_notices`, one alert email). No model has read these images; not imported or run in n8n; the images go to a third-party model, so only invented papers belong in the demo (README). Handoff 4 (ops event and daily digest line) is Phase 7. Tests: firm 20, intake 26, triage 46, booking 43, notices 49, site 66, ops 8, handoffs 8, finance eval 9, old booking eval 9, voice 3.
- 2026-11-11: phase 3 built (not committed). `automations/booking`: slot rules in one tested file (`lib/booking.js`) that read `firm/availability.json` and `practice-areas.json` (15-minute buffer counted once, 4-hour notice, 30-day horizon, 15-minute grid, consultation must end inside the window, one active booking per email or phone, conflict check must be `clear`, attorney chosen by the rules), a fixed confirmation email, a post-insert race check (`bookVerify`, earliest row id keeps the slot), a cancel rule, a metadata-only event. Two endpoints in one generated workflow (`booking/slots`, `booking/book`, header auth, no model, one email node that only sends the template to the booked address). 86 invented cases with labels written before the code; a brute-force oracle (every 15-minute UTC instant, minute-by-minute occupancy) agrees on 72 scenarios across both daylight-saving changes; random booking and race simulations hold the invariants; 46 mutants of the library are all caught (one survivor needed a new case). Found by the checks: one of my labels was wrong (code right), `Date.parse` accepts 30 February (fixed), the scorer never checked the `won` flag (fixed). Booking by email means the intake and triage link to the same form, not a thread-negotiating agent. Not imported or run in n8n; the race check assumes ids are assigned in commit order (to be tried with two simultaneous requests at cutover); no email verification or rate limit yet (Phase 6); no calendar mirror, no cancel endpoint, no holiday calendar. Tests: firm 20, intake 26, triage 46, booking 43, site 65, ops 8, handoffs 8, finance eval 9, old booking eval 9, voice 3.
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
