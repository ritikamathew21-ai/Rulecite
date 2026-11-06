# Golden set: baseline

Labels de882901a73f. Today pinned to 2026-11-06.

POST-RESULT ADJUDICATION (adjudicated-best). These labels were changed after the results were seen.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 45.8% | 61.1% | 11 | 1 | 13 | 0 | 0 |
| Code and AI, run 1 | 91.7% | 91.7% | 91.7% | 22 | 2 | 2 | 0 | 1 |
| Code and AI, run 2 | 92.0% | 95.8% | 93.9% | 23 | 2 | 1 | 0 | 1 |
| Code and AI, run 3 | 91.7% | 91.7% | 91.7% | 22 | 2 | 2 | 0 | 1 |
| Code and AI, all runs | 91.8% | 93.1% | 92.4% | 67 | 6 | 5 | 0 | 3 |

Claim status right: 6 of 6. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 3x d03-terminology | false alarm | MSG-04 | Earn reward points each time you pay.
- 3x d05-expired-offer | missed | CLM-02 | 2% back on their first ten payments
- 2x d08-hype | missed | TONE-01 | Leverage our synergistic fintech paradigm
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free

## holdout

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 100.0% | 33.3% | 50.0% | 3 | 0 | 6 | 0 | 0 |
| Code and AI, run 1 | 77.8% | 77.8% | 77.8% | 7 | 2 | 2 | 0 | 0 |
| Code and AI, run 2 | 100.0% | 88.9% | 94.1% | 8 | 0 | 1 | 0 | 1 |
| Code and AI, run 3 | 87.5% | 77.8% | 82.4% | 7 | 1 | 2 | 0 | 1 |
| Code and AI, all runs | 88.0% | 81.5% | 84.6% | 22 | 3 | 5 | 0 | 2 |

Claim status right: 6 of 6. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out
- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out.
- 1x h04-mixed-terms | false alarm | TONE-01 | risk-free
- 2x h04-mixed-terms | missed | MSG-07 | never run out
- 3x h05-expired-beside-valid | missed | CLM-02 | 2% back on your first ten payments
