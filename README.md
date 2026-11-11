# Hollis & Marr LLP: five automations for a fictional law firm

Hollis & Marr is a **made-up** firm in Harlow Point (11 people, founded 2014) that does family, personal injury, employment and estate planning and probate work. It is the invented company behind five automations I built, merged here into one team and one site. No person, client, matter, notice or email in the demos is real, and the domain `hollismarr.example` cannot receive mail.

The automations run on n8n, open models on Groq and OpenRouter, and Vercel. **Nothing sends a message to a client on its own judgment.** The one automatic email is the fixed booking confirmation, sent only to the address that booked.

> The repo and folder are still named `wrenbook` from an earlier version of this project (a made-up invoicing app). That brand is retired; its history is in [PLAN.md](PLAN.md). Renaming the GitHub repo is an owner task.

## The state, plainly

**All five are built and tested offline. None is live yet.** Nothing from this repo has been imported into n8n or deployed to Vercel, and no real model has been run on any of the evaluation sets, so **how well the models do is not measured**. Every number below is from tests and from labelled sets that I wrote myself, so they are regression checks and not independent proof. [CUTOVER.md](CUTOVER.md) is the runbook for going live, with every step that needs the owner's OK, and it names the live runs that will produce the missing numbers.

| Team | Automation | What it does | Evidence so far | Not measured |
|---|---|---|---|---|
| Intake | Lead intake and scoring | Matches a web form to a practice area, screens the other side against an invented conflict list, flags court dates and other time-sensitive wording, scores 0 to 100, picks the next step. No model. | 48 invented leads, 48 of 48 match their labels | Same-author labels; the conflict list is 22 invented names |
| Front office | Inbox triage | Sorts email, flags time-sensitive mail, saves a reply as a Gmail **draft** that is never sent. Courts, other lawyers, spam and instruction-like text get no draft. | 54 invented emails scored with stand-in models: a perfect model 54 of 54; a hostile or missing one still keeps the 49 checkable guarantees | The real model's accuracy. A scorer for the live run is ready |
| Intake | Consultation booking | Offers free first-consultation times and books one, on the site or by voice. Rules choose the attorney and enforce notice, buffer, one booking per person and the conflict check. No model. | 86 invented cases, 86 of 86; an independent brute-force check agrees on 72 scenarios across both daylight-saving changes; 46 of 46 deliberate breakages caught | A race between two simultaneous requests on a real n8n table |
| Paralegals | Court-notice extraction | A vision model copies a scanned court paper into fields; tested rules set the priority. Every result is "Needs attorney confirmation" and nothing can approve one. No deadline is ever worked out. | 12 invented notices: a perfect reader 12 of 12; 800 random readings agree with a separate restatement of the rules; 53 of 53 breakages caught | Whether a real model can read the pages. A model that calls every page "not a court document" would leave urgent notices without an alert |
| Front desk | Voice line | Answers questions about the firm by voice and books a consultation through the same booking service as the site. Urgent wording, advice requests and changes get fixed replies; a check blocks advice, a stated deadline or an invented fee. | 124 offline tests; 54 invented questions: the right knowledge reaches the model for all 43 that need it and the 11 that must not go to it do not | The chat model's answers; speech recognition and the voice with a real microphone |

## How they fit together

Four handoffs. Each is a reference, a label or a log row, never a client email.

1. **Intake to booking.** After a `book` or `follow_up` result the visitor is shown the booking page. The booking keeps the lead reference, and its log event carries the same reference.
2. **Voice to booking.** A call books through the same two endpoints and the same rules as the website, so a voice booking gets the same decision as a web one.
3. **Triage to intake.** A new inquiry that arrives by email is labelled for the intake coordinator (court mail for the paralegals). No lead row is created from an email yet.
4. **Notices to ops.** Every notice is a `needs_human` row, a line in the daily digest and, if urgent, one alert to the attorney on duty with no party names.

A shared ops layer ties them together: one log (`ops_events`, metadata only, a short summary with no names, addresses or phone numbers), one error alert, one daily digest to the owner and one nightly cleanup that deletes activity-log and inbox-log rows after 90 days. Leads, bookings and notices are never deleted automatically. See [automations/ops/SPEC.md](automations/ops/SPEC.md) and [automations/handoffs/README.md](automations/handoffs/README.md).

