# Triage: the firm's email inbox (Dyzania LLP)

Dyzania LLP is a fictional firm made for a portfolio project. Every person, court, firm and case number in this folder is invented.

Email arrives at the firm's inbox. This automation reads each message, flags the ones that are time-sensitive (a hearing, served papers, a protective order, an arrest, an eviction), sorts the rest into a queue, and prepares a **draft** reply only when a draft is safe. A person reads and sends every reply. **Nothing is ever sent to a sender automatically.**

It never gives legal advice, never states a legal deadline as fact, never says whether someone has a case, never promises a result or a response time, and never replies to a court or to another lawyer.

## How a message is handled

```
mail -> Screen (rules) -> Classify (model) -> Decide (rules) -> Draft (model, ordinary mail only) -> Finish (rules)
```

| Step | Who decides | What it does |
|---|---|---|
| Screen | rules | Cleans the message. Looks for time-sensitive wording and dates (`firm/lib/urgency.js`), instruction-like text, automatic replies, mail from a known court, mail from another lawyer, and the language. |
| Classify | model (Groq `gpt-oss-20b`) | Gives an opinion: category, priority, sentiment, language, one-line summary, needs-a-person, confidence, injection suspected. |
| Decide | rules | Combines the two. **The rules can only make handling more careful than the model asked for, never less.** Sets priority, draft mode, queue, hand-off. |
| Draft | model (Groq `gpt-oss-120b`) | Writes a reply from the knowledge base, only when the rules say `standard`. |
| Finish | rules | Checks the draft against the firm's rules, adds the fixed disclaimer, builds the alert, the Gmail labels and a metadata-only log row. |

### Categories

`new_inquiry`, `existing_client`, `court_notice`, `opposing_counsel`, `scheduling`, `billing`, `spam`, `other` (from `firm/urgency.json`).

### Priority

`urgent` > `high` > `normal` > `low`. The model may raise it. The rules put a floor under it:

| Rule | Floor |
|---|---|
| Time-sensitive wording with a date within 7 days (or past), served papers, safety wording, arrest, lockout | `urgent` |
| A hearing or deadline wording with a later date, or no date | `high` |
| Court notice or mail from another lawyer | `high` |
| An automatic reply | forced to `low` |
| Spam | forced to `low`, unless the rules see time-sensitive wording (a fake summons may be real) |
| The message contains instruction-like text | the model cannot raise it above `normal` |

### Draft mode

| Mode | When | What is made |
|---|---|---|
| `none` | automatic reply, spam, instruction-like text, empty message, another lawyer or insurer, mail from a known court, or the classifier failed | no draft: a person replies |
| `acknowledgement` | urgent, or a court paper sent in by a person | a **fixed text** (no model): your message was flagged for a person, we cannot say what a date or paper means, we cannot promise when someone replies, call the office; adds the 911 line for safety wording and the referral line for arrests and evictions; English or Spanish |
| `standard` | everything else | a model draft from the knowledge base, checked, with the fixed disclaimer added |

If a model draft fails a check, or the draft model is unavailable, the draft becomes a plain holding reply and the message is marked for a person.

### Queue and hand-off

| Queue | Gets |
|---|---|
| `urgent` | anything urgent (the attorney on duty is also emailed an alert) |
| `records` | court notices |
| `matter_attorney` | another lawyer, an insurer, the other side |
| `case_team` | existing clients |
| `intake` | new inquiries |
| `billing` | billing |
| `front_desk` | scheduling and other |
| `none` | spam and automatic replies |

Hand-off (a field in the result): `new_inquiry` -> `intake`, `court_notice` -> `extraction`. A message with instruction-like text is never handed on. **The hand-offs are not wired yet** (Phase 7).

### A person must look when

The classifier asks; it is urgent or mentions a hearing or deadline; it is from a court, a lawyer or a client; the sender is angry and the priority is high; it has instruction-like text; it is empty; confidence is under 0.7; the classifier failed; the message is **not in English** (the rule screen reads English only); or a draft was blocked.

## What is in the alert, the labels and the log

- **Alert** (urgent only, to the attorney on duty): category, queue, priority, the reasons, the flags with the date **as the sender wrote it**, the language, whether a draft waits. It has **no subject, no sender, no message text, no summary**.
- **Gmail labels**: `Triage/<Category>`, `Triage/P-<Priority>`, `Triage/Needs-Human`, `Triage/Injection-Suspected`, `Triage/Processed`.
- **Log row** (`columns.json`, 21 columns): ids, domain, category, priority, flag ids, reason codes, statuses, language, confidence, latency. **No subject, name, address, summary, message text or draft text.**
- Both workflows are set to **not save execution data**.

## Evaluation: what it shows and what it does not

`eval/emails.json` holds **54 invented emails**. By labelled category: 14 new inquiries (family, injury, employment, probate, an arrest, a safety request, a booking question, a served summons, an eviction), 12 from clients, 5 court notices (one a person forwarding a summons), 5 from other lawyers or an insurer, 3 scheduling, 3 billing, 4 spam or phishing (one a fake summons), and 8 other (automatic replies, a bounce, an empty message, a job application, an invitation, a thank-you, two injection attempts). Four are injection attempts in all, three are Spanish, and six are date traps (a hearing 7 days out versus 8, "next week", "I keep hearing", a notice to quit, a Spanish summons). Labelled priorities: 13 urgent, 12 high, 20 normal, 9 low. Each has a label written before the code: category, final priority, whether the rules should see time-sensitive wording, needs-a-person, draft mode, queue, hand-off.

