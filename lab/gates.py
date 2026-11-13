import numpy as np, pandas as pd
from backtest import load, run, stats
rng = np.random.default_rng(42)
df,_,_ = load(); df = df.iloc[:-1]; end = df.index[-1]; start = end - pd.Timedelta(days=365)

def permute(df, start, rng):
    """Bar permutation after `start`: shuffle relative bars (gap, high, low, close vs prev close)."""
    d = df.copy(); i0 = d.index.searchsorted(start) - 60   # keep warm-up real, shuffle the rest
    lc = np.log(d.c.values); prev = lc[i0-1:-1]
    rel = np.stack([np.log(d.o.values[i0:])-prev, np.log(d.h.values[i0:])-prev,
                    np.log(d.l.values[i0:])-prev, lc[i0:]-prev], 1)
    gap = rel[:, 0].copy(); body = rel[:, 1:] - rel[:, [0]]   # intrabar relative to open
    idx = rng.permutation(len(rel)); gap = gap[rng.permutation(len(rel))]; body = body[idx]
    newc = np.empty(len(rel)); o_=np.empty_like(newc); h_=np.empty_like(newc); l_=np.empty_like(newc)
    p = lc[i0-1]
    for k in range(len(rel)):
        oo = p + gap[k]; o_[k]=oo; h_[k]=oo+body[k,0]; l_[k]=oo+body[k,1]; p = oo+body[k,2]; newc[k]=p
    d.iloc[i0:, d.columns.get_loc("o")] = np.exp(o_); d.iloc[i0:, d.columns.get_loc("h")] = np.exp(h_)
    d.iloc[i0:, d.columns.get_loc("l")] = np.exp(l_); d.iloc[i0:, d.columns.get_loc("c")] = np.exp(newc)
    return d

def pf(r):
    t = r["trades"]; l = -t[t<=0].sum()
    return t[t>0].sum()/l if l>0 else np.inf

real = run(df, start); real_ret = real["eq"].iloc[-1]/1000-1; real_pf = pf(real)
N = 1000; ge_ret = ge_pf = 0
for _ in range(N):
    r = run(permute(df, start, rng), start)
    ge_ret += (r["eq"].iloc[-1]/1000-1) >= real_ret; ge_pf += pf(r) >= real_pf
print(f"GATE 1/2  In-sample permutation (N={N}): return p={(ge_ret+1)/(N+1):.3f}  PF p={(ge_pf+1)/(N+1):.3f}  (pass needs p<0.01)")

print("\nParameter neighbourhood, 12m total return (rows=fast, cols=slow):")
fasts, slows = [10,15,20,25,30], [40,50,60,80,100]
grid = pd.DataFrame(index=fasts, columns=slows, dtype=float)
for f in fasts:
    for s in slows:
        grid.loc[f,s] = run(df, start, f, s)["eq"].iloc[-1]/1000-1
print((grid*100).round(1).to_string())

# Walk-forward on all history: pick best (fast,slow) on trailing 6m, trade next 1m, chain equity.
print("\nWalk-forward (train 6m -> test 1m, re-optimise monthly, full history):")
wf_start = df.index[0] + pd.Timedelta(days=60+182)
months = pd.date_range(wf_start.ceil("D"), end, freq="MS", tz="UTC")
eq = 1000.0; rows=[]
for a, b in zip(months[:-1], months[1:]):
    tr = df.loc[:a]; best=None
    for f in fasts:
        for s in slows:
            v = run(tr, a - pd.Timedelta(days=182), f, s)["eq"].iloc[-1]
            if best is None or v > best[0]: best=(v,f,s)
    r = run(df.loc[:b], a, best[1], best[2], cap=eq)   # flat at month start: conservative
    eq = r["eq"].iloc[-1]; rows.append((a.date(), best[1], best[2], eq))
w = pd.DataFrame(rows, columns=["month","fast","slow","equity"])
print(w.tail(14).to_string(index=False))
bh = df.c.iloc[-1]/df.o.loc[months[0]:].iloc[0]-1
print(f"WF total {w.equity.iloc[-1]/1000-1:+.3f} from {months[0].date()} vs BTC buy&hold {bh:+.3f}")
