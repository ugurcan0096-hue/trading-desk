"""EMA20/50 flip strategy on Hyperliquid BTC perp, 4h. Signals on closed bar, fill at NEXT bar open.
Costs: taker fee per side (assumption, see FEE), hourly funding from Hyperliquid fundingHistory."""
import json, os, numpy as np, pandas as pd
D = os.path.join(os.path.dirname(__file__), "data")
FEE = 0.00045      # ESTIMATE: Hyperliquid base-tier taker fee 0.045% (not fetched from API)
SLIP = 0.0001      # ESTIMATE: 1 bp slippage per side on BTC
MIN_NOTIONAL = 10.0  # Hyperliquid minimum order value (USD), per their docs - ESTIMATE

def load():
    c = json.load(open(f"{D}/BTC_4h.json"))
    df = pd.DataFrame(c["rows"])
    df = df.assign(t=pd.to_datetime(df.t, unit="ms", utc=True))[["t","o","h","l","c"]]
    df[["o","h","l","c"]] = df[["o","h","l","c"]].astype(float)
    df = df.set_index("t")
    f = pd.DataFrame(json.load(open(f"{D}/BTC_funding.json"))["rows"])
    f = pd.Series(f.fundingRate.astype(float).values, index=pd.to_datetime(f.time, unit="ms", utc=True))
    # sum hourly funding into the 4h bar it falls in
    fb = f.groupby(f.index.floor("4h")).sum().reindex(df.index).fillna(0.0)
    df["fund"] = fb.values
    return df, c["source"], c["fetched_at_utc"]

def run(df, start, fast=20, slow=50, cap=1000.0, lev=2.0, frac=0.95, fee=FEE, slip=SLIP, opens=None):
    """opens: optional override price series (for permutation tests)."""
    o, h, l, c, fund = (df[k].values for k in ("o","h","l","c","fund"))
    ef = pd.Series(c).ewm(span=fast, adjust=False).mean().values
    es = pd.Series(c).ewm(span=slow, adjust=False).mean().values
    sig = np.sign(ef - es)
    i0 = int(np.searchsorted(df.index.values, np.datetime64(start.tz_convert(None))))
    cash, pos, entry, ent_eq = cap, 0.0, 0.0, cap   # pos in BTC (signed)
    eq_curve, trades, fees_tot, fund_tot, liq, skipped = [], [], 0.0, 0.0, 0, 0
    for i in range(i0, len(df)):
        # 1) execute pending signal at this bar's open (signal from bar i-1 close)
        cross = sig[i-1] != sig[i-2] and sig[i-1] != 0 and i-1 >= i0
        if cross:
            px = o[i]
            if pos != 0:  # close
                fill = px * (1 - slip*np.sign(pos))
                pnl = pos * (fill - entry); f_ = abs(pos)*fill*fee
                cash += pnl - f_; fees_tot += f_
                trades.append(cash - ent_eq)
                pos = 0.0
            notional = cash * frac * lev
            if notional >= MIN_NOTIONAL and cash > 0:
                side = sig[i-1]; fill = px * (1 + slip*side)
                f_ = notional*fee; cash -= f_; fees_tot += f_
                ent_eq = cash + f_   # equity before entry fee, so trade P&L includes both fees
                pos = side * notional / fill; entry = fill
            else:
                skipped += 1
        # 2) funding during bar (longs pay positive rate)
        if pos != 0:
            fp = pos * o[i] * fund[i]; cash -= fp; fund_tot += fp
            # 3) liquidation check (maint margin ~1.25% for BTC) on intrabar extreme
            worst = l[i] if pos > 0 else h[i]
            if cash + pos*(worst-entry) <= abs(pos)*worst*0.0125:
                liq += 1; cash = abs(pos)*worst*0.0125*0; trades.append(cash-ent_eq); pos = 0.0
        eq_curve.append(cash + pos*(c[i]-entry))
    eq = pd.Series(eq_curve, index=df.index[i0:])
    return dict(eq=eq, trades=np.array(trades), fees=fees_tot, funding=fund_tot, liq=liq,
                open_pos=pos, skipped=skipped)

def stats(r, cap):
    eq, tr = r["eq"], r["trades"]
    rets = eq.pct_change().dropna()
    dd = (eq/eq.cummax()-1).min()
    wins, losses = tr[tr>0], tr[tr<=0]
    pf = wins.sum()/-losses.sum() if losses.sum()<0 else np.inf
    sh = rets.mean()/rets.std()*np.sqrt(6*365) if rets.std()>0 else 0
    streak = m = 0
    for x in tr:
        streak = streak+1 if x<=0 else 0; m = max(m, streak)
    monthly = eq.resample("ME").last().pct_change()
    monthly.iloc[0] = eq.resample("ME").last().iloc[0]/cap-1
    return dict(total_return=eq.iloc[-1]/cap-1, max_dd=dd, win_rate=len(wins)/max(len(tr),1),
                sharpe=sh, profit_factor=pf, closed_trades=len(tr), fees=r["fees"], funding=r["funding"],
                liquidations=r["liq"], longest_losing_streak=m, worst_month=monthly.min(),
                worst_month_when=str(monthly.idxmin().date()), final_equity=eq.iloc[-1],
                open_position_btc=r["open_pos"], skipped_min_notional=r["skipped"])
