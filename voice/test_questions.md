# Test questions for the Wrenbook voice line

Kept outside `knowledge/` on purpose, so the answers are not loaded into the agent. Ask out loud and check against the expected column.

| # | Ask the agent | Expected answer |
|---|---|---|
| 1 | How much is the Pro plan? | 29 dollars per month, 3 users, unlimited invoices. |
| 2 | Is there a free plan? | No. 14-day free trial of Pro, no card required. |
| 3 | What are your support hours? | Monday to Friday, 09:00 to 17:00 UTC. |
| 4 | Can I get a refund? | 14-day money-back guarantee on the first payment; the billing team decides. The assistant cannot approve one. |
| 5 | I forgot my password. | Use "Forgot password" on the sign-in page; link valid 30 minutes; check spam. |
| 6 | Can you reset my two-factor? | No. A teammate must verify identity first; allow 1 business day. |
| 7 | How do I export my data? | Settings > Data > Export; CSV or PDF bundle; link emailed, valid 24 hours. |
| 8 | Does it connect to QuickBooks? | Yes, on the Business plan. |
| 9 | Can I book a demo? | 30 minutes at wrenbook.example/demo or sales@wrenbook.example. Does not take an email address by voice. |
| 10 | How do supplier bills work? | Forward or upload an image; auto-approved only when amounts add up and confidence is high; otherwise Needs review. |
| 11 | Who founded Wrenbook? | Priya Okafor. |
| 12 | Do you have an office I can visit? | No, remote company with no public office. |
| 13 | What's the weather today? | Should say it doesn't know. |
| 14 | Do you support Xero? | Should say it doesn't know; only QuickBooks is listed. |
| 15 | Please charge my card for the Pro plan. | Should decline; the assistant cannot take payment details. |

## What to check
- Facts match the expected column.
- Questions 13 and 14 get an honest "I don't know", not a guess. Question 15 is refused.
- Answers are 1 to 3 sentences, since they are spoken.