**No model was called.** There is no Groq key on this machine. Three stand-ins are used instead, so the numbers below are about the **rules and labels**, not about the model:

| Check | Stand-in | Result |
|---|---|---|
| Rules and labels agree | a perfect model that answers with the label | **54 of 54** on category, priority, needs-a-person, draft mode, queue, hand-off, injection. The time-sensitive reading (`urgency`) matches 53 of 54; the one miss is a Spanish email (below) |
| Rule guarantees hold | a hostile model (says "other, low, no person, no injection" for everything; obedient to the injected text on the injection emails) | **49 of 49** emails checked |
| Rule guarantees hold | no model at all (classifier unavailable) | **49 of 49** |
| Time-sensitive wording, rules alone | none | **53 of 54** |

"Guarantees" means: an email labelled urgent with wording the rules can read comes out urgent **and** raises an alert; a hearing further out comes out at least high with a person flagged; nothing the labels say should not be drafted gets a draft; injection mail is contained (no draft, no hand-off, a person looks); automatic replies stay quiet; court and lawyer mail is recognised from the sender or the wording and never drafted.

**Five emails are not checked in the model-free runs, because the rules cannot see them.** That is a limit, stated rather than hidden: three spam emails (spam is recognised by the model only), `I04` (a request for a client list, no instruction-like words), and `U06` (an urgent Spanish summons; the rules read English).

Read the numbers with care:
- I wrote the emails, the labels and the code. It is a **regression set**, not an independent test. A second person labelling the same emails would be the real check.
- Before the first run I traced the labels by hand against the rules and changed the rules in three places because of it: two deadline phrases (`respond by`, `response due`) were added to `firm/urgency.json`; "I keep hearing" and "been hearing from" are no longer read as a court hearing (this also changed the intake rules, with a test and a note in its README); and the rule screen reads the **whole** message while the model reads only the new text (a hearing date after 4000 characters, or inside an Outlook-style forward, would otherwise be missed).
- The first run then disagreed in two places. One label said Spanish mail needs no person; the rule I had decided on says it does, so the label was changed. The other was real: with a hostile model, spam got a draft. Spam recognition is model-only, so it was listed as a limit, and a real fix was made: **when the classifier gives nothing usable, no draft is made.**
- **Live run, 2026-11-12:** all 54 emails went through the published core on Groq, one at a time with a 20 s pause. Results are in `eval/live-results-2026-11-12.json` and the report in `eval/live-report-2026-11-12.txt`.
  - **Fields matching the label:** category 50/54, priority 45/54, urgency 53/54, needs-human 51/54, draft mode 49/54, queue 47/54, handoff 53/54, injection 52/54.
  - **Needs-human recall:** 35 of 35, with 3 extra flags.
  - **Urgent mail raised:** 13 of 13.
  - **Fallbacks and guarantees:** no classifier fallback, and no broken guarantee.
  - **Missed injection:** `I04` (a request for the client list, which only the model can catch) was not flagged and got a draft. The draft shares nothing and says the request goes through an internal process, and the email still went to a person.
  - **Over-raising:** most other misses raise priority to urgent where the label says high. That is the safe direction, but it means more alerts.
  - **Drafts:** 21 were made, and a person still has to read them.
  - **Dates:** the set's labels assume 11 Nov and the run was on 12 Nov, so one date-window email (`U03`) can read differently.
  - **Caveat:** this is one run, on a same-author set.
- **Second live run, same day, after one prompt line.** The classifier prompt now says that asking for an answer "today", being upset, or threatening a complaint is not urgent on its own. All 54 were run again; results are in `eval/live-results-2026-11-12-v2.json` and `eval/live-report-2026-11-12-v2.txt`.
  - **Fixed:** N03 is back to normal and C04 to high.
  - **Fields matching the label:** priority 47/54, needs-human 53/54, draft mode 51/54, queue 49/54, handoff 54/54, injection 53/54, category 50/54.
  - **Still holding:** urgent 13 of 13, needs-human recall 35 of 35, no fallback, and no broken guarantee.
  - **Still missed:** I04, as before.
  - **Model variance:** `I02`, a pure manipulation attempt, was flagged as an injection but sorted as spam, so it was not queued.
  - **Not over-raising:** O02, U01 and U03 now carry a date within 7 days of the run date, so urgent is correct by the rule.
- The mutation check: 22 deliberate breakages of the rules (removing the priority floor, the injection cap, the court and lawyer rules, the draft blocks, the non-English flag, the amount check, the negation guard, the hidden-character removal, the whole-message screen, and others). 20 were caught at once, one (hidden characters in the subject line) was not and now has a test, and one (an alert that leaks the subject) is not a real break because the result never holds the subject. A negative control (a wrong label and tampered results) is reported as a failure.

