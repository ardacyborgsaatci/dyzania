# Wrenbook

Fictional invoicing and bills app for small businesses. Its team runs on five automations built with n8n, Groq models and Vercel. See [PLAN.md](PLAN.md) for the merge plan and [brand/BRAND.md](brand/BRAND.md) for the brand.

Status: step 2 of 8. Code has been moved in unchanged from the five original projects; rebranding and handoffs come next.

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
