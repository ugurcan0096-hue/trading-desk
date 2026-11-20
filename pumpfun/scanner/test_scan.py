"""End-to-end scanner flow with fake API/RPC (no network)."""
import csv
import os
import tempfile
import time
import unittest
from pathlib import Path

import scan
from filters import INITIAL_REAL_TOKEN_RESERVES

SUPPLY = 1_000_000_000 * 10**6


def coin(mint, curve_pct, age_min=10):
    real = int(INITIAL_REAL_TOKEN_RESERVES * (1 - curve_pct / 100))
    return {"mint": mint, "symbol": mint.upper(), "name": mint, "creator": "DEV_" + mint,
            "bonding_curve": "BC_" + mint, "associated_bonding_curve": "ABC_" + mint,
            "market_cap_usd": 20000.0, "virtual_token_reserves": None, "real_token_reserves": real,
            "complete": False, "created_ts": time.time() - age_min * 60}


class FakeAPI:
    def __init__(self, coins): self.coins = coins
    def latest(self, limit=50): return list(self.coins)
    def coin(self, mint): return next((c for c in self.coins if c["mint"] == mint), None)


class FakeRPC:
    """holders: mint -> list of % for top wallets; dev % and block-0 buyers per mint."""
    def __init__(self, holders, dev, block0):
        self.holders, self.dev, self.block0 = holders, dev, block0
    def token_supply(self, mint): return SUPPLY
    def largest_accounts(self, mint):
        acc = {"ABC_" + mint: SUPPLY // 2}
        acc.update({f"ta{i}_{mint}": int(SUPPLY * p / 100) for i, p in enumerate(self.holders[mint])})
        return acc
    def owners(self, accts): return {a: ("BC_" + a[4:] if a.startswith("ABC_") else "w_" + a) for a in accts}
    def balance_of(self, owner, mint): return int(SUPPLY * self.dev[mint] / 100)
    def launch_slot_txs(self, addr):
        m = addr[3:]
        return [(1, "DEV_" + m)] + [(1, f"b{i}") for i in range(self.block0[m])] + [(2, "late")]


class ScanFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ.update({"HELIUS_API_KEY": "x", "LOG_FILE": str(Path(self.tmp.name) / "t.csv"),
                           "QUIET_START_HOUR": "", "QUIET_END_HOUR": "", "TELEGRAM_BOT_TOKEN": ""})
        self.s = scan.Scanner(dry_run=True)

    def tearDown(self):
        self.tmp.cleanup()

    def rows(self):
        with self.s.csv_path.open() as f:
            return {r["mint"]: r for r in csv.DictReader(f)}

    def test_flow(self):
        self.s.api = FakeAPI([coin("good", 40), coin("whale", 40), coin("bundle", 40),
                              coin("early", 5), coin("done", 99)])
        self.s.rpc = FakeRPC(holders={"good": [3, 3, 2], "whale": [20, 10], "bundle": [3]},
                             dev={"good": 1, "whale": 1, "bundle": 1},
                             block0={"good": 1, "whale": 0, "bundle": 6})
        self.s.poll()
        r = self.rows()
        self.assertEqual(r["good"]["result"], "PASS")
        self.assertEqual(r["good"]["top10_pct"], "8.0")  # curve account excluded
        self.assertEqual(r["good"]["block0_buyers"], "1")
        self.assertIn("top10", r["whale"]["reason"])
        self.assertIn("block-0", r["bundle"]["reason"])
        self.assertIn("> 80%", r["done"]["reason"])
        self.assertNotIn("early", r)            # still watching
        self.assertIn("early", self.s.watch)

        # Early token grows into the window: gets checked and passes.
        self.s.api.coins = [coin("early", 30)]
        self.s.rpc.holders["early"], self.s.rpc.dev["early"], self.s.rpc.block0["early"] = [5], 0, 0
        self.s.poll()
        self.assertEqual(self.rows()["early"]["result"], "PASS")

        # Nothing is checked twice.
        n = len(self.rows())
        self.s.poll()
        self.assertEqual(len(self.rows()), n)


if __name__ == "__main__":
    unittest.main()
