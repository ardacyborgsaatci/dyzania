# Loom script: Support Inbox Triage (under two minutes)

Record at 1080p with the browser zoomed to about 110%. Have these ready before you press record:

- The live site open on the home page.
- Gmail open in a second tab with the `Triage/*` labels visible and at least one threaded draft from a seed email.
- n8n open on the **Support Triage - Core** workflow.
- The README open on the results table.

Speak slowly. If a step lags, cut it in editing rather than filling the gap.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Home page, hero | "This is a support inbox triage system I built with n8n, open models on Groq, and Vercel. Email comes in, it gets classified and prioritised, a person is flagged when needed, and a reply is drafted. It never sends anything to a customer." |
| 0:12 | Architecture diagram on the home page | "There is one shared triage core. Both the Gmail inbox and this website call it, so the numbers on this site describe the real thing." |
| 0:22 | Playground: click the **Spanish how-to** preset, then Run | "Here is a Spanish question about exporting clients. It detects the language, categorises it as a how-to, and writes the reply in Spanish using only the help-center articles." |
| 0:38 | Point at the draft and the "Draft only, never sent" label | "Drafts are checked in code before they leave the workflow: word limit, link allowlist, no refund promises, no leaked prompt." |
| 0:48 | Playground: click **Prompt injection attempt**, then Run | "This email tries to give the model instructions. It is wrapped as untrusted data, scanned by a regex, and the model also reports it. It is flagged, routed to a human, and no draft is written." |
| 1:00 | Playground: click **Angry refund demand**, then Run | "A refund demand is always sent to a person. The assistant can acknowledge the problem but cannot promise money." |
| 1:10 | Dashboard: results strip and confusion matrix | "On a 54-email test set I wrote, it gets 98 percent of categories right and flags all 18 of the emails that need a person, with zero unsafe drafts. It does send more mail to a person than strictly needed, about a quarter of the routine mail. I tuned on that same set, so treat it as a development result, and the README says so." |
| 1:25 | Gmail tab: labels and a draft in the thread | "In Gmail it labels each message, saves a threaded draft, and emails me only for urgent mail. My Sent folder has no replies to customers." |
| 1:35 | n8n Core workflow | "Under the hood: sanitise, classify with a small model, validate in code, draft with a larger one, check the draft. Failures fall back to a safe default, and I get an error email if a run breaks." |
| 1:45 | README, failure-modes table | "I documented the failure modes too. When the model is down, the site says so honestly with a 503 instead of showing a fake result." |
| 1:52 | Home page | "Links to the code and a try-it-yourself playground are below. Thanks for watching." |

## Tips

- The first playground run after a pause can take a few seconds. Say "while that runs" and talk through the pipeline instead of waiting in silence.
- The playground allows 3 runs per visitor per hour, and preset runs count towards the cap. The script above uses all three, so do any dry run at least an hour before you record, or the last run will be refused.
- Do not show your inbox with real mail in it. Use a clean filter such as `label:Triage` or a window showing only the seed threads.
- Groq's free tier has daily limits. If the playground reports that the AI is unavailable, record the Gmail and n8n segments first and the playground last, or try again later.
- Keep it under two minutes. Cut the n8n segment first if you need to trim.
