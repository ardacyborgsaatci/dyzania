# Cutover and go-live runbook: Dyzania LLP

**Status (2026-11-11): the website is deployed (step 7, partly) and the two missing tables exist (step 1).** No firm workflow is imported or published in n8n, nothing is archived, and no live model has been run. Every step needs the owner's OK when it happens. The old Wrenbook workflows stay live until the firm's copies pass.

The firm is fictional. "Live" means running on the real services (n8n, Gmail, Groq, OpenRouter, Vercel) with **invented data only**. Never put a real client's details through any of it.

## What was checked in n8n (read-only, 2026-11-11)

| Table | Id | Verdict |
|---|---|---|
| `intake_leads` | OBru6aKjhDkKS9dq | 27 columns, names and types match `automations/intake/columns.json`. Empty. Use as is. |
| `court_notices` | iRFVRqbQHX2niq9v | 28 columns, match `automations/notices/columns.json`. Empty. Use as is. |
| `ops_events` | JN6zuKod5UpooQUV | 10 columns, match `automations/ops/ops_events.schema.json`. Empty. Use as is. |
| `triage_log` (old) | dMPf0tMgzkWZtiyX | **Wrong table for the firm.** It has the Wrenbook columns (subject, snippet, summary) and the live old triage workflow writes to it. Leave it alone. |
| `bookings` | LsVRNCJkU8MthUkh | **Created 2026-11-11**, 18 columns from `automations/booking/columns.json`, empty. The date column is `bookedAt`, not `createdAt`: n8n reserves `createdAt` for its own timestamp and refuses a column with that name, so the booking code was changed to match. |
| `dy_triage_log` (the firm's triage log) | zabUAA6tyQn7GRNL | **Created 2026-11-11**, 21 columns from `automations/triage/columns.json` (no subject, snippet or summary), empty. Named `dy_triage_log` because the old table holds the name `triage_log`. Only its id matters to the workflows. |
| `ops_config`, `demo_rate_limit`, `booking_thread_state`, `booking_fixture_calendar` | gMKsbxMcmyJtTkfr, JU0HrZecjMDawJpM, IunKujLEao0LJryK, 3dAc3XrQV1YJg4qP | Old Wrenbook tables. Nothing in the firm's workflows reads them. Retire at the end. |

Workflows in n8n today: 20. Twelve old Wrenbook workflows are **active** (lead intake, six support triage workflows, booking core and its three tools, invoice extraction). Eight are inactive: two booking test harnesses and the six unpublished "Wrenbook Ops" workflows. No Dyzania workflow exists in n8n yet.

Credentials that exist: Gmail `ADrOxnpC5M3hAS7a`, Groq `WIERJG1YhXtS5yas`, OpenRouter of type custom auth (the type the notices vision call uses) `lqwxdUxCERVyNQwy`, OpenRouter (API type) `kl9PRkCDRutRxIvI`, Google Calendar `zm0aokBQMyTEcVbe` (not used by any firm workflow), Header Auth `I4dGIOqOKuNJNeGp` and `ascChV8Y0jnM8xqB` (old). **To create:** one header-auth credential for the intake webhook, one for the two booking webhooks, one basic-auth credential for the notices upload form.

## Why one cutover

- The old Gmail triage and the firm's both use the one Gmail account and the same `Triage/...` label names, and the old and new digests and cleanups would both run at the same hour. The firm's Gmail triage polls the `+triage` alias, not the old `+support` alias, so it does not double the old drafts. It still should not run beside the old one for long: archive the old twin once the new one passes.
- The old Demo API owns the `triage-demo` and `triage-feed` paths. The firm's webhooks are `intake`, `booking/slots` and `booking/book`, which do not clash.
- The site has no test mode: until the intake and booking webhooks exist, its forms answer "unavailable" (by design).

## Owner decisions (made 2026-11-11)

| Item | Decision |
|---|---|
| Business time zone | `America/Chicago`, confirmed. |
| Owner address and attorney-on-duty address | The owner's own Gmail inbox for both, held only in the git-ignored `cutover.local.json`. `prepare-import` already accepts that file: 5 of 8 workflows are ready to write, 3 wait for the two missing tables and the triage core's workflow id. |
| Gmail account n8n uses | The same account. The **old** triage polls the `+support` alias; the firm's polls `+triage` (Gmail delivers any `+word` to the same inbox, so no setup). Keep them different until the old one is archived. |
| Voice page access | Keep it behind Vercel Authentication (the default). A public voice page spends Fish and Groq quota; show it in the Loom instead. Revisit with a rate limit if it is ever opened. |
| Name | **Dyzania LLP**, chosen by the owner. No trademark or domain search has been done; `dyzania.example` is a placeholder that cannot receive mail. |
| GitHub repo | **Renamed to `dyzania` by the owner (checked 2026-11-11):** `github.com/ardacyborgsaatci/dyzania` answers, the old `wrenbook` address redirects to it, and local `origin` now points at the new address. The Vercel project is linked by repo id, so it follows the rename; its last deployment before the rename still shows the old repo name in its metadata. Do not create a new repo called `wrenbook`, which would break the redirect. |
| Exposed keys (Groq, Fish Audio, OpenRouter, pasted in chat earlier) | The owner decided not to rotate them. The risk stays: anyone who saw that chat can use them until they are rotated. |
| Git identity | Set for this repo only: the name `Arda Saatci` and the GitHub no-reply address, so no personal inbox appears in the history. The first commits keep their placeholder author. |

## The cutover, in order

Do these in order. After each step the check says how to know it worked. Steps marked **(OK)** change something outside this folder and need your yes first.

### 1. Create the two missing tables **(OK)** (done 2026-11-11)

Create `bookings` from `automations/booking/columns.json` and `dy_triage_log` from `automations/triage/columns.json` in the n8n personal project (n8n UI, or ask Claude to create them with the n8n tools). Note the two ids.
Check: each table shows its columns and no rows.

### 2. Write the local config, then prepare the files

```bash
cp cutover.example.json cutover.local.json     # fill it in; git ignores it
node scripts/prepare-import.mjs --list         # the eight workflows, in import order
node scripts/prepare-import.mjs --config cutover.local.json --out cutover-out
```

The script fills the placeholders in copies of the eight workflow files and writes them to `cutover-out/` (also git-ignored). It prints no address. It writes nothing for a workflow whose values are missing and says what each one is waiting for. It never imports or publishes anything.
Check: no "waiting" lines, no problems. Run it twice: once with the table ids you have (without `triageCoreWorkflowId`), once after step 3 adds the triage core's id.

### 3. Import in this order **(OK)**

Import into an n8n folder named "Dyzania", all **unpublished**:

1. `triage-core.json`. Copy its workflow id into `triageCoreWorkflowId`, run `prepare-import` again.
2. `triage-gmail.json`
3. `intake.json`
4. `booking.json`
5. `notices.json`
6. `ops-error-alert.json`
7. `ops-daily-digest.json`
8. `ops-cleanup.json`

Check: eight workflows in the folder, all inactive.

### 4. Attach credentials and the error workflow **(OK)**

| Workflow | Credential to attach |
|---|---|
| triage-core | Groq `WIERJG1YhXtS5yas` on the Classifier model and the Drafting model |
| triage-gmail, intake, booking, notices, digest, error alert | Gmail `ADrOxnpC5M3hAS7a` on every Gmail node (the trigger, drafts, labels and the alert or confirmation node) |
| intake | New header-auth credential, header `X-Intake-Secret`, a long random value (keep the value for Vercel) |
| booking | New header-auth credential, header `X-Booking-Secret`, a long random value, on both webhooks (keep the value for Vercel and the voice server) |
| notices | New basic-auth credential on the upload form; OpenRouter (custom auth) `lqwxdUxCERVyNQwy` on the vision call |

Then open each of the other seven workflows, Settings, Error workflow, and choose **Dyzania Ops - Error alert** (`ops-error-alert.json`). n8n refuses this until the error alert itself is **published**, so publish it first (it only runs when another workflow fails). The import also drops the three "do not save execution data" settings from each file; put them back (Settings: save successful and failed executions "Do not save", progress off), because without them n8n keeps email text in its run history. Run triage's "Create triage labels (run once)" button once.
Check: no node shows a missing-credential warning; every workflow names the error workflow.

### 5. Test each workflow with pinned data before publishing **(OK)**

Use n8n's Test workflow with pinned input. The data tables are real, so a test writes a real (invented) row: delete those rows afterwards. Do not test the cleanup on a table you care about: it deletes rows older than 90 days.
Check: intake saves one lead and one `ops_events` row; booking offers slots and books one; notices only runs from its form (step 9); digest reads `ops_events` and emails only the owner address.

### 6. Archive the old twins, then publish the firm's **(OK, one at a time)**

For each pair: archive the old workflow, publish the firm's, run it once, look at the result. The list of what each firm workflow replaces is in "What can be retired" below. Publish the error workflow first, then triage core, triage Gmail, intake, booking, notices, digest, cleanup.
Check: each published workflow shows an execution that finished.

### 7. Vercel **(OK)**

Create a project from the GitHub repo with root directory `web/site`. Set these environment variables (Production):

| Variable | Value |
|---|---|
| `FORM_TOKEN_SECRET` | a long random string you generate |
| `N8N_INTAKE_URL` | the full production URL of the intake webhook |
| `N8N_INTAKE_SECRET` | the intake header-auth value (header name defaults to `X-Intake-Secret`) |
| `N8N_BOOKING_BASE` | the n8n webhook base, for example `https://YOUR-INSTANCE/webhook` (the site adds `booking/slots` and `booking/book`) |
| `N8N_BOOKING_SECRET` | the booking header-auth value (header defaults to `X-Booking-Secret`) |

Add a Vercel Firewall rate-limit rule on the `/api/` paths (the site's own limit lives in one instance's memory and is only a backup). Deploy `voice/` as its own project with `FISH_API_KEY`, `FISH_VOICE_ID`, `GROQ_API_KEY`, `VOICE_STATE_SECRET`, `N8N_BOOKING_BASE`, `N8N_BOOKING_SECRET`.
Check: the site's contact and book pages work, and `/ops` loads.

### 8. The live check of the chain

```bash
node scripts/live-check.mjs journey --base https://YOUR-SITE --email YOUR-OWN-INBOX
```

This acts as one invented visitor against the deployed site: it loads a token, sends the intake form, asks for times and books one using the lead reference the intake returned. **It books one real consultation slot for an invented person**: cancel it in the `bookings` table afterwards. Then export the `ops_events` rows to a JSON file (Claude can read them with the n8n tools and save them) and run:

```bash
node scripts/live-check.mjs verify --rows cutover-out/rows.json --report cutover-out/live-report.json
```

It passes only if the intake event and the booked event both exist, chain by the lead reference, hold no name, address or phone number, and the digest counts them.

### 9. Live model runs (each needs the owner's OK: they spend Groq and OpenRouter quota)

| Run | How | Scored with | What it settles |
|---|---|---|---|
| Court notices | Upload the 12 PNGs in `automations/notices/eval/samples/` through the live form, export the 12 rows | `node automations/notices/eval/score.js rows.json` | Wrong statuses (must be 0), urgent notices missed (target 0), field accuracy |
| Triage | Run the 54 emails in `automations/triage/eval/emails.json` through the triage core with n8n's execute tool, save each result under its `sampleId` | `node automations/triage/eval/score-live.js results.json` | Category and priority accuracy, needs-human recall, injections contained, unsafe drafts |
| Voice | `cd voice && python run_questions.py` (and `--set holdout`) with a Groq key | the script's own report | How the chat model answers the 54 invented questions |
| Voice call | One real call in a browser, steps in `voice/MANUAL-CALL.md` | by ear | Speech recognition and the voice, never tested |

Write the numbers into each automation's README and `web/site/data/status.json`, with the same-author caveat. Until a run is done its number is "not measured".

### 10. Watch the daily jobs

After a day of normal use, check the digest email (owner only) and the cleanup's first night: it should delete nothing, since no row is 90 days old yet.

## If something goes wrong

- **A firm workflow misbehaves:** unpublish it; the site then answers "unavailable". Nothing is lost, rows stay in the tables.
- **A step 6 swap goes wrong:** the old workflow is archived, not deleted. Restore it in n8n and unpublish the firm's.
- **A wrong Vercel value:** edit the variable and redeploy; the site never shows an upstream message.
- **Data from a test:** delete the invented rows from `intake_leads`, `bookings`, `court_notices` and `ops_events` by hand. Only the activity log and the inbox log delete themselves (90 days); leads, bookings and notices never delete automatically.

## What can be retired afterwards (each with the owner's OK)

**n8n workflows (old builds)**

| Workflow | Id | Replaced by |
|---|---|---|
| Lead Intake & Scoring | f2E0hVjfKYl4yXiw | Dyzania intake |
| Support Triage: Gmail, Core, Demo API, Daily Digest, Cleanup, Error Alert | 4W2dNUotp2nDOUmc, qumfu47ryclMxZut, v0mctb6yyey9qzBP, gkikxWy789RARpCB, GFlXK7mohl14pCVZ, KmU1Jt8JRT664SYv | Dyzania triage and the ops jobs. The Demo API has no replacement: the site has no public playground any more |
| Booking Core, three Booking Tools | IaRLrh8sBQ6w8h06, 26hnjgZFXuwIUKEC, uioKI8gG8b00uNUg, AZ1reSrylFEHbsbO | Dyzania booking |
| Two Booking Core test harnesses (already inactive) | PIVfNP7jofIVOXRk, EYNtFmhO3LS0iG9M | Archive |
| Six unpublished "Wrenbook Ops" workflows (Log Event, Get Config, Check Budget, Error Alert, Daily Digest, Cleanup) | j0jzROX4PPhrB47i, Nk2ERzQVizJhER5g, J2pLLUdAFRSaC0Sw, 7TLG4ZzUAxgc0IYZ, mAZ91VQuhBpao7zN, 6YkApfQkQEW0ckXn | The firm's three ops workflows |

The invoice workflow (`r2vlhLodTOdOjXfJ`) is not retired by this cutover. It belongs to the old finance automation, which the firm does not use; switch it off between uses, since its upload form is public while it is active, and decide separately whether to keep it.

**Data tables (old):** `triage_log`, `demo_rate_limit`, `booking_thread_state`, `booking_fixture_calendar`, `ops_config`. Deleting a table is permanent: export first, then ask.

**Vercel projects (old sites):** `support-inbox-triage-website`, `lead-intake-automation-website`, `voice-agent` (if the firm's voice project replaces it).

**Old project folders** next to this repo: `booking-agent`, `lead-intake-automation`, `support-inbox-triage`, `voice-agent`. Their code lives here; keep them until the cutover has run.

**In this repo (a separate cleanup commit, with the owner's OK):** `automations/sales-leads`, `automations/sales-booking`, `automations/support`, `automations/finance-invoices`. They are the Wrenbook-era sources, kept so far for history and the invoice workflow.

Archive, never hard-delete, where n8n and Vercel allow it: archived workflows and paused projects can be restored.

## Owner-only items that no code can do

A name and trademark search for "Dyzania", the real-microphone call, recording the Loom, creating the three n8n credentials, and deleting the 12 test rows in the old "Extraction" sheet tab. A CAPTCHA (Cloudflare Turnstile) is an optional extra for the forms.

## Not covered by this cutover

No real client data, ever. No calendar mirror, cancel endpoint, holiday calendar or email verification for bookings. A new-matter email does not become a lead by itself (the triage inbox only labels it for the intake coordinator). The activity log can hold a few characters of failing data inside an n8n error message; the alert goes to the owner address only. See each automation's README for its own limits.

## Progress

- 2026-11-11: old Wrenbook ops layer built earlier (tables, six workflows, unpublished); superseded by the firm's three generated ops workflows and the import script described above.
- 2026-11-11: **Website deployed on Vercel.** Project `dyzania` (prj_17cmjNH9V6qT7N8qVGhF4A7zGrqk, team `arda`), linked to the GitHub repo, root directory `web/site`, production branch `main`, so every push to `main` deploys on its own. First production deployment dpl_G6EDWs9SxbhAfNJWXLG8zEQfg2UQ from commit `11226f1`, state READY, at `dyzania.vercel.app`. `FORM_TOKEN_SECRET` is set (sensitive, random, production and preview). The `N8N_INTAKE_*` and `N8N_BOOKING_*` variables are **not** set, so the forms answer "unavailable" by design. Pages `/` and `/ops` load; `/api/token` answers 403 to a request with no matching origin, as designed. Vercel Authentication was on by default; the owner approved turning it off, so **the site is public** (checked: `/`, `/contact` and `/ops` answer 200 with no login). The voice page's own project stays protected, as decided. No Firewall rate-limit rule yet: add one before the n8n variables are set, since that is when the forms start to accept real submissions.
- 2026-11-11: n8n credentials created by the owner: `Intake Webhook` (vKDKdYah8iR6CRk7, header auth), `Booking Webhook` (KAfpJTd1RoHKgAod, header auth), `Notice Upload` (VmcpB7y3wtb5BZjz, basic auth). `cutover.local.json` written (git-ignored); `prepare-import` reports 5 of 8 workflows ready, 3 waiting for the `bookings` table, the firm's triage log table and the triage core's workflow id.
- 2026-11-11: **Step 1 done: the two tables exist.** `bookings` (LsVRNCJkU8MthUkh) and `dy_triage_log` (zabUAA6tyQn7GRNL), both empty. n8n refused the booking schema's `createdAt` column (reserved system name), so the booking column is now `bookedAt` in `columns.json`, `lib/booking.js`, the eval fixture, the README and the regenerated `workflow.json`; all 357 Node tests and the five generator checks still pass. Both ids are in `cutover.local.json`; `prepare-import` now writes 7 of 8 workflows, and only `triage-gmail.json` waits for the triage core's workflow id (known after step 3, import 1).
- 2026-11-11: **Step 3 done: all eight workflows imported by the owner, unpublished, in the `Dyzania` folder** (core `IUF8Qx1w9ipITI7Q`, Gmail `fxBLONZtkgMR9yL2`, error alert `TISzR1bG0KiR9pDX`, intake `ps5uC4ph437kf1Vy`, booking `UJqGbsvvIWFHmAEx`, notices `6sNm9S5ia1tOx28W`, digest `yA70Gs8KSabDJgkv`, cleanup `XUnf2vYcrFDYUcnm`), with "Available in MCP" on. Read back and compared with the files: same nodes, connections and code in all eight (n8n only fills in default settings). Found and fixed through the n8n tools: the import dropped the no-execution-data settings on every workflow (restored); the intake webhook carried the Booking Webhook credential (now `Intake Webhook`); the notices vision call had no credential (OpenRouter custom auth attached) and its upload form lost the multiple-files setting and submitted text (restored, read back equal to the file). Gmail attached on every Gmail node. **Then, with the owner's OK, `Dyzania Ops - Error alert` was published (the only Dyzania workflow that is active) and set as the error workflow on the other seven; each update returned the setting.** One validator warning to watch in the first test: Gmail `Apply labels` shows `labelIds` as a string because it is an expression.
- 2026-11-11: **Intake tested in n8n (manual execution 533, one invented lead, the eval case F1).** Every node succeeded: score 76, tier Hot, next step `book`, area family, conflict clear, urgency none (the same as F1's label in the offline set); one row in `intake_leads` (ref `DY-261111-K57G`, id 1) and one metadata-only row in `ops_events` (id 1, handoff to booking with the same reference, no name, address or number); the attorney-on-duty email was sent to the owner inbox. The manual run skips the webhook's header-auth check, so that check is still untested (the live check covers it). The two test rows are still in the tables (the n8n tools can add and read rows but not delete them: delete by hand in the n8n UI after the booking test, which reuses the lead reference to test the handoff). n8n keeps the data of manual runs in its execution list whatever the save settings say, so test only with invented data.
- 2026-11-11: **Booking tested in n8n (manual executions 534 to 536, one invented person).** Slots request: four free family-law times, in the firm's time zone (CST). Booking request for the first one with the intake reference as `leadRef`: every node succeeded, the attorney was chosen by the rules (Elena Voss), one row went into `bookings` (`DY-BHGNYY`, id 1, with the renamed `bookedAt` column, so the live table and the code agree), the fixed confirmation was sent (to a `+booktest` alias of the owner inbox) and `confirmation` was set to `sent`. The ops event's run id is the lead reference and its source is `handoff`, so it chains to the intake event. A second booking by the same person was refused with the fixed "contact the office" words: no row, no email, one `needs_human` ops event. **Not tested:** the race between two simultaneous requests (needs two real calls at the same moment; the live check covers it), and the webhook header-auth check (a manual run skips it). **Test rows to delete by hand in the n8n UI:** `intake_leads` id 1; `bookings` id 1; `ops_events` ids 1, 2 and 3.
- 2026-11-11: **Triage core: first live Groq run, 10 invented emails (not an accuracy figure).** The n8n tools cannot start the core directly (its trigger is an Execute Workflow trigger), so a temporary, unpublished harness workflow `Dyzania Test - Triage harness (temporary)` (8yd5q5f5yeOvyxGE, a test webhook that passes emails to the core) was created in the Dyzania folder; **archive it when the triage test is finished.** Sent all 10 at once (executions 537/538): 4 got a model answer (N01, C01, S01, O01) and all 4 matched their labels on category, queue and draft mode, but for S01 the draft step failed (draft model unavailable), so it got the holding reply and a person flag; 6 of 10 fell back to the safe path ("the classifier gave no usable answer"). One of the failed ones sent alone (B01, execution 539) classified correctly (billing, drafted) but took 12.9 s, and the model asked for a person where the label says no. Reading: a burst of 10 requests at once exceeds Groq's per-minute limits and most calls fail; the core's safety held in every case (no draft for the court notice, the opposing lawyer or the injection attempt; every fallback asks for a person; the rules alone still got the court notice, the filing deadline, the urgent-sounding client and the injection phrase right), but the fallback over-flags (spam and an out-of-office reply included) and the model is not reliably reachable under load. This is rate limiting inferred from the one-email retry, not read from an error message (the core keeps no execution data). **Open:** pace the model calls (one at a time with a short delay) in the core, rebuild through `build-triage-workflow.mjs`, then rerun the 10 and then the 54 for the real number. Also noted: `Dyzania Triage - Core` shows as active (published) in n8n although this session did not publish it; it has no listener, so it does nothing by itself.
- 2026-11-11: **Triage core: pacing tried, results for the same 10 invented emails (not an accuracy figure).** Added in-node pacing (batch size 1, 15 s between classifier calls, 30 s between drafts) to the core through `build-triage-workflow.mjs`, with a test, and the owner approved publishing the core. **It did not work:** 10 emails in one run still finished in about 7 s with 4 model answers and 6 safe fallbacks (execution 543, same as before at 541); the reason is not known. What did work was pacing in the harness: one email per run with a 20 s Wait between them (execution 547). The 6 emails that had fallen back (S01, B01, X01, I01, U01, A01) all got a real model answer, no fallbacks; S01 alone had also been fine (execution 545). So the failures follow load, most likely rate or burst limits on the provider (inferred; no error text is kept, and the Groq docs I found disagree on the free-tier numbers, so read the real limits on the org's limits page in the Groq console). Reading of the 10 (labels not yet scored by the scorer, only eyeballed): spam, the out-of-office reply and the injection mail are now sorted instead of flagged by fallback; the injection mail still gets no draft; B01 (billing) is drafted but the model asked for a person, where the label says no. **Production consequence, open:** the Gmail trigger polls every minute with up to 10 emails and hands them to the core in one call, so a burst there can hit the same fallbacks (safe, but it over-flags). Proposed fix: loop one email at a time with a Wait in the Gmail workflow (generator, tests, live workflow), and drop or keep the core's in-node setting. The harness `8yd5q5f5yeOvyxGE` now loops with a Wait (`waitSeconds` in the test body, default 25); still to be archived at the end of the triage test. Next: the 54 through the paced harness in chunks (about 25 s per email, so about 23 minutes in all), scored with `node automations/triage/eval/score-live.js results.json`.
- 2026-11-11: Phase 7 code done: ops events wired into the four workflows, digest, error alert and cleanup generated, `prepare-import`, `live-check`, handoff checks. **Nothing imported or run in n8n.** Table check above done read-only.
