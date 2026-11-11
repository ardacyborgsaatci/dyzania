# Loom script: Wrenbook, five automations (about 3 minutes)

One video for the whole company. Record at 1080p, browser zoom about 110%. The video says what is working and what is not; keep that, it is the point.

Have ready before you press record:

- The site running (local `web/site` or a deployment) on the home page.
- n8n open on the invoice workflow, and the Google Sheet "Extraction" tab with the 12 evaluation rows.
- A terminal in the repo with the tests ready (`node --test web/site/test/`).
- The README open on the table of automations.
- Do not show your real inbox. Use the support playground, not Gmail.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Home page | "Wrenbook is a made-up invoicing app for small businesses. I built five automations for its team, and this is them in one place. Everything you will see is invented data." |
| 0:15 | `/ops` page, the five cards | "Each card says honestly what runs and what does not. Two run today, two are tested but small, and booking is not finished." |
| 0:30 | Home page, sales form | "Sales. This form is real. It goes to an n8n workflow that scores the lead from budget, size, timeline and email type, logs it, and alerts on hot leads. The scoring rules have tests, including one that checks my helper matches the n8n node on 180 inputs." |
| 0:50 | Support playground: **Prompt injection attempt**, Run | "Support. This email tries to instruct the model. It is treated as untrusted, flagged and sent to a person, and no draft is written. Replies are only ever drafts; nothing is sent to a customer." |
| 1:10 | Dashboard results | "On 54 invented emails it gets 98 percent of categories right and flags every email that needs a person. I tuned on that set, so it is a development result, and a clean re-run is still owed." |
| 1:25 | `/call` page | "Front desk. A voice assistant that answers from the same knowledge base and points callers who want a demo to the sales form. I tested the text path on 15 questions. I have not tested the microphone or the voice yet." |
| 1:45 | n8n invoice workflow, then the sheet | "Finance. A bill image goes to a vision model, and code decides whether to approve it: amounts must add up and the model must be confident, otherwise Needs review. I ran 12 invented bills at once." |
| 2:05 | Sheet rows, point at I08 (Tallgrass) | "It sent every flawed bill to review and got the readable ones right. But this heavily blurred bill was approved with wrong values, because the wrong numbers still added up and the model sounded sure. I wrote that down as the main gap." |
| 2:25 | README, handoffs list | "Four handoffs connect these: support to sales, sales to booking, voice to sales, and finance to a shared ops alert. They are written and tested, and go live at one planned cutover." |
| 2:40 | Terminal: run the site tests | "Everything is tested where it can be, and the limits are written down." |
| 2:50 | Home page | "Links to the code are below. Thanks for watching." |

## Tips

- Booking is left out on purpose because it is not finished. If asked, say so in one sentence.
- Run the playground presets at least an hour before recording; the demo allows 3 runs per visitor per hour.
- If the site is not deployed, record against the local server and say "running locally".
- Keep it under three minutes. Cut the voice page first if you need to trim.
