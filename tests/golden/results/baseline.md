# Golden set: baseline

Labels de882901a73f. Today pinned to 2026-11-06.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 55.0% | 68.8% | 11 | 1 | 9 | 0 | 0 |
| Code and AI, run 1 | 81.8% | 90.0% | 85.7% | 18 | 4 | 2 | 0 | 3 |
| Code and AI, run 2 | 82.6% | 95.0% | 88.4% | 19 | 4 | 1 | 0 | 3 |
| Code and AI, run 3 | 81.8% | 90.0% | 85.7% | 18 | 4 | 2 | 0 | 3 |
| Code and AI, all runs | 82.1% | 91.7% | 86.6% | 55 | 12 | 5 | 0 | 9 |

Claim status right: 6 of 6. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 3x d03-terminology | false alarm | MSG-04 | Earn reward points each time you pay.
- 3x d05-expired-offer | missed | CLM-02 | 2% back on their first ten payments
- 3x d06-banned-phrases | false alarm | TONE-01 | risk-free and 100% safe
- 2x d08-hype | missed | TONE-01 | Leverage our synergistic fintech paradigm
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free
- 1x d09-innocent-words | false alarm | MSG-04 | The best way
- 2x d09-innocent-words | false alarm | MSG-04 | best

## holdout

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 100.0% | 37.5% | 54.5% | 3 | 0 | 5 | 0 | 0 |
| Code and AI, run 1 | 77.8% | 87.5% | 82.4% | 7 | 2 | 1 | 0 | 0 |
| Code and AI, run 2 | 100.0% | 87.5% | 93.3% | 7 | 0 | 1 | 0 | 2 |
| Code and AI, run 3 | 87.5% | 87.5% | 87.5% | 7 | 1 | 1 | 0 | 1 |
| Code and AI, all runs | 87.5% | 87.5% | 87.5% | 21 | 3 | 3 | 0 | 3 |

Claim status right: 6 of 6. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out
- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out.
- 1x h04-mixed-terms | false alarm | TONE-01 | risk-free
- 3x h05-expired-beside-valid | missed | CLM-02 | 2% back on your first ten payments
