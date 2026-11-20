"""Pure filter logic for the pump.fun scanner. No network, no wallet.

Everything here is a plain function so it can be tested without an API key.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# pump.fun bonding curve constants (raw units, 6 decimals).
TOKEN_DECIMALS = 6
INITIAL_REAL_TOKEN_RESERVES = 793_100_000 * 10**TOKEN_DECIMALS
# virtual_token_reserves - real_token_reserves is constant on the curve.
VIRTUAL_MINUS_REAL = 279_900_000 * 10**TOKEN_DECIMALS


@dataclass(frozen=True)
class Rules:
    max_top10_pct: float = 25.0
    max_dev_pct: float = 5.0
    max_block0_buyers: int = 3
    min_curve_pct: float = 15.0
    max_curve_pct: float = 80.0
    max_age_hours: float = 6.0


@dataclass
class TokenSnapshot:
    mint: str
    symbol: str = ""
    name: str = ""
    creator: str = ""
    market_cap_usd: float | None = None
    curve_pct: float | None = None
    age_hours: float | None = None
    top10_pct: float | None = None
    dev_pct: float | None = None
    block0_buyers: int | None = None
    top_holder_wallets: list[str] = field(default_factory=list)


@dataclass
class Verdict:
    passed: bool
    reasons: list[str]

    @property
    def reason_text(self) -> str:
        return "; ".join(self.reasons) if self.reasons else "ok"


def curve_progress(virtual_token_reserves: int | None = None,
                   real_token_reserves: int | None = None,
                   complete: bool = False) -> float | None:
    """Bonding curve progress in percent (0 = just launched, 100 = graduated)."""
    if complete:
        return 100.0
    if real_token_reserves is None:
        if virtual_token_reserves is None:
            return None
        real_token_reserves = int(virtual_token_reserves) - VIRTUAL_MINUS_REAL
    pct = 100.0 * (1.0 - int(real_token_reserves) / INITIAL_REAL_TOKEN_RESERVES)
    return round(min(100.0, max(0.0, pct)), 2)


def top_holders_pct(balances: dict[str, int], supply: int,
                    exclude: set[str] | frozenset[str] = frozenset(), n: int = 10) -> float | None:
    """Share of supply held by the n largest holders, ignoring excluded accounts
    (the bonding curve's token account, LP)."""
    if not supply or supply <= 0:
        return None
    amounts = sorted((int(a) for k, a in balances.items() if k not in exclude), reverse=True)
    return round(100.0 * sum(amounts[:n]) / supply, 2)


def count_block0_buyers(txs: list[tuple[int, str]], creator: str = "") -> int:
    """txs: (slot, fee payer) for the curve's transactions.
    Counts distinct wallets, other than the dev, that traded in the launch slot."""
    if not txs:
        return 0
    first_slot = min(slot for slot, _ in txs)
    return len({w for slot, w in txs if slot == first_slot and w and w != creator})


def in_quiet_hours(hour: int, start: int | None, end: int | None) -> bool:
    """True if `hour` is inside [start, end). Wraps past midnight (e.g. 1 -> 8, 23 -> 7)."""
    if start is None or end is None or start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def prefilter(t: TokenSnapshot, rules: Rules) -> Verdict:
    """Cheap checks that need no RPC calls. Run first to save credits."""
    reasons: list[str] = []
    if t.curve_pct is None:
        reasons.append("curve unknown")
    elif t.curve_pct < rules.min_curve_pct:
        reasons.append(f"curve {t.curve_pct:.0f}% < {rules.min_curve_pct:.0f}%")
    elif t.curve_pct > rules.max_curve_pct:
        reasons.append(f"curve {t.curve_pct:.0f}% > {rules.max_curve_pct:.0f}%")
    if t.age_hours is not None and t.age_hours > rules.max_age_hours:
        reasons.append(f"age {t.age_hours:.1f}h > {rules.max_age_hours:.0f}h")
    return Verdict(not reasons, reasons)


def is_curve_too_low_only(v: Verdict) -> bool:
    """A token that failed only because it is still early: worth re-checking later."""
    return len(v.reasons) == 1 and v.reasons[0].startswith("curve ") and " < " in v.reasons[0]


def evaluate(t: TokenSnapshot, rules: Rules, known_bad: set[str] | frozenset[str] = frozenset()) -> Verdict:
    """Full rule check. Missing data counts as a fail: unknown is not safe."""
    reasons = list(prefilter(t, rules).reasons)

    if t.top10_pct is None:
        reasons.append("top10 unknown")
    elif t.top10_pct >= rules.max_top10_pct:
        reasons.append(f"top10 {t.top10_pct:.1f}% >= {rules.max_top10_pct:.0f}%")

    if t.dev_pct is None:
        reasons.append("dev % unknown")
    elif t.dev_pct >= rules.max_dev_pct:
        reasons.append(f"dev {t.dev_pct:.1f}% >= {rules.max_dev_pct:.0f}%")

    if t.block0_buyers is None:
        reasons.append("block-0 buyers unknown")
    elif t.block0_buyers > rules.max_block0_buyers:
        reasons.append(f"{t.block0_buyers} block-0 buyers > {rules.max_block0_buyers}")

    if t.creator and t.creator in known_bad:
        reasons.append("dev wallet is on known-bad list")
    bad_holders = [w for w in t.top_holder_wallets if w in known_bad and w != t.creator]
    if bad_holders:
        reasons.append(f"{len(bad_holders)} known-bad wallet(s) in top holders")

    return Verdict(not reasons, reasons)
