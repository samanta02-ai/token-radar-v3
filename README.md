# Token Radar v3 — Build the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/samanta02-ai/token-radar-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/samanta02-ai/token-radar-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every pre-token protocol in the snapshot, ranked by what its token would be
worth if the protocol's record stayed as it is — with the uncertainty shown,
not hidden.

## What it does

`main.ts` reads the sealed snapshot (`/input/snapshot.json`, DefiLlama fetch
2026-11-14), fits a value model on the protocols whose token already trades,
and writes:

- `board.json` — 198 ranked rows (every genuine launch candidate in the
  snapshot), each with an implied value, an 80% interval, a FARM / THIN /
  SKIP verdict with its reason, costed farm economics and a 5-step farm plan.
- `data.js` — the same board plus the model, the out-of-sample table and the
  144 set-aside protocols, for the dashboard.
- `dashboard/` — a sortable, filterable board with a detail view per
  protocol, the method, and the set-aside list.
- `screenshots/` — the board, a detail view and a filtered (FARM) view.
- `dossier.json` — built with the vendored `vendor/makefun-board.ts`.

## The model

- **Peers:** the 128 protocols that record a token with a market cap above $0.
- **Value:** `log(market cap) = 6.965 + 0.522 × log(TVL)`, least squares on the
  peers, fitted at run time from the snapshot itself — no hardcoded list of
  names, no hardcoded coefficients. The fit is re-derived on every run.
- **Uncertainty:** residual spread σ = 2.077 in logs, so the 80% prediction
  interval is ×14.3 wide. That is the honest width of this data, and the
  dashboard shows it beside every value.
- **Tested and dropped:** 7-day growth and listing age as extra predictors.
  Out of sample they did not help (growth's coefficient was even negative),
  so they appear on each row as context only, never in the value.
- **Candidacy:** the board ranks only protocols that record no token and are
  not an exchange, bridge, staking wrapper or versioned deployment (the house
  watchlist's own exclusion rule, minus its $50M floor). The other 144
  pre-token protocols are listed in the dashboard with the reason each was
  set aside, not ranked as if they might launch a token. All 40 watchlist
  protocols are covered.

## Out-of-sample (5-fold, peers only)

| Model | Median log error | Median % error | Within 2× | 80% interval covers |
|---|---|---|---|---|
| One multiple for all (global median mcap/TVL) | 1.665 | 88% | 30% | — |
| One multiple per category (median, global fallback) | 1.608 | 92% | 20% | — |
| **v3: log-log line of mcap on TVL** | **1.283** | **86%** | **30%** | **81%** |

The log-log line wins on median log error; the category multiple does not
beat it. The errors are large in absolute terms — TVL alone only weakly
predicts market cap — which is exactly why the interval is shown.

## Verdicts and farm economics

Gas is not the constraint: 3 months of farming costs $1.30–$13 on the
cheapest chain for every candidate, so the verdict ranks by the money at
stake and quotes the cost as the check. Your time is the scarce input.

- **FARM** — implied value $10M or more (68 rows).
- **THIN** — $5M to $10M, farm lightly (79 rows).
- **SKIP** — under $5M, the smallest dollars at stake (51 rows).

Each farm plan is 5 concrete steps with gas cost and time, on the cheapest
chain the protocol runs on.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22 or later, standard library only. Two runs write the same bytes.

## What changed from v2

v2 ranked 200 rows (40 watchlist + 160 pre-token by TVL) on per-family
log-log fitted value multiples. v3 ranks all 198 genuine candidates (and
sets the other 144 pre-token protocols aside with reasons instead of ranking
exchanges and bridges as launches), fits one log-log line at run time with an
honest 80% interval, publishes a 5-fold out-of-sample comparison of three
models (and drops growth/age as predictors because they failed it), and
grounds every verdict in costed 3-month farm economics with a break-even
airdrop share.
