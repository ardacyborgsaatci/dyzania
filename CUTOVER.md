# Cutover and go-live runbook: Dyzania LLP

**Status (2026-11-11): only the website is deployed (step 7, partly).** No firm workflow is imported or published in n8n, nothing is archived, and no live model has been run. Every step needs the owner's OK when it happens. The old Wrenbook workflows stay live until the firm's copies pass.

The firm is fictional. "Live" means running on the real services (n8n, Gmail, Groq, OpenRouter, Vercel) with **invented data only**. Never put a real client's details through any of it.

## What was checked in n8n (read-only, 2026-11-11)

| Table | Id | Verdict |
|---|---|---|
| `intake_leads` | OBru6aKjhDkKS9dq | 27 columns, names and types match `automations/intake/columns.json`. Empty. Use as is. |
| `court_notices` | iRFVRqbQHX2niq9v | 28 columns, match `automations/notices/columns.json`. Empty. Use as is. |
| `ops_events` | JN6zuKod5UpooQUV | 10 columns, match `automations/ops/ops_events.schema.json`. Empty. Use as is. |
| `triage_log` (old) | dMPf0tMgzkWZtiyX | **Wrong table for the firm.** It has the Wrenbook columns (subject, snippet, summary) and the live old triage workflow writes to it. Leave it alone. |
| `bookings` | | **Does not exist.** Create it from `automations/booking/columns.json` (18 columns). |
| firm triage log | | **Does not exist.** Create it from `automations/triage/columns.json` (21 columns, no subject, snippet or summary). Name it `dy_triage_log`, because the old table holds the name `triage_log`. Only its id matters to the workflows. |
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
| GitHub repo | To be renamed `dyzania` by the owner in GitHub Settings. Not done as of the last check: `wrenbook` still answered with no redirect and `dyzania` was not found. After it is done, run `git remote set-url origin https://github.com/ardacyborgsaatci/dyzania.git`. The Vercel project follows a rename by repo id. |
| Exposed keys (Groq, Fish Audio, OpenRouter, pasted in chat earlier) | The owner decided not to rotate them. The risk stays: anyone who saw that chat can use them until they are rotated. |
| Git identity | Set for this repo only: the name `Arda Saatci` and the GitHub no-reply address, so no personal inbox appears in the history. The first commits keep their placeholder author. |

## The cutover, in order

Do these in order. After each step the check says how to know it worked. Steps marked **(OK)** change something outside this folder and need your yes first.

### 1. Create the two missing tables **(OK)**

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

Then open each of the other seven workflows, Settings, Error workflow, and choose **Dyzania Ops - Error alert** (`ops-error-alert.json`). Run triage's "Create triage labels (run once)" button once.
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
- 2026-11-11: Phase 7 code done: ops events wired into the four workflows, digest, error alert and cleanup generated, `prepare-import`, `live-check`, handoff checks. **Nothing imported or run in n8n.** Table check above done read-only.
