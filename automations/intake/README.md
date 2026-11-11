# Intake: lead intake and scoring (Dyzania LLP)

Dyzania LLP is a fictional firm made for a portfolio project. Every person, matter and name in this folder is invented.

A person fills in the website form. This automation checks the form, matches it to one of the firm's four practice areas, checks the other side's name against the firm's conflict list, flags time-sensitive wording, scores the lead from 0 to 100, decides the next step, saves the lead, and answers the visitor with a fixed message. It uses **no AI model**. Every decision is a rule you can read and test.

It never gives legal advice, never states a legal deadline as fact, never says whether someone has a case, never promises a response time, and never tells the visitor why a lead is on hold.

## What it does with one form

| Step | What happens | Code |
|---|---|---|
| 1. Check the form | Required fields, formats, dates, honeypot, consent. A bad form gets a 422 with a message per field. The honeypot field is answered with `{ok:true}` and dropped. | `validateIntake` |
| 2. Match the area | Selected area plus keywords in the text. Longest phrase wins. `real estate` and `in custody` are removed first. | `firm/lib/areas.js` |
| 3. Conflict check | Other-side name against clients and former clients. The visitor's own name against everyone, including adverse parties. Client names written in the description. | `firm/lib/conflicts.js` |
| 4. Time-sensitive wording | Court dates, served papers, deadlines, safety, arrest, lockout. Dates near the wording are read and compared with today. | `firm/lib/urgency.js` |
| 5. Score and decide | 0-100, a tier, a next step, a priority, whether to alert a person. | `scoreIntake`, `decideIntake` |
| 6. Answer | A fixed template per next step. | `visitorMessage` |

### Practice-area match

The visitor picks family, injury, employment, estate planning, "not sure" or "something else". The text is then searched for the keywords in `firm/practice-areas.json`.

| Basis | Meaning | Area points |
|---|---|---|
| `selected` | Chosen area has keyword support and is not outweighed | 35 |
| `selected_unsupported` | Chosen area, but the text has no keywords | 20 |
| `inferred` | Not chosen, one area wins on keywords | 25 |
| `differs` | Chosen area has no support and another has two or more hits | 15 |
| `mixed` | A tie between areas, or the chosen one is outweighed | 15 |
| `unclear` | No keywords anywhere | 10 |
| `out_of_scope` | Only keywords for matters the firm does not handle (criminal, immigration, IP, tax, bankruptcy, business, landlord-tenant) | 0 |

If a message has keywords for both a handled and an unhandled matter (a divorce and an arrest), the handled area wins and the other is noted.

### Score (0-100)

| Part | Max | How |
|---|---|---|
| Area fit | 35 | table above |
| Location | 15 | Harlow Point 15, nearby 8, somewhere else 0 |
| Time-sensitivity | 20 | hearing or deadline within 7 days (or past) 20, later 12, not sure 6, none 0. The higher of the form answer and the wording counts |
| Detail | 20 | description 300+ characters 12, 120+ 8, 40+ 4; incident date 4; other side named 4 |
| Contactability | 10 | email 5, phone 5 |

Tier: **Hot** 75 and over, **Warm** 50 and over, **Low** below. A conflict hold caps Hot at Warm. The tier is `Refer out` or `Not a fit` when the next step says so. The weights are choices, not measurements; they are in `INTAKE_POINTS` and the test checks that they add up to 100.

### Next step (first rule that applies)

1. `not_a_fit`: the person is somewhere else.
2. `refer_out`: the matter is one the firm does not handle. The reply points to the local bar association's referral service.
3. `hold_conflict`: any conflict match. A person clears it. The visitor gets no booking link and no reason.
4. `attorney_now`: urgent wording or a date within 7 days (or past). Alerts the attorney on duty.
5. `ask_more`: the area is unclear. A person may reply with a question.
6. `follow_up`: Low tier, or the area is mixed or differs from what was chosen. A person reads it. The reply also offers the booking link.
7. `book`: the reply offers a first consultation, with the fee line from the practice area.

A held lead that is also urgent still alerts, and its reply uses the "flagged for a person" wording, which does not hint at a conflict. A matter the firm cannot take (`refer_out`, `not_a_fit`) does not page the attorney on duty unless safety wording is present.

### Conflict check rules and limits

- Normalise: lowercase, strip accents and punctuation, drop company suffixes.
- `match`: equal after normalising. `near match`: same first initial and same last name (one typo allowed in last names of five letters or more), or one name contains the other as whole words (6+ characters).
- `ambiguous`: the entry is flagged as a common name and the last name matches.
- Names in the other-side field are split on "and", commas, "vs" and "&".
- Adverse parties are a conflict only when the **visitor** is one. Having the same opponent as a client is not a conflict.
- No other-side name and no match gives `not_provided`. It does not hold the lead; the attorney sees that it was not given.

It does **not** model relatives, subsidiaries, aliases, maiden names or sound-alike spellings. A real firm uses its practice-management system for that. This check is a screen for a demo list of 22 invented names.

### Time-sensitive wording: rules and limits

