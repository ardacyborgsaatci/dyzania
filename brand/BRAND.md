# Wrenbook brand

Wrenbook is a fictional invoicing and bills app for small businesses (12 people, founded 2019). Everything is invented for a portfolio. Pages stay `noindex`. Trademark and domain check is an owner task; the placeholder domain is `wrenbook.example`.

Voice: plain, calm, a little dry. Short sentences. Sentence-case headings. No exclamation marks, no "revolutionary".

## Visual system

Applied from `wrenbookDESIGN.md.md` (a dark, compact, pill-shaped system) on 2026-11-11. Its brand-specific parts were swapped for Wrenbook's own: the proprietary typeface became Inter, and the single accent became wren orange instead of the green the source uses. Tokens: `brand/tokens.css`; the site's stylesheet is `web/site/styles.css`.

| Role | Hex | Use |
|---|---|---|
| Background | `#121212` | Page |
| Surface | `#181818` | Cards |
| Surface 2 | `#1F1F1F` | Inputs, chips, the one band per page, hover |
| Card | `#252525` | Badges, bar tracks, matrix highlights |
| Text | `#FFFFFF` | Primary text |
| Muted | `#B3B3B3` | Secondary text, inactive nav |
| Edge | `#7C7C7C` | Input and outline-button border, drawn as an inset shadow, not a border |
| Wren | `#E08A2B` | The only accent: primary buttons, active states, key numbers, the logo dot. Never a large background. |
| Error | `#F3727F` | Errors and urgent |
| Warning | `#FFA42B` | Warnings and drafts |
| Info | `#539DF5` | Info and success |

Dark only. The site tests compute WCAG ratios for the main text pairs (all at least 4.5:1).

## Type

- One family: Inter (fallbacks Helvetica Neue, Arial). Mostly 700 and 400, 600 sparingly.
- Compact: body 16px, small text 12 to 14px, section titles 24px, page titles up to about 40px.
- Buttons: 14px, 700, uppercase, 1.4px letter-spacing.
- Small labels (eyebrows, team tags, table heads): 12px, 700, uppercase, wide tracking.

## Shape and depth

- Buttons, chips, badges and nav links are pills (9999px). Cards 8px, inputs 4px.
- Cards have no borders. Inputs and outline buttons use an inset 1px `#7C7C7C` shadow.
- Shadows are heavy: `rgba(0,0,0,.3) 0 8px 8px` for cards, `rgba(0,0,0,.5) 0 8px 24px` for dialogs.
- No gradients.

## Automation teams (labels used in the UI and ops dashboard)

| Team | Automation |
|---|---|
| Sales | Lead intake & scoring |
| Sales | Demo booking |
| Support | Inbox triage |
| Front desk | Voice line |
| Finance | Invoice extraction |

## Naming for the rebuild

- n8n folder: `Wrenbook Ops`; workflow names `Wrenbook <Team> - <Thing>`.
- Gmail aliases: `+support`, `+book`, `+invoices`; labels `Triage/*`, `Booking/*`, `Finance/*`.
- Email domain in all demo content: `@wrenbook.example`.
