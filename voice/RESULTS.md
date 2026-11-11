# Voice question results

Text-only run of the 15 questions in `test_questions.md`: same knowledge lookup and chat model as `server.py` (`openai/gpt-oss-20b` on Groq, 19 knowledge sections), no speech-to-text and no Fish voice. Answers for the last run are in `results/2026-11-11-run3.json`.

| Run | System prompt | Facts and refusals right | Notes |
|---|---|---|---|
| 1 | original | 14 of 15 | Q14 (Xero) invented an integration: "Yes, we support Xero". Q2 and Q6 incomplete. |
| 2 | "only state what is listed" | 13 of 15 | Q14 fixed, but Q4 (refund) and Q12 (office) wrongly said "I don't know". |
| 3 | "answer from the knowledge whenever it covers the question; never invent; otherwise say you don't know" | **15 of 15** | Q6 omits the identity check and the 1-day wait. Q4, Q5 and Q10 run longer than 3 sentences. |

How to read it:
- **Development results.** The prompt was changed twice after seeing the answers to these same 15 questions, so run 3 is optimistic. A fresh set of questions is the stricter check.
- **One answer per question per run**, and the model is not deterministic, so a re-run can differ.
- **Text only.** Speech recognition, the voice, interruptions and latency are not covered. A real microphone test is still owed.
- Retrieval was checked separately: refund, office and Xero questions pull the sections you would expect, so the Run 2 misses were over-caution in the model, not missing knowledge.
- Length is the open issue: spoken answers should be 1 to 3 sentences, and 3 of 15 are longer.
