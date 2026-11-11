# Hollis & Marr LLP brand

Hollis & Marr LLP is a **fictional** small law firm in Harlow Point (11 people, founded 2014) made for a portfolio project. It practices family law, personal injury, employment law, and estate planning and probate. Everything is invented. Pages stay `noindex`. The placeholder domain is `hollismarr.example`. A name check is an owner task.

Shared facts (staff, practice areas, hours, fees, availability, urgency rules, the invented conflict list) live in `firm/`. The brand and every automation read from there.

## Voice

Plain, calm and careful. Short sentences, sentence-case headings. Never:
- give legal advice, or say whether someone has a case
- promise an outcome, a result or a response time
- use words like "best", "aggressive", "guaranteed" or "win"
- show testimonials or case results (real firms are restricted from this)

Always: say it is not legal advice, and that no attorney-client relationship exists until an engagement letter is signed. Exact wording is in `firm/firm.json` under `language`.

## Visual system

The dark design system from `wrenbookDESIGN.md.md`: near-black surfaces, compact type, pill buttons, heavy shadows, one accent. The accent here is **brass**. Tokens: `brand/tokens.css`; the site's stylesheet is `web/site/styles.css`.

| Role | Hex | Use |
|---|---|---|
| Background | `#121212` | Page |
| Surface | `#181818` | Cards |
| Surface 2 | `#1F1F1F` | Inputs, chips, the one band per page, hover |
| Card | `#252525` | Badges, bar tracks, matrix highlights |
| Text | `#FFFFFF` | Primary text |
| Muted | `#B3B3B3` | Secondary text, inactive nav |
| Edge | `#7C7C7C` | Input and outline-button border, drawn as an inset shadow |
| Brass | `#D4A94F` | The only accent: primary buttons, active states, key numbers, the logo bars. Never a large background. |
| Error | `#F3727F` | Errors and urgent |
| Warning | `#FFA42B` | Warnings and drafts |
| Info | `#539DF5` | Info and success |

Dark only. The site tests compute WCAG ratios for the main text pairs (all at least 4.5:1).

## Type

One family: Inter (fallbacks Helvetica Neue, Arial). Mostly 700 and 400. Body 16px, small text 12 to 14px, section titles 24px, page titles up to about 40px. Buttons: 14px, 700, uppercase, 1.4px letter-spacing.

## Shape and depth

Pills (9999px) for buttons, chips, badges and nav links; 8px cards; 4px inputs. No card borders; inputs use an inset 1px `#7C7C7C` shadow. Heavy shadows. No gradients.

## Logo

A rounded dark tile with three white columns between two brass bars: a courthouse front, reduced to bars. `brand/logo.svg`, copied to `web/site/favicon.svg`.

## The five automations (labels used in the UI and ops dashboard)

| Team | Automation | What it does |
|---|---|---|
| Client care | Triage | Sorts email, flags time-sensitive and court matters, drafts acknowledgements |
| Intake | Lead intake and scoring | Matches form entries to practice areas, checks conflicts |
| Intake | Booking agent | Books first consultations, 24/7, by form, voice or email |
| Front desk | Voice line | Answers firm questions and books consultations |
| Records | Court-notice extraction | Reads hearing notices and flags dates, always for attorney confirmation |

## Naming for the rebuild

- n8n folder: `Hollis & Marr Ops`; workflow names `H&M <Team> - <Thing>`.
- Gmail aliases: `+intake`, `+urgent`, `+notices`; labels `Triage/*`, `Booking/*`, `Records/*`.
- Email domain in all demo content: `@hollismarr.example`.
