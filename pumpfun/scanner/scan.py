"""Read-only pump.fun scanner.

Polls new tokens, checks holders on-chain, pings Telegram on the few that pass
your rules, logs every decision to tokens.csv. No wallet. No signing. No trades.

    python scan.py            # run forever
    python scan.py --once     # one poll, then exit
    python scan.py --dry-run  # print alerts instead of sending them
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from filters import (Rules, TokenSnapshot, count_block0_buyers, curve_progress, evaluate,
                     in_quiet_hours, is_curve_too_low_only, prefilter, top_holders_pct)
from notify import alert_text, send_telegram
from sources import PumpFunAPI, SolanaRPC

HERE = Path(__file__).resolve().parent
CSV_FIELDS = ["time", "mint", "symbol", "name", "mcap_usd", "curve_pct", "top10_pct", "dev_pct",
              "block0_buyers", "age_min", "result", "reason"]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def env_float(k, d):
    v = os.environ.get(k, "").strip()
    return float(v) if v else d


def env_int_or_none(k):
    v = os.environ.get(k, "").strip()
    return int(v) if v else None


def load_known_bad(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out = set()
    for line in path.read_text().splitlines():
        w = line.split(",")[0].strip()
        if w and not w.startswith("#") and w.lower() != "wallet":
            out.add(w)
    return out


def snapshot_from_coin(c: dict, now: float) -> TokenSnapshot:
    return TokenSnapshot(
        mint=c["mint"], symbol=c["symbol"], name=c["name"], creator=c["creator"],
        market_cap_usd=c["market_cap_usd"],
        curve_pct=curve_progress(c["virtual_token_reserves"], c["real_token_reserves"], c["complete"]),
        age_hours=(now - c["created_ts"]) / 3600 if c["created_ts"] else None,
    )


def enrich(t: TokenSnapshot, c: dict, rpc: SolanaRPC) -> None:
    """Fill holder data from chain. Any failure leaves the field None (= fail)."""
    try:
        supply = rpc.token_supply(t.mint)
        accounts = rpc.largest_accounts(t.mint)
        owners = rpc.owners(list(accounts))
        exclude = {a for a, o in owners.items() if o == c["bonding_curve"]}
        if c["associated_bonding_curve"]:
            exclude.add(c["associated_bonding_curve"])
        t.top10_pct = top_holders_pct(accounts, supply, exclude)
        ranked = sorted((a for a in accounts if a not in exclude), key=accounts.get, reverse=True)[:10]
        t.top_holder_wallets = [owners[a] for a in ranked if a in owners]
        if t.creator:
            t.dev_pct = round(100.0 * rpc.balance_of(t.creator, t.mint) / supply, 2)
    except Exception as e:  # noqa: BLE001
        print(f"  holders failed for {t.symbol}: {e}", file=sys.stderr)
    try:
        if c["bonding_curve"]:
            txs = rpc.launch_slot_txs(c["bonding_curve"])
            t.block0_buyers = None if txs is None else count_block0_buyers(txs, t.creator)
    except Exception as e:  # noqa: BLE001
        print(f"  block-0 check failed for {t.symbol}: {e}", file=sys.stderr)


class Scanner:
    def __init__(self, dry_run: bool = False):
        self.rules = Rules(
            max_top10_pct=env_float("MAX_TOP10_PCT", 25),
            max_dev_pct=env_float("MAX_DEV_PCT", 5),
            max_block0_buyers=int(env_float("MAX_BLOCK0_BUYERS", 3)),
            min_curve_pct=env_float("MIN_CURVE_PCT", 15),
            max_curve_pct=env_float("MAX_CURVE_PCT", 80),
            max_age_hours=env_float("MAX_AGE_HOURS", 6),
        )
        self.api = PumpFunAPI(os.environ.get("PUMPFUN_API", "https://frontend-api-v3.pump.fun"))
        key = os.environ.get("HELIUS_API_KEY", "").strip()
        rpc_url = os.environ.get("SOLANA_RPC_URL", "").strip() or (
            f"https://mainnet.helius-rpc.com/?api-key={key}" if key else "")
        if not rpc_url:
            sys.exit("Set HELIUS_API_KEY (or SOLANA_RPC_URL) in .env")
        self.rpc = SolanaRPC(rpc_url)
        self.tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        self.tg_chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        self.dry_run = dry_run or not (self.tg_token and self.tg_chat)
        if self.dry_run and not dry_run:
            print("Telegram not configured: alerts are printed only.")
        self.quiet = (env_int_or_none("QUIET_START_HOUR"), env_int_or_none("QUIET_END_HOUR"))
        self.watch_minutes = env_float("WATCH_MINUTES", 30)
        self.watch_max = int(env_float("WATCH_MAX", 40))
        self.known_bad = load_known_bad(HERE / os.environ.get("KNOWN_BAD_FILE", "known_wallets.csv"))
        self.csv_path = HERE / os.environ.get("LOG_FILE", "tokens.csv")
        self.done: set[str] = self._load_done()
        self.watch: dict[str, float] = {}  # mint -> first seen

    def _load_done(self) -> set[str]:
        if not self.csv_path.exists():
            with self.csv_path.open("w", newline="") as f:
                csv.writer(f).writerow(CSV_FIELDS)
            return set()
        with self.csv_path.open(newline="") as f:
            return {r["mint"] for r in csv.DictReader(f) if r.get("mint")}

    def log(self, t: TokenSnapshot, result: str, reason: str) -> None:
        r2 = lambda v: "" if v is None else round(v, 2)  # noqa: E731
        with self.csv_path.open("a", newline="") as f:
            csv.writer(f).writerow([
                datetime.now().isoformat(timespec="seconds"), t.mint, t.symbol, t.name,
                r2(t.market_cap_usd), r2(t.curve_pct), r2(t.top10_pct), r2(t.dev_pct),
                "" if t.block0_buyers is None else t.block0_buyers,
                "" if t.age_hours is None else round(t.age_hours * 60), result, reason])
        self.done.add(t.mint)
        self.watch.pop(t.mint, None)

    def candidates(self, now: float) -> list[dict]:
        coins = {c["mint"]: c for c in self.api.latest(50) if c["mint"] not in self.done}
        # Re-check early tokens we are watching but that fell off the "latest" page.
        for mint in [m for m in self.watch if m not in coins][: self.watch_max]:
            try:
                c = self.api.coin(mint)
                if c:
                    coins[mint] = c
            except Exception:  # noqa: BLE001
                pass
        return list(coins.values())

    def handle(self, c: dict, now: float) -> None:
        t = snapshot_from_coin(c, now)
        pre = prefilter(t, self.rules)
        if not pre.passed:
            if is_curve_too_low_only(pre):
                first = self.watch.setdefault(t.mint, now)
                if now - first <= self.watch_minutes * 60:
                    return  # still early, look again next poll
                self.log(t, "FAIL", pre.reason_text + f" (after {self.watch_minutes:.0f} min)")
            else:
                self.log(t, "FAIL", pre.reason_text)
            return
        enrich(t, c, self.rpc)
        v = evaluate(t, self.rules, self.known_bad)
        if not v.passed:
            self.log(t, "FAIL", v.reason_text)
            print(f"  ✗ {t.symbol:<10} {v.reason_text}")
            return
        if in_quiet_hours(datetime.now().hour, *self.quiet):
            self.log(t, "PASS_QUIET", "passed, quiet hours: no alert")
            print(f"  ✓ {t.symbol:<10} passed (quiet hours, not sent)")
            return
        self.log(t, "PASS", "ok")
        print(f"  ✓ {t.symbol:<10} PASSED")
        text = alert_text(t)
        if self.dry_run:
            print(text + "\n")
        else:
            try:
                send_telegram(self.tg_token, self.tg_chat, text)
            except Exception as e:  # noqa: BLE001
                print(f"  telegram failed: {e}", file=sys.stderr)

    def poll(self) -> None:
        now = time.time()
        try:
            coins = self.candidates(now)
        except Exception as e:  # noqa: BLE001
            print(f"pump.fun API failed: {e}", file=sys.stderr)
            return
        print(f"[{datetime.now():%H:%M:%S}] {len(coins)} to check, {len(self.watch)} on watch")
        for c in coins:
            self.handle(c, now)
        cutoff = now - self.watch_minutes * 60 * 2
        self.watch = {m: ts for m, ts in self.watch.items() if ts >= cutoff}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    load_env(HERE / ".env")
    s = Scanner(dry_run=args.dry_run)
    interval = env_float("POLL_SECONDS", 15)
    print(f"Read-only scanner. Rules: {s.rules}. Poll every {interval:.0f}s. Ctrl+C to stop.")
    while True:
        s.poll()
        if args.once:
            break
        time.sleep(interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped")