## The rules everywhere

No legal advice. A date is only repeated as printed, never stated as a deadline. No opinion on whether anyone has a case, no promise of an outcome, no testimonials. Disclaimers on every page and in every draft. Invented data only. Logs hold references and categories, not names or message text. A conflict screen is never revealed to the visitor. Wording lives in `firm/firm.json`.

## Layout

```
firm/                  the firm's facts: name, areas, fees, availability, urgency wording, invented conflict list, shared rules in lib/
knowledge/             shared knowledge base (voice and triage drafts)
brand/                 palette, tokens, logo, design rules (dark, brass accent, Inter)
automations/
  intake/              lead intake and scoring: rules, 48 labelled leads, generated workflow
  triage/              inbox triage: rules, prompts, 54 labelled emails, scorers (offline and live), generated workflows
  booking/             consultation booking: slot rules, 86 cases, oracle, generated workflow
  notices/             court-notice extraction: rules, 12 invented notices, scorers, generated workflow
  ops/                 event log, digest, error alert, cleanup: helpers, tests, generated workflows
  handoffs/            the four links as data, with chain checks
web/site/              the firm's Vercel site: home, practice areas, contact (intake), book, voice page, how it runs, privacy
voice/                 the voice line (FastAPI): router, answer check, booking dialog, 54 questions
scripts/               workflow generators, prepare-import, live-check, knowledge sync
PLAN.md                the plan, the log of each phase and its findings
CUTOVER.md             how to go live, step by step, and what to retire
LOOM-SCRIPT.md         the script for the one walkthrough video
```

The n8n workflow files in `automations/*/` are **generated** from the tested libraries (`scripts/build-*-workflow.mjs`); change the rules in `lib/` and rebuild, and a test fails if a file is out of date.

## Run the checks

```bash
node --test firm/test/ automations/intake/test/ automations/triage/test/ automations/notices/test/ automations/booking/test/ automations/handoffs/test/ automations/ops/test/ web/site/test/
cd voice && python -m unittest discover -s tests
```

Currently 357 Node tests (firm 20, intake 29, triage 55, notices 52, booking 47, handoffs 8, ops 48, site 98) and 124 Python tests pass. Also:

```bash
node scripts/build-intake-workflow.mjs --check     # likewise build-booking, build-triage, build-notices, build-ops-workflows
node scripts/sync-knowledge.mjs --check
```

Offline evaluations: `node automations/intake/eval/run.js`, `automations/triage/eval/run.js`, `automations/booking/eval/run.js`, `automations/notices/eval/run.js`. To see the site locally, see [web/site/README.md](web/site/README.md) (the forms answer "unavailable" until the cutover, by design).

## Going live

[CUTOVER.md](CUTOVER.md) lists the order: create two tables, fill a git-ignored local config, `node scripts/prepare-import.mjs` (fills the placeholders in copies of the eight workflow files and never imports anything), import, attach credentials, test, publish, deploy to Vercel, then `node scripts/live-check.mjs journey` and `verify` to prove the intake-to-booking chain and its log events, then the live model runs. The folders `automations/sales-leads`, `sales-booking`, `support` and `finance-invoices` are the Wrenbook-era sources, kept for history until a cleanup commit.

## Known gaps

- Nothing is imported, published or deployed, and no model has been run on the labelled sets. The live numbers are owed.
- The labels, the rules and the code were written by one person. A second person labelling the same sets would be the real check.
- Booking has no calendar mirror, cancel endpoint, holiday calendar or email verification; the double-booking check has been simulated but not tried on a real table.
- A court notice that arrives by email is not sent to the notices workflow, and a new-matter email does not become a lead by itself.
- The voice line has no rate limit of its own (a Vercel Firewall rule is part of the cutover), and its page access is an owner decision. The site's rate limit lives in one instance's memory until that rule exists.
- Notice images and triage text go to third-party model providers, so only invented material belongs in the demo.
- The time zone (`America/Chicago`), the name, the trademark and the domain are placeholders for the owner to confirm.
