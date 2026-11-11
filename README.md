# Wrenbook

Fictional invoicing and bills app for small businesses. Its team runs on five automations built with n8n, Groq models and Vercel. See [PLAN.md](PLAN.md) for the merge plan and [brand/BRAND.md](brand/BRAND.md) for the brand.

Status: step 3 of 8 (repo-level rebrand done; n8n copies wait for the cutover). Knowledge copies are generated: run `node scripts/sync-knowledge.mjs` after editing `knowledge/`.

```
brand/                 palette, tokens, logo
knowledge/             shared knowledge base (voice + support drafts)
automations/
  sales-leads/         lead intake & scoring (was Brightline)
  sales-booking/       demo booking agent, design only (was Larkwell Studio)
  support/             inbox triage (was Fernbill)
  finance-invoices/    invoice extraction (exported workflow)
web/
  lead-intake/         interim site, Vercel root dir (merged into one site in step 6)
  support-triage/      interim site, Vercel root dir
voice/                 FastAPI voice agent (was Marlow & Pine)
```
