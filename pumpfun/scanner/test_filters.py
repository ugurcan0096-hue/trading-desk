import unittest

from filters import (INITIAL_REAL_TOKEN_RESERVES, VIRTUAL_MINUS_REAL, Rules, TokenSnapshot,
                     count_block0_buyers, curve_progress, evaluate, in_quiet_hours,
                     is_curve_too_low_only, prefilter, top_holders_pct)

R = Rules()


def good(**kw):
    base = dict(mint="M", symbol="TST", creator="DEV", curve_pct=50.0, age_hours=0.5,
                top10_pct=18.0, dev_pct=2.0, block0_buyers=1, top_holder_wallets=["A", "B"])
    base.update(kw)
    return TokenSnapshot(**base)


class CurveTest(unittest.TestCase):
    def test_fresh_curve_is_zero(self):
        self.assertEqual(curve_progress(real_token_reserves=INITIAL_REAL_TOKEN_RESERVES), 0.0)

    def test_half_sold(self):
        self.assertEqual(curve_progress(real_token_reserves=INITIAL_REAL_TOKEN_RESERVES // 2), 50.0)

    def test_from_virtual_reserves(self):
        v = INITIAL_REAL_TOKEN_RESERVES // 4 + VIRTUAL_MINUS_REAL
        self.assertEqual(curve_progress(virtual_token_reserves=v), 75.0)

    def test_complete_is_100(self):
        self.assertEqual(curve_progress(real_token_reserves=123, complete=True), 100.0)

    def test_unknown(self):
        self.assertIsNone(curve_progress())

    def test_clamped(self):
        self.assertEqual(curve_progress(real_token_reserves=-5), 100.0)


class HoldersTest(unittest.TestCase):
    def test_excludes_curve_account(self):
        bal = {"CURVE": 700, "a": 50, "b": 30, "c": 20}
        self.assertEqual(top_holders_pct(bal, 1000, exclude={"CURVE"}), 10.0)

    def test_only_top_n(self):
        bal = {str(i): 10 for i in range(20)}
        self.assertEqual(top_holders_pct(bal, 1000, n=10), 10.0)

    def test_zero_supply(self):
        self.assertIsNone(top_holders_pct({"a": 1}, 0))


class Block0Test(unittest.TestCase):
    def test_counts_distinct_wallets_in_first_slot_excluding_dev(self):
        txs = [(100, "DEV"), (100, "x"), (100, "y"), (100, "y"), (101, "z")]
        self.assertEqual(count_block0_buyers(txs, "DEV"), 2)

    def test_empty(self):
        self.assertEqual(count_block0_buyers([], "DEV"), 0)


class QuietHoursTest(unittest.TestCase):
    def test_simple_window(self):
        self.assertTrue(in_quiet_hours(3, 1, 8))
        self.assertFalse(in_quiet_hours(8, 1, 8))
        self.assertFalse(in_quiet_hours(0, 1, 8))

    def test_wraps_midnight(self):
        self.assertTrue(in_quiet_hours(23, 23, 7))
        self.assertTrue(in_quiet_hours(2, 23, 7))
        self.assertFalse(in_quiet_hours(12, 23, 7))

    def test_disabled(self):
        self.assertFalse(in_quiet_hours(3, None, None))


class EvaluateTest(unittest.TestCase):
    def test_good_token_passes(self):
        v = evaluate(good(), R)
        self.assertTrue(v.passed, v.reasons)
        self.assertEqual(v.reason_text, "ok")

    def test_top10_limit_is_strict(self):
        self.assertFalse(evaluate(good(top10_pct=25.0), R).passed)
        self.assertTrue(evaluate(good(top10_pct=24.9), R).passed)

    def test_dev_limit(self):
        v = evaluate(good(dev_pct=5.0), R)
        self.assertFalse(v.passed)
        self.assertIn("dev", v.reason_text)

    def test_block0_limit(self):
        self.assertTrue(evaluate(good(block0_buyers=3), R).passed)
        self.assertFalse(evaluate(good(block0_buyers=4), R).passed)

    def test_curve_window(self):
        self.assertFalse(evaluate(good(curve_pct=14.9), R).passed)
        self.assertTrue(evaluate(good(curve_pct=15.0), R).passed)
        self.assertTrue(evaluate(good(curve_pct=80.0), R).passed)
        self.assertFalse(evaluate(good(curve_pct=80.1), R).passed)

    def test_too_old(self):
        self.assertFalse(evaluate(good(age_hours=7), R).passed)

    def test_unknown_data_fails(self):
        v = evaluate(good(top10_pct=None, dev_pct=None, block0_buyers=None), R)
        self.assertFalse(v.passed)
        self.assertEqual(len(v.reasons), 3)

    def test_known_bad_dev_and_holder(self):
        v = evaluate(good(top_holder_wallets=["A", "RUG"]), R, known_bad={"RUG", "DEV"})
        self.assertFalse(v.passed)
        self.assertEqual(len(v.reasons), 2)

    def test_reports_every_failure(self):
        v = evaluate(good(top10_pct=40, dev_pct=9, block0_buyers=7), R)
        self.assertEqual(len(v.reasons), 3)

    def test_custom_rules(self):
        self.assertTrue(evaluate(good(top10_pct=28), Rules(max_top10_pct=30)).passed)


class PrefilterTest(unittest.TestCase):
    def test_early_token_goes_to_watch(self):
        v = prefilter(good(curve_pct=5), R)
        self.assertFalse(v.passed)
        self.assertTrue(is_curve_too_low_only(v))

    def test_late_token_is_final(self):
        self.assertFalse(is_curve_too_low_only(prefilter(good(curve_pct=95), R)))

    def test_early_and_old_is_final(self):
        self.assertFalse(is_curve_too_low_only(prefilter(good(curve_pct=5, age_hours=9), R)))


if __name__ == "__main__":
    unittest.main()
