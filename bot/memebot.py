"""Solana memecoin bot: DexScreener scan -> Sentinel checks -> Jupiter swap.

DRY-RUN BY DEFAULT. It only signs and sends real transactions when LIVE=1 is set.
The strategy below is UNPROVEN: it did not go through the lab's 4 gates (no history was available).
Use a NEW wallet that holds only what you can lose. The key is read from an env var, never stored here.

Run:   pkg install python python-cryptography   (Termux on Android; or: pip install pynacl)
       export SOLANA_PRIVATE_KEY=...   # only for LIVE=1 (base58, as exported from Phantom/Solflare)
       python3 memebot.py              # dry-run
       LIVE=1 python3 memebot.py       # real money
Stop:  create a file named STOP next to this script (or Ctrl+C). Halts need you to clear "halted" in state.json.
"""
import base64, json, os, sys, time, urllib.parse, urllib.request

# ---------------- config (env overrides) ----------------
def env(k, d, t=str): return t(os.environ.get(k, d))
LIVE          = env("LIVE", "0") == "1"
POS_USD       = env("POS_USD", "4", float)        # size per trade
MAX_POS       = env("MAX_POS", "1", int)          # open positions at once
GAS_RESERVE   = env("GAS_RESERVE_SOL", "0.02", float)  # never spend below this (fees + token account rent)
SLIPPAGE_BPS  = env("SLIPPAGE_BPS", "300", int)
TAKE_PROFIT   = env("TAKE_PROFIT", "0.25", float)
STOP_LOSS     = env("STOP_LOSS", "0.12", float)
MAX_HOLD_MIN  = env("MAX_HOLD_MIN", "120", float)
LOOP_SEC      = env("LOOP_SEC", "20", float)
MIN_LIQ       = env("MIN_LIQ_USD", "20000", float)
MIN_VOL24     = env("MIN_VOL24_USD", "50000", float)
MIN_AGE_H     = env("MIN_AGE_H", "6", float)
MAX_IMPACT    = env("MAX_IMPACT_PCT", "3", float)
MAX_TRADES_DAY= env("MAX_TRADES_DAY", "10", int)
DD_HALT       = env("DD_HALT", "0.15", float)
LOSS_HALT     = env("LOSS_HALT", "3", int)
STALE_SEC     = env("STALE_SEC", "300", float)
PAPER_USD     = env("PAPER_START_USD", "13", float)
RPC           = env("SOLANA_RPC", "https://api.mainnet-beta.solana.com")
JUP           = env("JUPITER_API", "https://lite-api.jup.ag/swap/v1")
DEX           = env("DEXSCREENER_API", "https://api.dexscreener.com")
SOL  = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "state.json")

