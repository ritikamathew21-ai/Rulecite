# Golden set: claims-v1

Labels de882901a73f. Today pinned to 2026-11-06.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 55.0% | 68.8% | 11 | 1 | 9 | 0 | 0 |
| Code and AI, run 1 | 81.0% | 85.0% | 82.9% | 17 | 4 | 3 | 0 | 3 |
| Code and AI, run 2 | 85.7% | 90.0% | 87.8% | 18 | 3 | 2 | 0 | 5 |
| Code and AI, run 3 | 82.6% | 95.0% | 88.4% | 19 | 4 | 1 | 0 | 3 |
| Code and AI, all runs | 83.1% | 90.0% | 86.4% | 54 | 11 | 6 | 0 | 11 |

Claim status right: 6 of 6. Missing responses: 1. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x d02-superlative | missed | MSG-04 | lowest fees
- 3x d03-terminology | false alarm | CLM-02 | Earn reward points each time you pay.
- 3x d05-expired-offer | missed | CLM-02 | 2% back on their first ten payments
- 1x d06-banned-phrases | false alarm | TONE-01 | 100% safe
- 1x d06-banned-phrases | false alarm | TONE-01 | risk-free and 100% safe
- 2x d08-hype | missed | TONE-01 | Leverage our synergistic fintech paradigm
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free
- 3x d09-innocent-words | false alarm | MSG-04 | best
