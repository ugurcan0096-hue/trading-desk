"""All-day paper bot. Run hourly. Stateless replay from PAPER_START on fresh Hyperliquid data,
so a missed run loses nothing. Paper only: this file has no order-sending code and no keys.
  python3 paper_bot.py            -> update paper/status.json + paper/STATUS.md
  python3 paper_bot.py --brief    -> also write paper/brief.md and send it to Telegram if configured"""
import json, os, sys, time, urllib.request, numpy as np, pandas as pd
from fetch_hl import candles, funding, API
from engine import backtest, metrics, regime
from strategies import STRATS
PAPER_START = pd.Timestamp(os.environ.get("PAPER_START", "2026-11-13 04:00"), tz="UTC")   # first bar the challengers trade
CAPITAL = 13.0
CHAMPION = None                                           # none passed all 4 gates (see lab/REPORT.md)
CHALLENGERS = ["B3 EMA20 pullback long", "B1 Donchian 20/10 breakout long", "B5 30-day momentum long"]
DD_HALT, LOSS_HALT, STALE_MIN = 0.15, 3, 4*60 + 30
MIN_NOTIONAL = 10.0
OUT = os.environ.get("PAPER_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "paper")
RNAME = {1: "BULLISH", 0: "FLAT", -1: "BEARISH", 99: "WARM-UP"}

def data():
    now = int(time.time()*1000)
    start = int((PAPER_START - pd.Timedelta(hours=4*400)).timestamp()*1000)
    cs = candles("BTC", "4h", start, now)
    df = pd.DataFrame(cs); df["t"] = pd.to_datetime(df.t, unit="ms", utc=True)
    df = df.set_index("t")[["o", "h", "l", "c"]].astype(float)
    closed = df[df.index + pd.Timedelta(hours=4) <= pd.Timestamp.now(tz="UTC")]   # only finished bars
    fr = funding("BTC", start, now)
    f = pd.Series([float(x["fundingRate"]) for x in fr], index=pd.to_datetime([x["time"] for x in fr], unit="ms", utc=True))
    closed = closed.assign(fund=f.groupby(f.index.floor("4h")).sum().reindex(closed.index).fillna(0.0).values)
    return closed

def sentinel(log, eq, i0):
    """Earliest bar where a halt rule fired, replayed over the whole paper history so a missed run can't skip one.
    Returns (reason, bar_index) or (None, None)."""
    hits = []
    dd = eq/np.maximum.accumulate(eq) - 1
    k = np.flatnonzero(dd <= -DD_HALT)
    if len(k): hits.append((i0 + int(k[0]), f"drawdown >= {DD_HALT:.0%} from peak"))
    for n in range(LOSS_HALT, len(log)+1):
        if all(t["pnl"] <= 0 for t in log[n-LOSS_HALT:n]):
            hits.append((log[n-1]["exit_i"], f"{LOSS_HALT} losses in a row")); break
    if not hits: return None, None
    b, why = min(hits); return why, b

def run(brief=False):
    os.makedirs(OUT, exist_ok=True)
    sp = os.path.join(OUT, "status.json")
    prev = json.load(open(sp)) if os.path.exists(sp) else {}
    halted = prev.get("halted", {})
    df = data(); idx = df.index
    D = {k: df[k].values for k in ("o", "h", "l", "c", "fund")}
    last_bar = idx[-1]
    stale = (pd.Timestamp.now(tz="UTC") - (last_bar + pd.Timedelta(hours=4))).total_seconds()/60 > STALE_MIN
    reg = regime(D["h"], D["l"], D["c"])
    i0 = int(idx.searchsorted(PAPER_START))
    rows = []
    for name in CHALLENGERS:
        s = next(x for x in STRATS if x["name"] == name)
        i1 = int(idx.searchsorted(pd.Timestamp(halted[name]["bar"])))+1 if name in halted else len(idx)
        if i1 <= i0 + 1:
            r = dict(eq=np.array([CAPITAL]), trades=np.array([]), fees=0, funding=0, exposure=0, log=[], open=None)
        else:
            r = backtest(D, s, i0, i1, cap=CAPITAL, mark_open=True)
        why = None
        if name not in halted:
            why, hb = sentinel(r["log"], r["eq"], i0)
            if why:                       # halt from the bar it fired; replay up to there only
                halted[name] = dict(bar=str(idx[hb]), reason=why)
                r = backtest(D, s, i0, hb+1, cap=CAPITAL, mark_open=False)
            elif stale:
                why = f"stale feed: last closed bar older than {STALE_MIN} min"
        m = metrics(r, CAPITAL) if len(r["eq"]) > 1 else dict(ret=0, dd=0, trades=0, win=0, pf=0)
        fmt = lambda t: {**t, **{k: str(idx[t[k]]) for k in ("entry_i", "exit_i") if k in t}}
        rows.append(dict(name=name, why=s["why"], equity=float(r["eq"][-1]) + (r["open"]["unrealised"] if r["open"] else 0),
                         ret=m["ret"], dd=m["dd"], trades=m["trades"], win=m["win"],
                         open=fmt(r["open"]) if r["open"] else None,
                         live_executable=(r["open"] is None or r["open"]["size"]*D["c"][-1] >= MIN_NOTIONAL),
                         last_trades=[fmt(t) for t in r["log"][-5:]],
                         status=(f"HALTED {halted[name]['bar'][:16]}: {halted[name]['reason']} - needs your review" if name in halted
                                 else ("PAUSED: " + why if why else "running"))))
    st = dict(updated_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), source=API,
              last_closed_bar=str(last_bar), btc_close=float(D["c"][-1]), regime=RNAME[int(reg[-1])],
              regime_bars=[RNAME[int(x)] for x in reg[-6:]], champion=CHAMPION, capital_each=CAPITAL,
              paper_start=str(PAPER_START), halted=halted, challengers=rows)
    json.dump(st, open(sp, "w"), indent=1, default=float)
    md = [f"# Paper lab status — {st['updated_utc']}", "",
          f"BTC perp {st['btc_close']:,.0f} (last closed 4h bar {last_bar}, source Hyperliquid). Regime: **{st['regime']}**.",
          f"Champion: **{CHAMPION or 'none — cash'}**. Challengers trade ${CAPITAL:.0f} of paper money each since {PAPER_START}.", "",
          "| Challenger | Equity | Return | Max DD | Trades | Open | Status |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        o = r["open"]; ot = f"{'long' if o['side']>0 else 'short'} @ {o['entry']:,.0f}, stop {o['stop']:,.0f}" if o else "flat"
        md.append(f"| {r['name']} | ${r['equity']:.2f} | {r['ret']:+.1%} | {r['dd']:+.1%} | {r['trades']} | {ot} | {r['status']} |")
    md += ["", "Note: at $13 with 1% risk, positions are below Hyperliquid's $10 minimum order, so these trades could not be placed live as sized."]
    open(os.path.join(OUT, "STATUS.md"), "w").write("\n".join(md) + "\n")
    if brief: send_brief(st)
    print("\n".join(md))

def send_brief(st):
    lines = [f"Trading lab brief {st['updated_utc'][:10]}",
             f"Regime: {st['regime']} (last 6 bars: {', '.join(st['regime_bars'])}). BTC {st['btc_close']:,.0f}.",
             f"Champion: {st['champion'] or 'none - holding cash'}. Real money: untouched.",
             "Challengers (paper, $13 each):"]
    for r in st["challengers"]:
        lines.append(f"- {r['name']}: ${r['equity']:.2f} ({r['ret']:+.1%}), {r['trades']} trades, {r['status']}")
    txt = "\n".join(lines)
    open(os.path.join(OUT, "brief.md"), "w").write(txt + "\n")
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if tok and chat:
        req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage",
                                     json.dumps({"chat_id": chat, "text": txt}).encode(), {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=20)

if __name__ == "__main__":
    run(brief="--brief" in sys.argv)
