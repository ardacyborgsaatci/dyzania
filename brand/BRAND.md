# Wrenbook brand

Wrenbook is a fictional invoicing and bills app for small businesses (12 people, founded 2019). Everything is invented for a portfolio. Pages stay `noindex`. Trademark and domain check is an owner task; the placeholder domain is `wrenbook.example`.

Voice: plain, calm, a little dry. Short sentences. Sentence-case headings. No exclamation marks, no "revolutionary".

## Palette (own system, not derived from any real brand)

| Token | Hex | Use |
|---|---|---|
| `--wb-ink` | `#12343B` | Text, primary buttons, dark band |
| `--wb-canvas` | `#FBF7F0` | Page background (warm paper) |
| `--wb-surface` | `#FFFFFF` | Cards |
| `--wb-line` | `#E6DFD2` | Hairlines, borders |
| `--wb-body` | `#3F5A5F` | Secondary text |
| `--wb-mute` | `#6F8386` | Captions (large text only on canvas) |
| `--wb-wren` | `#E08A2B` | Accent fill: badges, highlights, the logo dot. Never as text on canvas (fails contrast). |
| `--wb-sage` | `#6B9080` | Secondary accent, charts, "ok" states |
| `--wb-ok` | `#2E7D4F` | Success text |
| `--wb-warn` | `#8A5A00` | Warning text |
| `--wb-error` | `#B3261E` | Error text |

Contrast: the site tests compute WCAG ratios for the main text pairs (all at least 4.5:1).

## Type

- Display: Fraunces, weight 600, tight tracking (-0.02em).
- Body: Inter, 400 and 500.
- Mono (labels, code, numbers in tables): JetBrains Mono.

## Shape and depth

- Radius: 10px cards, 8px inputs, 999px buttons.
- One shadow: `0 1px 2px rgba(18,52,59,.08), 0 8px 24px -12px rgba(18,52,59,.18)`.
- One dark band per page (ink background). No gradients.

## Automation teams (labels used in the UI and ops dashboard)

| Team | Automation | Colour chip |
|---|---|---|
| Sales | Lead intake & scoring | wren |
| Sales | Demo booking | wren |
| Support | Inbox triage | sage |
| Front desk | Voice line | ink |
| Finance | Invoice extraction | sage |

## Naming for the rebuild

- n8n folder: `Wrenbook Ops`; workflow names `Wrenbook <Team> - <Thing>`.
- Gmail aliases: `+support`, `+book`, `+invoices`; labels `Triage/*`, `Booking/*`, `Finance/*`.
- Email domain in all demo content: `@wrenbook.example`.
