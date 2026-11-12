/* Trading desk app. Token lives in #t= then localStorage only. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const appEl = $("#app");
  const errorBar = $("#error-bar");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    // Keep the path; drop secrets/fragments from the visible URL after first load.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  function takeToken() { return takeHashParam("t", "desk_token"); }
  function takeDataPath() { return takeHashParam("d", "desk_data_path"); }
  let TOKEN = takeToken();
  let DATA_PATH = takeDataPath();
  if (TOKEN || DATA_PATH) stripHashParams();

  // raw.githubusercontent.com branch URLs are cached ~5 min and ignore ?t=.
  // Resolve the data-branch tip SHA via the public GitHub API (CORS, ~60s cache)
  // and fetch raw files by commit SHA so the phone sees new snapshots within ~1–2 min.
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
    const q = new URLSearchParams(path.includes("?") ? path.split("?")[1] : "");
    let file = null;
    if (u === "/api/state") file = "state.json";
    else if (u === "/api/chart") file = "chart.json";
    else if (u === "/api/activity") file = "activity.json";
    else if (u === "/api/account") file = "account.json";
    else if (u === "/api/trades") file = "trades.json";
    else if (u.startsWith("/api/coin/")) file = "coin/" + u.slice("/api/coin/".length) + ".json";
    else if (u.startsWith("/api/audit/")) file = "audit/" + u.slice("/api/audit/".length) + ".json";
    else if (/^\/api\/agents\/[^/]+\/decisions$/.test(u)) {
      const name = u.split("/")[3];
      file = "agents/" + name + ".json";
    } else if (u === "/api/activity/read") {
      return { ok: true };
    } else {
      throw Object.assign(new Error("Change settings in Telegram. This app is read-only."), { status: 405 });
    }
    const res = await fetch(await planBUrl(file), { cache: "no-store", mode: "cors" });
    if (!res.ok) throw Object.assign(new Error("data " + res.status), { status: res.status });
    const data = await res.json();
    if (u === "/api/chart") {
      const range = (q.get("range") || "LIVE").toUpperCase();
      return data[range] || data.LIVE || data;
    }
    return data;
  }

  async function api(path, opts = {}) {
    if (PLAN_B) {
      const method = (opts.method || "GET").toUpperCase();
      if (method !== "GET" && path !== "/api/activity/read") {
        throw Object.assign(new Error("Change this in Telegram. The web app is read-only."), { status: 405 });
      }
      return fetchPlanB(path);
    }
    const headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) throw Object.assign(new Error("unauthorized"), { status: 401 });
    if (!res.ok) {
      let msg = "error " + res.status;
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    if (res.headers.get("content-type") && res.headers.get("content-type").includes("json")) return res.json();
    return res;
  }

  const state = {
    tab: "home",
    screen: "home", // home|agents|activity|account|coin|auditor|search
    mint: null,
    range: "LIVE",
    cache: {},
    lastOk: Date.now(),
    offline: false,
    retryIn: 5,
  };

  function money(n, d = 2) {
    if (n == null || isNaN(n)) return "—";
    const s = Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    return (n < 0 ? "-$" : "$") + s.replace("-", "");
  }
  function pct(n, d = 2) {
    if (n == null || isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + Number(n).toFixed(d) + "%";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showError(online) {
    if (online) {
      errorBar.classList.add("hidden");
      state.offline = false;
      return;
    }
    state.offline = true;
    const t = new Date(state.lastOk).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    errorBar.classList.remove("hidden");
    errorBar.textContent = `Desk offline · retrying in ${state.retryIn}s · last update ${t}`;
  }

  function navbar(title) {
    const unread = (state.cache.state || {}).unread > 0;
    return `<div class="navbar">
      <button class="avatar" id="nav-acc" aria-label="Account">U</button>
      <div class="brand">${title || "Grok Bot ›"}</div>
      <button class="search-btn" id="nav-search" aria-label="Search">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
      <button class="bell" id="nav-bell" aria-label="Activity">${unread ? '<span class="dot"></span>' : ""}
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
      </button>
    </div>`;
  }

  function modeBadge(mode) {
    const m = String(mode || "PAPER").toUpperCase();
    if (m === "AUTO") return '<span class="mode-pill auto">AUTO</span>';
    if (m === "LIVE") return '<span class="mode-pill live">LIVE</span>';
    return '<span class="paper-pill">PAPER</span>';
  }
  function paperBadge(mode) { return modeBadge(mode); }

  function walletLine(s) {
    if (!s) return "";
    const bits = [];
    if (s.wallet_sol != null && s.wallet_sol !== "") bits.push(Number(s.wallet_sol).toFixed(4) + " SOL");
    if (s.wallet_usdc != null && s.wallet_usdc !== "") bits.push(Number(s.wallet_usdc).toFixed(2) + " USDC");
    if (!bits.length) return "";
    let pk = "";
    if (s.wallet_pubkey) {
      const w = String(s.wallet_pubkey);
      pk = `<span class="s mono">${esc(w.slice(0,4) + "…" + w.slice(-4))}</span>`;
    }
    let stop = "";
    if (s.auto_stop_at) {
      try {
        const d = new Date(s.auto_stop_at);
        const hh = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin", hour12: false });
        stop = `<div class="wallet-row"><span>AUTO-Stop ${esc(hh)} (Europe/Berlin)</span></div>`;
      } catch (e) {
        stop = `<div class="wallet-row"><span>AUTO-Stop ${esc(s.auto_stop_at)}</span></div>`;
      }
    }
    return `<div class="wallet-row"><span>${bits.join(" · ")}</span>${pk}</div>` + stop;
  }

  function solscanLinks(row) {
    const links = [];
    if (row && row.buy_solscan) links.push(`<a class="tx" href="${esc(row.buy_solscan)}" target="_blank" rel="noopener">buy ↗</a>`);
    if (row && row.sell_solscan) links.push(`<a class="tx" href="${esc(row.sell_solscan)}" target="_blank" rel="noopener">sell ↗</a>`);
    if (row && row.solscan && !row.buy_solscan && !row.sell_solscan) {
      links.push(`<a class="tx" href="${esc(row.solscan)}" target="_blank" rel="noopener">tx ↗</a>`);
    }
    return links.join(" ");
  }

  function tradeRow(t) {
    const name = esc(t.symbol || t.name || (t.mint || "").slice(0, 8));
    const st = esc(t.status || "");
    const coin = t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">${name}</a>` : name;
    let size = "";
    if (t.sol_spent != null) size = Number(t.sol_spent).toFixed(4) + " SOL";
    else if (t.size_usd != null) size = money(t.size_usd);
    let pnl = "";
    if (t.pnl_sol != null) pnl = (Number(t.pnl_sol) >= 0 ? "+" : "") + Number(t.pnl_sol).toFixed(4) + " SOL";
    else if (t.pnl_usd != null) pnl = money(t.pnl_usd);
    const vclass = (t.pnl_sol != null && t.pnl_sol < 0) || (t.pnl_usd != null && t.pnl_usd < 0) ? "neg" : "pos";
    const why = esc(t.exit_reason || t.mode || "");
    return `<div class="activity-row trade-row">
      <div class="mid"><div class="t">${coin} · ${st}</div><div class="s">${why} ${solscanLinks(t)}</div></div>
      <div class="v num ${t.status==="open"||t.status==="exiting"?"":vclass}">${esc(pnl || size)}</div>
    </div>`;
  }

  function skeleton() {
    return `<div class="home-hero"><div class="skel" style="height:64px;width:70%"></div><div class="skel" style="width:40%"></div></div>
      <div class="section"><div class="skel" style="height:180px"></div></div>`;
  }

  function renderHome() {
    const s = state.cache.state;
    if (!s) return navbar() + skeleton();
    const pos = (s.today_pct || 0) >= 0;
    const agents = s.agents || [];
    const act = (state.cache.activity || []).slice(0, 5);
    return `${navbar()}
      <div class="home-hero">
        <div class="hero-row">
          <div class="balance display num odometer" id="bal">${money(s.balance)}</div>
          ${paperBadge(s.mode)}
        </div>
        <div class="meta-row">
          <span class="${pos ? "pos" : "neg"} num">${pct(s.today_pct)}</span>
          <span class="mult ${s.multiplier >= 1 ? "" : "neg"} num">${Number(s.multiplier || 1).toFixed(2)}×</span>
        </div>
        ${walletLine(s)}
      </div>
      <div class="chart-wrap"><canvas id="home-chart"></canvas></div>
      <div class="range" id="range">
        ${["LIVE","1H","4H","1D","1W","ALL"].map((r) => `<button data-r="${r}" class="${state.range===r?"on":""}">${r}</button>`).join("")}
      </div>
      <div class="section">
        <div class="section-h"><h2>Agents · ${agents.filter(a=>a.status==="running").length} running</h2></div>
        <div class="carousel" id="cards">${agents.map(agentCard).join("")}</div>
      </div>
      <div class="section">
        <div class="section-h"><h2>Live trades</h2></div>
        ${(function(){
          const trades = (s.trades || state.cache.trades || []).slice(0, 8);
          return trades.length ? trades.map(tradeRow).join("") : `<div class="empty">No trades yet</div>`;
        })()}
      </div>
      <div class="section">
        <div class="section-h"><h2>Activity</h2><button class="link" data-tab="activity">See all</button></div>
        ${act.length ? act.map(activityRow).join("") : `<div class="empty">Nothing yet tonight</div>`}
      </div>`;
  }

  function agentCard(a) {
    const name = esc(a.name);
    let body = "";
    if (name === "Scanner") {
      const feed = (a.feed || []).slice(-6).reverse();
      body = feed.length ? `<div class="feed">${feed.map((f) => {
        const n = esc(f.symbol || f.name || (f.mint||"").slice(0,6));
        if (f.verdict === "kill") return `<div class="row kill"><span class="name">${n}</span><span class="why">${esc(f.reason||"")}</span></div>`;
        return `<div class="row"><span>${n} · liq ${f.liquidityUsd!=null?money(f.liquidityUsd,0):"—"}</span><span>→ auditor</span></div>`;
      }).join("")}</div>` : `<div class="asub">${a.waiting? a.waiting+" in the room · ":""}Listening for graduations</div>`;
    } else if (name === "Auditor") {
      const strips = (a.strips || []).map((s) => `<div class="strip ${s.pass===true?"ok":s.pass===false?"red":""}"></div>`).join("");
      body = `<div class="asub">${esc(a.subtitle||"")}</div><div class="strips">${strips}</div>
        <div class="asub" style="margin-top:8px">${a.rejected||0} rejected</div>`;
    } else if (name === "Analyst") {
      body = `<div class="ring-wrap"><canvas class="score-ring" width="140" height="140" data-score="${a.score??""}" data-min="${a.min_score||70}"></canvas></div>`;
    } else if (name === "Executor") {
      body = `<div class="asub">${esc(a.subtitle||"")}</div>`;
    } else if (name === "Risk") {
      body = `<div class="asub">${esc(a.subtitle||"")}</div>
        <div class="pills"><span class="pill red mono">stop -${a.stop_pct||6}%</span>
        <span class="pill green mono">trail ${a.trail_pct||12}%</span></div>`;
    }
    return `<article class="agent-card" data-agent="${esc(a.name)}">
      <div class="aname">${name}</div>
      <div class="atitle display">${esc(a.title||"")}</div>
      ${body}
    </article>`;
  }

  function activityRow(r) {
    const vclass = (r.kind === "stopped" || (r.value||"").startsWith("-")) ? "neg" : (r.kind==="bought"||r.kind==="sold" ? "pos" : "");
    const dest = (r.kind === "rejected") ? "auditor" : "coin";
    const tx = solscanLinks(r);
    return `<div class="activity-row">
      <button class="mid linkish" data-open="${dest}" data-mint="${esc(r.mint||"")}">
        <div class="t">${esc(r.title)}</div>
        <div class="s">${esc(r.subtitle||"")}</div>
      </button>
      <div class="v num ${vclass}">${esc(r.value||"")} ${tx}</div>
    </div>`;
  }

  function renderAgents() {
    const agents = (state.cache.state || {}).agents || [];
    const decisions = state.cache.decisions || {};
    if (!agents.length) return navbar("Agents") + skeleton();
    return `<h1 class="page">Agents</h1>` + agents.map((a) => {
      const rows = (decisions[(a.name||"").toLowerCase()] || []).slice(0, 20);
      const paused = a.status === "paused";
      return `<div class="full-card" style="margin:0 16px 12px">
        <div class="row-between">
          <div><span class="status-dot ${paused?"off":""}"></span><strong>${esc(a.name)}</strong>
            <div class="asub">${esc(a.title||"")} · ${paused?"paused":"running"}</div></div>
          ${PLAN_B?`<span class="s">${paused?"paused":"running"} · Telegram</span>`:
            `<button class="switch ${paused?"":"on"}" data-pause="${esc(a.name)}" aria-label="pause"><i></i></button>`}
        </div>
        <div class="feed" style="margin-top:8px">${rows.length? rows.map((r)=>{
          const label = esc(r.symbol||r.name||r.verdict||r.status||r.reason||r.value_text||"");
          const why = esc(r.reason||r.value_text||r.status||"");
          const link = r.link ? `<a href="${esc(r.link)}">${label}</a>` : label;
          return `<div class="row"><span>${link}</span><span class="s">${why}</span></div>`;
        }).join("") : '<div class="asub">No decisions yet</div>'}</div>
        <button class="link" data-tab="account" data-jump="${esc(a.name).toLowerCase()}" style="margin-top:8px">Settings</button>
      </div>`;
    }).join("");
  }

  function renderActivity() {
    const rows = state.cache.activity || [];
    return `${navbar("Activity")}<h1 class="page" style="margin-top:0">Activity</h1>
      <div class="list-screen">${rows.length? rows.map(activityRow).join("") : `<div class="empty">Nothing yet tonight</div>`}</div>`;
  }

  function renderAccount() {
    const a = state.cache.account;
    if (!a) return navbar("Account") + skeleton();
    const groups = a.settings || {};
    const order = ["desk","scanner","auditor","analyst","executor","risk"];
    let html = `${navbar("Account")}<h1 class="page" style="margin-top:0">Account</h1>
      <div class="list-screen">
        <div class="field"><label>Mode</label>
          <div class="row-between">
            <strong>${modeBadge(a.mode)} ${esc(a.mode)}</strong>
            ${PLAN_B?`<span class="s">change in Telegram</span>`:(
              a.mode==="PAPER"?`<button class="btn secondary" style="width:auto;padding:0 16px;margin:0" id="to-live">Go LIVE</button>`:
              `<button class="btn secondary" style="width:auto;padding:0 16px;margin:0" id="to-paper">PAPER</button>`)}
          </div>
        </div>
        <div class="field"><label>Wallet</label>
          <div class="num">${a.wallet_sol!=null?Number(a.wallet_sol).toFixed(4)+" SOL":"—"}${a.wallet_usdc!=null?" · "+Number(a.wallet_usdc).toFixed(2)+" USDC":""}</div>
          ${a.wallet_pubkey?`<div class="s mono">${esc(a.wallet_pubkey)}</div>`:""}
        </div>
        ${a.auto_stop_at?`<div class="field"><label>AUTO-Stop</label><div>${esc(a.auto_stop_at)} (Europe/Berlin)</div></div>`:""}
        <div class="field"><label>Paper stack</label>
          ${PLAN_B?`<div class="num">${esc(a.stack)}</div>`:`<input id="stack-field" type="number" inputmode="decimal" value="${esc(a.stack)}">`}
        </div>
        <a class="field row-between" href="${esc(a.profile_url)}"><span>Your FOMO profile</span><span>@${esc(a.fomo_handle)} ›</span></a>
        <button class="field row-between" id="invite"><span>Invite a friend</span><span>Share ›</span></button>
        <div class="field row-between"><span>Telegram</span><span>${a.telegram?"connected":"not connected"}</span></div>
        ${(!PLAN_B && a.telegram)?`<button class="btn secondary" id="test-push">Send test push</button>`:""}
        <div id="push-row"></div>
        ${PLAN_B?`<div class="field"><span>Settings and pause/mode are changed in Telegram. This screen is read-only.</span></div>`:""}
      </div>`;
    for (const g of order) {
      const block = groups[g];
      if (!block) continue;
      html += `<div class="group-title">${g[0].toUpperCase()+g.slice(1)}</div><div class="list-screen">`;
      for (const [k, spec] of Object.entries(block)) {
        if (["night_start_balance","paper_nights_completed"].includes(k)) continue;
        const typ = spec.type;
        if (PLAN_B) {
          html += `<div class="field row-between"><span>${esc(k)}</span><span class="num">${esc(spec.value)}</span></div>`;
        } else if (typ === "bool") {
          html += `<div class="field row-between"><span>${esc(k)}</span>
            <button class="switch ${spec.value?"on":""}" data-set="${esc(k)}" data-bool="1"><i></i></button></div>`;
        } else if (typ === "choice") {
          html += `<div class="field"><label>${esc(k)}</label>
            <select data-set="${esc(k)}">${(spec.choices||[]).map(c=>`<option ${c===spec.value?"selected":""}>${esc(c)}</option>`).join("")}</select></div>`;
        } else if (typ === "float" || typ === "int") {
          const min = spec.min, max = spec.max;
          html += `<div class="field"><label>${esc(k)}</label>
            ${min!=null&&max!=null?`<input class="slider" type="range" min="${min}" max="${max}" step="${typ==="int"?1:0.01}" value="${spec.value}" data-set="${esc(k)}">`:""}
            <input type="number" inputmode="decimal" value="${spec.value}" data-set="${esc(k)}"></div>`;
        } else {
          html += `<div class="field"><label>${esc(k)}</label><input type="text" value="${esc(spec.value)}" data-set="${esc(k)}"></div>`;
        }
      }
      html += `</div>`;
    }
    return html;
  }

  function renderCoin() {
    const c = state.cache.coin;
    if (!c) return navbar("Coin") + skeleton();
    const mode = (state.cache.state || {}).mode || "PAPER";
    const chg = c.change_since_entry;
    const st = c.stats || {};
    const pos = c.position;
    const btn = c.has_position ? "Sell on FOMO" : "Buy on FOMO";
    return `${navbar(esc(c.symbol || c.name || "Coin"))}
      <div class="list-screen">
        <div class="hero-row" style="align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${esc(c.name || c.symbol || "")}</strong>
          <span class="chip">${esc(c.symbol || "X")} · Solana · ${esc(c.age || "")}</span>
          ${c.shield?`<span class="chip">${esc(c.shield)}</span>`:""}
          ${paperBadge(mode)}
        </div>
        <div class="coin-price display num">${c.price!=null?money(c.price,6):"—"}</div>
        <div class="${(chg||0)>=0?"pos":"neg"}">${chg!=null?("▲ "+pct(chg)+" since entry"):""}</div>
        <canvas id="coin-chart" style="width:100%;height:220px;margin-top:8px"></canvas>
        <div class="stats">
          <div class="stat"><div class="k">Market cap</div><div class="v num">${st.marketCap!=null?money(st.marketCap,0):"n/a"}</div></div>
          <div class="stat"><div class="k">Liquidity</div><div class="v num">${st.liquidity!=null?money(st.liquidity,0):"n/a"}</div></div>
          <div class="stat"><div class="k">24h volume</div><div class="v num">${st.volume24!=null?money(st.volume24,0):"n/a"}</div></div>
          <div class="stat"><div class="k">Holders</div><div class="v num">${st.holders!=null?st.holders:"n/a"}</div></div>
        </div>
        ${pos && pos.status && pos.status!=="closed"?`
          <div class="exit-card">
            <div class="t">Your position · ${money(pos.size_usd)} in · Executor</div>
            <div class="s" style="margin-top:8px">Stop ${pos.stop_price!=null?money(pos.stop_price,6):"—"} ·
              Trail ${c.exit&&c.exit.trail!=null?money(c.exit.trail,6):"—"} ·
              Timeout ${c.exit&&c.exit.timeout_s!=null?Math.round(c.exit.timeout_s/60)+"m left":"—"}</div>
          </div>` : (pos?"":`<!-- no exit card without a position -->`)}
        <a class="btn" href="${esc(c.link)}">${btn}</a>
      </div>`;
  }

  function renderAuditor() {
    const a = state.cache.audit;
    if (!a) return navbar("Auditor") + `<div class="empty">No coin taken apart yet</div>`;
    const layers = a.layers || [];
    const name = a.symbol || a.name || (a.mint||"").slice(0,8);
    const discs = [1,2,3,4,5,6,7,8].map((n) => {
      const L = layers.find((x) => x.layer===n || x.n===n) || {};
      const pass = L.pass === 1 || L.pass === true;
      const fail = L.pass === 0 || L.pass === false;
      const grey = (L.value_text || L.value) === "not checked";
      return `<div class="disc ${grey?"grey":pass?"ok":fail?"red":""}">
        <div class="orb"></div>
        <div class="lab">${esc(L.name || ("Layer "+n))}</div>
        <div class="val">${esc(L.value_text || L.value || "")}</div>
      </div>`;
    }).join("");
    const head = a.passed
      ? `<h2>Cleared · 8/8 parts</h2><p>Sent to Executor${a.size_usd!=null?" · "+money(a.size_usd):""}</p>`
      : (a.reason ? `<h2>Rejected · ${esc(a.reason)}</h2><p>Grok Bot won't buy ${esc(name)}</p>` : `<h2>${esc(name)}</h2>`);
    const enabled = (((state.cache.account||{}).settings||{}).auditor||{}).auditor_enabled;
    const on = !enabled || enabled.value !== false;
    return `${navbar("Auditor")}<div class="list-screen">
      ${head}
      <div class="discs">${discs}</div>
      ${PLAN_B?`<div class="field row-between"><span>Take apart before buying</span><span>${on?"on":"off"} · Telegram</span></div>`:
        `<div class="field row-between"><span>Take apart before buying</span>
        <button class="switch ${on?"on":""}" data-set="auditor_enabled" data-bool="1" id="aud-toggle"><i></i></button></div>`}
      <a class="btn" href="${esc(a.link)}">Open on FOMO</a>
    </div>`;
  }

  function paint() {
    $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    if (state.screen === "home") appEl.innerHTML = renderHome();
    else if (state.screen === "agents") appEl.innerHTML = renderAgents();
    else if (state.screen === "activity") appEl.innerHTML = renderActivity();
    else if (state.screen === "account") appEl.innerHTML = renderAccount();
    else if (state.screen === "coin") appEl.innerHTML = renderCoin();
    else if (state.screen === "auditor") appEl.innerHTML = renderAuditor();
    bind();
    afterPaint();
  }

  function afterPaint() {
    if (state.screen === "home") {
      const c = $("#home-chart");
      if (c && window.DeskCharts) {
        const ch = state.cache.chart || { points: [], marks: [], start: 200 };
        DeskCharts.lineChart(c, { points: ch.points, marks: ch.marks, start: ch.start, height: 160 });
      }
      $$(".score-ring").forEach((cv) => {
        const sc = cv.dataset.score === "" ? null : Number(cv.dataset.score);
        window.DeskCharts && DeskCharts.scoreRing(cv, sc, Number(cv.dataset.min || 70));
      });
    }
    if (state.screen === "coin") {
      const c = $("#coin-chart");
      const coin = state.cache.coin || {};
      if (c && window.DeskCharts) {
        DeskCharts.candleChart(c, {
          candles: coin.candles || [],
          stop: coin.exit && coin.exit.stop,
          trail: coin.exit && coin.exit.trail,
          height: 220,
        });
      }
    }
    if (state.screen === "account") maybePushRow();
  }

  function maybePushRow() {
    const row = $("#push-row");
    if (!row) return;
    if (PLAN_B) {
      row.innerHTML = `<div class="field"><span>Web push is not available on this host — there is no server to send pushes. Trade alerts stay in Telegram.</span>
        <div class="s" style="margin-top:6px">Chrome: menu → Add to Home screen to install the app.</div></div>`;
      return;
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (!standalone) {
      row.innerHTML = `<div class="field"><span>Add this app to your home screen, then you can enable notifications here.</span>
        <div class="s" style="margin-top:6px">Chrome: menu → Add to Home screen.</div></div>`;
      return;
    }
    row.innerHTML = `<button class="btn secondary" id="enable-push">Enable notifications</button>`;
    $("#enable-push") && $("#enable-push").addEventListener("click", enablePush);
  }

  async function enablePush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const pub = (state.cache.state || {}).vapid_public || (await (await fetch("vapid-public.txt")).text()).trim();
      const key = urlBase64ToUint8Array(pub);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("/api/push", { method: "POST", body: JSON.stringify(sub) });
      alert("Notifications on.");
    } catch (e) {
      alert("Couldn't enable notifications: " + e.message);
    }
  }
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  function bind() {
    $("#nav-acc") && $("#nav-acc").addEventListener("click", () => go("account"));
    $("#nav-search") && $("#nav-search").addEventListener("click", openSearch);
    $("#nav-bell") && $("#nav-bell").addEventListener("click", () => go("activity"));
    $("#range") && $$("#range button").forEach((b) => b.addEventListener("click", async () => {
      state.range = b.dataset.r;
      await loadChart();
      paint();
    }));
    $$("[data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
    $$("[data-open]").forEach((b) => b.addEventListener("click", () => {
      state.mint = b.dataset.mint;
      go(b.dataset.open, b.dataset.mint);
    }));
    $$("[data-pause]").forEach((b) => b.addEventListener("click", async () => {
      const name = b.dataset.pause.toLowerCase();
      const on = b.classList.contains("on");
      try {
        if (on) await api(`/api/agents/${name}/pause`, { method: "POST" });
        else await api(`/api/agents/${name}/resume`, { method: "POST" });
        await refresh();
      } catch (e) { alert(e.message); }
    }));
    $$("[data-set]").forEach((el) => {
      const send = async (val) => {
        if (el.dataset.bool && el.id === "aud-toggle" && el.classList.contains("on")) {
          if (!confirm("Turn off the auditor? Coins will skip the 8 safety layers.") || !confirm("Really turn it off?")) return;
        }
        try { await api("/api/settings", { method: "POST", body: JSON.stringify({ key: el.dataset.set, value: val }) }); await refresh(); }
        catch (e) { alert(e.message); }
      };
      if (el.dataset.bool) el.addEventListener("click", () => send(!(el.classList.contains("on"))));
      else if (el.tagName === "SELECT") el.addEventListener("change", () => send(el.value));
      else if (el.type === "range") el.addEventListener("change", () => send(el.value));
      else el.addEventListener("change", () => send(el.value));
    });
    $("#stack-field") && $("#stack-field").addEventListener("change", async (e) => {
      try { await api("/api/settings", { method: "POST", body: JSON.stringify({ key: "stack", value: e.target.value }) }); } catch (err) { alert(err.message); }
    });
    $("#to-live") && $("#to-live").addEventListener("click", async () => {
      const v = prompt("Type LIVE to confirm");
      if (v !== "LIVE") return;
      try { await api("/api/mode", { method: "POST", body: JSON.stringify({ mode: "LIVE", confirm: "LIVE" }) }); await refresh(); }
      catch (e) { alert(e.message); }
    });
    $("#to-paper") && $("#to-paper").addEventListener("click", async () => {
      await api("/api/mode", { method: "POST", body: JSON.stringify({ mode: "PAPER" }) });
      await refresh();
    });
    $("#invite") && $("#invite").addEventListener("click", shareInvite);
    $("#test-push") && $("#test-push").addEventListener("click", async () => {
      try { await api("/api/test-push", { method: "POST" }); } catch (e) { alert(e.message); }
    });
  }

  async function shareInvite() {
    const url = (state.cache.account || {}).signup_url;
    if (!url) return;
    try {
      if (navigator.share) { await navigator.share({ title: "FOMO", url }); return; }
    } catch (e) {}
    try { await navigator.clipboard.writeText(url); alert("Link copied"); } catch (e) { prompt("Copy this link", url); }
  }

  function openSearch() {
    const box = document.createElement("div");
    box.className = "search-overlay";
    box.innerHTML = `<input id="q" placeholder="Name, symbol or mint" autofocus>
      <div id="qres"></div>
      <button class="btn secondary" id="qclose">Close</button>`;
    document.body.appendChild(box);
    $("#qclose", box).addEventListener("click", () => box.remove());
    const coins = collectCoins();
    $("#q", box).addEventListener("input", () => {
      const q = $("#q", box).value.toLowerCase();
      const hits = coins.filter((c) => (c.name||"").toLowerCase().includes(q) || (c.symbol||"").toLowerCase().includes(q) || (c.mint||"").includes(q)).slice(0, 20);
      $("#qres", box).innerHTML = hits.map((c) => `<button class="activity-row" data-m="${esc(c.mint)}"><div class="t">${esc(c.symbol||c.name||c.mint)}</div></button>`).join("");
      $$("#qres [data-m]", box).forEach((b) => b.addEventListener("click", () => { box.remove(); go("coin", b.dataset.m); }));
    });
  }
  function collectCoins() {
    const out = [];
    (state.cache.activity || []).forEach((r) => r.mint && out.push({ mint: r.mint, name: r.title, symbol: r.title }));
    return out;
  }

  function go(screen, mint) {
    state.screen = screen;
    if (["home","agents","activity","account"].includes(screen)) state.tab = screen;
    if (mint) state.mint = mint;
    if (screen === "activity") api("/api/activity/read", { method: "POST" }).catch(() => {});
    refresh();
  }

  $$("#tabbar .tab").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));

  async function loadChart() {
    try { state.cache.chart = await api("/api/chart?range=" + state.range); } catch (e) {}
  }

  async function refresh() {
    if (PLAN_B && !DATA_PATH) {
      appEl.innerHTML = `<div class="empty">Open this app from the link I sent you (it includes a #d= fragment). After the first open it stays on this phone.</div>`;
      return;
    }
    if (!PLAN_B && !TOKEN) {
      appEl.innerHTML = `<div class="empty">Open this app from the link I sent you (it has a sign-in fragment). The token stays on this phone.</div>`;
      return;
    }
    try {
      const jobs = [api("/api/state"), api("/api/activity"), api("/api/trades").catch(() => ({ rows: [] }))];
      if (state.screen === "home") jobs.push(api("/api/chart?range=" + state.range));
      if (state.screen === "account") jobs.push(api("/api/account"));
      if (state.screen === "agents") {
        ["scanner","auditor","analyst","executor","risk"].forEach((n) => jobs.push(api(`/api/agents/${n}/decisions`)));
      }
      if (state.screen === "coin" && state.mint) jobs.push(api("/api/coin/" + state.mint));
      if (state.screen === "auditor" && state.mint) { jobs.push(api("/api/audit/" + state.mint)); jobs.push(api("/api/account")); }
      const results = await Promise.all(jobs);
      state.cache.state = results[0];
      state.cache.activity = results[1].rows || [];
      state.cache.trades = (results[2] && (results[2].rows || results[2].trades)) || [];
      let i = 3;
      if (state.screen === "home") state.cache.chart = results[i++];
      if (state.screen === "account") state.cache.account = results[i++];
      if (state.screen === "agents") {
        state.cache.decisions = {};
        ["scanner","auditor","analyst","executor","risk"].forEach((n) => {
          state.cache.decisions[n] = (results[i++] || {}).rows || [];
        });
      }
      if (state.screen === "coin" && state.mint) state.cache.coin = results[i++];
      if (state.screen === "auditor" && state.mint) { state.cache.audit = results[i++]; state.cache.account = results[i++]; }
      state.lastOk = Date.now();
      showError(true);
      paint();
    } catch (e) {
      if (!state.cache.state) appEl.innerHTML = navbar() + skeleton();
      showError(false);
    }
  }

  function startSSE() {
    if (PLAN_B) return; // no server; we poll published JSON
    if (!TOKEN || !window.EventSource) return;
    const es = new EventSource("/api/stream?t=" + encodeURIComponent(TOKEN));
    ["scan","audit_layer","verdict","signal","fill","exit","balance"].forEach((ev) => {
      es.addEventListener(ev, () => { refresh(); });
    });
    es.onerror = () => {};
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  go("home");
  startSSE();
  setInterval(() => { if (state.offline) { state.retryIn = 5; refresh(); } }, 5000);
  setInterval(refresh, 15000);
})();