# ---------------- base58 ----------------
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58enc(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
def b58dec(s):
    n = 0
    for ch in s: n = n * 58 + B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw

# ---------------- http ----------------
def http(url, body=None, tries=3):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data, {"Content-Type": "application/json", "User-Agent": "memebot/1"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r: return json.load(r)
        except Exception as e:
            err = e; time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url.split('?')[0]}: {err}")

def rpc(method, params):
    r = http(RPC, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in r: raise RuntimeError(f"rpc {method}: {r['error']}")
    return r["result"]

# ---------------- wallet / signing ----------------
class _Signer:
    """Ed25519 via PyNaCl if installed, else the 'cryptography' package (prebuilt in Termux: pkg install python-cryptography)."""
    def __init__(self, seed):
        try:
            from nacl.signing import SigningKey
            k = SigningKey(seed); self.pub_bytes = bytes(k.verify_key); self._sign = lambda m: k.sign(m).signature
        except ImportError:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from cryptography.hazmat.primitives import serialization as ser
            k = Ed25519PrivateKey.from_private_bytes(seed)
            self.pub_bytes = k.public_key().public_bytes(ser.Encoding.Raw, ser.PublicFormat.Raw); self._sign = k.sign
    def sign(self, m): return self._sign(m)

class Wallet:
    def __init__(self, secret_b58):
        raw = b58dec(secret_b58.strip())
        if len(raw) not in (32, 64): raise ValueError("SOLANA_PRIVATE_KEY must be a base58 32- or 64-byte secret")
        self.sk = _Signer(raw[:32]); self.pub = b58enc(self.sk.pub_bytes)
        if len(raw) == 64 and b58enc(raw[32:]) != self.pub: raise ValueError("private key does not match its public half")

    def sign_tx(self, tx_b64):
        """Jupiter returns a serialized VersionedTransaction: shortvec(n) | n*64-byte sigs | message.
        We sign the message and put our signature in slot 0 (fee payer)."""
        tx = bytearray(base64.b64decode(tx_b64))
        n, off, shift = 0, 0, 0
        while True:
            b = tx[off]; n |= (b & 0x7F) << shift; off += 1; shift += 7
            if not b & 0x80: break
        msg = bytes(tx[off + 64 * n:])
        tx[off:off + 64] = self.sk.sign(msg)
        return base64.b64encode(bytes(tx)).decode()

# ---------------- market data ----------------
def jup_quote(inp, out, amount):
    q = urllib.parse.urlencode(dict(inputMint=inp, outputMint=out, amount=int(amount), slippageBps=SLIPPAGE_BPS))
    return http(f"{JUP}/quote?{q}")

def sol_usd():
    q = jup_quote(SOL, USDC, 10**9)
    return int(q["outAmount"]) / 1e6

def candidates():
    """Discovery from DexScreener's latest token profiles + boosts (boosts are PAID promotion: treated as a list
    of names to check, never as a buy signal). Returns pair dicts for Solana tokens."""
    addrs = []
    for path in ("/token-profiles/latest/v1", "/token-boosts/latest/v1"):
        try:
            for t in http(DEX + path):
                if t.get("chainId") == "solana" and t.get("tokenAddress") not in addrs: addrs.append(t["tokenAddress"])
        except Exception as e:
            log(f"discovery {path} failed: {e}")
    pairs = []
    for i in range(0, min(len(addrs), 90), 30):
        try: pairs += http(f"{DEX}/tokens/v1/solana/{','.join(addrs[i:i+30])}") or []
        except Exception as e: log(f"pair lookup failed: {e}")
    return pairs

def best_pair_per_token(pairs):
    best = {}
    for p in pairs:
        if p.get("chainId") != "solana" or p.get("quoteToken", {}).get("address") not in (SOL, USDC): continue
        a = p["baseToken"]["address"]
        if a not in best or (p.get("liquidity") or {}).get("usd", 0) > (best[a].get("liquidity") or {}).get("usd", 0):
            best[a] = p
    return list(best.values())

# ---------------- strategy (UNPROVEN) ----------------
def entry_signal(p, now_ms):
    """Momentum with filters. Returns (ok, reason). Every reason is one sentence by design."""
    liq = (p.get("liquidity") or {}).get("usd") or 0
    vol = (p.get("volume") or {}).get("h24") or 0
    ch = p.get("priceChange") or {}; tx = (p.get("txns") or {}).get("m5") or {}
    age_h = (now_ms - (p.get("pairCreatedAt") or now_ms)) / 3.6e6
    if liq < MIN_LIQ: return False, f"liquidity ${liq:,.0f} < ${MIN_LIQ:,.0f}"
    if vol < MIN_VOL24: return False, f"24h volume ${vol:,.0f} < ${MIN_VOL24:,.0f}"
    if age_h < MIN_AGE_H: return False, f"pair only {age_h:.1f}h old (launch-day rugs)"
    h1, m5 = ch.get("h1") or 0, ch.get("m5") or 0
    if not (5 <= h1 <= 40): return False, f"1h change {h1:+.0f}% outside +5..+40% (no trend, or already parabolic)"
    if m5 <= 0: return False, f"5m change {m5:+.1f}%: momentum stalled"
    if (tx.get("buys") or 0) <= 1.2 * (tx.get("sells") or 0): return False, "buyers not clearly outnumbering sellers (5m)"
    return True, f"uptrend: 1h {h1:+.0f}%, 5m {m5:+.1f}%, liq ${liq:,.0f}, buys {tx.get('buys')}/sells {tx.get('sells')}"

def exit_reason(pnl_pct, held_min):
    if pnl_pct >= TAKE_PROFIT: return "take-profit"
    if pnl_pct <= -STOP_LOSS: return "stop-loss"
    if held_min >= MAX_HOLD_MIN: return "time-stop"
    return None

# ---------------- state / logging ----------------
def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {'LIVE' if LIVE else 'DRY '} {msg}"
    print(line, flush=True)
    with open(os.path.join(HERE, "bot.log"), "a") as f: f.write(line + "\n")

def notify(msg):
    log("NOTIFY " + msg)
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if tok and chat:
        try: http(f"https://api.telegram.org/bot{tok}/sendMessage", {"chat_id": chat, "text": "memebot: " + msg}, tries=1)
        except Exception as e: log(f"telegram failed: {e}")

def load_state():
    if os.path.exists(STATE): return json.load(open(STATE))
    return dict(mode="live" if LIVE else "dry", cash_usd=PAPER_USD, positions={}, closed=[], peak=None,
                halted=None, trades_today={}, last_data_ok=0)

def save_state(s):
    tmp = STATE + ".tmp"; json.dump(s, open(tmp, "w"), indent=1); os.replace(tmp, STATE)

# ---------------- Sentinel ----------------
def sentinel_halt(s, equity):
    """Account-level stops. Returns a reason to halt everything, or None."""
    s["peak"] = max(s["peak"] or equity, equity)
    if equity <= s["peak"] * (1 - DD_HALT): return f"equity ${equity:.2f} is {DD_HALT:.0%}+ below peak ${s['peak']:.2f}"
    last = s["closed"][-LOSS_HALT:]
    if len(last) == LOSS_HALT and all(t["pnl_usd"] <= 0 for t in last): return f"{LOSS_HALT} losing trades in a row"
    return None

def sentinel_pretrade(s, p, size_usd, sol_bal, sol_px, now):
    """Per-order review: regime(data fresh), signal, size, stop, reason. Returns (ok, reason)."""
    if os.path.exists(os.path.join(HERE, "STOP")): return False, "STOP file present"
    if s["halted"]: return False, f"halted: {s['halted']}"
    if now - s["last_data_ok"] > STALE_SEC: return False, "stale feed"
    if len(s["positions"]) >= MAX_POS: return False, f"already {len(s['positions'])} open position(s)"
    if p["baseToken"]["address"] in s["positions"]: return False, "already holding"
    if any(t["mint"] == p["baseToken"]["address"] and now - t["closed"] < 7200 for t in s["closed"]):
        return False, "traded this token in the last 2h"
    day = time.strftime("%Y-%m-%d")
    if s["trades_today"].get(day, 0) >= MAX_TRADES_DAY: return False, "daily trade cap reached"
    if LIVE:
        spendable = (sol_bal - GAS_RESERVE) * sol_px
        if spendable < size_usd: return False, f"only ${spendable:.2f} spendable above the {GAS_RESERVE} SOL gas reserve"
    elif s["cash_usd"] < size_usd: return False, f"paper cash ${s['cash_usd']:.2f} < ${size_usd:.2f}"
    return True, "ok"

def token_safety(mint):
    """Mint and freeze authority must be revoked (no infinite mint, no freezing your tokens)."""
    info = rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])
    d = ((info or {}).get("value") or {}).get("data", {})
    parsed = d.get("parsed", {}).get("info", {}) if isinstance(d, dict) else {}
    if not parsed: return False, "could not read mint account"
    if parsed.get("mintAuthority"): return False, "mint authority still active"
    if parsed.get("freezeAuthority"): return False, "freeze authority still active"
    return True, "mint & freeze revoked"

