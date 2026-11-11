# Booking: first consultations, any hour (Hollis & Marr LLP)

Hollis & Marr LLP is a fictional firm made for a portfolio project. Every person, address and case in this folder is invented.

This automation books a **first consultation** without a receptionist going back and forth. It is two small web endpoints behind one n8n workflow: one returns the free times for a practice area, the other books one. The website form and the voice line both call them. The rules that decide what is free live in one tested file, `lib/booking.js`, and the n8n Code nodes are generated from that file, so the tests and the workflow cannot drift apart.

There is no model in this automation. Booking is rules, so it is exact and it is tested as rules.

It never gives legal advice, never says whether someone has a case, never promises a result, and never tells a person why a booking could not be made online.

## The three ways in

| Path | What exists now | What is still to build |
|---|---|---|
| Website form | The two endpoints below, with their rules and tests | The form page itself (Phase 6) |
| Voice line | The same two endpoints, with what a phone call needs: `limit: 3` for a short read-out and `channel: "voice"` so the row shows how it was booked. The voice agent does not call them yet | Teaching the voice agent to use them, spelling an email back to the caller (Phase 5) |
| Email | The intake reply and the triage drafts already carry the booking link (`https://hollismarr.example/book`) | The page behind that link (Phase 6) |

**Default taken, owner can change it:** the old Larkwell booking build was an LLM agent that negotiated times by email thread. It is not ported. A person who emails is sent to the same form, because one set of rules is easier to trust than two. The old build stays in `automations/sales-booking` until the cutover.

## What the rules are

All numbers come from `firm/availability.json` and `firm/practice-areas.json`. Change the data, not the code; the tests read the same files.

| Rule | Value now | Where |
|---|---|---|
| Consultation length | 45 min family and estate, 30 min injury and employment | `practice-areas.json` |
| Fee line in the email | $150, credited toward the retainer (family, estate); no charge (injury, employment) | `practice-areas.json` |
| Who can take it | The attorneys listed for the area, inside their weekly windows | `availability.json` `windows` |
| Start times | On a 15-minute grid from the window start; the consultation must end inside the window | `slotStepMinutes` |
| Notice | At least 4 hours from now (exactly 4 hours is allowed) | `minNoticeHours` |
| Horizon | Local dates up to and including today + 30 | `horizonDays` |
| Buffer | At least 15 minutes between one consultation's end and the next one's start, **counted once**. A gap of exactly 15 is allowed | `bufferMinutes` |
| One booking per person | Same email (any case) or same phone number (7+ digits), future bookings only | `maxActiveBookingsPerPerson` |
| Conflict check | Must be literally `clear`. The other side's name is required, or a box saying there is none | `requiresConflictClear` |
| Cancelling on the site | Up to 24 hours before the start | `cancelNoticeHours` |

The previous build documented a 15-minute buffer but applied it to both bookings, so it enforced 30. `lib/booking.js` counts it once, and a test pins the difference (a consultation 10:00 to 10:45 may sit next to one at 11:00).

The visitor picks a **time**. The rules pick the attorney: the one with the fewest future bookings, then the order in `practice-areas.json`.

## The two endpoints

Both are `POST`, behind a header-auth credential. The website (or the voice agent) calls them from the server side, never a browser directly.

**`booking/slots`** takes `{ area, limit?, after? }` and returns `{ ok, area, timezone, consultMinutes, fee, slots: [{ start, date, time, label }], more, note }`. `start` is a UTC time such as `2026-11-12T16:00:00Z`; `label` is `Thu, Nov 12, 10:00 AM CST`. It never says who is free or why a time is missing.

**`booking/book`** takes `{ name, email, phone?, area, otherSide?, noOtherSide?, consent, channel, start, leadRef?, website? }` and answers with one of these public codes:

| Code | Meaning | What the person is told |
|---|---|---|
| `booked` | A row was inserted and kept its slot | When, who, where, fee, a reference, and that a confirmation email is on the way (or that it could not be sent) |
| `invalid` | A field is wrong | Which fields, in plain words |
| `slot_unavailable` | Too soon, too far, outside the windows, or taken | "That time is not available", plus up to 3 later times |
| `contact_office` | A conflict hold **or** the person already has a booking | The same words for both: we cannot confirm this online, call the office. This is on purpose so the answer never reveals a conflict, and never confirms that an email address has a booking |
| `unavailable` | The honeypot field was filled | A generic failure |

`start` must carry a time zone (`Z` or an offset). A time with no zone is refused because it could mean any zone, and impossible dates such as 30 February are refused rather than quietly moved.

All answers use HTTP 200; the caller reads `ok` and `code`.

## Two people choosing the same time

The n8n data table has no unique constraint and no transaction, so "check, then insert" alone can double-book. After the insert the workflow reads the table again and runs `bookVerify`:

