# Wrenbook

Wrenbook is a **fictional** invoicing and bills app for small businesses (12 people, founded 2019). It is the made-up company behind five automations I built, merged here into one team and one site. Nothing on it is a real product, and every customer, bill and email in the demos is invented.

The automations run on n8n, open models on Groq and OpenRouter, and Vercel. Every reply to a customer is a draft that a person sends.

## The five automations

| Team | Automation | State | Evidence |
|---|---|---|---|
| Sales | Lead intake and scoring | Running (old build) | Scoring rules tested, including a check that the helper matches the n8n node on 180 inputs |
| Sales | Demo booking agent | In progress | Core and tools work on a fixture calendar. No Gmail trigger, no real calendar, 40-email set written but not run |
| Support | Inbox triage | Running (old build) | 54 invented emails (a development set): 98.1% category accuracy, 100% needs-human recall, 5 of 5 injections flagged, 0 unsafe drafts. A clean re-run is owed |
| Front desk | Voice line | Text path tested | 15 of 15 right on a text run, after two prompt changes made on the same questions. Speech and voice not tested, 3 answers too long |
| Finance | Invoice extraction | Tested once, small | 12 invented bills: 4 of 4 flawed bills sent to review, 7 of 8 readable bills approved with every field right, **1 blurred bill approved with wrong values** |

Honest summary: two of the five run today (as their original, pre-Wrenbook builds), two are tested but small, and booking is not finished. Details and caveats are in each folder and on the site's `/ops` page.

## How they fit together

Four handoffs link the automations. All of them make drafts or events, never customer mail.

1. Support to Sales: an email that is really a sales inquiry becomes a lead.
2. Sales to Booking: a hot lead gets a draft inviting them to book.
3. Voice to Sales: a caller who wants a demo is pointed to the sales form, pre-filled.
4. Finance to Ops: a bill that needs review goes to the shared alert and digest.

A shared ops layer (one event log, one error alert, one daily digest, one demo budget) is specified in [automations/ops/SPEC.md](automations/ops/SPEC.md). The handoffs and the ops helper are written and tested in the repo. **They are not yet imported into n8n or deployed**: that happens at one planned cutover, because the old workflows are still live and a second copy would double every draft. See [CUTOVER.md](CUTOVER.md).

## Layout

```
brand/                 palette, tokens, logo, design rules (dark system, wren orange accent)
knowledge/             shared knowledge base (voice and support drafts)
automations/
  sales-leads/         lead intake and scoring
  sales-booking/       booking agent design, 40-email eval set and scorer
  support/             inbox triage workflows, prompts, 54-email eval
  finance-invoices/    invoice workflow export, 12 sample bills, scorer and results
  ops/                 shared ops layer spec, event helper, tests
  handoffs/            the four links, helpers and tests
web/site/              one Vercel site: home and sales form, /ops, support demo and dashboard, voice page
voice/                 FastAPI voice agent
scripts/               sync-knowledge.mjs
PLAN.md                the merge plan and progress log
CUTOVER.md             what is left to switch over, and what to retire
LOOM-SCRIPT.md         script for the one walkthrough video
```

## Run the checks

```bash
node --test web/site/test/
node --test automations/ops/test/ automations/handoffs/test/
node --test automations/sales-booking/eval/test/ automations/finance-invoices/eval/test/
python -m unittest discover -s voice/tests
node scripts/sync-knowledge.mjs --check
```

After editing anything in `knowledge/`, run `node scripts/sync-knowledge.mjs` to refresh the copies in `voice/` and the support draft prompt.

## Known gaps

- Booking has no Gmail trigger and no real calendar (needs a Google Calendar credential in n8n). The effective buffer is 30 minutes, not the documented 15; the live workflows were left as they are until you decide.
- The invoice check can approve a badly blurred bill that is read wrongly but adds up. A date-plausibility rule is proposed, not built. There is no Needs-review alert yet.
- Triage needs a clean re-run of its evaluation. The voice line needs a real-microphone test and shorter answers.
- Trademark and domain check for the name `Wrenbook` (placeholder domain `wrenbook.example`) is not done.