def roundtrip_check(mint, lamports):
    """Quote SOL->token and token->SOL before buying: catches unsellable tokens and thin books."""
    buy = jup_quote(SOL, mint, lamports)
    if float(buy.get("priceImpactPct") or 0) * 100 > MAX_IMPACT: return False, "buy price impact too high", None
    sell = jup_quote(mint, SOL, int(buy["outAmount"]))
    back = int(sell["outAmount"]) / lamports
    if float(sell.get("priceImpactPct") or 0) * 100 > MAX_IMPACT: return False, "sell price impact too high", None
    if back < 0.95: return False, f"round trip returns only {back:.1%} (fees/tax/slippage)", None
    return True, f"round trip {back:.1%}", buy

# ---------------- execution ----------------
def swap(wallet, quote):
    body = dict(quoteResponse=quote, userPublicKey=wallet.pub, wrapAndUnwrapSol=True,
                dynamicComputeUnitLimit=True, prioritizationFeeLamports="auto")
    tx = http(f"{JUP}/swap", body, tries=1)["swapTransaction"]
    sig = rpc("sendTransaction", [wallet.sign_tx(tx), {"encoding": "base64", "maxRetries": 3}])
    for _ in range(30):
        st = rpc("getSignatureStatuses", [[sig]])["value"][0]
        if st and st.get("err"): raise RuntimeError(f"tx {sig} failed: {st['err']}")
        if st and st.get("confirmationStatus") in ("confirmed", "finalized"): return sig
        time.sleep(2)
    raise RuntimeError(f"tx {sig} not confirmed in 60s - check it on solscan before restarting")

def token_balance(owner, mint):
    r = rpc("getTokenAccountsByOwner", [owner, {"mint": mint}, {"encoding": "jsonParsed"}])
    return sum(int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in r["value"])

def position_value_usd(pos, sol_px):
    q = jup_quote(pos["mint"], SOL, pos["amount"])
    return int(q["outAmount"]) / 1e9 * sol_px, q

