# Wrenbook: combine the five automations

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
