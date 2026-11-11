# Hollis & Marr LLP ops layer (spec)

Shared plumbing for the five automations (intake, triage, booking, court notices, voice). Hollis & Marr LLP is a fictional firm; every row here is invented demo data.

Principle: **ops logging must never break an automation.** The event is built by a pure function that never throws, written by a data-table insert that continues on failure, and holds metadata only. Nothing in this layer sends mail to a client. The only mail it sends goes to the owner address, set at import and never committed.

What is built and tested offline: `lib/event.js`, `lib/adapters.js`, `lib/digest.js` and their tests (`node --test test/`). What is not done until the cutover: creating the table, importing the workflows, a live run. See `CUTOVER.md`.

## 1. Event log: data table `ops_events`

One row per automation run. Columns are in `ops_events.schema.json`; `lib/event.js` builds and checks every row, and the generated n8n Code nodes contain that file as it is, so what the tests run is what n8n runs. A test compares the schema file with the code, so the two cannot drift.

| column | type | notes |
|---|---|---|
| `ts` | date | event time |
| `automation` | string | `intake`, `triage`, `booking`, `notices`, `voice`, `ops` |
| `team` | string | filled from the automation: `intake`, `front-office`, `paralegals`, `front-desk`, `ops` |
| `runId` | string | the lead, booking or notice reference, or the Gmail message id |
| `source` | string | `web`, `gmail`, `voice`, `upload`, `seed`, `eval`, `schedule`, `handoff` |
| `status` | string | `ok`, `needs_human`, `blocked`, `error` |
| `summary` | string | at most 140 characters; email addresses become `[address]`, digit runs that look like a phone number become `[number]`; references are kept whole |
| `latencyMs` | number | optional |
| `handoffTo` | string | receiving automation, or empty |
| `handoffRef` | string | the receiver's own reference, or `queue` when a person's queue receives it |

Rules held in `validateEvent`, not by hand in each workflow: a known automation, source and status; a non-empty summary; a handoff names a receiver and a reference. An event that fails these is dropped, never thrown.

### What each automation logs (`lib/adapters.js`)

Each adapter turns what the automation already produces into one event. None reads a name, an address, a phone number, a subject, an other-side name or message text, and a test looks for exactly that across all 48 intake, 54 triage, 12 notice and 60 booking cases.

| Automation | `status` | `source` | Handoff |
|---|---|---|---|
| intake | `needs_human` when the next step is `attorney_now`, `ask_more`, `follow_up` or `hold_conflict`, else `ok`. Spam and invalid input are not logged. | `web` | to `booking` with the lead reference when the visitor is shown the booking page: next step `book` or `follow_up` (`web/site/contact.js`). Never after a conflict hold, an urgent matter or a referral out. |
| triage | `needs_human` when the label says a person must act or the classifier failed, else `ok` | `gmail` | to `intake` or `notices` with `queue` when the mail was routed to a person's queue |
| booking | `booked` is `ok`; `conflict_hold` and `already_booked` are `needs_human` (the visitor was told to call the office); `slot_taken` and `not_offered` are `blocked`; anything else is `error`. Invalid input and spam are not logged. | `handoff` when the booking arrived with an intake reference, `voice` for a call, else `web` | none |
| notices | always `needs_human`: every notice waits for an attorney to confirm, whatever its priority | `upload` | none |

## 2. Handoffs

A handoff is two events that chain by reference. The sender writes `handoffTo` and `handoffRef`. The receiver writes its own row with `source=handoff` whose `runId` equals that reference. The digest counts handoffs between automations and handoffs to a person's queue separately.

| From | To | How it is linked | Not done |
|---|---|---|---|
| intake | booking | the booking page carries the lead reference; the booking row keeps it as `leadRef` and its event `runId` | |
| voice | booking | the call books through the same rules; the event has `source=voice` | the call has no lead reference unless the caller was an intake lead |
| triage | intake | `handoffRef=queue`: the mail is labelled for the intake coordinator | no lead row is created from an email; listed in `web/site/data/status.json` as a later link |
| triage | notices | `handoffRef=queue`: the mail is labelled for the paralegals | the attachment is not passed to the notices workflow automatically |
| notices | ops | every notice is a `needs_human` row, a line in the digest and, if urgent, an owner-only alert | |

`automations/handoffs` holds the same rules as code with their own tests.

## 3. Scheduled jobs (`scripts/build-ops-workflows.mjs`)

| Job | When | What |
|---|---|---|
| `H&M Ops - Error alert` | when a production workflow fails (error workflow) | Mails the owner: workflow, node, a cut error message with no address. Writes an `ops_events` row with `status=error`. |
| `H&M Ops - Daily digest` | 08:00 in the workflow's timezone | Counts the last 24 hours per automation and status. Notices waiting, urgent notices, bookings by channel, handoffs, a list of what needs a person (15 at most). Seed and eval events are listed but not counted. Owner-only. |
| `H&M Ops - Cleanup` | 03:30 | Deletes `ops_events` and `triage_log` rows older than 90 days. |

`lib/digest.js` holds all three as pure functions: `buildDigest`, `errorAlert`, `retentionCutoff`. `retentionCutoff` throws for any table without a rule, so a table cannot be added to the cleanup by accident.

### Retention

| Table | Kept for |
|---|---|
| `ops_events` | 90 days |
| `triage_log` | 90 days |
| `intake_leads`, `bookings`, `court_notices` | no automatic deletion; removal is by hand. The privacy page says so. |

## 4. Config

There is no config table. The firm name and domain come from `firm/firm.json` when the workflows are built. The only value that differs per owner is the owner address, put into each workflow at import by `scripts/prepare-import.mjs` from a local file that is never committed. `config.example.json` shows the keys; `owner_address` and `timezone` are placeholders, and the timezone is the owner's to confirm.

## 5. Limits

- Events record what the code decided, not whether a person acted. `needs_human` means someone has to look, not that they did.
- A failed event write is silent by design. The digest therefore counts only what was logged; a workflow that ran but could not log would not appear. The error alert covers the workflow failing, not the log insert failing.
- An n8n error message can quote a few characters of the data that failed, and the error alert cuts and cleans it (no address) but cannot know what it holds. The alert goes to the owner address only.
- Nothing here has run in n8n yet. The numbers in tests are from the libraries' own evaluation sets, not from real traffic.
