/* Orbit Dash (Yörünge) — one-tap orbit game. Tap to switch between the inner and outer orbit. */
(function () {
  "use strict";
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const T = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const ui = {
    menu: $("menu"), over: $("over"), hud: $("hud"), score: $("score"), best: $("best"), level: $("level"),
    final: $("final"), finalBest: $("finalBest"), newBest: $("newBest"), menuBest: $("menuBest"), mute: $("mute"),
    board: $("board"), boardList: $("boardList"), nameBox: $("nameBox"), nameInput: $("nameInput"),
    overBoard: $("overBoard"), overWrap: $("overBoardWrap"), revive: $("revive"), skins: $("skins"), unlock: $("unlock"),
  };

  const store = {
    get(k, d) {
      try { const v = window.Platform ? window.Platform.storage.get(k) : localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
    },
    set(k, v) {
      try { if (window.Platform) window.Platform.storage.set(k, v); else localStorage.setItem(k, String(v)); } catch (e) {}
    },
  };
  let best = parseInt(store.get("yorunge_best", "0"), 10) || 0;
  let muted = store.get("yorunge_mute", "0") === "1";
  let lastName = store.get("yorunge_name", "");

  /* ---------- leaderboard (top 10 on this phone) ---------- */
  function loadBoard() {
    try { const b = JSON.parse(store.get("yorunge_board", "[]")); return Array.isArray(b) ? b.filter((r) => r && typeof r.s === "number").slice(0, 10) : []; }
    catch (e) { return []; }
  }
  let board = loadBoard();
  function qualifies(s) { return s > 0 && (board.length < 10 || s > board[board.length - 1].s); }
  function addToBoard(name, s) {
    const row = { n: String(name || T("player")).trim().slice(0, 14) || T("player"), s, d: Date.now() };
    board.push(row);
    board.sort((a, b) => b.s - a.s || a.d - b.d);
    board = board.slice(0, 10);
    store.set("yorunge_board", JSON.stringify(board));
    return row;
  }
  function boardHTML(highlight) {
    if (!board.length) return `<div class="empty">${T("noScores")}</div>`;
    const medal = ["🥇", "🥈", "🥉"];
    return board.map((r, i) => `<div class="brow ${r === highlight ? "me" : ""}"><span class="rk">${medal[i] || i + 1}</span><span class="nm"></span><span class="sc">${r.s}</span></div>`).join("");
  }
  function fillBoard(el, highlight) {
    el.innerHTML = boardHTML(highlight);
    // names via textContent so any typed text stays plain text
    const rows = el.querySelectorAll(".brow .nm");
    rows.forEach((n, i) => { n.textContent = board[i].n; });
  }

  /* ---------- ship skins ---------- */
  const SKINS = [
    { name: "Buz", body: "#e9fbff", glow: "#7cf2ff", flame: "#ff8a3d", need: 0 },
    { name: "Altın", body: "#ffe27a", glow: "#ffd84d", flame: "#ff5a3d", need: 50 },
    { name: "Neon", body: "#ff7bd5", glow: "#ff4fc3", flame: "#7cf2ff", need: 100 },
    { name: "Zümrüt", body: "#7dffb0", glow: "#34d36b", flame: "#fff27a", need: 200 },
  ];
  let skin = Math.min(SKINS.length - 1, parseInt(store.get("yorunge_skin", "0"), 10) || 0);
  if (SKINS[skin].need > best) skin = 0;
  function renderSkins() {
    ui.skins.innerHTML = SKINS.map((s, i) => {
      const locked = best < s.need;
      return `<button class="skin ${i === skin ? "on" : ""} ${locked ? "locked" : ""}" data-skin="${i}" aria-label="${T("skin" + i)}">
        <span class="sw" style="background:${s.body};box-shadow:0 0 12px ${s.glow}"></span><small>${locked ? "🔒 " + s.need : T("skin" + i)}</small></button>`;
    }).join("");
  }

  /* ---------- level themes ---------- */
  const THEMES = [
    { sky: ["#1a1240", "#0b0920"], planet: ["#b8a4ff", "#6a4cf0", "#2c1a8a"], glow: "120,90,255", ring: "140,170,255" },
    { sky: ["#0f2a3f", "#061420"], planet: ["#9ef0ff", "#2bb3d9", "#0b4a73"], glow: "60,200,255", ring: "120,220,255" },
    { sky: ["#3a1030", "#160614"], planet: ["#ffb3d9", "#e0408f", "#6e1043"], glow: "255,80,170", ring: "255,150,210" },
    { sky: ["#2e2408", "#120d02"], planet: ["#ffe9a3", "#f0a92b", "#7a4a08"], glow: "255,190,60", ring: "255,220,140" },
    { sky: ["#0d2e1a", "#04140a"], planet: ["#b5ffcf", "#2fcf73", "#0b5a2c"], glow: "60,230,130", ring: "140,255,190" },
  ];
  const LEVEL_EVERY = 60;

  /* ---------- sizing ---------- */
  let W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = [0, 0], U = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    U = Math.min(W, H);
    CX = W / 2;
    if (W > H * 1.1) { CY = H * 0.53; R = [U * 0.18, U * 0.32]; } // landscape / desktop: keep clear of the score
    else { CY = H * 0.5; R = [U * 0.2, U * 0.36]; }
    makeSky();
  }

  /* ---------- sound (tiny synth, no files) ---------- */
  let ac = null;
  function beep(freq, dur, type, vol, slide) {
    if (muted || adPlaying || (window.Platform && window.Platform.sdkMuted)) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), gn = ac.createGain(), t = ac.currentTime;
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gn.gain.setValueAtTime(vol || 0.15, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  /* ---------- background ---------- */
  let stars = [], nebulas = [];
  function makeSky() {
    stars = [];
    const n = Math.round((W * H) / 2200);
    for (let i = 0; i < n; i++) stars.push({ a0: Math.random() * Math.PI * 2, d: Math.sqrt(Math.random()) * Math.hypot(W, H) * 0.6, r: Math.random() * 1.5 + 0.2, a: Math.random() * 0.6 + 0.2, tw: Math.random() * 6, layer: Math.random() < 0.7 ? 0.02 : 0.05 });
    nebulas = [];
    for (let i = 0; i < 4; i++) nebulas.push({ x: Math.random() * W, y: Math.random() * H, r: U * (0.35 + Math.random() * 0.4), hue: Math.random() });
  }

  /* ---------- game state ---------- */
  const TAU = Math.PI * 2;
  let state = "menu"; // menu | play | over
  let g = null;
  let skyRot = 0;
  let themeIdx = 0, themeMix = 1, themePrev = 0;
  let awaitingName = false, lastRow = null;
  // ads (CrazyGames only; on our own site Platform.adsAvailable is false)
  const PF = window.Platform || { adsAvailable: false, name: "web", gameplayStart() {}, gameplayStop() {}, happytime() {}, showAd: () => Promise.resolve(false), init: () => Promise.resolve() };
  let adPlaying = false, runs = 0, lastAdAt = Date.now();
  const MIDGAME_GAP_MS = 150000, MIDGAME_MIN_RUNS = 2;

  function newGame() {
    g = {
      t: 0, ang: -Math.PI / 2, ring: 1, rad: R[1], from: R[1], switchT: 1,
      speed: 1.25, score: 0, combo: 0, comboT: 0, level: 1, shield: false, shieldT: 0,
      items: [], nextAt: 2.2, travelled: 0,
      parts: [], texts: [], shake: 0, dead: false, deadT: 0, trail: [], banner: null, flash: 0,
    };
    setTheme(0, true);
  }
  function setTheme(i, instant) {
    if (i === themeIdx && instant) { themeMix = 1; return; }
    themePrev = themeIdx; themeIdx = i % THEMES.length; themeMix = instant ? 1 : 0;
  }

  function angDiff(a, b) { let d = (a - b) % TAU; if (d < -Math.PI) d += TAU; if (d > Math.PI) d -= TAU; return d; }

  function spawn() {
    // Place things ahead of the ship, never closing both orbits at the same spot.
    const ahead = g.ang + Math.PI * (0.72 + Math.random() * 0.12);
    const hard = Math.min(1, g.score / 250);
    const roll = Math.random();
    const ring = Math.random() < 0.5 ? 0 : 1;
    const spin = g.score > 80 && Math.random() < 0.1 + hard * 0.2 ? (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.25) : 0;
    if (g.score > 15 && !g.shield && roll < 0.05) {
      g.items.push({ kind: "shield", ring, ang: ahead, spin: 0, r: U * 0.024, born: g.t });
    } else if (roll < 0.25) {
      g.items.push({ kind: "gem", ring, ang: ahead, spin: 0, r: U * 0.022, born: g.t });
    } else {
      g.items.push({ kind: "rock", ring, ang: ahead, spin, r: U * (0.026 + Math.random() * 0.012), born: g.t, rot: Math.random() * TAU, near: false, seed: Math.random() });
      if (Math.random() < 0.3) g.items.push({ kind: "gem", ring: 1 - ring, ang: ahead, spin: 0, r: U * 0.022, born: g.t });
    }
    g.nextAt = Math.max(0.75, 1.3 - hard * 0.5) * (0.9 + Math.random() * 0.35);
  }

  function tap() {
    if (state === "menu") { start(); return; }
    if (state === "over") { if (!awaitingName && !adPlaying && g && g.t - g.deadT > 0.6) again(); return; }
    if (g.dead) return;
    g.ring = 1 - g.ring; g.tapped = true;
    g.from = g.rad; g.switchT = 0;
    beep(g.ring ? 520 : 380, 0.08, "triangle", 0.09);
  }

  function start() {
    if (awaitingName) saveName(); // Tekrar while naming: keep the score, then play
    newGame();
    state = "play";
    ui.menu.classList.add("hide"); ui.over.classList.add("hide"); ui.board.classList.add("hide"); ui.hud.classList.remove("hide");
    ui.score.textContent = "0"; ui.best.textContent = T("bestHud", { n: best }); ui.level.textContent = T("level", { n: 1 });
    beep(440, 0.12, "sine", 0.1, 880);
    runs++;
    PF.gameplayStart();
  }

  // "Tekrar": now and then a short ad between games (never more often than every 2.5 minutes)
  async function again() {
    if (adPlaying) return;
    if (awaitingName) saveName();
    if (PF.adsAvailable && runs >= MIDGAME_MIN_RUNS && Date.now() - lastAdAt > MIDGAME_GAP_MS) {
      adPlaying = true;
      await PF.showAd("midgame");
      adPlaying = false; lastAdAt = Date.now();
    }
    start();
  }

  // Rewarded ad: watch an ad, keep playing from where you died (once per game)
  async function revive() {
    if (adPlaying || !g || !g.dead || g.revived) return;
    adPlaying = true;
    ui.revive.disabled = true; ui.revive.textContent = T("adLoading");
    const ok = await PF.showAd("rewarded");
    adPlaying = false; lastAdAt = Date.now();
    if (!ok) { const code = String(PF.lastAdError || "").slice(0, 24); ui.revive.textContent = T("noAd") + (code ? " (" + code + ")" : ""); ui.revive.disabled = false; return; }
    g.revived = true; g.dead = false; g.flash = 0; g.shake = 0;
    // clear the way and give a free shield
    g.items = g.items.filter((it) => it.kind !== "rock" || it.ang - g.ang > 1.6 || it.ang - g.ang < -0.2);
    g.shield = true; g.shieldT = 0; g.switchT = 1; g.travelled = 0; g.nextAt = 1.2;
    awaitingName = false;
    state = "play";
    ui.over.classList.add("hide"); ui.hud.classList.remove("hide");
    float(shipPos(), T("resume"), "#7dffb0");
    beep(523, 0.1, "sine", 0.1, 1046);
    PF.gameplayStart();
  }

  function die() {
    g.dead = true; g.deadT = g.t; g.shake = 18; g.flash = 0.35;
    buzz([60, 40, 120]);
    beep(200, 0.5, "sawtooth", 0.14, 50);
    burst(shipPos(), "#ff7a59", 46, 1.7);
    burst(shipPos(), SKINS[skin].glow, 20, 1.1);
    const oldBest = best;
    const isBest = g.score > best;
    if (isBest) { best = g.score; store.set("yorunge_best", best); }
    const unlocked = SKINS.filter((s) => s.need > oldBest && s.need <= best);
    PF.gameplayStop();
    if (isBest) PF.happytime();
    setTimeout(() => {
      const canRevive = PF.adsAvailable && !g.revived;
      ui.revive.classList.toggle("hide", !canRevive);
      ui.revive.disabled = false; ui.revive.textContent = T("watchAd");
      state = "over";
      ui.final.textContent = g.score;
      ui.finalBest.textContent = best;
      ui.newBest.classList.toggle("hide", !isBest);
      ui.unlock.classList.toggle("hide", !unlocked.length);
      if (unlocked.length) ui.unlock.textContent = T("newShip", { s: unlocked.map((s) => T("skin" + SKINS.indexOf(s))).join(", ") });
      lastRow = null;
      awaitingName = qualifies(g.score);
      ui.nameBox.classList.toggle("hide", !awaitingName);
      ui.overWrap.classList.toggle("hide", awaitingName);
      if (awaitingName) { ui.nameInput.value = lastName; }
      else fillBoard(ui.overBoard, null);
      ui.over.classList.remove("hide"); ui.hud.classList.add("hide");
    }, 750);
  }

  function saveName() {
    if (!awaitingName) return;
    const name = ui.nameInput.value.trim() || T("player");
    lastName = name; store.set("yorunge_name", name);
    lastRow = addToBoard(name, g.score);
    awaitingName = false;
    try { ui.nameInput.blur(); } catch (e) {}
    ui.nameBox.classList.add("hide");
    fillBoard(ui.overBoard, lastRow);
    ui.overWrap.classList.remove("hide");
    beep(784, 0.15, "sine", 0.1, 1175);
  }

  function shipPos() { return { x: CX + Math.cos(g.ang) * g.rad, y: CY + Math.sin(g.ang) * g.rad }; }
  function itemPos(it) { const r = R[it.ring]; return { x: CX + Math.cos(it.ang) * r, y: CY + Math.sin(it.ang) * r }; }

  function burst(p, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (Math.random() * 180 + 60) * (power || 1);
      g.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.5, t: 0, c: color, r: Math.random() * 2.5 + 1 });
    }
  }
  function float(p, text, color) { g.texts.push({ x: p.x, y: p.y, text, c: color, t: 0 }); }

  function addScore(n, p, label, color) {
    g.score += n;
    ui.score.textContent = g.score;
    ui.score.classList.remove("pop"); void ui.score.offsetWidth; ui.score.classList.add("pop");
    if (label) float(p, label, color);
    const lv = 1 + Math.floor(g.score / LEVEL_EVERY);
    if (lv > g.level) {
      g.level = lv;
      ui.level.textContent = T("level", { n: lv });
      g.banner = { text: T("levelBanner", { n: lv }), t: 0 };
      setTheme(lv - 1, false);
      beep(523, 0.12, "triangle", 0.1); setTimeout(() => beep(659, 0.12, "triangle", 0.1), 110); setTimeout(() => beep(784, 0.2, "triangle", 0.1), 220);
      buzz([20, 30, 20]);
    }
  }

  /* ---------- update ---------- */
  function update(dt) {
    skyRot -= dt * (g && state === "play" ? 0.02 + g.speed * 0.01 : 0.015);
    if (themeMix < 1) themeMix = Math.min(1, themeMix + dt / 1.2);
    if (!g) return;
    g.t += dt;
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 60);
    if (g.flash > 0) g.flash = Math.max(0, g.flash - dt);
    for (const p of g.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    g.parts = g.parts.filter((p) => p.t < p.life);
    for (const t of g.texts) t.t += dt;
    g.texts = g.texts.filter((t) => t.t < 0.9);
    if (g.banner) { g.banner.t += dt; if (g.banner.t > 1.6) g.banner = null; }
    if (state !== "play" || g.dead) return;

    g.speed = Math.min(3.0, 1.25 + g.t * 0.016 + g.score * 0.004);
    const da = g.speed * dt;
    g.ang += da; g.travelled += da;
    if (g.travelled >= g.nextAt) { g.travelled = 0; spawn(); }

    if (g.switchT < 1) {
      g.switchT = Math.min(1, g.switchT + dt / 0.13);
      const e = 1 - Math.pow(1 - g.switchT, 3);
      g.rad = g.from + (R[g.ring] - g.from) * e;
    } else g.rad = R[g.ring];
    const sp = shipPos();
    g.trail.push({ x: sp.x, y: sp.y }); if (g.trail.length > 20) g.trail.shift();
    if (Math.random() < 0.5) g.parts.push({ x: sp.x, y: sp.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.35, t: 0, c: SKINS[skin].flame, r: Math.random() * 1.6 + 0.6 });

    if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) g.combo = 0; }
    if (g.shield) g.shieldT += dt;

    // fairness: a spinning rock stops before it lines up with a rock on the other orbit
    for (const a of g.items) {
      if (a.kind !== "rock" || !a.spin) continue;
      for (const b of g.items) {
        if (b === a || b.kind !== "rock" || b.ring === a.ring) continue;
        if (Math.abs(a.ang + a.spin * 0.6 - b.ang) < 0.5) { a.spin = 0; break; }
      }
    }

    const shipR = U * 0.024;
    for (const it of g.items) {
      if (it.dead) continue;
      it.ang += it.spin * dt;
      if (it.rot != null) it.rot += dt * 1.5;
      const d = it.ang - g.ang;
      const p = itemPos(it);
      const dist = Math.hypot(p.x - sp.x, p.y - sp.y);
      if (it.kind === "rock") {
        if (dist < it.r * 0.85 + shipR * 0.7) {
          if (g.shield) {
            it.dead = true; g.shield = false; g.shake = 9;
            burst(p, "#8b5a44", 24, 1.2); burst(p, "#7cc8ff", 24, 1);
            float(sp, T("shieldHit"), "#7cc8ff"); beep(300, 0.25, "square", 0.08, 120); buzz([30, 30, 30]);
            continue;
          }
          die(); return;
        }
        if (!it.near && dist < it.r + shipR * 2.6 && d < 0) { it.near = true; addScore(2, sp, T("nearMiss"), "#7cf2ff"); beep(900, 0.07, "square", 0.05); buzz(15); }
        if (d < -0.35 && !it.passed) { it.passed = true; addScore(1); }
      } else if (it.kind === "gem") {
        if (dist < it.r + shipR * 1.4) {
          it.dead = true;
          g.combo++; g.comboT = 2.2;
          const pts = 5 * Math.min(g.combo, 5);
          addScore(pts, p, g.combo > 1 ? T("combo", { c: Math.min(g.combo, 5), p: pts }) : `+${pts}`, "#ffd84d");
          burst(p, "#ffd84d", 18, 0.8);
          beep(660 + Math.min(g.combo, 5) * 110, 0.12, "sine", 0.12, 1320 + g.combo * 80);
          buzz(10);
        }
      } else if (it.kind === "shield") {
        if (dist < it.r + shipR * 1.5) {
          it.dead = true; g.shield = true; g.shieldT = 0;
          float(p, T("shieldGot"), "#7cc8ff"); burst(p, "#7cc8ff", 22, 0.9);
          beep(523, 0.1, "sine", 0.1, 1046); buzz(20);
        }
      }
    }
    g.items = g.items.filter((it) => !it.dead && it.ang - g.ang > -1.4);
  }

  /* ---------- draw ---------- */
  function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const gg = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return `rgb(${r},${gg},${bl})`;
  }
  function mixRGB(a, b, t) { const x = a.split(",").map(Number), y = b.split(",").map(Number); return x.map((v, i) => Math.round(v * (1 - t) + y[i] * t)).join(","); }

  function draw() {
    const t = performance.now() / 1000;
    const A = THEMES[themePrev], B = THEMES[themeIdx], m = themeMix;
    ctx.save();
    if (g && g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    // sky
    const bg = ctx.createRadialGradient(CX, CY, U * 0.05, CX, CY, Math.max(W, H) * 0.8);
    bg.addColorStop(0, mixHex(A.sky[0], B.sky[0], m)); bg.addColorStop(0.6, mixHex(A.sky[1], B.sky[1], m)); bg.addColorStop(1, "#030209");
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
    // nebula clouds
    const glowRGB = mixRGB(A.glow, B.glow, m);
    for (const n of nebulas) {
      const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      ng.addColorStop(0, `rgba(${glowRGB},0.10)`); ng.addColorStop(1, `rgba(${glowRGB},0)`);
      ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.fill();
    }
    // stars slowly turning (two depths)
    for (const s of stars) {
      const a = s.a0 + skyRot * (s.layer * 20);
      const x = CX + Math.cos(a) * s.d, y = CY + Math.sin(a) * s.d;
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 1.5 + s.tw)); ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // orbits
    const ringRGB = mixRGB(A.ring, B.ring, m);
    for (let i = 0; i < 2; i++) {
      const active = g && state === "play" && g.ring === i;
      ctx.strokeStyle = `rgba(${ringRGB},${active ? 0.5 : 0.16})`;
      ctx.lineWidth = active ? 2.5 : 2; ctx.setLineDash([4, 10]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); ctx.arc(CX, CY, R[i], 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);

    // planet
    const pr = U * 0.1 * (1 + Math.sin(t * 1.2) * 0.015);
    const glow = ctx.createRadialGradient(CX, CY, pr * 0.6, CX, CY, pr * 2.4);
    glow.addColorStop(0, `rgba(${glowRGB},.38)`); glow.addColorStop(1, `rgba(${glowRGB},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX, CY, pr * 2.4, 0, TAU); ctx.fill();
    const pg = ctx.createRadialGradient(CX - pr * 0.4, CY - pr * 0.4, pr * 0.1, CX, CY, pr);
    pg.addColorStop(0, mixHex(A.planet[0], B.planet[0], m)); pg.addColorStop(0.6, mixHex(A.planet[1], B.planet[1], m)); pg.addColorStop(1, mixHex(A.planet[2], B.planet[2], m));
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(CX, CY, pr, 0, TAU); ctx.fill();
    // planet bands
    ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, pr, 0, TAU); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = pr * 0.12;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(CX + Math.sin(t * 0.3) * pr * 0.1, CY + k * pr * 0.35, pr * 1.2, pr * 0.12, 0.15, 0, TAU); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(CX, CY, pr * 1.6, pr * 0.42, -0.35, 0, TAU); ctx.stroke();

    if (g) {
      for (const it of g.items) {
        const p = itemPos(it);
        const ahead = it.ang - g.ang;
        ctx.globalAlpha = Math.max(0, Math.min(1, (g.t - it.born) / 0.4, (ahead + 1.4) / 0.6));
        if (it.kind === "rock") drawRock(p, it.r, it.rot || 0, it.seed || 0);
        else if (it.kind === "gem") drawGem(p, it.r, t);
        else drawShieldItem(p, it.r, t);
      }
      ctx.globalAlpha = 1;
      if (!g.dead && state === "play") {
        const sk = SKINS[skin];
        for (let i = 0; i < g.trail.length; i++) {
          const q = g.trail[i], a = i / g.trail.length;
          ctx.fillStyle = hexA(sk.glow, a * 0.45);
          ctx.beginPath(); ctx.arc(q.x, q.y, U * 0.013 * a + 1, 0, TAU); ctx.fill();
        }
        const sp = shipPos();
        drawShip(sp, g.ang + Math.PI / 2, U * 0.024, sk);
        if (g.shield) {
          ctx.strokeStyle = `rgba(124,200,255,${0.55 + Math.sin(g.shieldT * 8) * 0.25})`; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, U * 0.048, 0, TAU); ctx.stroke();
          ctx.fillStyle = "rgba(124,200,255,.12)"; ctx.fill();
        }
      }
      for (const p of g.parts) { ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center"; ctx.font = `800 ${Math.round(U * 0.045)}px system-ui, sans-serif`;
      for (const tx of g.texts) { ctx.globalAlpha = 1 - tx.t / 0.9; ctx.fillStyle = tx.c; ctx.fillText(tx.text, tx.x, tx.y - 30 - tx.t * 50); }
      ctx.globalAlpha = 1;
      if (g.banner) {
        const bt = g.banner.t, a = bt < 0.3 ? bt / 0.3 : bt > 1.2 ? Math.max(0, 1 - (bt - 1.2) / 0.4) : 1;
        ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(U * 0.09 * (1 + (1 - a) * 0.2))}px system-ui, sans-serif`;
        ctx.shadowColor = `rgb(${glowRGB})`; ctx.shadowBlur = 24;
        ctx.fillText(g.banner.text, CX, CY - R[1] - U * 0.08);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      if (state === "play" && !g.dead && g.t < 3.5 && !g.tapped) {
        ctx.globalAlpha = Math.min(1, (3.5 - g.t) / 0.5) * (0.75 + 0.25 * Math.sin(t * 6));
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `800 ${Math.round(U * 0.05)}px system-ui, sans-serif`;
        ctx.fillText(T("tapHint"), CX, Math.min(CY + R[1] + U * 0.14, H - U * 0.05));
        ctx.globalAlpha = 1;
      }
      if (g.flash > 0) { ctx.fillStyle = `rgba(255,120,90,${g.flash * 0.6})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
    } else {
      const a = t * 1.2;
      drawShip({ x: CX + Math.cos(a) * R[1], y: CY + Math.sin(a) * R[1] }, a + Math.PI / 2, U * 0.024, SKINS[skin]);
    }
    ctx.restore();
  }

  function hexA(hex, a) { const p = parseInt(hex.slice(1), 16); return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`; }
  function drawShip(p, rot, s, sk) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
    ctx.shadowColor = sk.glow; ctx.shadowBlur = 18;
    ctx.fillStyle = sk.body;
    ctx.beginPath(); ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.9, s); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.9, s); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = sk.flame;
    ctx.beginPath(); ctx.moveTo(-s * 0.35, s * 0.75); ctx.lineTo(0, s * (1.3 + Math.random() * 0.6)); ctx.lineTo(s * 0.35, s * 0.75); ctx.fill();
    ctx.restore();
  }
  function drawRock(p, r, rot, seed) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
    ctx.shadowColor = "rgba(255,110,80,.6)"; ctx.shadowBlur = 10;
    const rg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    rg.addColorStop(0, "#b07a5e"); rg.addColorStop(1, "#5a3426");
    ctx.fillStyle = rg; ctx.strokeStyle = "#ff7a59"; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, k = 0.78 + 0.22 * Math.abs(Math.sin(i * 2.3 + seed * 10)); ctx.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.22, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-r * 0.3, r * 0.25, r * 0.14, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawGem(p, r, t) {
    const s = r * (1 + Math.sin(t * 6) * 0.08);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(t * 2) * 0.15);
    ctx.shadowColor = "#ffd84d"; ctx.shadowBlur = 16; ctx.fillStyle = "#ffd84d";
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.8, 0); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(s * 0.3, 0); ctx.lineTo(0, -s * 0.1); ctx.closePath(); ctx.fill();
    // sparkle
    const k = (Math.sin(t * 5 + p.x) + 1) / 2;
    ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s * 0.9, -s * 0.9 - s * 0.35 * k); ctx.lineTo(s * 0.9, -s * 0.9 + s * 0.35 * k);
    ctx.moveTo(s * 0.9 - s * 0.35 * k, -s * 0.9); ctx.lineTo(s * 0.9 + s * 0.35 * k, -s * 0.9); ctx.stroke();
    ctx.restore();
  }
  function drawShieldItem(p, r, t) {
    ctx.save(); ctx.translate(p.x, p.y);
    const s = r * (1 + Math.sin(t * 5) * 0.1);
    ctx.shadowColor = "#7cc8ff"; ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(124,200,255,.25)"; ctx.strokeStyle = "#a6dcff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "#e6f6ff";
    ctx.beginPath(); ctx.moveTo(0, -s * 0.55); ctx.lineTo(s * 0.45, -s * 0.3); ctx.lineTo(s * 0.35, s * 0.25); ctx.lineTo(0, s * 0.6); ctx.lineTo(-s * 0.35, s * 0.25); ctx.lineTo(-s * 0.45, -s * 0.3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    try { update(dt); draw(); } catch (e) { /* keep the loop alive */ }
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function onPress(e) {
    if (e.target.closest && e.target.closest("button, input, select, option, label, .langwrap, .skins, .panel, a")) return; // UI handles itself
    e.preventDefault();
    tap();
  }
  window.addEventListener("pointerdown", onPress, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") { if (e.key === "Enter") { e.preventDefault(); saveName(); } return; }
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); tap(); }
  });
  document.addEventListener("visibilitychange", () => { last = performance.now(); });
  window.addEventListener("resize", resize);

  $("play").addEventListener("click", start);
  $("again").addEventListener("click", again);
  ui.revive.addEventListener("click", revive);
  $("saveName").addEventListener("click", saveName);
  $("openBoard").addEventListener("click", () => { fillBoard(ui.boardList, null); ui.board.classList.remove("hide"); });
  $("closeBoard").addEventListener("click", () => ui.board.classList.add("hide"));
  $("share").addEventListener("click", async () => {
    const text = T("shareText", { n: g ? g.score : 0 });
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) await navigator.share({ title: T("title"), text, url });
      else { await navigator.clipboard.writeText(text + " " + url); $("share").textContent = T("copied"); }
    } catch (e) {}
  });
  ui.skins.addEventListener("click", (e) => {
    const b = e.target.closest("[data-skin]"); if (!b) return;
    const i = +b.dataset.skin;
    if (best < SKINS[i].need) { beep(180, 0.12, "square", 0.06); b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 400); return; }
    skin = i; store.set("yorunge_skin", i); renderSkins(); beep(660, 0.08, "sine", 0.08);
  });
  function setMute(m) { muted = m; store.set("yorunge_mute", m ? "1" : "0"); ui.mute.textContent = m || (window.Platform && window.Platform.sdkMuted) ? "🔇" : "🔊"; }
  ui.mute.addEventListener("click", () => setMute(!muted));

  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (PF.name !== "crazygames") $("install").classList.remove("hide"); });
  $("install").addEventListener("click", () => { if (!installEvt) return; installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; $("install").classList.add("hide"); }); });
  window.addEventListener("appinstalled", () => $("install").classList.add("hide"));

  // back to menu (and refresh skins) when returning from game over
  $("toMenu").addEventListener("click", () => {
    if (awaitingName) saveName();
    state = "menu"; g = null; setTheme(0, true);
    ui.over.classList.add("hide"); ui.menu.classList.remove("hide");
    refreshMenuText();
  });

  PF.init().then(() => {
    if (PF.name !== "crazygames") return;
    $("share").classList.add("hide"); $("install").classList.add("hide");
    // saved progress may live in the CrazyGames Data Module: read it again now that the SDK is ready
    best = Math.max(best, parseInt(store.get("yorunge_best", "0"), 10) || 0);
    muted = store.get("yorunge_mute", muted ? "1" : "0") === "1";
    lastName = store.get("yorunge_name", lastName);
    board = loadBoard();
    const sk = parseInt(store.get("yorunge_skin", String(skin)), 10) || 0;
    skin = SKINS[sk] && SKINS[sk].need <= best ? sk : 0;
    setMute(muted);
    if (typeof refreshMenuText === "function") refreshMenuText();
    PF.onMuteChange(() => setMute(muted));
  }).catch(() => {});
  setMute(muted);
  // language menu
  function refreshMenuText() {
    ui.menuBest.textContent = best ? T("bestScore", { n: best }) : "";
    renderSkins();
    if (ui.board && !ui.board.classList.contains("hide")) fillBoard(ui.boardList, null);
  }
  const langSel = $("lang");
  if (langSel && window.I18N) {
    langSel.innerHTML = window.I18N.list.map((l) => `<option value="${l.code}">${l.label}</option>`).join("");
    langSel.value = window.I18N.lang;
    langSel.addEventListener("change", () => window.I18N.set(langSel.value));
    window.I18N.onChange(() => { refreshMenuText(); if (g && state === "play") { ui.best.textContent = T("bestHud", { n: best }); ui.level.textContent = T("level", { n: g.level }); } });
    window.I18N.apply();
  }
  refreshMenuText();
  renderSkins();
  resize();
  requestAnimationFrame(frame);

  // for automated tests only
  window.__yorunge = { get state() { return state; }, get g() { return g; }, tap, R: () => R, get awaitingName() { return awaitingName; }, PF, revive, again };
})();
