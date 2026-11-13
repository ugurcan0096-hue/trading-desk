"""Regime-matched strategy ideas. Each fn returns entry_long, entry_short, exit_long, exit_short, stop_mult (x ATR).
Each idea has a one-line reason ('who pays'). Fixed parameters chosen BEFORE testing; no tuning."""
import numpy as np
from engine import ema, sma, std, hh, ll, rsi, atr
F = np.zeros
def prev(x, k=1): return np.r_[np.full(k, np.nan), x[:-k]]

def donchian_long(n_in, n_out):
    def fn(o, h, l, c):
        z = F(len(c), bool); return c > prev(hh(h, n_in)), z, c < prev(ll(l, n_out)), z, 2.5
    return fn
def donchian_short(n_in, n_out):
    def fn(o, h, l, c):
        z = F(len(c), bool); return z, c < prev(ll(l, n_in)), z, c > prev(hh(h, n_out)), 2.5
    return fn
def ema_pullback_long(o, h, l, c):
    e20, e50 = ema(c, 20), ema(c, 50); z = F(len(c), bool)
    touched = (l <= e20) & (c > e20) & (e20 > e50)
    return touched, z, c < e50, z, 2.0
def rsi_pullback_long(o, h, l, c):
    r = rsi(c); z = F(len(c), bool)
    return (prev(r) < 40) & (r >= 40), z, r > 70, z, 2.0
def tsmom_long(o, h, l, c):          # 30-day momentum
    m = c/prev(c, 180) - 1; z = F(len(c), bool)
    return m > 0, z, m < 0, z, 3.0
def tsmom_short(o, h, l, c):
    m = c/prev(c, 180) - 1; z = F(len(c), bool)
    return z, m < 0, z, m > 0, 3.0
def boll_revert(o, h, l, c):
    mid, sd = sma(c, 20), std(c, 20)
    return c < mid-2*sd, c > mid+2*sd, c >= mid, c <= mid, 1.5
def rsi_revert(o, h, l, c):
    r = rsi(c); return r < 30, r > 70, r > 50, r < 50, 1.5
def range_fade(o, h, l, c):          # fade 5-day range extremes
    hi, lo = prev(hh(h, 30)), prev(ll(l, 30)); mid = (hi+lo)/2
    return c <= lo + 0.1*(hi-lo), c >= hi - 0.1*(hi-lo), c >= mid, c <= mid, 1.5
def rally_fade_short(o, h, l, c):
    r = rsi(c); z = F(len(c), bool)
    return z, (prev(r) > 60) & (r <= 60), z, r < 30, 2.0
def ema_breakdown_short(o, h, l, c):
    e20, e50 = ema(c, 20), ema(c, 50); z = F(len(c), bool)
    return z, (h >= e20) & (c < e20) & (e20 < e50), z, c > e50, 2.0

S = [
 ("B1 Donchian 20/10 breakout long", 1, donchian_long(20, 10), "Trend followers pile in late; breakouts in uptrends extend (herding, slow information)."),
 ("B2 Donchian 55/20 breakout long", 1, donchian_long(55, 20), "Same as B1, slower; fewer false breaks."),
 ("B3 EMA20 pullback long",          1, ema_pullback_long,     "Dip buyers in uptrends; weak hands sell the pullback to trend holders."),
 ("B4 RSI 40 pullback long",         1, rsi_pullback_long,     "Buy short-term oversold inside a long-term uptrend."),
 ("B5 30-day momentum long",         1, tsmom_long,            "Time-series momentum: documented across assets; paid by late reactors."),
 ("F1 Bollinger 20/2 reversion",     0, boll_revert,           "In ranges, liquidity providers get paid for absorbing overshoots."),
 ("F2 RSI 30/70 reversion",          0, rsi_revert,            "Same idea as F1 with a momentum oscillator."),
 ("F3 30-bar range fade",            0, range_fade,            "Buy range floor, sell range ceiling while ADX<20."),
 ("R1 Donchian 20/10 breakdown short",-1, donchian_short(20, 10), "Forced sellers (liquidations, stops) push breakdowns further."),
 ("R2 Donchian 55/20 breakdown short",-1, donchian_short(55, 20), "Slower version of R1."),
 ("R3 RSI 60 rally-fade short",      -1, rally_fade_short,     "Rallies in downtrends are sold by trapped longs exiting at breakeven."),
 ("R4 EMA20 rejection short",        -1, ema_breakdown_short,  "Short failed rallies to the falling EMA20."),
 ("R5 30-day momentum short",        -1, tsmom_short,          "Time-series momentum on the short side."),
]
STRATS = [dict(name=n, regime=r, fn=f, why=w) for n, r, f, w in S]
