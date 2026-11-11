# Loom script: Dyzania LLP, five automations (about 3 minutes)

One video for the whole firm. Record at 1080p, browser zoom about 110%. The video says what works and what is not measured; keep that, it is the point.

**Record after the cutover and the live check have passed** ([CUTOVER.md](CUTOVER.md)). Before that, the forms on the site answer "unavailable" by design, so there is nothing honest to show. If you must record earlier, show only the `/ops` page, the tests and the code, and say "not live yet".

Have ready before you press record:

- The deployed site open on the home page (or `vercel dev`, and say "running locally").
- A second tab on `/ops` ("how it runs").
- n8n open on the `ops_events` table, with the live check's rows in it.
- A terminal in the repo with the tests ready.
- Gmail open on **Drafts** with the invented emails already sent to the `+triage` alias an hour before, so the drafts and labels are there.
- One of the 12 invented notice PNGs from `automations/notices/eval/samples/` ready to upload.
- Do not show your real inbox, real addresses or any real person's data. Everything on screen is invented. The firm is fictional.
- Write the live numbers on a sticky note first (the table at the end). Never say a number you have not measured.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Home page | "Dyzania is a made-up law firm. I built five automations for its team and this is them in one place. Everything you will see is invented, and nothing here gives legal advice or sends a message to a client on its own." |
| 0:15 | `/ops` page, the five cards | "Each card says what it does, the evidence, and what is not measured. I wrote the labels and the code myself, so these are regression checks, not independent proof." |
| 0:30 | Contact form: fill in the invented visitor, send | "Intake. A visitor describes a matter. Rules, not a model, match it to a practice area, screen the other side against an invented conflict list, flag a court date or other urgent wording, and score it. The visitor is never told about the conflict screen." |
| 0:55 | Booking page: pick a time, book | "Booking. The same rules offer free times and choose the attorney. They enforce notice, a buffer, one booking per person and the conflict check. A separate brute-force check agrees with them on 72 scenarios, including both daylight-saving changes." |
| 1:15 | n8n `ops_events` table | "Every run writes one short log row with no names, addresses or message text. These two rows are the intake and the booking, linked by the lead reference. A script checks that chain and that nothing private is in any row." |
| 1:35 | Gmail Drafts, then the injection email | "Inbox triage. A model sorts email and a reply is saved as a draft, never sent. Courts, other lawyers, spam and instruction-like text get no draft at all. This email tries to give the model orders: it is flagged and sent to a person." |
| 1:55 | Upload a notice PNG, then the row and the alert email | "Court notices. A vision model copies a scanned paper into fields and rules set the priority. Every result says Needs attorney confirmation and nothing can change that. It never works out a deadline; a date is repeated as printed. One alert goes to the attorney on duty, with no party names." |
| 2:15 | `/call` page, ask one question, then book by voice | "The voice line answers from the same knowledge base and books through the same service as the website. A check blocks advice, a stated deadline or an invented fee." |
| 2:35 | Terminal: run the tests | "Everything is tested where it can be: 357 Node tests and 124 Python tests, and the generated n8n workflows are checked against the libraries." |
| 2:45 | `/ops` page, "not measured" lines | "What I have not done: [say the limits you still have, from the table below]. Links to the code are below. Thanks for watching." |

## Numbers to read off after the live runs

Say only what the run produced. If a run was not done, say "not measured yet".

| Run | Command | Say |
|---|---|---|
| Intake to booking chain | `node scripts/live-check.mjs verify ...` | "The live check passed: the two events chain by the lead reference and hold nothing private." |
| Triage, 54 emails through the real model | `node automations/triage/eval/score-live.js results.json` | The category and needs-human numbers it prints, and how many guarantees broke (target none). Say it is a development set I wrote. |
| Court notices, 12 notices | `node automations/notices/eval/score.js rows.json` | Wrong statuses (must be 0), urgent notices missed, fields right. |
| Voice questions | `python run_questions.py` in `voice/` | How many of the 54 it got right, and that a real call was or was not made. |

## Tips

- Run the triage emails and the live check an hour before recording so the drafts, labels and rows are already there.
- Delete the booking the live check made (and any test rows) afterwards.
- Cut the voice page first if you need to trim; keep the `ops_events` rows and the notices alert, they are the proof.
- If asked what is missing, say it in one sentence: no calendar mirror, no cancel endpoint, and a new-matter email still needs a person to enter it.
- Keep it under three minutes.
