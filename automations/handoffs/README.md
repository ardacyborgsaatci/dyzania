# Handoffs

Four links between automations. All are drafts-only or data-only: nothing here sends mail to a customer. Helpers live in `lib/handoffs.js` and are pasted into Code nodes at the cutover.

| # | Link | Trigger | Result | Where |
|---|---|---|---|---|
| 1 | support -> leads | category `sales_inquiry` | Unscored lead row (no budget, size or timeline was given), no reply | `leadFromSupport` |
| 2 | leads -> booking | tier `Hot` | Gmail **draft** inviting the lead to book, labelled `Booking/Awaiting-Send`; owner sends it | `bookingInvite` |
| 3 | voice -> leads | caller asks for a demo | Voice page shows a link to the sales form with `topic=demo`; the form pre-fills a one-line message. No email is taken by voice. | `voice/demo_intent.py`, `web/lead-intake/contact.js` |
| 4 | invoices -> ops | status `Needs review` | Event row, a digest line, and an owner alert above a configured amount | `invoiceEvent` |

Linked events: the sender row carries `handoffTo` and `handoffRef`; the receiver row has `source=handoff` and `runId` equal to that ref (`handoffEvents`).

Safety notes
- Lead names are stripped to letters, digits and a few marks before they reach the draft greeting, and the draft contains only fixed text plus the brand domain.
- Only a Hot lead is invited. An unscored lead from support waits for a person.
- Injection-flagged support mail never becomes a lead.

Run the tests: `cd automations/handoffs && npm test` (8 tests) and `python -I voice/tests/test_demo_intent.py`.
