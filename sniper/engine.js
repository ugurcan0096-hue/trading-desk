/* Meme Sniper — paper trading engine (pure logic, no network, no DOM).
   The same rules as sniper.yaml: ticket = share of free cash, fixed stop,
   trailing exit, max open slots, five seats, daily lock. */
(function (root) {
  "use strict";

  const SEATS = ["watcher", "auditor", "judge", "sizer", "risk"];

  const DEFAULT_CFG = {
    budget: 100,
    ticket: 0.20,                 // share of free cash per buy
    stop: -0.08,                  // stop loss vs entry
    trail: { start: 0.20, give: 0.15 }, // trail arms at +20%, exits 15% below peak
    universe: "solana_memecoins",
    max_open: 2,
    seats: SEATS.slice(),
    lock: "07:00",                // local time: close everything, stop buying
    mode: "paper",
    // Seat thresholds
    min_liq: 40000,
    mcap_min: 100000,
    mcap_max: 1000000,
    max_age_min: 60,
    max_top10: 0.30,
    chase_max: 0.25,              // Judge: skip if price ran > +25% since spotted
    chase_min: -0.10,             // Judge: skip if it already dumped > 10%
    judge_wait_s: 15,             // Judge looks again after this many seconds
    judge_timeout_min: 15,        // forget a token nobody bought after this
    min_ticket: 5,
    slip: 0.01,                   // paper fill cost each way (1% buy, 1% sell)
    require_audit: false,         // if true, no holder data = reject
  };

  function nextLockAt(fromMs, hhmm) {
    const [h, m] = String(hhmm || "07:00").split(":").map((x) => parseInt(x, 10) || 0);
    const d = new Date(fromMs);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= fromMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function newState(cfg, now) {
    const c = Object.assign({}, DEFAULT_CFG, cfg || {});
    c.trail = Object.assign({}, DEFAULT_CFG.trail, (cfg && cfg.trail) || {});
    return {
      v: 1,
      cfg: c,
      status: "idle",            // idle | live | locked
      startedAt: null,
      lockAt: null,
      cash: c.budget,
      positions: [],             // {mint,symbol,icon,entry,qty,cost,peak,last,openedAt,trailOn}
      closed: [],                // {mint,symbol,icon,entry,exit,cost,proceeds,pnl,pct,reason,at,openedAt}
      seen: {},                  // mint -> {symbol,spotPrice,spotAt,status,reason,seat,n}
      stats: { scanned: 0, bought: 0, rejected: 0 },
      equity: [{ t: now || Date.now(), v: c.budget, k: "start" }],
      current: null,             // {mint,symbol,icon,tok,seat,verdict,reason,n}
      lastStop: null,
      lastTrail: null,
      lastReject: null,
      log: [],
      updatedAt: now || Date.now(),
    };
  }

  function log(st, now, text, kind) {
    st.log.unshift({ t: now, text, k: kind || "info" });
    if (st.log.length > 300) st.log.length = 300;
  }

  function equityValue(st) {
    let v = st.cash;
    for (const p of st.positions) v += p.qty * (p.last || p.entry) * (1 - st.cfg.slip);
    return v;
  }

  function pushEquity(st, now, kind) {
    st.equity.push({ t: now, v: +equityValue(st).toFixed(4), k: kind || "mark" });
    if (st.equity.length > 2000) st.equity.splice(1, st.equity.length - 2000);
  }

  function start(st, now) {
    if (st.status === "live") return st;
    st.status = "live";
    st.startedAt = st.startedAt || now;
    st.lockAt = nextLockAt(now, st.cfg.lock);
    log(st, now, "Bot başladı · kilit " + st.cfg.lock, "info");
    return st;
  }

  function stop(st, now) {
    st.status = "idle";
    log(st, now, "Bot durduruldu", "info");
    return st;
  }

  /* ---------- seats ---------- */

  function seatWatcher(c, tok) {
    if (tok.price == null || !(tok.price > 0)) return { ok: false, why: "fiyat yok" };
    if (tok.mcap != null && tok.mcap < c.mcap_min) return { ok: false, why: "mcap $" + kfmt(tok.mcap) + " < $" + kfmt(c.mcap_min) };
    if (tok.mcap != null && tok.mcap > c.mcap_max) return { ok: false, why: "mcap $" + kfmt(tok.mcap) + " > $" + kfmt(c.mcap_max) };
    if (tok.ageMin != null && tok.ageMin > c.max_age_min) return { ok: false, why: "yaş " + Math.round(tok.ageMin) + "dk > " + c.max_age_min + "dk" };
    return { ok: true, why: "yeni pair · $" + kfmt(tok.mcap) + " mcap" };
  }

  function seatAuditor(c, tok) {
    if (tok.liq == null || tok.liq < c.min_liq) return { ok: false, why: "liq $" + kfmt(tok.liq || 0) + " < $" + kfmt(c.min_liq) };
    if (tok.mintOk === false) return { ok: false, why: "mint yetkisi açık" };
    if (tok.freezeOk === false) return { ok: false, why: "freeze yetkisi açık" };
    if (tok.top10 != null && tok.top10 > c.max_top10) return { ok: false, why: "top 10 %" + Math.round(tok.top10 * 100) };
    if (tok.top10 == null && c.require_audit) return { ok: false, why: "holder verisi yok" };
    const parts = ["liq $" + kfmt(tok.liq)];
    parts.push(tok.top10 != null ? "top 10 %" + Math.round(tok.top10 * 100) : "top10 ?");
    if (tok.mintOk === true) parts.push("mint ok");
    return { ok: true, why: parts.join(" · ") };
  }

  function seatJudge(c, tok, seen) {
    const ch = tok.price / seen.spotPrice - 1;
    const s = tp(ch * 100);
    if (ch > c.chase_max) return { ok: false, why: "kovalama " + s + " (max " + tp(c.chase_max * 100) + ")" };
    if (ch < c.chase_min) return { ok: false, why: "düşüşte " + s };
    if (tok.buys5m != null && tok.sells5m != null && tok.sells5m > tok.buys5m * 1.5) return { ok: false, why: "satış baskısı " + tok.sells5m + "/" + tok.buys5m };
    return { ok: true, why: s + " görüldüğünden beri · ok" };
  }

  function seatSizer(c, st) {
    if (st.positions.length >= c.max_open) return { ok: false, why: "slot dolu " + st.positions.length + "/" + c.max_open, wait: true };
    const amt = +(st.cash * c.ticket).toFixed(2);
    if (amt < c.min_ticket) return { ok: false, why: "ticket $" + amt.toFixed(2) + " çok küçük" };
    return { ok: true, why: "ticket $" + amt.toFixed(2) + " · %" + Math.round(c.ticket * 100), amt };
  }

  /* ---------- token flow ---------- */

  // Called for every candidate token on every poll.
  function onToken(st, tok, now) {
    if (st.status !== "live") return null;
    const c = st.cfg;
    if (st.positions.some((p) => p.mint === tok.mint)) return null;
    let s = st.seen[tok.mint];

    if (!s) {
      st.stats.scanned += 1;
      s = st.seen[tok.mint] = { symbol: tok.symbol, spotPrice: tok.price, spotAt: now, status: "new", reason: "", seat: "watcher", n: st.stats.scanned };
      const w = seatWatcher(c, tok);
      if (!w.ok) return reject(st, s, tok, now, "watcher", w.why);
      s.status = "watching";
      s.watchWhy = w.why;
      setCurrent(st, tok, s, "watcher", "checking", w.why);
      return { seat: "watcher", ok: true };
    }

    if (s.status !== "watching") return null;
    if (now - s.spotAt > c.judge_timeout_min * 60000) {
      s.status = "expired";
      return null;
    }

    const a = seatAuditor(c, tok);
    if (!a.ok) return reject(st, s, tok, now, "auditor", a.why);
    if (now - s.spotAt < c.judge_wait_s * 1000) {
      setCurrent(st, tok, s, "auditor", "checking", a.why);
      return { seat: "auditor", ok: true };
    }
    const j = seatJudge(c, tok, s);
    if (!j.ok) return reject(st, s, tok, now, "judge", j.why);
    const z = seatSizer(c, st);
    if (!z.ok) {
      if (z.wait) { setCurrent(st, tok, s, "sizer", "skip", z.why); st.lastReject = { seat: "sizer", why: z.why, symbol: tok.symbol }; return { seat: "sizer", ok: false }; }
      return reject(st, s, tok, now, "sizer", z.why);
    }
    buy(st, tok, z.amt, now);
    s.status = "bought";
    setCurrent(st, tok, s, "risk", "buy", "AL $" + z.amt.toFixed(2) + " · stop " + tp(c.stop * 100) + " kuruldu");
    return { seat: "risk", ok: true, buy: z.amt };
  }

  function reject(st, s, tok, now, seat, why) {
    s.status = "rejected";
    s.reason = why;
    s.seat = seat;
    st.stats.rejected += 1;
    st.lastReject = { seat, why, symbol: tok.symbol };
    setCurrent(st, tok, s, seat, "skip", why);
    log(st, now, "Atlandı " + tok.symbol + " · " + cap(seat) + " · " + why, "skip");
    return { seat, ok: false, why };
  }

  function setCurrent(st, tok, s, seat, verdict, reason) {
    st.current = {
      mint: tok.mint, symbol: tok.symbol, icon: tok.icon || "", n: s.n,
      tok: { price: tok.price, mcap: tok.mcap, liq: tok.liq, holders: tok.holders, ageMin: tok.ageMin, vol5m: tok.vol5m, top10: tok.top10 },
      seat, verdict, reason, spotAt: s.spotAt,
    };
  }

  function buy(st, tok, amt, now) {
    const c = st.cfg;
    const fill = tok.price * (1 + c.slip);
    const qty = amt / fill;
    st.cash = +(st.cash - amt).toFixed(6);
    st.positions.push({ mint: tok.mint, symbol: tok.symbol, icon: tok.icon || "", entry: fill, ref: tok.price, qty, cost: amt, peak: tok.price, last: tok.price, openedAt: now, trailOn: false, mcap: tok.mcap });
    st.stats.bought += 1;
    log(st, now, "AL " + tok.symbol + " $" + amt.toFixed(2) + " @ " + pfmt(tok.price), "buy");
    pushEquity(st, now, "buy");
  }

  // Called with fresh prices for open positions.
  function onPrice(st, mint, price, now) {
    if (!(price > 0)) return null;
    const c = st.cfg;
    const p = st.positions.find((x) => x.mint === mint);
    if (!p) return null;
    p.last = price;
    if (price > p.peak) p.peak = price;
    const up = p.peak / p.ref - 1;
    if (!p.trailOn && up >= c.trail.start) { p.trailOn = true; log(st, now, "Trail aktif " + p.symbol + " " + tp(up * 100), "info"); }
    if (p.trailOn && price <= p.peak * (1 - c.trail.give)) return sell(st, p, price, now, "trail");
    if (price <= p.ref * (1 + c.stop)) return sell(st, p, price, now, "stop");
    return null;
  }

  function sell(st, p, price, now, reason) {
    const c = st.cfg;
    const fill = price * (1 - c.slip);
    const proceeds = p.qty * fill;
    const pnl = proceeds - p.cost;
    const pct = proceeds / p.cost - 1;
    st.cash = +(st.cash + proceeds).toFixed(6);
    st.positions = st.positions.filter((x) => x !== p);
    const row = { mint: p.mint, symbol: p.symbol, icon: p.icon, entry: p.entry, exit: fill, cost: p.cost, proceeds, pnl, pct, reason, at: now, openedAt: p.openedAt };
    st.closed.unshift(row);
    if (st.closed.length > 500) st.closed.length = 500;
    if (reason === "stop") st.lastStop = row;
    if (reason === "trail") st.lastTrail = row;
    const verb = reason === "stop" ? "Stop" : reason === "lock" ? "Kilit" : "Sat";
    log(st, now, verb + " " + p.symbol + " " + tp(pct * 100, 1) + " · " + sgn(pnl, 2, "$"), pnl >= 0 ? "win" : "loss");
    pushEquity(st, now, reason === "stop" ? "stop" : "sell");
    return row;
  }

  // Called every few seconds.
  function tick(st, now) {
    if (st.status === "live" && st.lockAt && now >= st.lockAt) {
      for (const p of st.positions.slice()) sell(st, p, p.last || p.ref, now, "lock");
      st.status = "locked";
      log(st, now, "Kilitlendi " + st.cfg.lock + " · $" + st.cash.toFixed(2), "info");
      pushEquity(st, now, "lock");
    }
    // forget old rejected tokens so memory stays small
    const ids = Object.keys(st.seen);
    if (ids.length > 3000) {
      ids.sort((a, b) => st.seen[a].spotAt - st.seen[b].spotAt);
      for (const id of ids.slice(0, ids.length - 2000)) delete st.seen[id];
    }
    st.updatedAt = now;
  }

  function watchList(st) {
    const out = [];
    for (const [mint, s] of Object.entries(st.seen)) if (s.status === "watching") out.push(mint);
    return out;
  }

  function summary(st) {
    let w = 0, l = 0;
    for (const r of st.closed) (r.pnl >= 0 ? w++ : l++);
    const eq = equityValue(st);
    return { equity: eq, mult: eq / st.cfg.budget, pnl: eq - st.cfg.budget, wins: w, losses: l };
  }

  /* ---------- format helpers ---------- */
  function kfmt(n) {
    if (n == null || isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return Math.round(n / 1e3) + "K";
    return String(Math.round(n));
  }
  function pfmt(p) {
    if (p == null || isNaN(p)) return "—";
    if (p >= 1) return "$" + p.toFixed(4);
    const s = p.toPrecision(3);
    return "$" + (+s).toFixed(Math.min(12, Math.max(4, -Math.floor(Math.log10(p)) + 2)));
  }
  function sgn(n, d, pre) {
    const s = n >= 0 ? "+" : "−";
    return s + (pre || "") + Math.abs(n).toFixed(d);
  }
  // Turkish style: +%12, −%8,4
  function tp(n, d) {
    if (n == null || isNaN(n)) return "—";
    const v = Math.abs(n).toFixed(d || 0).replace(".", ",");
    return (n > 0 ? "+" : n < 0 ? "−" : "") + "%" + v;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  const api = { DEFAULT_CFG, SEATS, newState, start, stop, onToken, onPrice, tick, sell, watchList, summary, equityValue, pushEquity, nextLockAt, kfmt, pfmt, sgn, tp, cap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SniperEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
