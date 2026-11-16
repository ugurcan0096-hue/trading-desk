/* Meme Sniper — runs the paper bot in this browser tab and draws it. */
(function () {
  "use strict";
  const E = window.SniperEngine, F = window.SniperFeed;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const appEl = $("#app");
  const KEY = "sniper_state_v1", FEED_KEY = "sniper_feed";
  const { kfmt, pfmt } = E;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  let feedMode = store.get(FEED_KEY) === "demo" ? "demo" : "live";
  let feed = makeFeed();
  let st = load() || E.newState({}, Date.now());
  let tab = "home";
  let busy = false, lastDiscover = 0, lastErr = "", errCount = 0;
  const fresh = [];   // mints found by discover, not yet looked at
  const retry = new Map(); // mint -> tries without a price yet
  let wake = null;

  const DEMO_SPEED = 30, DEMO_NIGHT_MS = 8 * 3600000;
  function clock() { return feedMode === "demo" ? (st && st.simNow) || Date.now() : Date.now(); }
  function makeFeed() { return feedMode === "demo" ? F.DemoFeed(Date.now() % 100000) : F.LiveFeed(); }
  function load() {
    try {
      const s = JSON.parse(store.get(KEY) || "null");
      if (s && s.v === 1 && s.cfg) {
        s.cfg = Object.assign({}, E.DEFAULT_CFG, s.cfg);
        if (!(s.cfg.cv >= 2)) {
          for (const k of ["min_liq", "mcap_min", "mcap_max", "max_age_min", "max_top10", "chase_min", "judge_wait_s", "min_ticket", "cv"]) s.cfg[k] = E.DEFAULT_CFG[k];
          if (!s.startedAt) { s.cfg.budget = E.DEFAULT_CFG.budget; s.cash = s.cfg.budget; s.equity = [{ t: Date.now(), v: s.cfg.budget, k: "start" }]; }
        }
        s.why = s.why || {};
        return s;
      }
    } catch (e) {}
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); }
    catch (e) {
      // storage full: drop old history and try once more
      try {
        st.equity = st.equity.filter((p, i) => i === 0 || p.k !== "mark" || i > st.equity.length - 300);
        st.log.length = Math.min(st.log.length, 100);
        st.closed.length = Math.min(st.closed.length, 200);
        for (const [m, x] of Object.entries(st.seen)) if (x.status !== "watching" && x.status !== "bought") delete st.seen[m];
        localStorage.setItem(KEY, JSON.stringify(st));
      } catch (e2) {}
    }
  }

  /* ---------- loop ---------- */
  async function step() {
    const managing = st.status === "idle" && st.positions.length > 0; // stopped, but exits still run
    if (busy || (st.status !== "live" && !managing)) return;
    busy = true;
    let netOk = false;
    if (feedMode === "demo") st.simNow = (st.simNow || Date.now()) + DEMO_SPEED * 1000;
    const now = clock();
    try {
      if (st.status === "live" && now - lastDiscover > (feedMode === "demo" ? 0 : 5000)) {
        lastDiscover = now;
        try {
          const found = await feed.discover(now); netOk = true;
          for (const m of found) if (!st.seen[m] && !fresh.includes(m)) fresh.push(m);
          if (fresh.length > 60) fresh.splice(0, fresh.length - 60);
        } catch (e) {
          // keep going: open positions still need their stop/trail checks
          errCount += 1;
          lastErr = (e && e.name === "AbortError") ? "zaman aşımı" : (e && e.message) || "ağ hatası";
        }
      }
      const open = st.positions.map((p) => p.mint);
      const watching = st.status === "live" ? E.watchList(st) : [];
      const newOnes = st.status === "live" ? fresh.splice(0, 20) : [];
      const ids = [...new Set([...open, ...watching, ...newOnes])];
      if (ids.length) {
        const q = await feed.quote(ids, now); netOk = true;
        for (const m of open) if (q[m]) { const r = E.onPrice(st, m, q[m].price, now); if (r) toast(r); }
        for (const m of newOnes) if (!q[m]) { const n = (retry.get(m) || 0) + 1; if (n <= 3) { retry.set(m, n); fresh.push(m); } else retry.delete(m); }
        if (retry.size > 500) retry.clear();
        for (const m of [...newOnes, ...watching]) {
          const t = q[m];
          if (!t) continue;
          const s = st.seen[m];
          // Give RugCheck up to 60 s to answer before the Auditor decides.
          if (s && s.status === "watching" && !feed.hasAudit(m) && now - s.spotAt < 60000) { feed.audit(m); continue; }
          const r = E.onToken(st, t, now);
          if (r && r.seat === "watcher" && r.ok) feed.audit(m);
          if (r && r.buy) { buzz([40, 40, 40]); }
        }
        if (open.length) E.pushEquity(st, now, "mark");
      }
      E.tick(st, now);
      if (netOk) { lastErr = ""; errCount = 0; }
    } catch (e) {
      errCount += 1;
      lastErr = (e && e.name === "AbortError") ? "zaman aşımı" : (e && e.message) || "ağ hatası";
    } finally {
      busy = false;
      if (st.status !== "live") releaseWake();
      save();
      if (tab !== "config") paintSoon();
    }
  }

  function interval() { return feedMode === "demo" ? 1000 : (errCount > 3 ? 20000 : 3000); }
  (function loop() { step().finally(() => setTimeout(loop, interval())); })();

  async function grabWake() {
    try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (e) {}
  }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (st.status === "live") grabWake();
    step();
  });

  function buzz(p) {
    try {
      const ua = navigator.userActivation;
      if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(p);
    } catch (e) {}
  }

  let toastT = null;
  function toast(r) {
    const el = $("#toast");
    const win = r.pnl >= 0;
    const verb = r.reason === "stop" ? "Stop" : r.reason === "lock" ? "Kilit" : "Satıldı";
    el.className = "toast" + (win ? "" : " loss");
    el.innerHTML = `${avatar(r)}<div class="nm"><b>${verb} ${esc(r.symbol)}</b><span>${E.tp(r.pct * 100, 1)} · $${r.cost.toFixed(2)} → $${r.proceeds.toFixed(2)}</span></div><div class="pl ${win ? "pos" : "neg"}">${E.sgn(r.pnl, 2, "$")}</div>`;
    buzz(win ? [30] : [80, 40, 80]);
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.add("hidden"), 4500);
  }

  /* ---------- render helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function money(n) { return "$" + (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function hhmm(t) { const d = new Date(t); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function avatar(x) {
    const ch = esc((x.symbol || "?").charAt(0));
    return `<div class="av">${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${x.icon ? "" : ch}</div>`;
  }
  function pctS(n) { return E.tp(n * 100, 0); }

  function lines() {
    const c = st.cfg, cur = st.current, sm = E.summary(st);
    const L = [];
    const tk = +(st.cash * c.ticket).toFixed(2);
    L.push({ code: `budget: ${c.budget.toFixed(2)} <span class="c"># paper, USD</span>`, tag: `$${c.budget.toFixed(2)} yatırıldı · paper`, cls: st.status === "idle" && !st.startedAt ? "g" : "" });
    const justBought = cur && cur.verdict === "buy";
    L.push({ code: `ticket: ${c.ticket.toFixed(2)} * free_cash`, tag: `$${tk.toFixed(2)} = %${Math.round(c.ticket * 100)}`, cls: justBought ? "g" : "" });
    const ls = st.lastStop, lt = st.lastTrail;
    const stopHot = ls && (!lt || ls.at >= lt.at) && clock() - ls.at < 60000 * (feedMode === "demo" ? DEMO_SPEED / 4 : 1);
    L.push({ code: `stop: ${c.stop.toFixed(2)}`, tag: ls ? `${ls.symbol} ${E.tp(ls.pct * 100, 0)} · ${E.sgn(ls.pnl, 2, "$")}` : `stop ${E.tp(c.stop * 100)}`, cls: stopHot ? "r" : "" });
    const trailHot = lt && (!ls || lt.at > ls.at) && clock() - lt.at < 60000 * (feedMode === "demo" ? DEMO_SPEED / 4 : 1);
    L.push({ code: `trail: {start: ${c.trail.start.toFixed(2)}, give: ${c.trail.give.toFixed(2)}}`, tag: lt ? `${lt.symbol} ${E.tp(lt.pct * 100, 0)} · trail çıkış` : `${E.tp(c.trail.start * 100)}'den, %${Math.round(c.trail.give * 100)} geri verir`, cls: trailHot ? (lt.pnl >= 0 ? "g" : "y") : "" });
    L.push({ code: `universe: ${c.universe}`, tag: cur ? `#${cur.n} ${cur.symbol} · $${kfmt(cur.tok.mcap)}` : (st.status === "live" ? "Solana memecoin taranıyor" : "Solana memecoin"), cls: st.status === "live" ? "b" : "" });
    const slotSkip = cur && cur.seat === "sizer" && cur.verdict === "skip";
    L.push({ code: `max_open: ${c.max_open}`, tag: slotSkip ? `${st.positions.length}/${c.max_open} açık · ${cur.symbol} atla` : `${st.positions.length}/${c.max_open} açık`, cls: slotSkip ? "y" : "" });
    const seatBad = cur && cur.verdict === "skip" && cur.seat !== "sizer";
    L.push({ code: `seats: [${c.seats.join(", ")}]`, tag: seatBad ? `✗ ${E.cap(cur.seat)} · ${cur.reason}` : (cur && cur.verdict === "buy" ? "5/5 koltuk ✓ geçti" : "5 koltuk " + (st.status === "live" ? "çevrimiçi" : "")), cls: seatBad ? "r" : (st.status === "live" ? "p" : "") });
    L.push({ code: `lock: "${esc(c.lock)}"`, tag: st.status === "locked" ? `kilitli · ${money(sm.equity)}` : `${c.lock}'de kilit`, cls: st.status === "locked" ? "g" : "" });
    L.push({ code: `mode: ${c.mode}`, tag: feedMode === "demo" ? "DEMO veri · sahte" : "sadece paper", cls: feedMode === "demo" ? "y" : "" });
    return L;
  }

  function cfgCard() {
    return `<div class="card cfg">${lines().map((l, i) => `<div class="ln ${l.cls}"><span class="no">${i + 1}</span><span class="code">${l.code}</span><span class="tag">${esc(l.tag)}</span></div>`).join("")}</div>`;
  }

  function chart() {
    const pts = st.equity;
    const W = 340, H = 150, padL = 34, padR = 8, padT = 10, padB = 16;
    if (pts.length < 2) pts.push({ t: clock(), v: E.equityValue(st), k: "mark" });
    const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 60000);
    const vs = pts.map((p) => Math.max(p.v, 0.01));
    let lo = Math.min(...vs, st.cfg.budget), hi = Math.max(...vs, st.cfg.budget);
    lo = lo * 0.9; hi = hi * 1.1;
    const ly = (v) => Math.log(Math.max(v, 0.01));
    const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
    const Y = (v) => padT + (ly(hi) - ly(v)) / (ly(hi) - ly(lo)) * (H - padT - padB);
    const step = Math.max(1, Math.floor(pts.length / 300));
    const line = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => X(p.t).toFixed(1) + "," + Y(Math.max(p.v, 0.01)).toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    const ev = pts.filter((p) => p.k === "buy" || p.k === "sell" || p.k === "stop").slice(-120);
    const col = { buy: "var(--blue)", sell: "var(--green)", stop: "var(--red)" };
    const ticks = [st.cfg.budget, lo * 1.1 < st.cfg.budget / 2 ? st.cfg.budget / 3 : null, hi / 1.1 > st.cfg.budget * 2 ? Math.round(hi / 1.15) : null].filter((v) => v && v > lo && v < hi);
    const lx = Math.max(padL + 58, Math.min(X(last.t), W - 8));
    return `<div class="card chart"><div class="chart-h"><span>EQUITY · LOG</span><span class="legend"><span><i style="border:2px solid var(--blue)"></i>al</span><span><i style="background:var(--green)"></i>sat</span><span><i style="background:var(--red)"></i>stop</span></span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Equity grafiği">
        ${ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.08)" stroke-dasharray="${v === st.cfg.budget ? "2 3" : "0"}"/><text x="2" y="${Y(v) + 3}" fill="#6b6b73" font-size="9" font-family="monospace">$${kfmt(v)}</text>`).join("")}
        <polygon points="${X(t0)},${H - padB} ${line} ${X(last.t)},${H - padB}" fill="rgba(52,211,107,.08)"/>
        <polyline points="${line}" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linejoin="round"/>
        ${ev.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(Math.max(p.v, .01)).toFixed(1)}" r="2.6" fill="${p.k === "buy" ? "#000" : col[p.k]}" stroke="${col[p.k]}" stroke-width="1.4"/>`).join("")}
        <circle cx="${X(last.t)}" cy="${Y(Math.max(last.v, .01))}" r="4.5" fill="var(--green)" stroke="#fff" stroke-width="1.5"/>
        <rect x="${lx - 54}" y="${Math.max(2, Y(Math.max(last.v, .01)) - 22)}" width="52" height="16" rx="8" fill="#fff"/>
        <text x="${lx - 28}" y="${Math.max(2, Y(Math.max(last.v, .01)) - 22) + 11.5}" text-anchor="middle" font-size="10" font-weight="700" font-family="monospace" fill="#000">$${last.v >= 1000 ? kfmt(last.v) : last.v.toFixed(2)}</text>
        <text x="${padL}" y="${H - 3}" fill="#6b6b73" font-size="9" font-family="monospace">${hhmm(t0)}</text>
        <text x="${W - padR}" y="${H - 3}" fill="#6b6b73" font-size="9" font-family="monospace" text-anchor="end">${hhmm(t1)}</text>
      </svg></div>`;
  }

  function statsRow() {
    const sm = E.summary(st);
    return `<div class="stats">
      <div class="stat"><div class="k">Taranan</div><div class="v">${st.stats.scanned}</div></div>
      <div class="stat"><div class="k">Alınan</div><div class="v pos">${st.stats.bought}</div></div>
      <div class="stat"><div class="k">Reddedilen</div><div class="v neg">${st.stats.rejected}</div></div>
      <div class="stat"><div class="k">Kâr / Zarar</div><div class="v"><span class="pos">${sm.wins}</span> / <span class="neg">${sm.losses}</span></div></div></div>`;
  }

  function tokCard() {
    const c = st.current;
    if (!c) return `<div class="card tok"><div class="tok-h"><div class="av">·</div><div class="tok-n"><b>—</b><span>${st.status === "live" ? "ilk token bekleniyor" : "bot duruyor"}</span></div><span class="pill">${st.status === "live" ? "taranıyor…" : "boşta"}</span></div></div>`;
    const t = c.tok;
    const pill = c.verdict === "buy" ? `<span class="pill buy">AL ${esc(c.reason.match(/\$[\d.]+/) ? c.reason.match(/\$[\d.]+/)[0] : "")}</span>` : c.verdict === "skip" ? `<span class="pill skip">ATLA · ${E.cap(c.seat)}</span>` : `<span class="pill">kontrol…</span>`;
    return `<div class="card tok ${c.verdict === "buy" ? "buy" : c.verdict === "skip" ? "skip" : ""}"><div class="tok-h">${avatar(c)}<div class="tok-n"><b>${esc(c.symbol)}</b><span>${pfmt(t.price)} · görüldü ${hhmm(c.spotAt)}</span></div>${pill}</div>
      <div class="grid6"><div><div class="k">MCAP</div><div class="v">$${kfmt(t.mcap)}</div></div><div><div class="k">LİK</div><div class="v">$${kfmt(t.liq)}</div></div><div><div class="k">HOLDER</div><div class="v">${t.holders ? t.holders.toLocaleString("en-US") : "—"}</div></div><div><div class="k">YAŞ</div><div class="v">${t.ageMin != null ? Math.round(t.ageMin) + "dk" : "—"}</div></div><div><div class="k">VOL 5DK</div><div class="v">$${kfmt(t.vol5m)}</div></div><div><div class="k">TOP10</div><div class="v">${t.top10 != null ? "%" + Math.round(t.top10 * 100) : "—"}</div></div></div></div>`;
  }

  function seatsCard() {
    const c = st.current;
    const colors = { watcher: "#3b82f6", auditor: "#f59e0b", judge: "#a855f7", sizer: "#22c55e", risk: "#ef4444" };
    const idx = c ? E.SEATS.indexOf(c.seat) : -1;
    const bad = c && c.verdict === "skip";
    const w = idx < 0 ? 0 : idx / 4 * 100;
    return `<div class="card seats"><div class="seats-h"><span>Beş koltuk</span><span>${c ? "gecenin " + c.n + ". tokeni" : (st.status === "live" ? "5/5 çevrimiçi" : "")}</span></div>
      <div class="seat-row"><div class="rail ${bad ? "bad" : ""}"><i style="width:${w}%"></i></div>
      ${E.SEATS.map((s, i) => `<div class="seat ${i === idx ? "on" : ""}"><span class="dot" style="border-color:${colors[s]};color:${colors[s]};${i === idx ? "background:" + (bad ? "var(--red)" : colors[s]) : ""}">${s[0].toUpperCase()}</span>${E.cap(s)}</div>`).join("")}</div>
      <div class="seat-why">${c ? `<b>${E.cap(c.seat)}</b> · ${bad ? "✗ " : ""}${esc(c.reason)}` : (st.status === "live" ? "yeni Solana tokenleri taranıyor" : "Başlat'a bas")}</div></div>`;
  }

  function openList() {
    return st.positions.map((p) => {
      const pct = p.last / p.ref - 1;
      return `<div class="row"><span class="t">${hhmm(p.openedAt)}</span><span class="d" style="background:var(--blue)"></span>${avatar(p)}<div class="nm"><b>${esc(p.symbol)}</b><span>${p.trailOn ? "trail aktif · zirve " + pctS(p.peak / p.ref - 1) : "stop " + E.tp(st.cfg.stop * 100) + " kurulu"}</span></div><div class="pl ${pct >= 0 ? "pos" : "neg"}">${pctS(pct)}<span>$${p.cost.toFixed(2)}</span></div></div>`;
    }).join("");
  }

  function closedList(n) {
    const why = (r) => r.reason === "stop" ? "stop " + E.tp(st.cfg.stop * 100) + " tetiklendi" : r.reason === "lock" ? st.cfg.lock + " kilit" : "trail çıkış";
    const rows = st.closed.slice(0, n || 12).map((r) => `<div class="row"><span class="t">${hhmm(r.at)}</span><span class="d" style="background:${r.pnl >= 0 ? "var(--green)" : "var(--red)"}"></span>${avatar(r)}<div class="nm"><b>${r.reason === "stop" ? "Stop" : r.reason === "lock" ? "Kilit" : "Satıldı"} ${esc(r.symbol)}</b><span>${why(r)}</span></div><div class="pl ${r.pnl >= 0 ? "pos" : "neg"}">${E.sgn(r.pnl, 2, "$")}<span>${E.tp(r.pct * 100, 1)}</span></div></div>`).join("");
    return rows || `<div class="empty">Henüz kapanan işlem yok</div>`;
  }

  function header() {
    const sm = E.summary(st);
    const badge = feedMode === "demo" ? `<span class="badge demo">DEMO</span>` : "";
    const sb = st.status === "live" ? `<span class="badge live">Canlı</span>` : st.status === "locked" ? `<span class="badge locked">Kilitli</span>` : `<span class="badge">Boşta</span>`;
    const [w, d] = sm.equity.toFixed(2).split(".");
    return `<div class="head"><div class="brand"><span class="logo">◎</span>Meme Sniper ${sb} ${badge}</div><span class="file">sniper.yaml · 9 satır</span></div>
      <div class="bal"><div class="bal-v num" id="balv">$${(+w).toLocaleString("en-US")}<small>.${d}</small></div>
      <div class="bal-r"><span class="mult ${sm.mult >= 2 ? "hot" : ""}">${sm.mult.toFixed(2)}×</span><div class="since ${sm.pnl >= 0 ? "pos" : "neg"}">${E.sgn(sm.pnl, 2, "$")} başlangıçtan · paper</div></div></div>`;
  }

  function controls() {
    if (st.status === "live") return `<div class="cta"><button class="btn stop" data-act="stop">Durdur</button></div>`;
    const managingNote = st.positions.length ? `<p class="note">Durduruldu: yeni alım yok. Açık ${st.positions.length} pozisyon stop / trail ile takip ediliyor.</p>` : "";
    if (st.status === "locked") return `<div class="cta"><button class="btn go" data-act="again">Bu gece aynı $${st.cfg.budget}?</button></div>`;
    return `<div class="seg" style="margin-bottom:8px">${[20, 50, 100].map((b) => `<button data-budget="${b}" class="${st.cfg.budget === b ? "on" : ""}" ${st.startedAt ? "disabled" : ""}>$${b}</button>`).join("")}</div>
      <div class="cta"><button class="btn go" data-act="start">${st.startedAt ? "Devam et" : "Başlat · $" + st.cfg.budget + " paper"}</button></div>` + managingNote;
  }

  function finalCard() {
    if (st.status !== "locked") return "";
    const sm = E.summary(st);
    return `<div class="card final"><div class="k">TÜM CONFIG · 9 SATIR</div><div class="big">$${st.cfg.budget} → <span class="${sm.pnl >= 0 ? "pos" : "neg"}">${money(sm.equity)}</span></div><div class="x">${sm.mult.toFixed(2)}×</div><div class="sub">9 satır · 5 koltuk · ${st.stats.scanned} token · ${st.stats.bought} alım · ${sm.wins} kâr / ${sm.losses} zarar · paper</div></div>`;
  }

  function warnings() {
    const w = [];
    if (lastErr) w.push(`<p class="note warn">Veri alınamadı (${esc(lastErr)}). Tekrar deneniyor…</p>`);
    if (feedMode === "live" && feed.rugcheckOk === false) w.push(`<p class="note warn">RugCheck'e ulaşılamıyor — Auditor şimdilik sadece likiditeye bakıyor (top10 / mint kontrolü yok).</p>`);
    if (st.status === "live" && st.stats.bought === 0 && st.stats.scanned > 0) w.push(`<p class="note">${st.stats.scanned} coin tarandı, henüz hiçbiri 5 koltuğu geçmedi. Sebepler için <b>Aktivite</b> sekmesine bak.</p>`);
    if (st.status === "live") w.push(`<p class="note">Bot uygulama açıkken çalışır: ekranı açık ve uygulamayı önde tut. Arka plana alırsan Android onu duraklatır; geri döndüğünde kaldığı yerden devam eder.</p>`);
    return w.join("");
  }

  function renderHome() {
    return header() + controls() + finalCard() + cfgCard() + chart() + statsRow() + tokCard() + seatsCard() + warnings() +
      (st.positions.length ? `<div class="sec-h"><h2>Açık pozisyonlar <span class="muted" style="font-size:12px;font-weight:500">${st.positions.length}/${st.cfg.max_open}</span></h2><span>canlı fiyat</span></div>` + openList() : "") +
      `<div class="sec-h"><h2>Bu gece kapananlar <span class="muted" style="font-size:12px;font-weight:500">${st.closed.length} işlem</span></h2><span>paper · SIM</span></div>` + closedList(12) +
      (st.closed.length ? `<p class="note">Sonuçlar kayma ve ücret dahil (her yönde %${(st.cfg.slip * 100).toFixed(1).replace(".", ",")}). Bu yüzden ${E.tp(st.cfg.stop * 100)} stop genelde ${E.tp((st.cfg.stop - 2 * st.cfg.slip) * 100)} civarında kapanır; hızlı düşüşte daha kötü olabilir.</p>` : "");
  }

  function num(id, v, step, min, max, lab, sub) {
    return `<div class="f"><label for="${id}">${lab}${sub ? `<small>${sub}</small>` : ""}</label><input id="${id}" type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" value="${v}"></div>`;
  }
  function renderConfig() {
    const c = st.cfg, locked = st.status === "live";
    return `<h1 class="page">Config</h1>
      <div class="card form">
        <div class="f"><label>Veri kaynağı<small>Canlı: DexScreener + RugCheck. Demo: sahte tokenler.</small></label><div class="seg" style="width:150px"><button data-feed="live" class="${feedMode === "live" ? "on" : ""}">Canlı</button><button data-feed="demo" class="${feedMode === "demo" ? "on" : ""}">Demo</button></div></div>
      </div>
      <div class="card form" id="cfgform">
        ${num("ticket", Math.round(c.ticket * 100), 1, 1, 100, "ticket (%)", "boş nakdin yüzdesi")}
        ${num("stop", Math.round(-c.stop * 100), 1, 1, 90, "stop (−%)", "girişten bu kadar düşerse sat")}
        ${num("tstart", Math.round(c.trail.start * 100), 1, 1, 1000, "trail start (+%)", "bu kârda trail devreye girer")}
        ${num("tgive", Math.round(c.trail.give * 100), 1, 1, 90, "trail give (%)", "zirveden bu kadar düşünce sat")}
        ${num("maxopen", c.max_open, 1, 1, 10, "max_open", "aynı anda açık pozisyon")}
        <div class="f"><label for="lock">lock<small>bu saatte her şeyi kapat, dur</small></label><input id="lock" type="time" value="${esc(c.lock)}"></div>
        ${num("minliq", c.min_liq, 1000, 0, 10000000, "Auditor · min likidite ($)")}
        ${num("top10", Math.round(c.max_top10 * 100), 1, 1, 100, "Auditor · max top10 (%)")}
        ${num("mcmin", c.mcap_min, 10000, 0, 1e9, "Watcher · min mcap ($)")}
        ${num("mcmax", c.mcap_max, 10000, 0, 1e10, "Watcher · max mcap ($)")}
        ${num("age", c.max_age_min, 1, 1, 10000, "Watcher · max yaş (dk)")}
        ${num("chase", Math.round(c.chase_max * 100), 1, 0, 1000, "Judge · max kovalama (+%)", "görüldüğünden beri bu kadar çıktıysa alma")}
        ${num("slip", +(c.slip * 100).toFixed(2), 0.1, 0, 20, "Kayma / ücret (% her yön)", "paper dolumlara eklenen gerçekçi maliyet")}
        <div class="f"><label for="reqa">Holder verisi zorunlu<small>RugCheck yanıt vermezse alma</small></label><input id="reqa" type="checkbox" ${c.require_audit ? "checked" : ""}></div>
      </div>
      <div class="cta"><button class="btn go" data-act="savecfg" ${locked ? "disabled" : ""}>${locked ? "Önce botu durdur" : "Kaydet"}</button></div>
      <div class="cta"><button class="btn stop" data-act="reset">Sıfırla (tüm geçmişi sil)</button></div>
      <p class="note">Bu tamamen <b>paper</b> (sanal para). Gerçek cüzdan, anahtar veya ödeme yok. Videodaki gibi 38× sonuçlar gerçekçi değil: memecoinlerin çoğu sıfıra gider ve stop, hızlı düşüşlerde çok daha kötü dolar. Fiyat ~3 saniyede bir kontrol edildiği için stop'lar o anki fiyattan dolar.</p>`;
  }

  function whyPanel() {
    const names = { watcher: "Watcher", auditor: "Auditor", judge: "Judge", sizer: "Sizer" };
    const w = st.why || {};
    const rows = Object.keys(names).map((seat) => {
      const r = w[seat] || {};
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      if (!total) return "";
      const top = Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(k)} ×${n}`).join(" · ");
      return `<div class="row"><div class="nm"><b>${names[seat]} · ${total} red</b><span>${top}</span></div></div>`;
    }).join("");
    const live = st.status === "live";
    const head = `<div class="sec-h"><h2>Neden almıyor?</h2><span>${st.stats.scanned} taranan · ${st.stats.bought} alım</span></div>`;
    let hint = "";
    if (live && lastErr) hint = `<p class="note warn">Veri gelmiyor: ${esc(lastErr)}. İnternet bağlantını kontrol et.</p>`;
    else if (live && st.stats.scanned === 0) hint = `<p class="note">Henüz coin gelmedi. İlk tarama birkaç saniye sürer.</p>`;
    else if (!live && !st.startedAt) hint = `<p class="note">Bot başlatılmadı. Ana sayfada <b>Başlat</b>'a bas.</p>`;
    return head + (rows ? `<div class="card" style="padding:2px 12px">${rows}</div>` : "") + hint;
  }

  function renderActivity() {
    return `<h1 class="page">Aktivite</h1>` + whyPanel() + `<div class="sec-h"><h2>Kayıt</h2><span></span></div>
      <div class="card" style="padding:4px 12px"><div class="log">${st.log.slice(0, 150).map((l) => `<div class="row"><span class="t">${hhmm(l.t)}</span><div class="nm ${l.k === "win" ? "pos" : l.k === "loss" ? "neg" : l.k === "skip" ? "muted" : ""}">${esc(l.text)}</div></div>`).join("") || `<div class="empty">Henüz kayıt yok</div>`}</div></div>`;
  }

  let touchAt = 0, paintTimer = null;
  document.addEventListener("pointerdown", () => { touchAt = Date.now(); }, true);
  function paintSoon() {
    const wait = 700 - (Date.now() - touchAt);
    if (wait <= 0) return paint();
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paintSoon, wait);
  }
  function paint() {
    $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    try {
      appEl.innerHTML = installBar() + (tab === "config" ? renderConfig() : tab === "activity" ? renderActivity() : renderHome());
    } catch (e) {
      appEl.innerHTML = `<h1 class="page">Bir şey ters gitti</h1><p class="note warn">${esc(e && e.message)}</p><div class="cta"><button class="btn" data-act="reload">Yeniden yükle</button></div>`;
    }
  }

  /* Android: "Yükle" button when Chrome offers install */
  let installEvt = null;
  const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (tab !== "config") paint(); });
  window.addEventListener("appinstalled", () => { installEvt = null; paint(); });
  function installBar() {
    if (!installEvt || standalone()) return "";
    return `<div class="card install"><span class="logo">◎</span><div class="nm"><b>Uygulamayı yükle</b><span>Ana ekrana ikon, tam ekran</span></div><button class="btn go sm" data-act="install">Yükle</button></div>`;
  }

  /* Android back button: go to Ana sayfa first, then leave the app */
  function setTab(t, fromHistory) {
    if (t === tab) return;
    if (!fromHistory) {
      if (tab === "home" && t !== "home") history.pushState({ tab: t }, "");
      else history.replaceState({ tab: t }, "");
    }
    tab = t; paint(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", () => { if (tab !== "home") setTab("home", true); });

  function startBot(now) {
    const fresh0 = !st.startedAt;
    E.start(st, now);
    if (feedMode === "demo") { if (!st.simNow) st.simNow = now; if (fresh0 || !st.lockAt || st.lockAt <= now) st.lockAt = now + DEMO_NIGHT_MS; }
  }
  function goHome() { if (tab !== "home") { if (history.state && history.state.tab) history.back(); else setTab("home"); } paint(); }

  /* ---------- actions ---------- */
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-tab],[data-act],[data-budget],[data-feed]");
    if (!t) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.budget) { if (!st.startedAt) { st = E.newState(Object.assign({}, st.cfg, { budget: +t.dataset.budget }), clock()); save(); paint(); } return; }
    if (t.dataset.feed) {
      if (t.dataset.feed === feedMode) return;
      if (st.startedAt && !confirm("Veri kaynağını değiştirmek geçmişi sıfırlar. Devam?")) return;
      feedMode = t.dataset.feed; store.set(FEED_KEY, feedMode); feed = makeFeed(); fresh.length = 0;
      st = E.newState(st.cfg, Date.now()); if (feedMode === "demo") st.simNow = Date.now(); save(); paint(); return;
    }
    const now = clock(), a = t.dataset.act;
    if (a === "reload") { location.reload(); return; }
    if (a === "install") { const ev = installEvt; installEvt = null; if (ev) { ev.prompt(); ev.userChoice.finally(paint); } return; }
    if (a === "start") { startBot(now); grabWake(); lastDiscover = 0; save(); paint(); step(); }
    else if (a === "stop") { E.stop(st, now); releaseWake(); save(); paint(); }
    else if (a === "again") { st = E.newState(st.cfg, now); if (feedMode === "demo") st.simNow = now; startBot(now); grabWake(); lastDiscover = 0; fresh.length = 0; save(); paint(); }
    else if (a === "reset") { if (confirm("Tüm paper geçmişi silinsin mi?")) { st = E.newState(st.cfg, now); fresh.length = 0; save(); goHome(); } }
    else if (a === "savecfg") {
      const g = (id) => parseFloat($("#" + id).value);
      const c = Object.assign({}, st.cfg);
      const ok = (v) => isFinite(v) && v >= 0;
      const pos = (v) => isFinite(v) && v > 0;
      if (pos(g("ticket"))) c.ticket = Math.min(1, g("ticket") / 100);
      if (pos(g("stop"))) c.stop = -Math.min(0.9, g("stop") / 100);
      c.trail = { start: pos(g("tstart")) ? g("tstart") / 100 : c.trail.start, give: pos(g("tgive")) ? Math.min(0.9, g("tgive") / 100) : c.trail.give };
      if (ok(g("maxopen"))) c.max_open = Math.max(1, Math.round(g("maxopen")));
      const lk = $("#lock").value; if (/^\d\d:\d\d$/.test(lk)) c.lock = lk;
      if (ok(g("minliq"))) c.min_liq = g("minliq");
      if (pos(g("top10"))) c.max_top10 = Math.min(1, g("top10") / 100);
      if (ok(g("mcmin"))) c.mcap_min = g("mcmin");
      if (ok(g("mcmax"))) c.mcap_max = g("mcmax");
      if (ok(g("age"))) c.max_age_min = g("age");
      if (ok(g("chase"))) c.chase_max = g("chase") / 100;
      if (ok(g("slip"))) c.slip = Math.min(0.2, g("slip") / 100);
      if (c.mcap_min > c.mcap_max) { const x = c.mcap_min; c.mcap_min = c.mcap_max; c.mcap_max = x; }
      if (!(c.max_age_min >= 1)) c.max_age_min = 1;
      c.require_audit = $("#reqa").checked;
      st.cfg = c;
      if (st.lockAt) st.lockAt = feedMode === "demo" ? st.lockAt : E.nextLockAt(clock(), c.lock);
      save(); goHome();
    }
  });

  if (st.status === "live") grabWake();
  paint();
})();
