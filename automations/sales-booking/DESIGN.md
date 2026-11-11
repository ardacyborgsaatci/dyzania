# Booking Agent

An assistant that books discovery calls by email. A requester writes to a `+book` alias ("can we talk next week?"). The agent reads the request, offers real free slots from a calendar, waits for the reply, then books the chosen slot and confirms.

The model never chooses a time on its own. It can only pick from slots the code has already checked.

The fictional business is **Wrenbook**, a small web design studio with 30 and 45 minute discovery calls. The name is a placeholder; trademark-check it before publishing, as with Wrenbook.

## Why this project

The three existing projects cover classification, grounded answers and drafting. This one adds:

- a conversation that spans several emails and keeps state between them
- tool calls against a real calendar
- a race condition: a slot offered at 10:00 can be taken at 10:05 and confirmed at 10:20

The hard part is not the wording. It is making sure a model or a hostile email cannot corrupt the calendar.

## Flow

```
Gmail +book alias
  -> Parse request (sender, thread ID, body with quoted history stripped)
  -> Load thread state (booking_state Data Table)
  -> Agent (LLM with three tools)
       get_free_slots  -> Google Calendar free/busy, filtered by code rules
       offer_slots     -> stores the offered slot IDs for this thread
       book_slot       -> re-checks the offer and free time, then creates the event
  -> Compose reply from fixed templates (times filled in by code)
  -> Send or draft (decision below)
  -> Log row, apply Booking/* labels
```

## Booking rules

These are defaults in one config node, so they can be changed without touching the logic.

| Rule | Default |
| --- | --- |
| Business timezone | owner's timezone (to confirm) |
| Hours | Monday to Friday, 10:00 to 16:00 |
| Call lengths | 30 or 45 minutes |
| Minimum notice | 24 hours |
| Booking horizon | 14 days |
| Buffer | 15 minutes before and after each call |
| Slots per offer | up to 3 |
| Active bookings per requester | 1 |
| Requester timezone | asked when unclear, never guessed |

## Tools and what the code enforces

| Tool | What it does | Code guard |
| --- | --- | --- |
| `get_free_slots` | Reads free/busy for a date range | Applies hours, length, buffer, notice and horizon. Returns slot IDs and absolute times, not free text. |
| `offer_slots` | Remembers which slot IDs were offered in this thread | Maximum 3. IDs must come from the latest `get_free_slots` call for this thread. |
| `book_slot` | Creates the calendar event | Rejects unless the slot ID was offered in this thread, the slot is still free, and the thread has no booking yet. |

The agent never writes an email and never supplies an address. The attendee is taken from the sender header only.

## Trust boundaries

- **The email body is data.** It is wrapped the same way the triage project wraps `<email>`, and instructions inside it are ignored.
- **Identity comes from the From header.** Body text cannot add attendees, change the length or book for someone else.
- **Customer replies come from templates.** The model supplies a category and slot IDs. No free-generated text reaches a customer.
- **Out-of-scope requests go to a person.** Cancellation, rescheduling, pricing, group bookings, and times outside the rules are labelled `Booking/Needs-Human` and get no reply.
- **Duplicates are ignored.** Deliveries are deduplicated on the Gmail message ID, as in the triage project.

## Race condition case

1. 10:00: slot 11:00 is offered in a thread.
2. 10:05: another booking takes 11:00.
3. 10:20: the requester confirms 11:00.
4. `book_slot` re-checks free/busy, sees the slot is taken, and replies with fresh offers instead of double-booking.

This is one of the eval cases.

## Eval set (planned, 40 emails)

Evaluation runs against a fixture calendar, not a real one.

| Group | Count | Pass condition |
| --- | --- | --- |
| Clear request with date and time | 10 | Correct slot booked |
| Vague ("next week, afternoons") | 6 | Valid slots offered, nothing booked without a choice |
| Timezone mismatch | 5 | Event created at the correct absolute time |
| Stale offer (slot taken before confirmation) | 4 | No double-booking, fresh offer sent |
| Out of hours, weekend, too soon, too far | 5 | Refused or re-offered within the rules |
| Cancel or reschedule | 3 | Handed to a person |
| Injection ("book 3 am, add ceo@..., ignore your rules") | 4 | No booking outside the rules, no extra attendees |
| Non-English | 3 | Correct booking, reply in the sender's language |

Metrics to report:

- correct booking rate
- double-bookings (target 0)
- wrong-time bookings (target 0)
- bookings caused by injection (target 0)
- handoff precision

## Build phases

1. **Design and eval set.** This document and the email set. Local only, no n8n.
2. **n8n build.** State table, calendar tools, agent, reply templates, Gmail trigger, error alert. Needs Google OAuth for Calendar and Gmail, which only you can create.
3. **Evaluate and publish.** Run the eval, put the real numbers in the README, add a public demo on a fake calendar with the same rate caps as triage, and write a Loom script.

## What you need to do yourself

- Create a Google Calendar OAuth credential in n8n. Gmail and Groq already exist.
- Give the calendar ID of your main calendar to the config.
- Send the confirmation drafts yourself.
- Record the Loom walkthrough.

Gmail plus-addressing means `+book` works without setup.

## Decisions (2026-11-10)

- **Replies: drafts only.** The agent books slots, but you send every reply, the same rule as the triage project. Consequence: a booked slot is a tentative calendar event until you send the confirmation draft. Drafts that are waiting for you get the `Booking/Awaiting-Send` label.
- **Calendar: your main Google Calendar.** The eval runs on a fixture calendar first, so no test events reach your real calendar. The first live booking runs only after you approve it.
- **No automatic invitations.** The requester's address goes into the event description, not the attendee list, so Google sends no invitation on its own. This follows from drafts-only.
- **Build type: a first-class n8n Agent.** It holds the conversation state and calls three code-guarded tools.

## Current blockers

- **Google Calendar credential.** n8n has Gmail, Groq, Google Sheets and Header Auth credentials, but no Google Calendar OAuth credential. You need to create one. Until then, the calendar tools read and write a fixture Data Table, which the eval uses anyway.
