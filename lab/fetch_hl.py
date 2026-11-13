"""Fetch Hyperliquid BTC perp candles + funding. Every file records source + fetch time."""
import json, time, urllib.request, sys, os
API = "https://api.hyperliquid.xyz/info"
OUT = os.path.join(os.path.dirname(__file__), "data")

def post(body):
    req = urllib.request.Request(API, json.dumps(body).encode(), {"Content-Type": "application/json"})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(2 ** i)
    raise RuntimeError("fetch failed")

def candles(coin, interval, start_ms, end_ms):
    step = {"1h": 3600_000, "4h": 14400_000}[interval]
    out, t = {}, start_ms
    while t < end_ms:
        chunk = post({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval,
                      "startTime": t, "endTime": min(end_ms, t + 4900 * step)}})
        for c in chunk:
            out[c["t"]] = c
        t += 4900 * step
        time.sleep(0.3)
    return [out[k] for k in sorted(out)]

def funding(coin, start_ms, end_ms):
    out, t = {}, start_ms
    while t < end_ms:
        chunk = post({"type": "fundingHistory", "coin": coin, "startTime": t, "endTime": end_ms})
        if not chunk:
            break
        for f in chunk:
            out[f["time"]] = f
        nt = chunk[-1]["time"] + 1
        if nt <= t: break
        t = nt
        time.sleep(0.3)
    return [out[k] for k in sorted(out)]

if __name__ == "__main__":
    coin = sys.argv[1] if len(sys.argv) > 1 else "BTC"
    now = int(time.time() * 1000)
    start = now - 4 * 365 * 86400_000   # ask for 4y; exchange returns what it has
    meta = {"source": API, "fetched_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "coin": coin}
    for iv in ("4h", "1h"):
        d = candles(coin, iv, start, now)
        json.dump({**meta, "interval": iv, "rows": d}, open(f"{OUT}/{coin}_{iv}.json", "w"))
        print(iv, len(d), "bars", time.strftime("%Y-%m-%d %H:%M", time.gmtime(d[0]["t"]/1000)), "->",
              time.strftime("%Y-%m-%d %H:%M", time.gmtime(d[-1]["t"]/1000)))
    f = funding(coin, start, now)
    json.dump({**meta, "rows": f}, open(f"{OUT}/{coin}_funding.json", "w"))
    print("funding", len(f), "rows", time.strftime("%Y-%m-%d", time.gmtime(f[0]["time"]/1000)), "->",
          time.strftime("%Y-%m-%d %H:%M", time.gmtime(f[-1]["time"]/1000)))
