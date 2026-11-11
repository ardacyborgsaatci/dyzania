# Wrenbook Ops layer (spec)

Shared plumbing for the five automations. Nothing here is built in n8n yet; it is imported at the cutover (see `PLAN.md`). The old per-project alert, digest and cleanup workflows keep running until then.

Principle: **ops logging must never break an automation.** Every call into this layer is fire-and-forget (`continueOnFail`), and every row holds metadata only.

## 1. Shared config: data table `ops_config`

Key/value rows read by every workflow through the `Wrenbook Ops - Get Config` sub-workflow (cached per run).

| key | default | used by |
|---|---|---|
| `brand` | `Wrenbook` | all prompts, templates |
| `domain` | `wrenbook.example` | draft checker link and address allowlist |
| `owner_address` | set at import (never committed) | every owner-only send node |
| `timezone` | owner to confirm (IANA name) | booking rules, digest schedule text |
| `support_hours` | `Mon-Fri 09:00-17:00 UTC` | voice and support answers |
| `demo_enabled` | `true` | kill switch for every public demo |

`config.example.json` holds the defaults. The owner address and any secret never go in the repo.

## 2. Event log: data table `ops_events`

One row per automation run. Columns are in `ops_events.schema.json` and validated by `lib/event.js` (the same code is pasted into the Log Event sub-workflow).

| column | type | notes |
|---|---|---|
| `ts` | date | event time |
| `automation` | string | `leads`, `booking`, `support`, `voice`, `invoices`, `ops` |
| `team` | string | `sales`, `support`, `front-desk`, `finance`, `ops` |
| `runId` | string | execution ID or a hash of the source message |
| `source` | string | `gmail`, `web`, `voice`, `seed`, `eval`, `schedule` |
| `status` | string | `ok`, `needs_human`, `blocked`, `error` |
| `summary` | string | at most 140 characters, no email addresses, no free-text from visitors |
| `latencyMs` | number | optional |
| `handoffTo` | string | target automation, or empty |
| `handoffRef` | string | the runId on the receiving side, or empty |

Privacy rules (enforced in `validateEvent`): no `@` in `summary`, no body text, no names of private people. Real Gmail rows are counted but never shown publicly, as in the triage feed.

`triage_log` stays as it is (it feeds the public support dashboard). `ops_events` is additive; the support Core writes to both.

## 3. Sub-workflows

| Name | Input | Output |
|---|---|---|
| `Wrenbook Ops - Log Event` | event fields | none (never throws) |
| `Wrenbook Ops - Get Config` | none | config object |
| `Wrenbook Ops - Check Budget` | `automation`, `kind` (`demo` or `inbox`), `visitorHash` | `{ allowed, reason, retryAfter }` |

## 4. Shared demo budget (Groq free tier)

All public demos and the real inbox draw on one Groq daily token allowance. The budget stops a busy demo from starving real mail.

Defaults (tune after measuring real token use):

| Bucket | Daily limit | Notes |
|---|---|---|
| Support demo | 15 requests | was part of 40 per day |
| Booking demo | 10 | fixture calendar only |
| Invoice demo | 8 | preset sample invoices only, image model is separate |
| Voice demo | 15 calls | each turn uses STT + chat |
| Public demos combined | 40 | hard ceiling, same as today |
| Reserve for the real inbox | everything else | `kind=inbox` is never blocked by the demo counters |

- Per visitor: 3 requests per hour per bucket (hashed IP, salted), as in the triage Demo API.
- Counters are computed from `ops_events` rows in the last 24 hours, so there is no extra table and nothing to reset.
- Eval runs use the shared secret, bypass the caps and write `source=eval`.
- When a cap is hit: HTTP 429 with `Retry-After`; the page shows a plain message. `demo_enabled=false` returns 503 for every demo.

## 5. Scheduled jobs (replace the per-project ones)

| Job | When | What |
|---|---|---|
| `Wrenbook Ops - Error Alert` | on failure (error workflow for every production workflow) | Emails the owner: automation, workflow, node, message. Also writes an `ops_events` row with `status=error`. |
| `Wrenbook Ops - Daily Digest` | 08:00 | Counts last 24 hours per automation and status; lists needs_human items per team; one short summary from `gpt-oss-20b`. Owner-only send. Replaces the support digest. |
| `Wrenbook Ops - Cleanup` | 03:30 | Deletes `ops_events` older than 90 days, `triage_log` older than 90 days, `demo_rate_limit` older than 1 day. |

All three send only to `owner_address`. There is still no node anywhere that sends mail to a customer.

## 6. Handoff contract (used in step 5)

A handoff is two events: the sender writes `handoffTo` + a new `handoffRef`; the receiver writes its own row with `source=handoff` and the same `runId`. The digest can then show a chain such as support -> leads -> booking.

| From | To | Trigger | Result |
|---|---|---|---|
| support | leads | category `sales_inquiry` | lead row created, score computed; no reply sent |
| leads | booking | tier `Hot` | owner-only draft inviting the lead to book via `+book` |
| voice | leads | caller wants a demo | page shows the sales form pre-filled; no email taken by voice |
| invoices | ops | status `Needs review` | line in the next digest, plus an alert if the amount is above a threshold in config |

## 7. Cutover checklist (owner approves each line)

1. Create `ops_config` and `ops_events` tables.
2. Import and publish the three sub-workflows and three jobs.
3. Set the new Error Alert as the error workflow on every production workflow.
4. Import the rebranded automations, run each once on a test input, then archive the old ones.
5. Archive the old Error Alert, Digest and Cleanup only after one clean day of the new ones.
