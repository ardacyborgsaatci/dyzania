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

## Visual system (design system v5, cream / ink / burnt orange)

Taken from the images in `REFERENCE/`. A flat, editorial look: **cream** page, **ink** type and actions, **burnt orange** as the single accent. Tokens: `brand/tokens.css`; the site stylesheet (`web/site/styles.css`) copies them. The voice page and the brand email still use design system v2 (dark, brass) until their own pass.

| Role | Hex | Use |
|---|---|---|
| Cream | `#F3EEE3` | Page background |
| Surface | `#FFFFFF` | Cards, forms |
| Surface 2 | `#FAF7F1` | Quiet panels, skeletons |
| Ink | `#111111` | Text, primary buttons, focus ring, selected choice, footer |
| Muted | `#5C5750` | Secondary text |
| Edge | `#8A847B` | Input and choice borders (3:1 on every surface) |
| Burnt orange | `#D9541E` | Offset block, underline, large italic accent words, the large orange button |
| Accent text | `#A63A12` | Small orange text: eyebrows, numerals, list markers |
| Error | `#B91C1C` on `#FEF2F2` | Errors and urgent |
| Warning | `#92400E` on `#FFFBEB` | Warnings |
| Info | `#1D4ED8` on `#EFF6FF` | Info |

White on `#D9541E` is about 4.0:1, so it is only used for large bold text (the 19px hero button). Small buttons are ink.

**Hero:** an announcement bar, then two columns. Left: a heavy tight headline with the place name as an orange italic serif accent word and a hand-drawn underline, a short lede, a button, a quiet link and a facts row (4 attorneys, 11 people, since 2014). Right: a black-and-white drawing of the office (`web/site/hero-office-mono.svg`) on an orange offset block, with two floating white cards (office hours, and an example of a message sent at night). Decorative picture (`alt=""`). Below it a strip names the four kinds of matter in italic serif. There are no stars, client logos or testimonials: a law firm may not show them.

## Layout

1200px container, 8px spacing, generous section gaps. The announcement bar scrolls away; the header is sticky, cream, and frosted once scrolled; below 900px it becomes a Menu button that opens a full-screen overlay (without JavaScript the links wrap in a row). Home: hero, strip, a one-line urgent notice, numbered area rows, four steps, a dark closing call to action. Inner pages open with a compact title block over a hairline. Practice areas has a sticky side index on wide screens. Contact, booking and the voice page use an 8/4 split. The footer is ink with cream text.

## Type

**Inter Tight** (700 to 800, tight tracking) for headlines and the wordmark. **Instrument Serif** italic for accent words and the strip. **Inter** (400 to 700) for everything else: body 16px, small text 13 to 14px. Numbers that line up use tabular figures. Email falls back to Georgia for the serif.

## Shape, depth and motion

Radius 10px inputs, 16px cards, 24px large panels, pills for buttons and chips. Flat white cards with a hairline and one soft shadow. No gradients, no glass (except the header after scroll). Motion is 160 to 640ms ease-out and stops under `prefers-reduced-motion`.

## Components

Announcement bar, sticky header with pill CTA and menu overlay, buttons (ink, and the large orange hero button), numbered area rows, hero with offset picture and floating cards, italic strip, area cards, steps, people list, callouts (urgent, warning, info), form fields with error summary, choice tiles, booking stepper and time chips, status chips, rules list, ink footer. Each is defined once in `web/site/styles.css`.

## Logo

A rounded ink tile with three cream columns between two orange bars. `brand/logo.svg`, copied to `web/site/favicon.svg`.

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