1. Take every future booked row in insertion order (the table's row `id`).
2. Accept a row unless it clashes with an already accepted row for the same attorney (inside the buffer) or repeats an accepted person.
3. If the new row was not accepted it is marked `cancelled_race` and its owner gets the ordinary "not available" answer with new times. No email is sent to a loser.

A row can only be beaten by rows with a smaller id, and every smaller id was inserted before it, so every caller reaches the same answer. Tests check exactly that.

**Not proven here:** this relies on the table assigning ids in commit order. If a database commits ids out of order, two requests inside the same few milliseconds could both think they won. I have not run this against a real n8n data table. The cutover test (Phase 7) fires two simultaneous requests at the same time to check it.

## Conflict holds

If the conflict check is anything but `clear`, no time is reserved. The workflow inserts a **held** row (no time, no attorney, the matched list ids in `note`, never names) so the intake coordinator can follow up, and answers `contact_office`. The person is never told why. A box saying "there is no other side" never overrides a name that matches, or a prospect who is on the list.

## The confirmation email

The only automatic email the firm sends. It is a fixed template (`bookConfirmation`): date and time in the firm's zone, length, attorney, address, fee line, reference, what to bring, how to change or cancel, the not-legal-advice line and the fictional-firm line. Nothing from the form is repeated except the name. It is sent only to the address that booked. If sending fails the booking stands, the row records `confirmation: failed`, and the visitor is told to keep the reference.

## Data

`columns.json` lists the 18 columns of the `bookings` data table (`bookingRef`, `status` = `booked` / `held` / `cancelled` / `cancelled_race`, `area`, `attorney`, `startUtc`, `endUtc`, `localDate`, `localTime`, `minutes`, `name`, `email`, `phone`, `channel`, `leadRef`, `confirmation`, `note`, `createdAt`, `rulesVersion`). The table **is** the calendar: it holds names and emails because the confirmation needs them. The ops event for each decision (`event` in the result) has no name, email, phone or other-side text; it is not wired to the ops log yet (Phase 7). Execution data is switched off in the workflow because it would hold names and emails.

## Evaluation (offline, no model)

Run `node eval/run.js` or `npm test` in this folder. Four checks, from most to least independent of the code (numbers from the last full run):

| Check | What it does | Result |
|---|---|---|
| Oracle | A brute-force re-implementation walks every 15-minute UTC instant, asks `Intl` for the local time, and counts occupied minutes one by one. It must give the same free times and attorneys as the library, on the labelled offer cases and on random scenarios across both daylight-saving changes | 72 of 72 scenarios agree (12 labelled offer cases and 60 random ones); 20,677 free start times compared |
| Simulation | Random people book random offered times in a row. At the end no attorney has two consultations closer than the buffer, nobody has two future bookings, and every booked time is inside the rules | 12 runs, 147 bookings made, 213 refused, 0 problems |
| Race | Several requests decide against the same stale snapshot and are all inserted in random order. The kept set must be valid, each row's verdict must not depend on rows inserted later, and every loser must have a reason | 30 runs, 180 rows, 139 lost their slot, 0 problems |
| Labelled cases | 86 invented cases in `eval/cases.json` (13 offer, 60 booking, 8 race, 5 cancel), labels written from the data files before the code existed | 86 of 86 |

Guarantees checked on every booking case: the confirmation has the disclaimer lines, the address and exactly one clock time (the booked one), no outcome wording, no link outside the firm's domain; the public answer never repeats the email, phone or other side, never shows a conflict-list id or name; the event holds no personal data; a hold and a repeat booking get identical words.

**Mutation check (run by hand, not in the test suite):** 46 deliberate one-line breakages of `lib/booking.js` (buffer doubled or ignored, off-by-one on notice, horizon and window end, no daylight saving, person limit off, conflict gate off, race order reversed, disclaimer dropped, and so on). 45 were caught on the first run. The survivor (race verification treating two different attorneys at the same time as a clash) showed a missing case; R08 now covers it and it is caught. 46 of 46. This shows the tests notice those breakages. It says nothing about breakages nobody thought of.

**What went wrong while building, so you can see the checks did something:**
- A label of mine was wrong. I wrote an excluded UTC time for the March daylight-saving case that is actually a legal slot (11:00 CDT). The code was right; I corrected the label after checking the arithmetic by hand.
- A unit test found a real bug: `Date.parse` quietly reads `2026-02-30` as March 2, so the start-time parser accepted impossible dates. It now checks calendar fields first.
- A negative control found a gap in the scorer: it never checked the `won` flag that the workflow actually uses. Two checks were added.

## Limits (read these)

- **Same-author evidence.** The labelled cases and the oracle were written by the same author as the code. The oracle is a separate algorithm, but it shares my reading of the rules (for example "horizon is inclusive", "buffer counts once"). Nobody else has checked those readings.
- **Not run in n8n.** The workflow is generated and the Code nodes are tested through stubs. The data-table `get` filter, the `update` node, `alwaysOutputData`, the webhook body shape, and whether the insert returns the row `id` are as documented by n8n but unverified until the cutover import (Phase 7).
- **No email verification and no rate limit.** Anyone can book with someone else's email address and the firm will send them a confirmation; a script could fill the calendar. The site layer (Phase 6) needs rate limiting or a bot check, and the owner has to decide how much verification a first-consultation form should have.
- **No holiday or time-off calendar.** Windows repeat every week. An attorney's vacation or a public holiday is not modeled.
- **No Google Calendar mirror yet.** The owner has since added a Google Calendar credential in n8n, so the mirror can now be built (create an event after a confirmed booking, delete it on cancel); it is not in this workflow. The `bookings` table is the calendar until then.
- **No cancel or change endpoint.** `bookCancelDecision` exists and is tested, but no workflow calls it. Changes go through the office (the email says so). Moving a booking would be cancel plus book, and the one-booking rule would block the second step.
- **Time zone is a default.** `America/Chicago` was chosen by the builder; the owner confirms it. Times are always shown with the zone name.
- **English only.** A caller who needs another language is sent to the office by the voice agent and the form.
- **Urgent matters.** The 4-hour notice and the weekly windows are not an urgent path. A person with a hearing in two days should be called, and intake and triage already flag that; booking does not know.
- **Same person, other identity.** Plus-addresses and a second phone number count as other people.
