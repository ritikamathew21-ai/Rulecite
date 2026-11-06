# Golden set: claims-v1

Labels de882901a73f. Today pinned to 2026-11-06.

POST-RESULT ADJUDICATION (adjudicated). These labels were changed after the results were seen.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 47.8% | 62.9% | 11 | 1 | 12 | 0 | 0 |
| Code and AI, run 1 | 87.0% | 87.0% | 87.0% | 20 | 3 | 3 | 0 | 1 |
| Code and AI, run 2 | 87.0% | 87.0% | 87.0% | 20 | 3 | 3 | 0 | 3 |
| Code and AI, run 3 | 88.0% | 95.7% | 91.7% | 22 | 3 | 1 | 0 | 1 |
| Code and AI, all runs | 87.3% | 89.9% | 88.6% | 62 | 9 | 7 | 0 | 5 |

Claim status right: 6 of 6. Missing responses: 1. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x d02-superlative | missed | MSG-04 | lowest fees
- 3x d03-terminology | false alarm | CLM-02 | Earn reward points each time you pay.
- 3x d05-expired-offer | missed | CLM-02 | 2% back on their first ten payments
- 1x d06-banned-phrases | missed | TONE-01 | risk-free and 100% safe
- 2x d08-hype | missed | TONE-01 | Leverage our synergistic fintech paradigm
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free
- 3x d09-innocent-words | false alarm | MSG-04 | best
