/* Trading Desk PWA — Plan B, German UI, read-only. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const appEl = $("#app");
  const errorBar = $("#error-bar");

  const PLAN_B = (window.DESK_PLAN === "B");
  const DATA_ORIGIN = window.DESK_DATA_ORIGIN || "";
  const DATA_REPO = window.DESK_DATA_REPO || "ugurcan0096-hue/trading-desk";
  const DATA_BRANCH = window.DESK_DATA_BRANCH || "data";
  const DATA_RAW = (window.DESK_DATA_RAW || "https://raw.githubusercontent.com/ugurcan0096-hue/trading-desk").replace(/\/$/, "");

  function takeHashParam(name, storageKey) {
    const hash = location.hash || "";
    const re = new RegExp("(?:^|#|&)" + name + "=([^&]+)");
    const m = hash.match(re);
    if (m) {
      const v = decodeURIComponent(m[1]);
      try { localStorage.setItem(storageKey, v); } catch (e) {}
      return v;
    }
    try { return localStorage.getItem(storageKey) || ""; } catch (e) { return ""; }
  }
  function stripHashParams() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  function takeToken() { return takeHashParam("t", "desk_token"); }
  function takeDataPath() { return takeHashParam("d", "desk_data_path"); }
  let TOKEN = takeToken();
  let DATA_PATH = takeDataPath();
  if (TOKEN || DATA_PATH) stripHashParams();

  let tipSha = "";
  let tipShaAt = 0;
  const TIP_TTL_MS = 60000;

  async function resolveDataTip() {
    const now = Date.now();
    if (tipSha && (now - tipShaAt) < TIP_TTL_MS) return tipSha;
    try {
      const res = await fetch(
        "https://api.github.com/repos/" + DATA_REPO + "/git/refs/heads/" + DATA_BRANCH,
        { cache: "no-store", mode: "cors", headers: { "Accept": "application/vnd.github+json" } }
      );
      if (res.ok) {
        const j = await res.json();
        const sha = (j.object && j.object.sha) || "";
        if (sha) { tipSha = sha; tipShaAt = now; return tipSha; }
      }
    } catch (e) {}
    return tipSha || "";
  }

  async function planBUrl(file) {
    const rel = "d/" + DATA_PATH + "/" + file.replace(/^\//, "");
    const sha = await resolveDataTip();
    if (sha) return DATA_RAW + "/" + sha + "/" + rel;
    return DATA_ORIGIN.replace(/\/$/, "") + "/" + rel;
  }

  async function fetchPlanB(path) {
    const u = path.split("?")[0];
    let file = null;
    if (u === "/api/state") file = "state.json";
    else if (u === "/api/chart") file = "chart.json";
    else if (u === "/api/activity") file = "activity.json";
    else if (u === "/api/account") file = "account.json";
    else if (u === "/api/trades") file = "trades.json";
    else if (u.startsWith("/api/coin/")) file = "coin/" + u.slice("/api/coin/".length) + ".json";
    else if (u.startsWith("/api/audit/")) file = "audit/" + u.slice("/api/audit/".length) + ".json";
    else if (/^\/api\/agents\/[^/]+\/decisions$/.test(u)) file = "agents/" + u.split("/")[3] + ".json";
    else if (u === "/api/activity/read") return { ok: true };
    else throw Object.assign(new Error("Einstellungen nur in Telegram. Die App ist schreibgeschützt."), { status: 405 });
    const res = await fetch(await planBUrl(file), { cache: "no-store", mode: "cors" });
    if (!res.ok) throw Object.assign(new Error("data " + res.status), { status: res.status });
    return res.json();
  }

  async function api(path, opts = {}) {
    if (PLAN_B) {
      const method = (opts.method || "GET").toUpperCase();
      if (method !== "GET" && path !== "/api/activity/read") {
        throw Object.assign(new Error("Bitte in Telegram ändern. Die App ist schreibgeschützt."), { status: 405 });
      }
      return fetchPlanB(path);
    }
    const headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw Object.assign(new Error("error " + res.status), { status: res.status });
    if (res.headers.get("content-type") && res.headers.get("content-type").includes("json")) return res.json();
    return res;
  }

  const TABS = ["start", "scanner", "positionen", "konto"];
  const state = { tab: "start", screen: "start", cache: {}, lastOk: Date.now(), offline: false, retryIn: 5 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n));
  }
  function moneyEUR(n) {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
  }
  function moneyUSD(n) {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(n);
  }
  function solAmt(n, d) {
    if (n == null || isNaN(n)) return "—";
    return fmt(n, d == null ? 4 : d) + " SOL";
  }
  function pct(n, d) {
    if (n == null || isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + fmt(n, d == null ? 2 : d) + "\u00a0%";
  }
  function pnlClass(n) { return n == null || isNaN(n) || n === 0 ? "" : (n > 0 ? "pos" : "neg"); }
  function shortMint(m) { return m ? String(m).slice(0, 4) + "…" + String(m).slice(-4) : "—"; }
  function coinName(row) { return row.symbol || row.name || shortMint(row.mint); }

  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z");
    return isNaN(d) ? null : d;
  }
  function timeBerlin(ts) {
    const d = parseTs(ts);
    if (!d) return "";
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", hour12: false });
  }
  function ago(ts) {
    const d = parseTs(ts);
    if (!d) return "—";
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 10) return "jetzt";
    if (s < 60) return Math.floor(s) + "s";
    if (s < 3600) return Math.floor(s / 60) + " Min";
    if (s < 86400) return Math.floor(s / 3600) + " Std";
    return Math.floor(s / 86400) + " T";
  }
  function held(ts) {
    const d = parseTs(ts);
    if (!d) return "—";
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + " Std " + m + " Min";
    return m + " Min";
  }

  function isLive(s) {
    const mode = String((s && s.mode) || "").toUpperCase();
    const buys = s && s.auto_buys_enabled;
    return mode === "AUTO" && buys !== false && buys !== "false";
  }
  function statusBadge(s) {
    if (isLive(s)) {
      return `<span class="status-badge live"><span class="pulse" aria-hidden="true"></span>LIVE AUTO</span>`;
    }
    return `<span class="status-badge paused"><span class="pulse" aria-hidden="true"></span>PAUSIERT</span>`;
  }

  function showError(online) {
    if (online) { errorBar.classList.add("hidden"); state.offline = false; return; }
    state.offline = true;
    const t = new Date(state.lastOk).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    errorBar.classList.remove("hidden");
    errorBar.textContent = "Desk offline · erneuter Versuch in " + state.retryIn + "s · zuletzt " + t;
  }

  function hero(s) {
    if (!s) return "";
    const fiat = [];
    if (s.wallet_eur != null) fiat.push(moneyEUR(s.wallet_eur));
    if (s.wallet_usd != null) fiat.push(moneyUSD(s.wallet_usd));
    const pnlSol = s.today_pnl_sol;
    const pnlUsd = s.today_pnl_usd;
    let pnl = "—";
    if (pnlSol != null) pnl = (Number(pnlSol) > 0 ? "+" : "") + solAmt(pnlSol);
    else if (pnlUsd != null) pnl = (Number(pnlUsd) > 0 ? "+" : "") + moneyUSD(pnlUsd);
    const cls = pnlClass(pnlSol != null ? pnlSol : pnlUsd);
    return `<header class="hero">
      <div class="hero-top">
        <div class="brand-kicker">Trading Desk</div>
        ${statusBadge(s)}
      </div>
      <div class="wallet-sol num">${s.wallet_sol != null ? fmt(s.wallet_sol, 4) : "—"} <span style="font-size:16px;color:var(--muted);font-weight:600">SOL</span></div>
      <div class="wallet-fiat">${fiat.length ? fiat.join('<span class="dot">·</span>') : "—"}</div>
      <div class="hero-pnl">
        <span class="k">PnL heute</span>
        <span class="v num ${cls}">${esc(pnl)}${pnlUsd != null && pnlSol != null ? ' <span style="color:var(--muted);font-size:12px;font-weight:500">('+esc(moneyUSD(pnlUsd))+')</span>' : ""}</span>
      </div>
    </header>
    <div class="updated">Aktualisiert ${esc(timeBerlin(s.updated_at || s.published_at))} Europe/Berlin</div>`;
  }

  function statsGrid(s) {
    const st = (s && s.stats) || {};
    const wr = st.win_rate == null ? "—" : fmt(st.win_rate, 0) + "\u00a0%";
    return `<div class="stats">
      <div class="stat"><div class="k">Gesehen</div><div class="v">${st.coins_seen != null ? st.coins_seen : "—"}</div></div>
      <div class="stat"><div class="k">Bestanden</div><div class="v pos">${st.passed != null ? st.passed : "—"}</div></div>
      <div class="stat"><div class="k">Trades</div><div class="v">${st.trades != null ? st.trades : "—"}</div></div>
      <div class="stat"><div class="k">Trefferquote</div><div class="v">${wr}</div></div>
    </div>`;
  }

  const AGENT_LABEL = { scanner: "Scan", auditor: "Audit", analyst: "Analys", executor: "Exec", risk: "Risk" };
  function agentRow(s) {
    const beats = (s && s.heartbeats) || {};
    const paused = (s && s.paused_agents) || {};
    const names = ["scanner", "auditor", "analyst", "executor", "risk"];
    const published = (s && (s.updated_at || s.published_at)) || null;
    const pref = parseTs(published);
    return `<div class="section-h"><h2>Agenten</h2></div>
      <div class="agents">${names.map((n) => {
        const ts = beats[n];
        const d = parseTs(ts);
        const ref = pref || new Date();
        const age = d ? (ref.getTime() - d.getTime()) / 1000 : 9999;
        const off = paused[n];
        const cls = off ? "off" : (age < 45 ? "ok" : age < 180 ? "stale" : "off");
        const label = off ? "aus" : (d ? (age < 10 ? "ok" : Math.max(0, Math.floor(age)) + "s") : "—");
        return `<div class="agent ${cls}"><div class="dot"></div><div class="n">${AGENT_LABEL[n]}</div><div class="age">${label}</div></div>`;
      }).join("")}</div>`;
  }

  function verdictLabel(v) {
    if (v === "pass") return "bestanden";
    if (v === "kill") return "abgelehnt";
    if (v === "wait") return "wartet";
    return v || "";
  }
  function liqLabel(n) {
    if (n == null || isNaN(n)) return "Liq. —";
    if (n >= 1000) return "Liq. " + fmt(n / 1000, 1) + "k $";
    return "Liq. " + moneyUSD(n);
  }
  function reasonLine(reason, liq) {
    if (!reason) return "";
    const r = String(reason);
    if (/^liq\s/i.test(r) && liq != null) return "";
    if (/^liq unknown$/i.test(r) && (liq == null)) return "";
    return r;
  }
  function scanRow(f) {
    const name = esc(coinName(f));
    const mint = esc(shortMint(f.mint));
    const v = f.verdict || "";
    const href = f.dexscreener || (f.mint ? "https://dexscreener.com/solana/" + f.mint : "");
    const title = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${name}</a>` : name;
    return `<div class="row">
      <div class="mid">
        <div class="t">${title} <span class="mint-s">${mint}</span></div>
        <div class="s">${esc([liqLabel(f.liquidityUsd), reasonLine(f.reason, f.liquidityUsd), timeBerlin(f.ts)].filter(Boolean).join(" · "))}</div>
      </div>
      <span class="verdict ${esc(v)}">${esc(verdictLabel(v))}</span>
    </div>`;
  }

  function positionCard(p) {
    const name = esc(coinName(p));
    const href = p.dexscreener || p.link;
    const title = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${name}</a>` : name;
    const trail = p.trail_active ? `<span class="pill trail">TRAIL ${esc(p.trail_pct != null ? fmt(p.trail_pct, 0) + "%" : "")}</span>` : "";
    const stop = p.stop_pct != null ? `<span class="pill stop">STOP −${esc(fmt(p.stop_pct, 0))}%</span>` : "";
    return `<div class="pos-card">
      <div class="pos-head">
        <div class="pos-name">${title} ${stop}${trail}</div>
        <div class="pos-pct num ${pnlClass(p.current_pct)}">${pct(p.current_pct)}</div>
      </div>
      <div class="pos-grid">
        <div><div class="k">Einstieg</div><div class="v">${p.entry_price != null ? fmt(p.entry_price, 8) : "—"}</div></div>
        <div><div class="k">Aktuell</div><div class="v">${p.current_price != null ? fmt(p.current_price, 8) : "—"}</div></div>
        <div><div class="k">Stop</div><div class="v">${p.stop_price != null ? fmt(p.stop_price, 8) : "—"}</div></div>
        <div><div class="k">Gehalten</div><div class="v">${esc(held(p.opened_at))}</div></div>
      </div>
    </div>`;
  }

  function solscanLinks(row) {
    const links = [];
    if (row && row.buy_solscan) links.push(`<a class="link" href="${esc(row.buy_solscan)}" target="_blank" rel="noopener">Kauf</a>`);
    if (row && row.sell_solscan) links.push(`<a class="link" href="${esc(row.sell_solscan)}" target="_blank" rel="noopener">Verkauf</a>`);
    if (row && row.solscan && !row.buy_solscan && !row.sell_solscan) {
      links.push(`<a class="link" href="${esc(row.solscan)}" target="_blank" rel="noopener">Solscan</a>`);
    }
    return links.join(" · ");
  }
  function tradeRow(t) {
    const name = esc(coinName(t));
    const coin = t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">${name}</a>` : name;
    let pnl = "—", cls = "";
    if (t.pnl_sol != null) { pnl = (Number(t.pnl_sol) > 0 ? "+" : "") + solAmt(t.pnl_sol); cls = pnlClass(t.pnl_sol); }
    else if (t.pnl_usd != null) { pnl = moneyUSD(t.pnl_usd); cls = pnlClass(t.pnl_usd); }
    const st = t.status === "open" || t.status === "exiting" ? "offen" : (t.status === "closed" ? "geschlossen" : (t.status || ""));
    return `<div class="row">
      <div class="mid">
        <div class="t">${coin} · ${esc(st)}</div>
        <div class="s">${esc(t.exit_reason || t.mode || "")} · ${solscanLinks(t)}</div>
      </div>
      <div class="v num ${t.status==="open"||t.status==="exiting"?"":cls}">${esc(pnl)}</div>
    </div>`;
  }

  function skeleton() {
    return `<div class="hero"><div class="skel" style="height:22px;width:40%"></div><div class="skel" style="height:36px;width:70%"></div><div class="skel" style="width:50%"></div></div>
      <div class="stats"><div class="stat"><div class="skel"></div></div><div class="stat"><div class="skel"></div></div><div class="stat"><div class="skel"></div></div><div class="stat"><div class="skel"></div></div></div>`;
  }

  function renderStart() {
    const s = state.cache.state;
    if (!s) return skeleton();
    const feed = (s.scanner_feed || []).slice(0, 6);
    const opens = s.open_positions || [];
    return `${hero(s)}
      ${statsGrid(s)}
      ${agentRow(s)}
      <div class="section">
        <div class="section-h"><h2>Scanner</h2><button class="link" data-tab="scanner">Alle</button></div>
        <div class="card">${feed.length ? feed.map(scanRow).join("") : `<div class="empty">Noch keine Coins heute</div>`}</div>
      </div>
      <div class="section">
        <div class="section-h"><h2>Offene Positionen</h2><button class="link" data-tab="positionen">Trades</button></div>
        <div class="card">${opens.length ? opens.map(positionCard).join("") : `<div class="empty">Keine offenen Positionen</div>`}</div>
      </div>`;
  }

  function renderScanner() {
    const s = state.cache.state;
    if (!s) return `<h1 class="page">Scanner</h1>` + skeleton();
    const feed = s.scanner_feed || [];
    return `<h1 class="page">Scanner</h1>
      <div class="updated" style="margin-top:-8px">Heute ${esc(String((s.stats||{}).coins_seen ?? "—"))} gesehen · ${esc(String((s.stats||{}).passed ?? "—"))} bestanden</div>
      <div class="section"><div class="card">${feed.length ? feed.map(scanRow).join("") : `<div class="empty">Warte auf neue Coins…</div>`}</div></div>`;
  }

  function renderPositionen() {
    const s = state.cache.state;
    if (!s) return `<h1 class="page">Positionen</h1>` + skeleton();
    const opens = s.open_positions || [];
    const trades = (s.trades || state.cache.trades || []).slice(0, 30);
    return `<h1 class="page">Positionen</h1>
      <div class="section">
        <div class="section-h"><h2>Offen</h2></div>
        <div class="card">${opens.length ? opens.map(positionCard).join("") : `<div class="empty">Keine offenen Positionen</div>`}</div>
      </div>
      <div class="section">
        <div class="section-h"><h2>Letzte Trades</h2></div>
        <div class="card">${trades.length ? trades.map(tradeRow).join("") : `<div class="empty">Noch keine Trades</div>`}</div>
      </div>`;
  }

  function renderKonto() {
    const s = state.cache.state || {};
    const a = state.cache.account || s;
    const stop = a.auto_stop_at || s.auto_stop_at;
    let stopLine = "—";
    if (stop) {
      try {
        const d = new Date(stop);
        stopLine = d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) + " Europe/Berlin";
      } catch (e) { stopLine = String(stop); }
    }
    return `<h1 class="page">Konto</h1>
      <div class="section"><div class="card">
        <div class="kv"><span class="k">Modus</span><span class="v">${statusBadge(s)}</span></div>
        <div class="kv"><span class="k">Wallet</span><span class="v num">${s.wallet_sol != null ? solAmt(s.wallet_sol) : "—"}</span></div>
        <div class="kv"><span class="k">Wert</span><span class="v">${[s.wallet_eur != null ? moneyEUR(s.wallet_eur) : null, s.wallet_usd != null ? moneyUSD(s.wallet_usd) : null].filter(Boolean).join(" · ") || "—"}</span></div>
        <div class="kv"><span class="k">Adresse</span><span class="v mint-s">${esc(s.wallet_pubkey || "—")}</span></div>
        <div class="kv"><span class="k">AUTO-Stop</span><span class="v">${esc(stop && String(stop).trim() ? stopLine : "keiner geplant")}</span></div>
        <div class="kv"><span class="k">Paper-Stack</span><span class="v">${a.stack != null ? moneyUSD(a.stack) : "—"}</span></div>
        <div class="kv"><span class="k">Min. Liquidität</span><span class="v">40.000 $</span></div>
        <div class="kv"><span class="k">Telegram</span><span class="v">${a.telegram || s.telegram ? "verbunden" : "—"}</span></div>
      </div></div>
      <p class="note">Einstellungen und Befehle laufen über Telegram. Diese App ist schreibgeschützt. Zum Startbildschirm hinzufügen: Browser-Menü → <em>Zum Startbildschirm</em>.</p>`;
  }

  function paint() {
    $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    const screen = state.screen;
    if (screen === "scanner") appEl.innerHTML = renderScanner();
    else if (screen === "positionen") appEl.innerHTML = renderPositionen();
    else if (screen === "konto") appEl.innerHTML = renderKonto();
    else appEl.innerHTML = renderStart();
    afterPaint();
  }

  function afterPaint() {
    $$("[data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  }

  function go(screen) {
    state.screen = screen;
    if (TABS.includes(screen)) state.tab = screen;
    refresh();
  }

  async function refresh() {
    if (PLAN_B && !DATA_PATH) {
      appEl.innerHTML = `<div class="empty">Öffne die App über den Link, den ich dir geschickt habe (er enthält ein #d=-Fragment). Nach dem ersten Öffnen bleibt er auf diesem Gerät gespeichert.</div>`;
      return;
    }
    if (!PLAN_B && !TOKEN) {
      appEl.innerHTML = `<div class="empty">Öffne die App über den zugesandten Link.</div>`;
      return;
    }
    try {
      const jobs = [api("/api/state"), api("/api/trades").catch(() => ({ rows: [] }))];
      if (state.screen === "konto") jobs.push(api("/api/account").catch(() => ({})));
      const results = await Promise.all(jobs);
      state.cache.state = results[0];
      state.cache.trades = (results[1] && (results[1].rows || results[1].trades)) || (results[0].trades || []);
      if (state.screen === "konto") state.cache.account = results[2] || {};
      state.lastOk = Date.now();
      showError(true);
      paint();
    } catch (e) {
      if (!state.cache.state) appEl.innerHTML = skeleton();
      showError(false);
    }
  }

  if ("serviceWorker" in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || window.__deskSWReloading) return;
      reloading = true;
      window.__deskSWReloading = true;
      location.reload();
    });
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      const ping = () => { try { reg.update(); } catch (e) {} };
      ping();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") ping();
      });
      window.addEventListener("focus", ping);
    }).catch(() => {});
  }

  $$("#tabbar .tab").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  go("start");
  setInterval(() => { if (state.offline) { state.retryIn = 5; refresh(); } }, 5000);
  setInterval(refresh, 12000);
})();
