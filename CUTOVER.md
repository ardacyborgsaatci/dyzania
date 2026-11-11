# Cutover and retirement

Nothing here has been done. Every item needs the owner's OK when it happens. Old workflows stay live until the new ones pass.

## Why one cutover

The old Gmail triage workflow polls the `+support` alias and the old Demo API owns its webhook paths, so a published Wrenbook copy running beside them would double every draft and clash on paths. So the new copies go in together, then the old ones go.

## Before the cutover (owner)

- Add a Google Calendar credential in n8n and decide the business timezone (booking needs both).
- Decide the booking buffer: 15 minutes as documented, or the 30 minutes the live workflows enforce.
- Rotate the keys that were pasted in chat (Groq, Fish Audio, OpenRouter).
- Decide whether the voice page stays behind Vercel Authentication.
- Trademark and domain check for the name.

## The cutover, in order

1. Create the `ops_config` and `ops_events` data tables.
2. Import the three ops workflows (error alert, daily digest, cleanup) into a "Wrenbook Ops" folder and switch on the three jobs.
3. Import the rebranded lead, support and booking workflows as new copies, unpublished.
4. Test each new copy with seed input. Publish one at a time, then archive its old twin.
5. Vercel: point one project at root `web/site` and set `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `N8N_TRIAGE_URL`, `N8N_FEED_URL`, `N8N_TRIAGE_SECRET`, `IP_HASH_SALT`. Deploy the voice app as its own project.
6. Re-run the triage evaluation on the new copy; run the booking evaluation once the Gmail path exists.

## What can be retired afterwards (each with the owner's OK)

**n8n workflows (old builds)**

| Workflow | Id | Replaced by |
|---|---|---|
| Lead Intake & Scoring | f2E0hVjfKYl4yXiw | Wrenbook lead intake |
| Support Triage: Gmail, Core, Demo API, Daily Digest, Cleanup, Error Alert | 4W2dNUotp2nDOUmc, qumfu47ryclMxZut, v0mctb6yyey9qzBP, gkikxWy789RARpCB, GFlXK7mohl14pCVZ, KmU1Jt8JRT664SYv | Wrenbook triage and the shared ops jobs |
| Booking Core, three Booking Tools | IaRLrh8sBQ6w8h06, 26hnjgZFXuwIUKEC, uioKI8gG8b00uNUg, AZ1reSrylFEHbsbO | Wrenbook booking copies |
| Two Booking Core test harnesses (already inactive) | PIVfNP7jofIVOXRk, EYNtFmhO3LS0iG9M | Kept for tests, or archive |

The invoice workflow (`r2vlhLodTOdOjXfJ`) is not retired. It is the finance automation; switch it off between uses, since its upload form is public while it is active.

**Vercel projects (old sites)**: `support-inbox-triage-website`, `lead-intake-automation-website`, `voice-agent`.

**Old project folders** next to this repo: `booking-agent`, `lead-intake-automation`, `support-inbox-triage`, `voice-agent`. Their code now lives here; keep them until the cutover has run.

Archive, never hard-delete: archived workflows and paused projects can be restored.
