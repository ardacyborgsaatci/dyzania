# Wrenbook

Fictional invoicing and bills app for small businesses. Its team runs on five automations built with n8n, Groq models and Vercel. See [PLAN.md](PLAN.md) for the merge plan and [brand/BRAND.md](brand/BRAND.md) for the brand.

Status: step 6 of 8 (combined site built; not deployed). Knowledge copies are generated: run `node scripts/sync-knowledge.mjs` after editing `knowledge/`.

```
brand/                 palette, tokens, logo
knowledge/             shared knowledge base (voice + support drafts)
automations/
  sales-leads/         lead intake & scoring (was Brightline)
  sales-booking/       demo booking agent, design only (was Larkwell Studio)
  support/             inbox triage (was Fernbill)
  finance-invoices/    invoice extraction (exported workflow)
  ops/                 shared ops layer spec, event helper and tests
  handoffs/            the four links between automations, helpers and tests
web/
  site/                one Vercel site: home + sales form, /ops, support demo and dashboard, voice page
voice/                 FastAPI voice agent (was Marlow & Pine)
```
