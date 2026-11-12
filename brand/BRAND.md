# Dyzania LLP brand

Dyzania LLP is a **fictional** small law firm in Harlow Point (11 people, founded 2014) made for a portfolio project. It practices family law, personal injury, employment law, and estate planning and probate. Everything is invented. Pages stay `noindex`. The placeholder domain is `dyzania.example`. A name check is an owner task.

Shared facts (staff, practice areas, hours, fees, availability, urgency rules, the invented conflict list) live in `firm/`. The brand and every automation read from there.

## Voice

Plain, calm and careful. Short sentences, sentence-case headings. Never:
- give legal advice, or say whether someone has a case
- promise an outcome, a result or a response time
- use words like "best", "aggressive", "guaranteed" or "win"
- show testimonials or case results (real firms are restricted from this)

Always: say it is not legal advice, and that no attorney-client relationship exists until an engagement letter is signed. Exact wording is in `firm/firm.json` under `language`.

## Visual system (design system v2)

Dark and refined: near-black layered surfaces, 1px hairlines for depth, a serif display face over Inter, one accent. The accent is **brass**. Tokens: `brand/tokens.css`. The site stylesheet (`web/site/styles.css`), the voice page (`voice/public/index.html`) and the brand email (`automations/lib/brand-email.js`) copy those values.

| Role | Hex | Use |
|---|---|---|
| Background | `#0B0B0C` | Page |
| Surface | `#121214` | Panels, cards, footer |
| Surface 2 | `#18181B` | Inputs, hover, raised rows |
| Card | `#1F1F23` | Badges, chips, selected tiles |
| Line | `#26262B` | Hairline borders and rules |
| Edge | `#7A7A84` | Input and outline-button border (3:1 against every surface) |
| Text | `#F5F3EE` | Primary text, a warm white |
| Muted | `#A8A6A0` | Secondary text, inactive nav |
| Brass | `#D4A94F` | The only accent: primary buttons, the current choice, key numbers, list markers, the logo bars. Never a large background. |
| Error | `#F3727F` on `#2A1418` | Errors and urgent |
| Warning | `#FFA42B` on `#2A2010` | Warnings |
| Info | `#539DF5` on `#101C2E` | Info |

Dark only. The site tests compute WCAG ratios for the main text pairs (all at least 4.5:1).

## Type

Two families. **Instrument Serif** (400) for page titles, section titles, names and large numbers: 56 to 76px for the home title, 32 to 44px for section titles, 28px for card titles. **Inter** (400, 500, 600) for everything else: body 16px, small text 13 to 14px, labels 12px uppercase with wide tracking. Numbers that line up use tabular figures. Buttons: 15px, 600, sentence case. Email falls back to Georgia for the serif, because mail clients do not load web fonts.

## Shape, depth and motion

Radius 6px for inputs, 12px for cards, 20px for large panels; pills (9999px) only for buttons, chips, time slots and nav links. Depth comes from layered surfaces and inset 1px hairlines, not shadows; one soft shadow is kept for the result panel. No gradients on the site. Motion is 160 to 240ms ease-out on hover, focus and step changes, and stops under `prefers-reduced-motion`. Spacing follows an 8px grid; sections sit 56 to 120px apart.

## Components

Header (translucent, hairline, scrolls sideways on phones), buttons (primary brass, secondary hairline), hero with office panel, key-numbers strip, area cards, numbered steps, people list, callouts (urgent, warning, info), form fields with error summary, choice tiles, booking stepper and time chips, status chips, rules list, footer. Each is defined once in `web/site/styles.css`.

## Logo

A rounded dark tile with three warm-white columns between two brass bars: a courthouse front, reduced to bars. `brand/logo.svg`, copied to `web/site/favicon.svg`.

## The five automations (labels used in the UI and ops dashboard)

| Team | Automation | What it does |
|---|---|---|
| Client care | Triage | Sorts email, flags time-sensitive and court matters, drafts acknowledgements |
| Intake | Lead intake and scoring | Matches form entries to practice areas, checks conflicts |
| Intake | Booking agent | Books first consultations, 24/7, by form, voice or email |
| Front desk | Voice line | Answers firm questions and books consultations |
| Records | Court-notice extraction | Reads hearing notices and flags dates, always for attorney confirmation |

## Naming for the rebuild

- n8n folder: `Dyzania Ops`; workflow names `Dyzania <Team> - <Thing>`.
- Gmail aliases: `+intake`, `+urgent`, `+notices`; labels `Triage/*`, `Booking/*`, `Records/*`.
- Email domain in all demo content: `@dyzania.example`.
