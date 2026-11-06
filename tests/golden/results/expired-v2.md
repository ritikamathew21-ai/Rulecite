# Golden set: expired-v2

Labels de882901a73f. Today pinned to 2026-11-06.

## dev

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 91.7% | 55.0% | 68.8% | 11 | 1 | 9 | 0 | 0 |
| Code and AI, run 1 | 87.0% | 100.0% | 93.0% | 20 | 3 | 0 | 0 | 4 |
| Code and AI, run 2 | 83.3% | 100.0% | 90.9% | 20 | 4 | 0 | 0 | 3 |
| Code and AI, run 3 | 83.3% | 100.0% | 90.9% | 20 | 4 | 0 | 0 | 3 |
| Code and AI, all runs | 84.5% | 100.0% | 91.6% | 60 | 11 | 0 | 0 | 10 |

Claim status right: 9 of 9. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 0.

### Errors (count across 3 runs)

- 1x d03-terminology | false alarm | MSG-07 | Earn reward points each time you pay
- 2x d03-terminology | false alarm | MSG-07 | Earn reward points each time you pay.
- 1x d06-banned-phrases | false alarm | TONE-01 | Zentra Wallet is risk-free and 100% safe.
- 1x d06-banned-phrases | false alarm | TONE-01 | risk-free and 100% safe
- 3x d09-innocent-words | false alarm | BAN-03 | risk-free
- 3x d09-innocent-words | false alarm | MSG-04 | best

## holdout

| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |
|---|---|---|---|---|---|---|---|---|
| Code checks only | 100.0% | 37.5% | 54.5% | 3 | 0 | 5 | 0 | 0 |
| Code and AI, run 1 | 88.9% | 100.0% | 94.1% | 8 | 1 | 0 | 0 | 1 |
| Code and AI, run 2 | 100.0% | 100.0% | 100.0% | 8 | 0 | 0 | 0 | 1 |
| Code and AI, run 3 | 100.0% | 87.5% | 93.3% | 7 | 0 | 1 | 0 | 1 |
| Code and AI, all runs | 95.8% | 95.8% | 95.8% | 23 | 1 | 1 | 0 | 3 |

Claim status right: 8 of 8. Missing responses: 0. Invalid output: 0. Findings dropped by verification: 1.

### Errors (count across 3 runs)

- 1x h03-wrong-and-unknown-numbers | missed | CLM-02 | daily limit is ₹2,00,000
- 1x h04-mixed-terms | false alarm | MSG-04 | Cashback points never run out.
