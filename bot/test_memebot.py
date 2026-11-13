"""Offline tests: no network. Run: python3 test_memebot.py"""
import base64, json, os, tempfile, time
os.environ["LIVE"] = "0"
import memebot as m
from nacl.signing import SigningKey

# base58: known Solana addresses are 32 bytes and round-trip
for a in (m.SOL, m.USDC):
    assert len(m.b58dec(a)) == 32 and m.b58enc(m.b58dec(a)) == a

# wallet + signing of a versioned tx with 2 signature slots
sk = SigningKey.generate(); secret = m.b58enc(bytes(sk) + bytes(sk.verify_key))
w = m.Wallet(secret); assert w.pub == m.b58enc(bytes(sk.verify_key))
msg = b"\x80" + os.urandom(150)
tx = base64.b64encode(bytes([2]) + b"\0"*128 + msg).decode()
signed = base64.b64decode(w.sign_tx(tx))
sk.verify_key.verify(msg, signed[1:65])          # raises if bad
assert signed[65:129] == b"\0"*64 and signed[129:] == msg
try: m.Wallet(m.b58enc(bytes(sk) + bytes(SigningKey.generate().verify_key))); raise SystemExit("mismatch not caught")
except ValueError: pass

# entry filters
now = time.time()*1000
good = dict(chainId="solana", baseToken=dict(address="Tok1", symbol="TOK"), quoteToken=dict(address=m.SOL),
            liquidity=dict(usd=50000), volume=dict(h24=200000), priceChange=dict(m5=1.5, h1=12),
            txns=dict(m5=dict(buys=40, sells=20)), pairCreatedAt=now - 24*3.6e6)
assert m.entry_signal(good, now)[0]
for k, v in [("liquidity", dict(usd=5000)), ("pairCreatedAt", now - 3.6e6), ("priceChange", dict(m5=1, h1=80)),
             ("priceChange", dict(m5=-1, h1=10)), ("txns", dict(m5=dict(buys=20, sells=20)))]:
    assert not m.entry_signal({**good, k: v}, now)[0], k
assert m.exit_reason(0.3, 5) == "take-profit" and m.exit_reason(-0.13, 5) == "stop-loss"
assert m.exit_reason(0.0, 121) == "time-stop" and m.exit_reason(0.05, 10) is None

# Sentinel
s = dict(peak=None, closed=[], halted=None, positions={}, trades_today={}, last_data_ok=time.time(), cash_usd=13)
assert m.sentinel_halt(s, 13.0) is None and m.sentinel_halt(s, 11.0) is not None      # -15.4%
s = dict(peak=13, closed=[dict(pnl_usd=-.1)]*3)
assert "losing" in m.sentinel_halt(s, 12.9)
s = dict(peak=13, closed=[], halted=None, positions={}, trades_today={}, last_data_ok=time.time()-999, cash_usd=13)
assert m.sentinel_pretrade(s, good, 4, 0, 150, time.time()) == (False, "stale feed")

# one full dry-run cycle with faked APIs: buy, then a price jump -> take-profit sell
d = tempfile.mkdtemp(); m.HERE = d; m.STATE = os.path.join(d, "state.json")
price = {"x": 1.0}
def fake_http(url, body=None, tries=3):
    if "/token-profiles/" in url: return [dict(chainId="solana", tokenAddress="Tok1")]
    if "/token-boosts/" in url or "/search" in url: return [] if "boosts" in url else {"pairs": []}
    if "/tokens/v1/solana/" in url: return [good]
    if "/quote" in url:
        q = dict(x.split("=") for x in url.split("?")[1].split("&")); amt = int(q["amount"])
        if q["inputMint"] == m.SOL and q["outputMint"] == m.USDC: return dict(outAmount=str(150*10**6), priceImpactPct="0")
        if q["inputMint"] == m.SOL: out = amt * 1000 // price["x"]          # SOL -> token
        else: out = amt * price["x"] // 1000 * 0.99                         # token -> SOL (1% cost)
        return dict(outAmount=str(int(out)), otherAmountThreshold=str(int(out*.97)), priceImpactPct="0.001")
    if body and body.get("method") == "getAccountInfo":
        return {"result": {"value": {"data": {"parsed": {"info": {"mintAuthority": None, "freezeAuthority": None}}}}}}
    raise AssertionError(url)