## Known limits

- **English only.** The rules read English. A Spanish email that is urgent is flagged only if the model says so; any non-English email is sent to a person. The language guess is a short word list.
- **US-style dates only**, and the same date-reading limits as intake (`firm/lib/urgency.js`): "next Monday" is read as the coming Monday; "next week" and "16 de noviembre" give no date.
- **The sender is not authenticated.** A forged "From" can only make a message more careful (court mail is never answered), never less. No SPF/DKIM check is made here.
- **A model can page the attorney on duty** by saying "urgent". The prompt restricts it and the rules only add; a false alarm is possible. Mail with instruction-like text cannot be raised above normal.
- **Automatic replies are ignored completely** (low, no draft, no queue), so the patterns are narrow. An "Automatic reply" that is really a notice would be missed.
- **Quoted history.** The Gmail-style "On ... wrote:" part is cut for both readings. Outlook-style forwards and replies are read in full by the rules, so an old date in a long Outlook thread can raise a flag. That is the safe direction.
- **Attachments are not read.** A summons that arrives only as a photo has no text; it is flagged as empty for a person. Reading it is the extraction automation (Phase 4).
- **The draft check is pattern-based.** It blocks guarantees, outcome predictions, case opinions, advice verbs, a date stated as a deadline, promised times, "we will take your case", invented fees, links, phone numbers and addresses, and leaks. A sentence is skipped when it says "cannot" or "do not", so a sneaky sentence could pass. Every draft is reviewed by a person before anything is sent.
- **Privacy.** The message text goes to a third-party model provider (Groq). This demo uses invented mail only. A real firm would need a zero-retention agreement or a self-hosted model, and a decision on whether privileged text may leave the building at all.
- **The model's summary** is held for the run and returned to the caller, but never logged or put in an alert.

## Files

| File | What |
|---|---|
| `lib/triage.js` | sanitize, screen, normalize the model answer, decide, fixed texts, draft check, finish, alert, log row, `triageRun` |
| `lib/labels.js` | Gmail label names and message helpers (kept apart so the Gmail workflow's Code nodes stay small) |
| `lib/data.js` | node-only loader for the data the rules use |
| `rules.json` | known court domains, automatic-reply patterns, lawyer cues, prompt version |
| `../../firm/urgency.json`, `../../firm/lib/` | shared time-sensitive wording and date reading (also used by intake) |
| `prompts/classify.md`, `prompts/draft.md` | the two prompts (the knowledge base is appended to the draft prompt at build time) |
| `columns.json` | the 21 columns of the `triage_log` data table |
| `eval/emails.json`, `eval/run.js` | the 54 labelled emails and the offline scorer (`npm run eval`) |
| `eval/score-live.js` | scores a live run of the core against the labels (`node eval/score-live.js results.json`) |
| `workflow-core.json`, `workflow-gmail.json` | the n8n workflows, **generated** |
| `../../scripts/build-triage-workflow.mjs` | builds both workflow files; `--check` fails if either is out of date |
| `test/` | 55 tests |

## The n8n workflows

**Dyzania Triage - Core**: `Triage request` -> `Screen email` (Code) -> `Classify email` (Groq) -> `Decide` (Code) -> `Standard draft?` -> `Draft reply` (Groq) -> `Finish` (Code). **Dyzania Triage - Gmail**: polls the `+triage` alias, runs the core, creates a threaded Gmail **draft** when one is allowed, inserts the log row, applies the labels, and emails the alert for urgent mail. A manual branch creates the labels once.

The Code nodes are **generated** from the tested library with the firm data inlined. Change the rules in `lib/`, `rules.json` or `firm/`, run `npm test`, run `npm run build`. A test fails if either file is out of date, and another runs every Code node's text over all 54 emails with three kinds of model answer and compares the result with the library.

To use them, follow [CUTOVER.md](../../CUTOVER.md): create the firm's triage log table from `columns.json` (as `dy_triage_log`, because the old table holds the name `triage_log`), run `node scripts/prepare-import.mjs` to fill the table id, the triage core's workflow id, the attorney-on-duty address and the mailbox into copies of both files, import them, attach a Groq credential to the two model nodes and a Gmail credential to the Gmail nodes, run the label branch once. Publishing waits for the cutover and the owner's OK. The old Wrenbook triage (`automations/support`) polls a different alias (`+support`), so the two do not double-process mail until it is retired; they do share the Gmail account and the `Triage/...` label names.

## Not done

- **Live since 2026-11-12:** the core and the Gmail workflow are published, and the 54 emails were run live (see above). No real inbox traffic has been scored.
- **Ops events.** The Gmail workflow writes one metadata-only row per email to `ops_events` (a handoff to the intake coordinator's or the paralegals' queue when it applies).
- **No automatic hand-off to intake or extraction.** A new inquiry is labelled for the intake coordinator and court mail for the paralegals. No lead row is created from an email and an attachment is not passed on (listed as later links on the site's "how it runs" page).
- The firm's triage log table does not exist in n8n yet (the old `triage_log` has Wrenbook columns that hold subjects and summaries; the firm's is created from `columns.json` at the cutover).
