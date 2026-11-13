# Memecoin bot (Solana) — read before using real money

**Status:** built and tested offline only. Not yet run against live DexScreener / Jupiter / Solana.
**Strategy:** unproven. It did not pass the lab's 4 gates — there was no history to test it on.
Assume you can lose the whole $13.

## What it does every 20 seconds
1. Checks open positions using a real Jupiter sell quote: sells at **+25%**, **−12%**, or after **2 hours**.
2. Scans new Solana tokens from DexScreener. It only buys when **all** of these are true:
   liquidity ≥ $20k, 24h volume ≥ $50k, pair ≥ 6h old, 1h change +5% to +40%, 5m change positive,
   buyers > 1.2× sellers, mint & freeze authority revoked, and a buy-then-sell quote returns ≥ 95% with < 3% price impact.
3. **Sentinel** checks every order: STOP file, halted, stale data, 1 position max, 10 trades/day, 2h cooldown per token,
   keeps 0.02 SOL for fees. It **halts and sells everything** at −15% from peak or 3 losses in a row, and messages you.

Size: $4 per trade, one at a time. Costs per round trip are roughly 1–5% (pool fee, slippage, priority fee),
plus ~0.002 SOL rent for each new token account (returned only if the account is closed).

## Run it on your Android phone (Termux)
```
pkg install python git
pip install pynacl
git clone https://github.com/ugurcan0096-hue/trading-desk && cd trading-desk/bot
termux-wake-lock          # keep running with the screen off
python3 memebot.py        # DRY-RUN: fake $13, real prices. Run this for a few days first.
```

## Go live (your decision)
1. Make a **new** wallet in Phantom. Send it your $13 in SOL. Never use your main wallet.
2. Phantom → Settings → Manage accounts → this account → Show private key. Copy it.
3. `export SOLANA_PRIVATE_KEY=<paste>` — only on your phone. **Never** put it in the repo, a chat, or GitHub.
4. `mv state.json state-dry.json; LIVE=1 python3 memebot.py`

Stop: `touch STOP` (it exits; open positions are not sold), or Ctrl+C.
Resume after a halt: open `state.json`, set `"halted": null`.
Telegram messages: `export TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...`
Settings: every number above is an env var at the top of `memebot.py` (e.g. `POS_USD=3`).
