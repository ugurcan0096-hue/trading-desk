"""Regime-aware event backtester for BTC perp 4h.
- Signals use only data up to bar i-1 close; orders fill at bar i open (no lookahead).
- Stops checked intrabar; gap through stop fills at the open.
- Size: risk RISK of equity per trade to the stop, notional capped at MAX_LEV x equity.
- Costs: FEE per side + SLIP per side (estimates), real hourly funding."""
import numpy as np, pandas as pd
FEE, SLIP, RISK, MAX_LEV = 0.00045, 0.0001, 0.01, 2.0
CONFIRM = 3   # regime must hold this many bars before it counts

def ema(x, n): return pd.Series(x).ewm(span=n, adjust=False).mean().values
def sma(x, n): return pd.Series(x).rolling(n).mean().values
def std(x, n): return pd.Series(x).rolling(n).std().values
def hh(x, n):  return pd.Series(x).rolling(n).max().values
def ll(x, n):  return pd.Series(x).rolling(n).min().values

def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h-l, np.maximum(abs(h-pc), abs(l-pc)))
    return pd.Series(tr).ewm(alpha=1/n, adjust=False).mean().values

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0]); up = np.clip(d, 0, None); dn = np.clip(-d, 0, None)
    au = pd.Series(up).ewm(alpha=1/n, adjust=False).mean().values
    ad = pd.Series(dn).ewm(alpha=1/n, adjust=False).mean().values
    return 100 - 100/(1 + au/np.where(ad == 0, 1e-12, ad))

def adx(h, l, c, n=14):
    up = np.diff(h, prepend=h[0]); dn = -np.diff(l, prepend=l[0])
    pdm = np.where((up > dn) & (up > 0), up, 0.0); mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = atr(h, l, c, n)
    pdi = 100*pd.Series(pdm).ewm(alpha=1/n, adjust=False).mean().values/a
    mdi = 100*pd.Series(mdm).ewm(alpha=1/n, adjust=False).mean().values/a
    dx = 100*abs(pdi-mdi)/np.where(pdi+mdi == 0, 1e-12, pdi+mdi)
    return pd.Series(dx).ewm(alpha=1/n, adjust=False).mean().values

def regime(h, l, c):
    """Raw label per bar: +1 bull (close>EMA200 rising), -1 bear (close<EMA200 falling), 0 flat (ADX<20 or mixed).
    Confirmed label switches only after CONFIRM consecutive bars of the new raw label."""
    e = ema(c, 200); slope = e - np.r_[np.full(10, np.nan), e[:-10]]
    a = adx(h, l, c)
    raw = np.where(a < 20, 0, np.where((c > e) & (slope > 0), 1, np.where((c < e) & (slope < 0), -1, 0)))
    conf = np.zeros_like(raw); cur, run, last = 0, 0, None
    for i, r in enumerate(raw):
        run = run+1 if r == last else 1; last = r
        if run >= CONFIRM: cur = r
        conf[i] = cur
    conf[:210] = 99   # warm-up: no regime
    return conf

def backtest(d, strat, i0, i1=None, cap=1000.0, mark_open=False):
    o, h, l, c, fund = (d[k] for k in ("o", "h", "l", "c", "fund"))
    i1 = len(c) if i1 is None else i1
    reg = regime(h, l, c)
    el, es, xl, xs, stop_mult = strat["fn"](o, h, l, c)
    a = atr(h, l, c)
    want = strat["regime"]
    eq, pos, entry, stop, ent_eq = cap, 0.0, 0.0, 0.0, cap
    curve, trades, fees, fundp, bars_in, log = [], [], 0.0, 0.0, 0, []
    ent_i = 0
    def close(px, why="exit"):
        nonlocal eq, pos, fees
        fill = px*(1 - SLIP*np.sign(pos)); f = abs(pos)*fill*FEE
        eq += pos*(fill-entry) - f; fees += f; trades.append(eq - ent_eq)
        log.append(dict(entry_i=ent_i, exit_i=i, side=int(np.sign(pos)), entry=entry, exit=fill,
                        stop=stop, pnl=eq-ent_eq, reason=why))
        pos = 0.0
    for i in range(i0, i1):
        j = i-1
        # --- orders at open, from signals at bar j close
        if pos > 0 and (xl[j] or reg[j] != want): close(o[i])
        elif pos < 0 and (xs[j] or reg[j] != want): close(o[i])
        if pos == 0 and reg[j] == want and (el[j] or es[j]) and a[j] > 0:
            side = 1 if el[j] else -1
            dist = stop_mult*a[j]
            notional = min(RISK*eq/dist*o[i], MAX_LEV*eq)
            fill = o[i]*(1 + SLIP*side); f = notional*FEE
            ent_eq = eq; eq -= f; fees += f
            pos = side*notional/fill; entry = fill; stop = fill - side*dist; ent_i = i
        # --- intrabar stop
        if pos > 0 and l[i] <= stop: close(min(stop, o[i]), "stop")
        elif pos < 0 and h[i] >= stop: close(max(stop, o[i]), "stop")
        if pos != 0:
            fp = pos*o[i]*fund[i]; eq -= fp; fundp += fp; bars_in += 1
        curve.append(eq + pos*(c[i]-entry))
    open_trade = None
    if pos != 0:
        if mark_open:   # live paper: report open position, don't close it
            open_trade = dict(entry_i=ent_i, side=int(np.sign(pos)), entry=entry, stop=stop, size=abs(pos),
                              unrealised=pos*(c[i1-1]-entry))
        else:
            i = i1-1; close(c[i1-1], "end"); curve[-1] = eq
    return dict(eq=np.array(curve), trades=np.array(trades), fees=fees, funding=fundp,
                exposure=bars_in/max(i1-i0, 1), log=log, open=open_trade, regime=reg)

def metrics(r, cap=1000.0):
    eq, t = r["eq"], r["trades"]
    rets = np.diff(eq)/eq[:-1] if len(eq) > 1 else np.array([0.0])
    dd = (eq/np.maximum.accumulate(eq) - 1).min() if len(eq) else 0
    w, lo = t[t > 0], t[t <= 0]
    pf = w.sum()/-lo.sum() if lo.sum() < 0 else (np.inf if len(w) else 0)
    s = m = 0
    for x in t: s = s+1 if x <= 0 else 0; m = max(m, s)
    return dict(ret=eq[-1]/cap-1, dd=dd, trades=len(t), win=len(w)/max(len(t), 1), pf=pf,
                sharpe=rets.mean()/rets.std()*np.sqrt(6*365) if rets.std() > 0 else 0.0,
                streak=m, fees=r["fees"], funding=r["funding"], exposure=r["exposure"])
