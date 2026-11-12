# Dyzania LLP site

One static site plus four Vercel functions. No build step. The firm is fictional; use invented details everywhere.

| Page | Purpose |
|---|---|
| `/` | Home: what the firm handles, how a first consultation works, who you would meet, the office |
| `/practice-areas` | The four areas with consultation length, fee, attorneys and what to bring; matters the firm does not handle |
| `/contact` | The intake form (`POST /api/intake`) |
| `/book` | Booking in three steps: area, time (`POST /api/slots`), details (`POST /api/book`) |
| `/call` | The voice line, explained; shows the player only when the voice server answers (`data/site.json`, `voiceUrl`) |
| `/ops` | The five automations: what each does, how it was checked, what that does not prove, what is left (`data/status.json`) |
| `/privacy`, `404` | Disclaimers and what the forms collect, error page |

The pages are plain HTML with the same header and footer (a test checks that). Facts such as the phone number, address, hours, fees and attorneys come from `firm/*.json`; a test compares the pages with those files. Change the facts there, then edit the pages.

## What the endpoints do

`/api/intake`, `/api/slots` and `/api/book` do not decide anything. They check the request and pass it to n8n, where the same tested rules as `automations/intake` and `automations/booking` run. They never show an n8n message to a visitor.

Checks on every request (`lib/guard.js`):

- the request must come from this site (Origin, Referer or Sec-Fetch-Site);
- a signed form token, issued by `GET /api/token` when a page loads, must be 3 seconds to 2 hours old (the times list accepts a fresh token);
- a hidden `website` field must be empty (the intake form answers as if it worked; booking says "unavailable");
- a per-IP rate limit held in memory (intake 5 an hour, book 6 an hour, times 40 per 10 minutes), and a body of at most 8 KB.

Privacy rules kept here: the intake next step is reduced to book, follow up, urgent, refer or review; a conflict hold is never shown (a repeat booking and a conflict hold both say "contact the office", with the same status); the channel is always `form`; only whitelisted fields are forwarded.

**Honest limits.** The rate limit is per server instance, so a determined visitor gets more than the number above; the real limit is a Vercel Firewall rule, added at the cutover. A script can still fetch a token and post, so this stops casual bots and double clicks, not a targeted attack (Cloudflare Turnstile would be the next step and needs an owner account). Nothing here has run against a live n8n yet.

## Vercel

Root directory `web/site`. Environment variables:

| Name | Used by |
|---|---|
| `FORM_TOKEN_SECRET` | All form endpoints (any long random string) |
| `N8N_INTAKE_URL`, `N8N_INTAKE_SECRET`, `N8N_INTAKE_HEADER` (default `X-Intake-Secret`) | `/api/intake` |
| `N8N_BOOKING_BASE` (ends with `/webhook/`), `N8N_BOOKING_SECRET`, `N8N_BOOKING_HEADER` (default `X-Booking-Secret`) | `/api/slots`, `/api/book` |

Without these the endpoints answer that the service is not available, and the pages say so plainly. Do not deploy before the cutover: the workflows are not live yet.

## Run it locally

Static pages only: serve this folder with any static server and clean URLs. The forms need the endpoints, so use `vercel dev` with the variables above, or run the endpoints against the test stand-in (it runs the real rules in memory and stores nothing): see `test/helpers.js` (`fakeN8n`).

## Design

Design system v5 (cream, ink, burnt orange; flat), from `brand/tokens.css` and `brand/BRAND.md`: an editorial hero with a black-and-white office drawing on an orange block, Inter Tight headlines with Instrument Serif accent words, ink for every action. The header menu and the practice-areas side index are in `nav.js`. One primary action per screen, visible labels, each error shown beside its field and in a focusable summary that links to the field, 44 px targets, subtle motion that stops under `prefers-reduced-motion`, no gradients. Icons are inline SVG.

## Tests

`npm test` (93 tests):

- `site.test.js`: page structure, links and anchors, one header and footer, firm facts and fees against `firm/*.json`, form options against the intake rules, ids the scripts look up, text-only rendering in scripts, the status list and the numbers it quotes, no leftover Wrenbook text or outcome claims, brand tokens, no gradients and WCAG contrast of every text pair.
- `guard.test.js`, `forms-api.test.js`: the endpoints, run against the real intake and booking rules behind a stand-in n8n (privacy mapping, races, repeat booking, token age, rate limits, upstream failures).
