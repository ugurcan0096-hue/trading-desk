"""Nightly Judge: in-sample screen + 1,000-permutation gate; survivors get ONE out-of-sample look
(walk-forward) + OOS permutation gate. OOS is never used to choose between candidates."""
import sys, json, time, numpy as np, pandas as pd
from backtest import load
from engine import backtest, metrics
from strategies import STRATS
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
rng = np.random.default_rng(7)
df, src, fetched = load(); df = df.iloc[:-1]       # drop forming bar
D = {k: df[k].values.astype(float) for k in ("o", "h", "l", "c", "fund")}
idx = df.index
split = int(idx.searchsorted(idx[-1] - pd.Timedelta(days=365)))
I0 = 260

def permute(D, a, b, rng):
    d = {k: v.copy() for k, v in D.items()}
    lc = np.log(d["c"]); prev = lc[a-1:b-1]
    gap = np.log(d["o"][a:b]) - prev
    body = np.stack([np.log(d["h"][a:b]), np.log(d["l"][a:b]), lc[a:b]], 1) - np.log(d["o"][a:b])[:, None]
    gap = gap[rng.permutation(b-a)]; body = body[rng.permutation(b-a)]
    p = lc[a-1]
    for k in range(b-a):
        oo = p+gap[k]; d["o"][a+k] = np.exp(oo); d["h"][a+k] = np.exp(oo+body[k, 0])
        d["l"][a+k] = np.exp(oo+body[k, 1]); p = oo+body[k, 2]; d["c"][a+k] = np.exp(p)
    return d

def perm_p(s, a, b, start, real):
    ge = 0
    for _ in range(N):
        ge += metrics(backtest(permute(D, a, b, rng), s, start, b))["ret"] >= real
    return (ge+1)/(N+1)

def bh(a, b): return D["c"][b-1]/D["o"][a]-1
print(f"Source {src} fetched {fetched}")
print(f"IS  {idx[I0]} -> {idx[split-1]}  ({split-I0} bars)  BTC buy&hold {bh(I0, split):+.1%}")
print(f"OOS {idx[split]} -> {idx[-1]}  ({len(idx)-split} bars)  BTC buy&hold {bh(split, len(idx)):+.1%}")
out = []
for s in STRATS:
    m = metrics(backtest(D, s, I0, split))
    row = dict(name=s["name"], regime=s["regime"], why=s["why"], IS=m)
    # Gate 1: must make money in-sample with >= 15 trades; Gate 2: permutation p < 0.01
    if m["ret"] > 0 and m["trades"] >= 15:
        row["IS_p"] = perm_p(s, 210, split, I0, m["ret"])
    out.append(row)
    print(f"{s['name']:36s} IS ret {m['ret']:+7.1%} dd {m['dd']:+6.1%} n={m['trades']:3d} pf {m['pf']:5.2f} "
          f"exp {m['exposure']:4.0%}  p={row.get('IS_p', float('nan')):.3f}", flush=True)
surv = [r for r in out if r.get("IS_p", 1) < 0.01]
print(f"\nSurvivors of gates 1-2: {[r['name'] for r in surv] or 'none'}")
for r in surv:   # gates 3-4: single OOS look
    s = next(x for x in STRATS if x["name"] == r["name"])
    m = metrics(backtest(D, s, split, len(idx)))
    r["OOS"] = m; r["OOS_p"] = perm_p(s, split, len(idx), split, m["ret"])
    print(f"  OOS {r['name']}: ret {m['ret']:+.1%} dd {m['dd']:+.1%} n={m['trades']} pf {m['pf']:.2f} p={r['OOS_p']:.3f}")
json.dump(dict(source=src, fetched=fetched, run_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               permutations=N, results=out), open("results.json", "w"), default=float, indent=1)
