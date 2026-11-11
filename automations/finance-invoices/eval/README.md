# Invoice extraction: evaluation set

12 invented supplier bills (`samples/I01.png` to `I12.png`) with the right answers in `invoices.json`. Every vendor, number and amount is made up.

| Group | Cases | What it checks |
|---|---|---|
| clean | I01, I04, I05 | Plain bills, one with a 5-figure total and thousands separators |
| format | I02, I03, I06 | German layout and decimal commas, UK date and VAT, Canadian dollars |
| hard | I07, I08 | Rotated and blurred images. Needs review is fine; approving with wrong values is not |
| flawed | I09 to I12 | No total, amounts that do not add up, no vendor name, a restaurant menu that is not a bill |

## Scoring

`node score.js results.json`, where results.json maps each id to the extracted fields plus `status` (`Auto-approved` or `Needs review`).

The number that matters most is **bad approvals**: a bill that was approved but should have gone to a person, or was approved with a wrong value. The target is 0. Sending a good bill to review is safe, just slower, and is counted separately.

`node --test test/` checks the set itself and the scorer.

## Status

Images and scorer are ready. **The model has not been run on them yet**, so there are no accuracy numbers. The workflow takes images through its upload form only, and the n8n tool used in this session cannot attach an image to a form. The form now accepts several bills in one upload.

## Results, 2026-11-11

Run once through the live workflow (one multi-file upload of all 12 bills, model `nvidia/nemotron-3.5-super-vl:free`). Raw rows: `results/2026-11-11-sheet-rows.tsv`; scored copy: `results/2026-11-11.json`. Rows are matched to bills by order, which agrees with the invoice numbers on every bill except I08.

- **Bad approvals: 1 of 12.** I08 (the heavily blurred bill) was auto-approved with wrong values: it read invoice number TG-0042 (true TG-0412), date 2020-10-05 (true 2026-10-15) and amounts 800 / 64 / 864 (true 300 / 24 / 324). The amounts added up and the model reported 0.95 confidence, so every check passed. A bill read wrongly but consistently gets through the current rules.
- **All other 11 were handled correctly.** The 8 readable bills were approved with every field right (including the German and Canadian formats, 5-figure amounts and the mildly blurred, rotated I07). The 4 flawed bills (no total, amounts that don't add up, no vendor, a menu) all went to Needs review. Nothing was sent to review needlessly.
- **Fields right: 72 of 77** on the 11 bills that have an answer key; all 5 misses are on I08.

Caveats: 12 invented bills, one run, no repeats, so the numbers say little about variation. The blurry bills were made by shrinking and rotating the same clean image, which is easier than real phone photos. The model's confidence score did not catch the one real failure.

Idea, not built: also send to review when the date is more than about a year from today or in the future. That would have caught I08, but it is a rule chosen after seeing the failure, so it would need fresh bills to check.
