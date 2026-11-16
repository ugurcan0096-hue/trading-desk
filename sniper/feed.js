/* Meme Sniper — market data.
   LiveFeed: DexScreener public API (new Solana tokens + prices) and RugCheck
   (top-10 holder share, mint/freeze authority). No keys, read-only.
   DemoFeed: made-up tokens for trying the app; clearly marked as demo. */
(function (root) {
  "use strict";

  const DS = "https://api.dexscreener.com";
  const RC = "https://api.rugcheck.xyz/v1";

  async function getJSON(url, ms) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), ms || 12000) : null;
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined });
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { if (t) clearTimeout(t); }
  }

  function pairToTok(p, now) {
    const b = p.baseToken || {};
    return {
      mint: b.address,
      symbol: (b.symbol || "?").slice(0, 14),
      name: b.name || "",
      icon: (p.info && p.info.imageUrl) || "",
      price: p.priceUsd != null ? parseFloat(p.priceUsd) : null,
      mcap: p.marketCap != null ? p.marketCap : p.fdv,
      liq: p.liquidity && p.liquidity.usd != null ? p.liquidity.usd : null,
      ageMin: p.pairCreatedAt ? (now - p.pairCreatedAt) / 60000 : null,
      vol5m: p.volume && p.volume.m5 != null ? p.volume.m5 : null,
      buys5m: p.txns && p.txns.m5 ? p.txns.m5.buys : null,
      sells5m: p.txns && p.txns.m5 ? p.txns.m5.sells : null,
      dex: p.dexId || "",
      url: p.url || "",
    };
  }

  function LiveFeed() {
    const audits = {};       // mint -> {top10, mintOk, freezeOk, holders, at} | {fail:true}
    const auditing = new Set();
    let rcDown = 0;           // consecutive RugCheck failures
    const self = {
      name: "live",
      lastError: "",
      rugcheckOk: null,

      // New Solana tokens from DexScreener's latest profiles + boosts.
      async discover() {
        const lists = await Promise.allSettled([
          getJSON(DS + "/token-profiles/latest/v1"),
          getJSON(DS + "/token-boosts/latest/v1"),
        ]);
        const mints = [];
        for (const r of lists) {
          if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
          for (const x of r.value) if (x && x.chainId === "solana" && x.tokenAddress && !mints.includes(x.tokenAddress)) mints.push(x.tokenAddress);
        }
        if (!mints.length && lists.every((r) => r.status === "rejected")) throw lists[0].reason;
        return mints;
      },

      // Price + liquidity for up to 30 mints per call.
      async quote(mints) {
        const now = Date.now();
        const out = {};
        for (let i = 0; i < mints.length; i += 30) {
          const chunk = mints.slice(i, i + 30);
          const pairs = await getJSON(DS + "/tokens/v1/solana/" + chunk.join(","));
          const best = {};
          for (const p of Array.isArray(pairs) ? pairs : []) {
            const m = p.baseToken && p.baseToken.address;
            if (!m || !chunk.includes(m)) continue;
            const liq = (p.liquidity && p.liquidity.usd) || 0;
            if (!best[m] || liq > ((best[m].liquidity && best[m].liquidity.usd) || 0)) best[m] = p;
          }
          for (const [m, p] of Object.entries(best)) {
            const t = pairToTok(p, now);
            Object.assign(t, audits[m] && !audits[m].fail ? audits[m] : {});
            out[m] = t;
          }
        }
        return out;
      },

      // Holder data, fetched once per token in the background.
      audit(mint) {
        if (audits[mint] || auditing.has(mint) || auditing.size > 3) return;
        if (rcDown >= 5 && Math.random() > 0.1) return; // back off when RugCheck is unreachable
        auditing.add(mint);
        getJSON(RC + "/tokens/" + mint + "/report", 15000).then((r) => {
          const known = r.knownAccounts || {};
          const skip = (a) => known[a] && /amm|pool|lock/i.test(known[a].type || known[a].name || "");
          const holders = (r.topHolders || []).filter((h) => !skip(h.address) && !skip(h.owner));
          const top10 = holders.slice(0, 10).reduce((s, h) => s + (+h.pct || 0), 0) / 100;
          audits[mint] = {
            top10: holders.length ? top10 : null,
            mintOk: r.mintAuthority == null,
            freezeOk: r.freezeAuthority == null,
            holders: r.totalHolders || null,
          };
          rcDown = 0; self.rugcheckOk = true;
        }).catch(() => {
          audits[mint] = { fail: true };
          rcDown += 1; if (rcDown >= 5) self.rugcheckOk = false;
        }).finally(() => auditing.delete(mint));
      },
      hasAudit(mint) { return !!audits[mint]; },
    };
    return self;
  }

  /* ---------- demo ---------- */
  const NAMES = ["MOTH", "WISP", "DOPE", "CATE", "PAWS", "STONK", "FLOAT", "BATON", "KRILL", "MASK", "HEEHAW", "CLAUS", "PONS", "MOGZ", "GLINT", "TUBA", "ORBO", "FIZZ", "NAPS", "YETI", "BLIP", "SNAX", "ZORP", "WAGU"];

  function DemoFeed(seed) {
    let s = seed || 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const toks = {};
    let n = 0;
    function make(now) {
      n += 1;
      const sym = NAMES[Math.floor(rnd() * NAMES.length)] + (n > NAMES.length ? n : "");
      const mcap = 60000 + rnd() * 900000;
      const supply = 1e9;
      const fate = rnd(); // rug / dud / runner
      const t = {
        mint: "DEMO" + n + "x" + Math.floor(rnd() * 1e9).toString(36),
        symbol: sym, name: sym, icon: "",
        price: mcap / supply, supply,
        liq: 15000 + rnd() * 80000,
        bornAt: now - rnd() * 50 * 60000,
        top10: 0.05 + rnd() * 0.5,
        mintOk: rnd() > 0.08, freezeOk: true,
        holders: Math.floor(300 + rnd() * 3000),
        drift: fate < 0.3 ? -0.003 : fate < 0.85 ? 0 : 0.004,
        vol: 0.008 + rnd() * 0.02,
      };
      toks[t.mint] = t;
      return t.mint;
    }
    function step(t) {
      const shock = (rnd() - 0.5) * 2 * t.vol + t.drift + (rnd() < 0.01 ? -0.4 : 0);
      t.price = Math.max(t.price * (1 + shock), 1e-9);
    }
    function view(t, now) {
      const mcap = t.price * t.supply;
      return { mint: t.mint, symbol: t.symbol, name: t.name, icon: "", price: t.price, mcap, liq: t.liq, ageMin: (now - t.bornAt) / 60000, vol5m: Math.round(mcap * (0.05 + rnd() * 0.3)), buys5m: Math.floor(20 + rnd() * 200), sells5m: Math.floor(20 + rnd() * 200), top10: t.top10, mintOk: t.mintOk, freezeOk: t.freezeOk, holders: t.holders, dex: "demo" };
    }
    return {
      name: "demo",
      lastError: "",
      rugcheckOk: true,
      async discover(now) {
        now = now || Date.now();
        const k = rnd() < 0.3 ? 1 : 0;
        const out = [];
        for (let i = 0; i < k; i++) out.push(make(now));
        return out;
      },
      async quote(mints, now) {
        now = now || Date.now();
        const out = {};
        for (const m of mints) if (toks[m]) { step(toks[m]); out[m] = view(toks[m], now); }
        return out;
      },
      audit() {},
      hasAudit() { return true; },
    };
  }

  const api = { LiveFeed, DemoFeed };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SniperFeed = api;
})(typeof window !== "undefined" ? window : globalThis);
