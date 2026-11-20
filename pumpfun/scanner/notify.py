"""Telegram alerts. Bot token and chat id come from .env."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request


def fmt(v, suffix="", digits=1):
    return "?" if v is None else f"{v:,.{digits}f}{suffix}"


def alert_text(t) -> str:
    return (
        f"✅ ${t.symbol} — {t.name}\n"
        f"CA: <code>{t.mint}</code>\n"
        f"MCAP: ${fmt(t.market_cap_usd, digits=0)}\n"
        f"Curve: {fmt(t.curve_pct, '%')}  Top10: {fmt(t.top10_pct, '%')}  Dev: {fmt(t.dev_pct, '%')}\n"
        f"Block-0 buyers: {t.block0_buyers if t.block0_buyers is not None else '?'}  "
        f"Age: {fmt((t.age_hours or 0) * 60, ' min', 0)}\n"
        f"https://pump.fun/coin/{t.mint}\n\n"
        "Passed the filter. Now run the AUTOPSY prompt. Claude analyzes, you click."
    )


def send_telegram(token: str, chat_id: str, text: str) -> None:
    data = urllib.parse.urlencode({
        "chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        res = json.loads(r.read().decode())
    if not res.get("ok"):
        raise RuntimeError(f"telegram: {res}")
