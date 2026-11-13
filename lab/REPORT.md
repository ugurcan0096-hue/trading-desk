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

---

# Night 1 research: 13 regime-matched ideas — no champion

Regime (4h): BULLISH = close above a rising EMA200, BEARISH = close below a falling EMA200, FLAT = ADX(14) < 20.
A switch only counts after 3 bars. Each idea trades only in its regime and exits when the regime changes.
Sizing: 1% of equity at risk to an ATR stop, capped at 2x. Same costs as above. Parameters fixed before testing.

In-sample 2024-09-14 → 2025-11-12 (BTC +67.4%). Out-of-sample 2025-11-12 → 2026-11-12 (BTC −29.4%) is held back;
only gate 1–2 survivors may look at it. Gate 1 = profitable with ≥ 15 trades; gate 2 = 1,000 permutations, p < 0.01.

| Idea | Regime | IS return | Max DD | Trades | PF | Perm. p | Verdict |
|---|---|---|---|---|---|---|---|
| B1 Donchian 20/10 breakout long | bull | +7.8% | −4.0% | 21 | 2.16 | 0.151 | fail gate 2 |
| B2 Donchian 55/20 breakout long | bull | +5.4% | −3.9% | 16 | 1.81 | 0.259 | fail gate 2 |
| B3 EMA20 pullback long | bull | +10.7% | −5.0% | 27 | 2.24 | 0.115 | fail gate 2 |
| B4 RSI 40 pullback long | bull | −0.2% | −3.3% | 16 | 0.98 | – | fail gate 1 |
| B5 30-day momentum long | bull | +9.1% | −6.3% | 47 | 1.55 | 0.139 | fail gate 2 |
| F1 Bollinger 20/2 reversion | flat | −3.6% | −8.3% | 79 | 0.91 | – | fail gate 1 |
| F2 RSI 30/70 reversion | flat | −2.3% | −3.9% | 28 | 0.80 | – | fail gate 1 |
| F3 30-bar range fade | flat | −15.1% | −17.1% | 68 | 0.54 | – | fail gate 1 |
| R1 Donchian 20/10 breakdown short | bear | −6.7% | −9.4% | 15 | 0.30 | – | fail gate 1 |
| R2 Donchian 55/20 breakdown short | bear | −9.0% | −10.0% | 13 | 0.13 | – | fail gate 1 |
| R3 RSI 60 rally-fade short | bear | −3.0% | −4.5% | 10 | 0.23 | – | fail gate 1 |
| R4 EMA20 rejection short | bear | −8.5% | −14.9% | 27 | 0.32 | – | fail gate 1 |
| R5 30-day momentum short | bear | −4.4% | −9.7% | 31 | 0.53 | – | fail gate 1 |

Champion for every regime: **cash**. Out-of-sample data was not touched.
Challengers (paper-traded forward from 2026-11-13, $13 each): B3, B1, B5 — best in-sample, none proven.
Replaying them over the held-back year, Sentinel would have halted all three on 3-loss streaks.

## WHY THIS COULD FAIL
- Only ~27 months of 4h data exist on Hyperliquid's API; the in-sample period was almost all bull market,
  so bear and flat ideas were tested on few bars.
- 13 ideas tested means ~1 in 8 chance that one clears p < 0.01 by luck; that is why survivors must also pass out-of-sample.
- The fee (0.045%) and slippage (1 bp) are estimates, not exchange-confirmed.
