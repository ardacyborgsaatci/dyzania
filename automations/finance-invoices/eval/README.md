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
