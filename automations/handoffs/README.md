# Handoffs

Four links between Hollis & Marr's automations. None of them sends a message to a client: a handoff is a reference, a label on an email, or a log row. The firm is fictional and every row is invented demo data.

| # | Link | Carried by | What happens | Not done |
|---|---|---|---|---|
| 1 | intake -> booking | the lead reference in the booking page link (`/book?area=...&ref=...`) | After `book` or `follow_up`, the visitor is shown the booking page. The booking row keeps the reference as `leadRef`; its event has `source=handoff` and `runId` equal to the reference. | A visitor who never books leaves an open offer, which is normal. |
| 2 | voice -> booking | the booking channel (`voice`) | A call books through the same rules as the website and gets the same decision. The event has `source=voice`. | The call has no lead reference unless the caller came from intake. |
| 3 | triage -> intake | a Gmail label and a queue (`handoffRef=queue`) | A new inquiry arriving by email is labelled for the intake coordinator. Court-notice mail is labelled for the paralegals the same way. | No lead row is created from an email, and the attachment is not passed to the notices workflow. Both are listed as later links in `web/site/data/status.json`. |
| 4 | notices -> ops | an ops event | Every notice is a `needs_human` row, a line in the digest and, if urgent, an owner-only alert. | Nothing confirms a notice automatically; an attorney does. |

`lib/handoffs.js` holds the four links as data (`HANDOFFS`) and two checks on `ops_events` rows:

- `chainProblems(rows)`: a receiving row must have a sender (same reference, sent no later), a sender must name a known automation and a reference, and nothing hands off to itself.
- `openHandoffs(rows)`: offers to another automation that no receiving row has answered yet. A queue is never an open offer.

The live check at the cutover runs `chainProblems` on the real table.

## Safety notes

- Injected email is never handed off (tested on the triage set).
- A conflict hold, an urgent matter or a referral out never shows the booking page, so none of them claims a handoff. The visitor message is written never to reveal a conflict check, and this log stays internal.
- No handoff adds a client-facing email. The only email any automation sends to a client is the fixed booking confirmation.

## Tests

```bash
cd automations/handoffs && npm test
```

Eight tests, driven by the real intake, triage, notices and booking libraries and their own evaluation sets: leads from the 48-case intake set actually book through the 86-case booking rules, the same 60 booking requests give the same decision by voice as by web, and the digest and the owner alert agree on which notices are urgent.
