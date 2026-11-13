import pandas as pd, numpy as np, json
from backtest import load, run, stats
df, src, fetched = load()
end = df.index[-1]                       # last bar (may be still forming -> drop it)
df = df.iloc[:-1]; end = df.index[-1]
start = end - pd.Timedelta(days=365)
print(f"Source: {src}  fetched {fetched}")
print(f"Window: {start} -> {end} (last CLOSED 4h bar), bars={len(df.loc[start:])}")
for cap in (1000.0, 13.0):
    r = run(df, start, cap=cap)
    s = stats(r, cap)
    print(f"\n== EMA20/50 flip, 2x, 95%, no SL/TP, capital {cap} USDC ==")
    for k,v in s.items():
        print(f"  {k:24s} {v:.4f}" if isinstance(v,float) else f"  {k:24s} {v}")
bh = df.loc[start:]
p0 = df.o.iloc[df.index.searchsorted(start)]
bhr = bh.c.iloc[-1]/p0-1; bhdd=(bh.c/bh.c.cummax()-1).min()
print(f"\nBuy&hold BTC 1x (no fees/funding): return {bhr:.4f}, maxDD {bhdd:.4f}")
print(f"Long-only 2x hold approx: return {2*bhr:.4f} (rough, ignores funding/path)")
