# Wrenbook site

One static site plus three Vercel functions. No build step.

| Page | Purpose |
|---|---|
| `/` | Product page and the real sales form (posts to `/api/lead`) |
| `/ops` | The five automations, what is running and what is not (`data/status.json`), handoffs and rules |
| `/playground`, `/dashboard` | Support triage demo and live/eval dashboard |
| `/call` | The voice line, explained (the voice agent is its own Vercel project) |
| `/privacy`, `404` | Privacy note, error page |

`data/status.json` is edited by hand. Keep it honest: a card says "In progress" until it has a working evaluation. The one live number is the support triage total from `/api/feed`.

## Vercel

Root directory `web/site`. Environment variables:

| Name | Used by |
|---|---|
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | `/api/lead` |
| `N8N_TRIAGE_URL`, `N8N_FEED_URL`, `N8N_TRIAGE_SECRET`, `IP_HASH_SALT` | `/api/triage`, `/api/feed` |

Do not deploy before the cutover: these point at n8n webhooks that currently belong to the old projects.

## Tests

`npm test` (65 tests): page structure and links, form fields against the API, brand tokens, no gradients, WCAG contrast, status list, API handlers, validation.