Phrases come from `firm/urgency.json`. For court dates, deadlines and lockouts the **nearest date within 90 characters** of the phrase is used, so "I was fired on Oct 3 and have a hearing on Nov 25" reads Nov 25. Served papers, safety wording and arrest are urgent on sight. The flag repeats the date **as the sender wrote it** and never says what a deadline is.

Known limits, found by trying things rather than fixing them all:
- Wording is matched, not understood. "I was not served" is flagged (the safe direction). "I keep hearing that...", "been hearing from" and "hard of hearing" are removed before matching, because the triage evaluation showed a real email tripping on them; other uses of the verb can still be flagged as a court date with no date.
- US dates only. `16/11/2026` is not read, so it falls back to "no date given" and a "check" flag.
- "next Monday" is read as the coming Monday, which makes a hearing look closer, not further.
- A date with no year is the next one that is not more than 30 days in the past.
- English only. No negation, no synonyms beyond the phrase lists.

## Files

| File | What |
|---|---|
| `lib/intake.js` | validation, score, decision, reply templates, `processIntake` |
| `../../firm/lib/*.js` | shared helpers: text, areas, conflicts, urgency (also used by triage and booking later) |
| `columns.json` | the 27 columns of the `intake_leads` data table |
| `eval/cases.json`, `eval/run.js` | 48 labelled invented leads and the scorer |
| `workflow.json` | the n8n workflow, generated |
| `../../scripts/build-intake-workflow.mjs` | builds `workflow.json` from the library; `--check` fails if it is out of date |
| `test/` | 26 tests |

## The n8n workflow

`Intake form` (POST `/intake`, header auth) → `Validate and score` (Code) → `Valid?` → `Save lead` (data table `intake_leads`) → `Reply to visitor` → `Send alert?` → `Alert attorney on duty` (Gmail). An invalid form goes to `Spam?` → a quiet 200 or a 422 with the errors.

The Code node is **generated**. It holds the same functions the tests run, joined together, with the firm data inlined. Change the rules in `lib/`, run `npm test`, run `node ../../scripts/build-intake-workflow.mjs`. A test fails if `workflow.json` does not match the library, and another runs the Code node's text over all 48 eval leads and compares it with the library output.

Privacy: the workflow is set to **not save execution data**, because the form text is personal and may be privileged. The alert email carries the reference, priority, tier, area, next step, flags and the conflict reason ids. It does not carry the message, the name, the email address or the phone number; those are in the table under the reference.

To use it: create the data table from `columns.json` (done in the demo n8n project as `intake_leads`, id `OBru6aKjhDkKS9dq`), import `workflow.json`, replace `REPLACE_WITH_INTAKE_LEADS_TABLE_ID` and `REPLACE_WITH_ATTORNEY_ON_DUTY_ADDRESS`, attach a header-auth credential to the webhook and a Gmail credential to the alert node. Publishing waits for the cutover and the owner's OK.

## Evaluation: what it shows and what it does not

48 invented leads in `eval/cases.json`: each of the four areas, five of the seven kinds of matter the firm does not handle (criminal, immigration, tax, business, landlord-tenant; not IP or bankruptcy), thin and mixed messages, eleven dedicated conflict cases (exact, partial, typo, two names, a client named in the text, the visitor is a client or an adverse party, and same-opponent-is-not-a-conflict) plus several others with an other-side name, and seven wording and date cases (a hearing tomorrow, a past date, two dates in a sentence, "hard of hearing", a deadline with no date, "I keep hearing").

Result: **48 of 48** on area, next step, tier, urgency, conflict status and exact score.

Read that number with care:
- The labels were written **before** the code was run, from the rules above. **No case ever failed**, so the set did not drive any tuning, and a pass mostly shows the code and my labels agree.
- I wrote the labels and the code. It is a regression set, not an independent test. A second person labelling the same leads would be the real check.
- Everything the set checks the rules already decided. It cannot tell you whether 75 is the right line for "Hot".
- Checks that were made to prove the tests can fail: a negative control (three wrong labels are all caught) and mutation checks (breaking the 7-day edge, the Hot cap, the visitor-versus-adverse check, the longest-phrase rule and the location rule each makes a test fail). The longest-phrase mutation was **not** caught at first, because the real keyword lists happen to be in a lucky order; a test with an unlucky order was added.

## Not done in this phase

- The generated workflow has **not been imported into n8n and run there** yet. The Code node's text is run in Node against all 48 leads; the node shapes (data table insert, webhook, respond) copy workflows that already run live in this project. A pinned-data run in n8n is the first step of the cutover.
- The website form and the handoff to booking are built (`web/site`; the `book` and `follow_up` next steps show the booking page, and the booking keeps the lead reference as `leadRef`). Neither has run against n8n. The workflow also writes one metadata-only ops event per lead, with a handoff to booking when the booking page is offered; that is tested in Node and has not run in n8n.
- The `intake_leads` table holds the form text. Nothing deletes it automatically: the nightly cleanup covers only the activity log and the inbox log, so removing leads is done by hand. The privacy page says so.
