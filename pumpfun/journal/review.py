"""Weekly journal review (Part 8). Numbers first, then paste the output + CSV into Claude.

    python review.py trades.csv
    python review.py trades.csv --since 2026-11-14
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import datetime

STOP = 0.35  # -35% stop: 1R = 35% of size


def load(path: str, since: str | None = None) -> list[dict]:
    out = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                r["_t"] = datetime.fromisoformat(r["time"])
                r["_pnl"] = float(r["pnl_sol"])
                r["_size"] = float(r["size_sol"])
            except (KeyError, ValueError):
                continue
            if since and r["_t"] < datetime.fromisoformat(since):
                continue
            r["_r"] = r["_pnl"] / (r["_size"] * STOP) if r["_size"] else 0.0
            out.append(r)
    return out


def hour_bucket(h: int) -> str:
    if h < 6:
        return "00-06 (night)"
    if h < 12:
        return "06-12"
    if h < 18:
        return "12-18"
    return "18-24"


def group_stats(trades, key) -> list[tuple[str, int, float, float, float]]:
    g = defaultdict(list)
    for t in trades:
        g[key(t)].append(t)
    rows = []
    for k, ts in sorted(g.items()):
        wins = sum(1 for t in ts if t["_pnl"] > 0)
        rows.append((k, len(ts), 100 * wins / len(ts), sum(t["_r"] for t in ts) / len(ts),
                     sum(t["_pnl"] for t in ts)))
    return rows


def report(trades: list[dict]) -> str:
    if not trades:
        return "No trades."
    L = []
    total = sum(t["_pnl"] for t in trades)
    wins = sum(1 for t in trades if t["_pnl"] > 0)
    L.append(f"{len(trades)} trades | win rate {100 * wins / len(trades):.0f}% | "
             f"avg R {sum(t['_r'] for t in trades) / len(trades):+.2f} | P&L {total:+.3f} SOL\n")
    for title, key in [("Time of day", lambda t: hour_bucket(t["_t"].hour)),
                       ("Curve phase", lambda t: t.get("curve_phase") or "?"),
                       ("Narrative age", lambda t: _age_bucket(t.get("narrative_age_min")))]:
        L.append(title)
        for k, n, wr, r, pnl in group_stats(trades, key):
            L.append(f"  {k:<16} n={n:<3} win {wr:3.0f}%  avg R {r:+.2f}  P&L {pnl:+.3f}")
        L.append("")
    broken = [t for t in trades if (t.get("rule_broken") or "").strip().lower() in ("yes", "y", "1", "true")]
    L.append(f"Rule broken in {len(broken)}/{len(trades)} trades, cost {sum(t['_pnl'] for t in broken):+.3f} SOL")
    by_rule = defaultdict(list)
    for t in broken:
        by_rule[(t.get("rule") or "unnamed").strip()].append(t["_pnl"])
    for rule, p in sorted(by_rule.items(), key=lambda kv: sum(kv[1])):
        L.append(f"  {rule:<20} x{len(p)}  {sum(p):+.3f} SOL")
    L.append("\n3 worst trades")
    for t in sorted(trades, key=lambda t: t["_pnl"])[:3]:
        L.append(f"  {t['time']} {t.get('token', '?'):<10} {t['_pnl']:+.3f} SOL  "
                 f"in: {t.get('reason_in', '')} | out: {t.get('reason_out', '')} | phase {t.get('curve_phase', '?')}")
    return "\n".join(L)


def _age_bucket(v) -> str:
    try:
        m = float(v)
    except (TypeError, ValueError):
        return "?"
    return "<20 min" if m < 20 else "20-40 min" if m <= 40 else "40-120 min" if m <= 120 else ">2 h"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--since")
    a = ap.parse_args()
    print(report(load(a.csv, a.since)))
