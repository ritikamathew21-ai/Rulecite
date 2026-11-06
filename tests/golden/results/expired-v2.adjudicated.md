# Golden set: expired-v2

Labels de882901a73f. Today pinned to 2026-11-06.

POST-RESULT ADJUDICATION (adjudicated). These labels were changed after the results were seen.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 47.8% | 62.9% | 11 | 1 | 12 | 0 | 0 |
| Code and AI, run 1 | 88.0% | 95.7% | 91.7% | 22 | 3 | 1 | 0 | 2 |
| Code and AI, run 2 | 88.5% | 100.0% | 93.9% | 23 | 3 | 0 | 0 | 1 |
| Code and AI, run 3 | 88.5% | 100.0% | 93.9% | 23 | 3 | 0 | 0 | 1 |
| Code and AI, all runs | 88.3% | 98.6% | 93.2% | 68 | 9 | 1 | 0 | 4 |

Claim status right: 9 of 9. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x d03-terminology | false alarm | MSG-07 | Earn reward points each time you pay
- 2x d03-terminology | false alarm | MSG-07 | Earn reward points each time you pay.
- 1x d06-banned-phrases | missed | TONE-01 | risk-free and 100% safe
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free
- 3x d09-innocent-words | false alarm | MSG-04 | best

## holdout

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 100.0% | 33.3% | 50.0% | 3 | 0 | 6 | 0 | 0 |
| Code and AI, run 1 | 88.9% | 88.9% | 88.9% | 8 | 1 | 1 | 0 | 1 |
| Code and AI, run 2 | 100.0% | 88.9% | 94.1% | 8 | 0 | 1 | 0 | 1 |
| Code and AI, run 3 | 100.0% | 77.8% | 87.5% | 7 | 0 | 2 | 0 | 1 |
| Code and AI, all runs | 95.8% | 85.2% | 90.2% | 23 | 1 | 4 | 0 | 3 |

Claim status right: 8 of 8. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 1.

### Errors (count across 3 runs)

- 1x h03-wrong-and-unknown-numbers | missed | CLM-02 | daily limit is ₹2,00,000
- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out.
- 3x h04-mixed-terms | missed | MSG-07 | never run out