def step(s, wallet):
    now = time.time(); now_ms = now * 1000
    sol_px = sol_usd()
    sol_bal = rpc("getBalance", [wallet.pub])["value"] / 1e9 if LIVE else 0.0
    # 1) manage open positions with executable (quoted) value, not screen price
    pos_val = 0.0
    for mint, pos in list(s["positions"].items()):
        val, q = position_value_usd(pos, sol_px)
        pnl = val / pos["cost_usd"] - 1; held = (now - pos["opened"]) / 60
        why = exit_reason(pnl, held) or ("halted" if s["halted"] else None)
        if why:
            if LIVE: sig = swap(wallet, q)
            else: sig = "dry-run"
            s["cash_usd"] += val if not LIVE else 0
            s["closed"].append(dict(symbol=pos["symbol"], mint=mint, pnl_usd=val - pos["cost_usd"], pnl_pct=pnl,
                                    reason=why, held_min=round(held), sig=sig, closed=now))
            del s["positions"][mint]
            notify(f"SELL {pos['symbol']} {why}: {pnl:+.1%} (${val - pos['cost_usd']:+.2f}) tx {sig}")
        else:
            pos_val += val
    equity = (sol_bal * sol_px if LIVE else s["cash_usd"]) + pos_val
    why = sentinel_halt(s, equity)
    if why and not s["halted"]:
        s["halted"] = why; notify(f"HALTED: {why}. Positions will be sold. Clear 'halted' in state.json to resume.")
    # 2) scan for entries
    pairs = best_pair_per_token(candidates())
    if pairs: s["last_data_ok"] = now
    else: log("scan: DexScreener returned no Solana tokens this round")
    rejects, passed = {}, 0
    for p in pairs:
        ok, reason = entry_signal(p, now_ms)
        if not ok:
            k = reason.split(" ")[0] + (" " + reason.split(" ")[1] if reason.startswith(("1h", "5m", "24h", "pair")) else "")
            rejects[k] = rejects.get(k, 0) + 1; continue
        passed += 1
        sym, mint = p["baseToken"].get("symbol", "?"), p["baseToken"]["address"]
        ok, why = sentinel_pretrade(s, p, POS_USD, sol_bal, sol_px, now)
        if not ok:
            log(f"skip {sym}: {why}")
            if "2h" in why or "holding" in why: continue
            break
        ok, safe = token_safety(mint)
        if not ok: log(f"skip {sym}: {safe}"); continue
        lamports = int(POS_USD / sol_px * 1e9)
        ok, rt, quote = roundtrip_check(mint, lamports)
        if not ok: log(f"skip {sym}: {rt}"); continue
        sig = swap(wallet, quote) if LIVE else "dry-run"
        amount = (token_balance(wallet.pub, mint) or int(quote["otherAmountThreshold"])) if LIVE else int(quote["outAmount"])
        if not LIVE: s["cash_usd"] -= POS_USD
        s["positions"][mint] = dict(symbol=sym, mint=mint, amount=amount, cost_usd=POS_USD, opened=now, reason=reason)
        day = time.strftime("%Y-%m-%d"); s["trades_today"][day] = s["trades_today"].get(day, 0) + 1
        notify(f"BUY {sym} ${POS_USD:.2f}: {reason}; {safe}; {rt}; stop -{STOP_LOSS:.0%} / target +{TAKE_PROFIT:.0%}; tx {sig}")
    top = ", ".join(f"{k} {v}" for k, v in sorted(rejects.items(), key=lambda x: -x[1])[:3])
    log(f"equity ${equity:.2f} (peak ${s['peak']:.2f}), open {len(s['positions'])}, closed {len(s['closed'])}, SOL ${sol_px:.2f} | "
        f"scanned {len(pairs)}, passed {passed}" + (f" (failed: {top})" if top else ""))

def main():
    wallet = None
    if LIVE:
        key = os.environ.get("SOLANA_PRIVATE_KEY")
        if not key: sys.exit("LIVE=1 needs SOLANA_PRIVATE_KEY (use a fresh wallet holding only your trading money)")
        wallet = Wallet(key)
    else:
        class W: pub = "dry-run"
        wallet = W()
    s = load_state()
    if s.get("mode") != ("live" if LIVE else "dry"):
        sys.exit(f"state.json belongs to {s.get('mode')} mode; move it away before switching modes")
    log(f"start; wallet {wallet.pub}; size ${POS_USD}, stop -{STOP_LOSS:.0%}, target +{TAKE_PROFIT:.0%}, halt at -{DD_HALT:.0%}")
    fails = 0
    while not os.path.exists(os.path.join(HERE, "STOP")):
        try:
            step(s, wallet); fails = 0
        except Exception as e:
            fails += 1; log(f"error: {e}")
            if fails == 5: notify(f"5 errors in a row, last: {e}")
        save_state(s)
        time.sleep(LOOP_SEC)
    log("STOP file found, exiting (open positions are NOT sold automatically on STOP)")

if __name__ == "__main__":
    main()
