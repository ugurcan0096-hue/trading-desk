"""Read-only data sources: pump.fun public API + Solana RPC (Helius).

No wallet, no signing, no transactions are ever sent. Only GET/`get*` RPC calls.
"""
from __future__ import annotations

import json
import time
import urllib.request
from typing import Any

UA = "Mozilla/5.0 (read-only token scanner)"


def http_json(url: str, payload: Any = None, timeout: float = 15.0) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": UA, "Accept": "application/json",
        "Origin": "https://pump.fun", "Referer": "https://pump.fun/",
        **({"Content-Type": "application/json"} if data else {}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize_coin(c: dict) -> dict:
    """Map a pump.fun coin object to the fields the scanner uses."""
    created = _num(c.get("created_timestamp")) or 0
    if created > 1e12:  # milliseconds
        created /= 1000
    return {
        "mint": c.get("mint", ""),
        "symbol": c.get("symbol", ""),
        "name": c.get("name", ""),
        "creator": c.get("creator", ""),
        "bonding_curve": c.get("bonding_curve", ""),
        "associated_bonding_curve": c.get("associated_bonding_curve", ""),
        "market_cap_usd": _num(c.get("usd_market_cap")),
        "virtual_token_reserves": _num(c.get("virtual_token_reserves")),
        "real_token_reserves": _num(c.get("real_token_reserves")),
        "complete": bool(c.get("complete")),
        "created_ts": created,
    }


class PumpFunAPI:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def latest(self, limit: int = 50) -> list[dict]:
        url = (f"{self.base}/coins?offset=0&limit={limit}"
               "&sort=created_timestamp&order=DESC&includeNsfw=false")
        data = http_json(url)
        if isinstance(data, dict):
            data = data.get("coins") or data.get("data") or []
        return [normalize_coin(c) for c in data if isinstance(c, dict) and c.get("mint")]

    def coin(self, mint: str) -> dict | None:
        data = http_json(f"{self.base}/coins/{mint}")
        return normalize_coin(data) if isinstance(data, dict) and data.get("mint") else None


class SolanaRPC:
    """Minimal JSON-RPC client. Only read methods."""

    def __init__(self, url: str, min_interval: float = 0.05):
        self.url = url
        self.min_interval = min_interval
        self._last = 0.0
        self._id = 0

    def call(self, method: str, params: list) -> Any:
        if not method.startswith("get"):
            raise ValueError("read-only client: only get* methods are allowed")
        wait = self.min_interval - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        self._id += 1
        res = http_json(self.url, {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        if "error" in res:
            raise RuntimeError(f"{method}: {res['error']}")
        return res.get("result")

    def token_supply(self, mint: str) -> int:
        return int(self.call("getTokenSupply", [mint])["value"]["amount"])

    def largest_accounts(self, mint: str) -> dict[str, int]:
        """token account address -> raw amount (top 20)."""
        r = self.call("getTokenLargestAccounts", [mint])
        return {a["address"]: int(a["amount"]) for a in r["value"]}

    def owners(self, token_accounts: list[str]) -> dict[str, str]:
        """token account -> owner wallet."""
        if not token_accounts:
            return {}
        r = self.call("getMultipleAccounts", [token_accounts, {"encoding": "jsonParsed"}])
        out = {}
        for addr, acc in zip(token_accounts, r["value"]):
            try:
                out[addr] = acc["data"]["parsed"]["info"]["owner"]
            except (TypeError, KeyError):
                pass
        return out

    def balance_of(self, owner: str, mint: str) -> int:
        r = self.call("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
        return sum(int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in r["value"])

    def launch_slot_txs(self, address: str, max_pages: int = 4, max_fetch: int = 25) -> list[tuple[int, str]] | None:
        """(slot, fee payer) for every transaction in the address's first slot.
        Returns None if history is too long to reach the launch."""
        sigs: list[dict] = []
        before = None
        for _ in range(max_pages):
            opts = {"limit": 1000, **({"before": before} if before else {})}
            page = self.call("getSignaturesForAddress", [address, opts])
            sigs.extend(page)
            if len(page) < 1000:
                break
            before = page[-1]["signature"]
        else:
            return None
        if not sigs:
            return []
        first = min(s["slot"] for s in sigs)
        launch = [s for s in sigs if s["slot"] == first]
        out = []
        for s in launch[:max_fetch]:
            tx = self.call("getTransaction", [s["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 0}])
            try:
                out.append((first, tx["transaction"]["message"]["accountKeys"][0]))
            except (TypeError, KeyError, IndexError):
                out.append((first, s["signature"]))  # unknown payer: count it anyway
        # More launch-slot txs than we fetched: count them as separate buyers (worst case).
        out.extend((first, s["signature"]) for s in launch[max_fetch:])
        return out
