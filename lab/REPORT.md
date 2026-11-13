# Strategy card: EMA 20/50 flip, BTC perp (Hyperliquid), 4h — KILLED

Data: Hyperliquid `candleSnapshot` + `fundingHistory`, fetched 2026-11-13 01:43 UTC.
Window: 2025-11-12 20:00 → 2026-11-12 20:00 UTC (2,191 closed 4h bars).
Rules: EMA20 crosses EMA50 → flip long/short at next bar open. 2x, 95% of balance, no stop or take-profit.
Costs: 0.045% taker fee per side (estimate), 1 bp slippage (estimate), real hourly funding.

| Metric | Value |
|---|---|
| Total return (incl. open short, marked to market) | +3.0% |
| BTC buy & hold, same window | −29.4% |
| Max drawdown | −48.7% |
| Win rate (closed trades) | 31.7% |
| Sharpe (annualised, 4h) | 0.38 |
| Profit factor (closed trades) | 0.93 |
| Closed trades | 41 |
| Fees / funding paid (per 1,000 USDC) | 56.31 / 9.37 USDC |
| Worst month | Dec 2025, −46% (BTC flat; chop whipsaw) |
| Longest losing streak | 5 |
| Liquidations | 0 |

Gate 1/2 — 1,000 bar permutations: p = 0.283 (return), 0.306 (profit factor). **Fail** (needs p < 0.01).
Parameter check: 12m return ranges from −63% to +162% across nearby EMA pairs → result depends on a lucky value.
Walk-forward (6m train / 1m test, re-optimised monthly): +16.6% vs buy & hold −13.4%, with a −54% drawdown. Not run through the walk-forward permutation test: the strategy already failed Gate 1.

## WHY THIS COULD FAIL
It already did. It "beat" buy and hold only because BTC fell 29% and the strategy happened to be short.
On closed trades it lost money (profit factor 0.93). A shuffled market does as well 28% of the time.