m.http = fake_http
st = m.load_state(); w0 = type("W", (), {"pub": "dry-run"})()
m.step(st, w0); assert "Tok1" in st["positions"] and abs(st["cash_usd"] - 9) < 1e-9
price["x"] = 1.4; m.step(st, w0)
assert st["closed"] and st["closed"][0]["reason"] == "take-profit", st["closed"]
assert "Tok1" not in st["positions"], "re-bought during cooldown"
print("closed trade:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in st["closed"][0].items() if k != "closed"})
print("ALL TESTS PASSED")

# BIP39 vector (Trezor): 'abandon x11 about' + passphrase TREZOR
assert m.mnemonic_seed("abandon "*11 + "about", "TREZOR").hex().startswith("c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04"[:32])
# SLIP-0010 ed25519 test vector 1
sd = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
assert m.slip10_ed25519(sd, []).hex() == "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7"
assert m.slip10_ed25519(sd, [0]).hex() == "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3"
# address matching by 'start...end' finds the right account index
ph = "abandon "*11 + "about"
k3 = m.slip10_ed25519(m.mnemonic_seed(ph), [44, 501, 3, 0]); a3 = m.b58enc(m._Signer(k3).pub_bytes)
w3, i3 = m.wallet_from_phrase(ph, a3[:6] + "..." + a3[-6:]); assert i3 == 3 and w3.pub == a3
print("PHRASE TESTS PASSED")

# LIVE: a sell whose SOL arrives must not look like a drawdown
m.LIVE = True; bal = {"sol": 0.1}; price["x"] = 1.0
class FW:
    pub = "WalletX"
    def sign_tx(self, t): return t
def fake_http2(url, body=None, tries=3):
    if body and body.get("method") == "getBalance": return {"result": {"value": int(bal["sol"]*1e9)}}
    if body and body.get("method") == "getTokenAccountsByOwner":
        return {"result": {"value": [{"account": {"data": {"parsed": {"info": {"tokenAmount": {"amount": str(held["amt"])}}}}}}]}}
    if body and body.get("method") == "sendTransaction": return {"result": "SIG"}
    if body and body.get("method") == "getSignatureStatuses": return {"result": {"value": [{"confirmationStatus": "confirmed", "err": None}]}}
    if url.endswith("/swap"):
        q = body["quoteResponse"]
        if q["_in"] == m.SOL: bal["sol"] -= int(q["_amt"])/1e9; held["amt"] = int(q["outAmount"])
        else: bal["sol"] += int(q["outAmount"])/1e9; held["amt"] = 0
        return {"swapTransaction": "x"}
    r = fake_http(url, body, tries)
    if "/quote" in url and isinstance(r, dict):
        qq = dict(x.split("=") for x in url.split("?")[1].split("&")); r["_in"] = qq["inputMint"]; r["_amt"] = qq["amount"]
    return r
held = {"amt": 0}; m.http = fake_http2; m.time.sleep = lambda x: None
st2 = m.load_state(); st2["mode"] = "live"; st2["positions"] = {}; st2["closed"] = []; st2["peak"] = None; st2["halted"] = None
os.remove(m.STATE) if os.path.exists(m.STATE) else None
st2 = dict(mode="live", cash_usd=0, positions={}, closed=[], peak=None, halted=None, trades_today={}, last_data_ok=0)
fw = FW(); m.step(st2, fw); assert st2["positions"], "live buy did not happen"
price["x"] = 1.4; m.step(st2, fw)
assert st2["closed"] and st2["halted"] is None, (st2["halted"], st2["closed"])
print("LIVE NO-FALSE-HALT TEST PASSED")

# Token-2022 danger checks
def acct(info): return {"result": {"value": {"data": {"parsed": {"info": info}}}}}
base = {"mintAuthority": None, "freezeAuthority": None}
cases = [([{"extension": "permanentDelegate", "state": {"delegate": "X"}}], False),
         ([{"extension": "transferFeeConfig", "state": {"newerTransferFee": {"transferFeeBasisPoints": 300}, "olderTransferFee": {"transferFeeBasisPoints": 0}}}], False),
         ([{"extension": "transferFeeConfig", "state": {"newerTransferFee": {"transferFeeBasisPoints": 0}, "olderTransferFee": {"transferFeeBasisPoints": 0}}}], True),
         ([{"extension": "metadataPointer", "state": {}}], True)]
for ext, ok in cases:
    m.http = lambda url, body=None, tries=3, e=ext: acct({**base, "extensions": e})
    assert m.token_safety("T")[0] == ok, ext
assert "slippage" in m.short_err(RuntimeError("custom program error: 0x1771"))
print("TOKEN-2022 + ERROR TESTS PASSED")
