/* Yörünge — one-tap orbit game. Tap to switch between the inner and outer orbit. */
(function () {
  "use strict";
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const ui = { menu: $("menu"), over: $("over"), hud: $("hud"), score: $("score"), best: $("best"), final: $("final"), finalBest: $("finalBest"), newBest: $("newBest"), menuBest: $("menuBest"), mute: $("mute") };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} },
  };
  let best = parseInt(store.get("yorunge_best", "0"), 10) || 0;
  let muted = store.get("yorunge_mute", "0") === "1";

  /* ---------- sizing ---------- */
  let W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = [0, 0], U = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    U = Math.min(W, H);
    CX = W / 2; CY = H * 0.5;
    R = [U * 0.2, U * 0.36];
    makeStars();
  }

  /* ---------- sound (tiny synth, no files) ---------- */
  let ac = null;
  function beep(freq, dur, type, vol, slide) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  /* ---------- background ---------- */
  let stars = [];
  function makeStars() {
    stars = [];
    const n = Math.round((W * H) / 2600);
    for (let i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.2, a: Math.random() * 0.6 + 0.2, tw: Math.random() * 6 });
  }

  /* ---------- game state ---------- */
  const TAU = Math.PI * 2;
  let state = "menu"; // menu | play | over
  let g = null;
  function newGame() {
    g = {
      t: 0, ang: -Math.PI / 2, ring: 1, rad: R[1], from: R[1], switchT: 1,
      speed: 1.55, score: 0, combo: 0, comboT: 0,
      items: [],      // {kind:'rock'|'gem', ring, ang, spin, r, born}
      nextAt: 0.9,    // angle distance (rad) travelled until next spawn
      travelled: 0,
      parts: [], texts: [], shake: 0, dead: false, deadT: 0, trail: [],
      passed: 0,
    };
  }

  function angDiff(a, b) { let d = (a - b) % TAU; if (d < -Math.PI) d += TAU; if (d > Math.PI) d -= TAU; return d; }

  function spawn() {
    // Place things ahead of the ship, never closing both orbits at the same spot.
    const ahead = g.ang + Math.PI * (0.95 + Math.random() * 0.25);
    const hard = Math.min(1, g.score / 120);
    const roll = Math.random();
    const ring = Math.random() < 0.5 ? 0 : 1;
    const spin = g.score > 25 && Math.random() < 0.25 + hard * 0.25 ? (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.25) : 0;
    if (roll < 0.22) {
      g.items.push({ kind: "gem", ring, ang: ahead, spin: 0, r: U * 0.022, born: g.t });
    } else {
      g.items.push({ kind: "rock", ring, ang: ahead, spin, r: U * (0.026 + Math.random() * 0.012), born: g.t, rot: Math.random() * TAU, near: false });
      // sometimes a gem on the other orbit as a reward for switching
      if (Math.random() < 0.3) g.items.push({ kind: "gem", ring: 1 - ring, ang: ahead, spin: 0, r: U * 0.022, born: g.t });
    }
    const gap = Math.max(0.55, 1.05 - hard * 0.45) * (0.85 + Math.random() * 0.4);
    g.nextAt = gap;
  }

  function tap() {
    if (state === "menu") { start(); return; }
    if (state === "over") { if (g && g.t - g.deadT > 0.6) start(); return; }
    if (g.dead) return;
    g.ring = 1 - g.ring;
    g.from = g.rad; g.switchT = 0;
    beep(g.ring ? 520 : 380, 0.08, "triangle", 0.09);
  }

  function start() {
    newGame();
    state = "play";
    ui.menu.classList.add("hide"); ui.over.classList.add("hide"); ui.hud.classList.remove("hide");
    ui.score.textContent = "0"; ui.best.textContent = "En iyi " + best;
    beep(440, 0.12, "sine", 0.1, 880);
  }

  function die() {
    g.dead = true; g.deadT = g.t; g.shake = 18;
    buzz([60, 40, 120]);
    beep(200, 0.5, "sawtooth", 0.14, 50);
    burst(shipPos(), "#ff7a59", 40, 1.6);
    const isBest = g.score > best;
    if (isBest) { best = g.score; store.set("yorunge_best", best); }
    setTimeout(() => {
      state = "over";
      ui.final.textContent = g.score;
      ui.finalBest.textContent = best;
      ui.newBest.classList.toggle("hide", !isBest);
      ui.over.classList.remove("hide"); ui.hud.classList.add("hide");
    }, 750);
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
  }

  /* ---------- update ---------- */
  function update(dt) {
    if (!g) return;
    g.t += dt;
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 60);
    for (const p of g.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    g.parts = g.parts.filter((p) => p.t < p.life);
    for (const t of g.texts) t.t += dt;
    g.texts = g.texts.filter((t) => t.t < 0.9);
    if (state !== "play" || g.dead) return;

    // speed ramps up, capped
    g.speed = Math.min(3.6, 1.55 + g.t * 0.028 + g.score * 0.006);
    const da = g.speed * dt;
    g.ang += da; g.travelled += da;
    if (g.travelled >= g.nextAt) { g.travelled = 0; spawn(); }

    // orbit switch animation (fast ease-out)
    if (g.switchT < 1) {
      g.switchT = Math.min(1, g.switchT + dt / 0.13);
      const e = 1 - Math.pow(1 - g.switchT, 3);
      g.rad = g.from + (R[g.ring] - g.from) * e;
    } else g.rad = R[g.ring];
    const sp = shipPos();
    g.trail.push({ x: sp.x, y: sp.y }); if (g.trail.length > 18) g.trail.shift();

    if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) g.combo = 0; }

    const shipR = U * 0.024;
    // fairness: a spinning rock stops before it lines up with a rock on the other orbit
    for (const a of g.items) {
      if (a.kind !== "rock" || !a.spin) continue;
      for (const b of g.items) {
        if (b === a || b.kind !== "rock" || b.ring === a.ring) continue;
        if (Math.abs(angDiff(a.ang + a.spin * 0.6, b.ang)) < 0.42) { a.spin = 0; break; }
      }
    }
    for (const it of g.items) {
      if (it.dead) continue;
      it.ang += it.spin * dt;
      if (it.rot != null) it.rot += dt * 1.5;
      const d = angDiff(it.ang, g.ang);
      const p = itemPos(it);
      const dist = Math.hypot(p.x - sp.x, p.y - sp.y);
      if (it.kind === "rock") {
        if (dist < it.r + shipR * 0.8) { die(); return; }
        if (!it.near && dist < it.r + shipR * 2.6 && d < 0) { it.near = true; addScore(2, sp, "Kıl payı! +2", "#7cf2ff"); beep(900, 0.07, "square", 0.05); buzz(15); }
        if (d < -0.35 && !it.passed) { it.passed = true; g.passed++; addScore(1); }
      } else {
        if (dist < it.r + shipR * 1.4) {
          it.dead = true;
          g.combo++; g.comboT = 2.2;
          const pts = 5 * Math.min(g.combo, 5);
          addScore(pts, p, g.combo > 1 ? `Kombo x${Math.min(g.combo, 5)}  +${pts}` : `+${pts}`, "#ffd84d");
          burst(p, "#ffd84d", 16, 0.8);
          beep(660 + Math.min(g.combo, 5) * 110, 0.12, "sine", 0.12, 1320 + g.combo * 80);
          buzz(10);
        }
      }
    }
    // forget items far behind
    g.items = g.items.filter((it) => !it.dead && angDiff(it.ang, g.ang) > -Math.PI * 0.9);
  }

  /* ---------- draw ---------- */
  function draw() {
    const t = performance.now() / 1000;
    ctx.save();
    if (g && g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    // sky
    const bg = ctx.createRadialGradient(CX, CY, U * 0.05, CX, CY, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#1a1240"); bg.addColorStop(0.55, "#0b0920"); bg.addColorStop(1, "#04030c");
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
    for (const s of stars) { ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 1.5 + s.tw)); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;

    // orbits
    for (let i = 0; i < 2; i++) {
      ctx.strokeStyle = g && state === "play" && g.ring === i ? "rgba(140,170,255,.45)" : "rgba(140,170,255,.16)";
      ctx.lineWidth = 2; ctx.setLineDash([4, 10]);
      ctx.beginPath(); ctx.arc(CX, CY, R[i], 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);

    // planet
    const pr = U * 0.1;
    const glow = ctx.createRadialGradient(CX, CY, pr * 0.6, CX, CY, pr * 2.2);
    glow.addColorStop(0, "rgba(120,90,255,.35)"); glow.addColorStop(1, "rgba(120,90,255,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX, CY, pr * 2.2, 0, TAU); ctx.fill();
    const pg = ctx.createRadialGradient(CX - pr * 0.4, CY - pr * 0.4, pr * 0.1, CX, CY, pr);
    pg.addColorStop(0, "#b8a4ff"); pg.addColorStop(0.6, "#6a4cf0"); pg.addColorStop(1, "#2c1a8a");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(CX, CY, pr, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(CX, CY, pr * 1.55, pr * 0.42, -0.35, 0, TAU); ctx.stroke();

    if (g) {
      // items
      for (const it of g.items) {
        const p = itemPos(it);
        if (it.kind === "rock") drawRock(p, it.r, it.rot || 0);
        else drawGem(p, it.r, t);
      }
      // trail + ship
      if (!g.dead && state === "play") {
        for (let i = 0; i < g.trail.length; i++) {
          const q = g.trail[i], a = i / g.trail.length;
          ctx.fillStyle = `rgba(124,242,255,${a * 0.5})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, U * 0.012 * a + 1, 0, TAU); ctx.fill();
        }
        drawShip(shipPos(), g.ang + Math.PI / 2, U * 0.024);
      }
      for (const p of g.parts) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center"; ctx.font = `800 ${Math.round(U * 0.045)}px system-ui, sans-serif`;
      for (const tx of g.texts) { ctx.globalAlpha = 1 - tx.t / 0.9; ctx.fillStyle = tx.c; ctx.fillText(tx.text, tx.x, tx.y - 30 - tx.t * 50); }
      ctx.globalAlpha = 1;
    } else {
      // menu: a ship circling for show
      const a = t * 1.2;
      drawShip({ x: CX + Math.cos(a) * R[1], y: CY + Math.sin(a) * R[1] }, a + Math.PI / 2, U * 0.024);
    }
    ctx.restore();
  }

  function drawShip(p, rot, s) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
    ctx.shadowColor = "#7cf2ff"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#e9fbff";
    ctx.beginPath(); ctx.moveTo(0, -s * 1.3); ctx.lineTo(s * 0.9, s); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.9, s); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "#ff8a3d";
    ctx.beginPath(); ctx.moveTo(-s * 0.35, s * 0.75); ctx.lineTo(0, s * (1.3 + Math.random() * 0.5)); ctx.lineTo(s * 0.35, s * 0.75); ctx.fill();
    ctx.restore();
  }
  function drawRock(p, r, rot) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot);
    ctx.fillStyle = "#8b5a44"; ctx.strokeStyle = "#ff7a59"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, k = i % 2 ? 0.78 : 1; ctx.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.22, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawGem(p, r, t) {
    const s = r * (1 + Math.sin(t * 6) * 0.08);
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.shadowColor = "#ffd84d"; ctx.shadowBlur = 14; ctx.fillStyle = "#ffd84d";
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.8, 0); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(s * 0.3, 0); ctx.lineTo(0, -s * 0.1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function onPress(e) {
    if (e.target.closest && e.target.closest("button")) return; // buttons handle themselves
    e.preventDefault();
    tap();
  }
  window.addEventListener("pointerdown", onPress, { passive: false });
  window.addEventListener("keydown", (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); tap(); } });
  document.addEventListener("visibilitychange", () => { last = performance.now(); });
  window.addEventListener("resize", resize);

  $("play").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("share").addEventListener("click", async () => {
    const text = `Yörünge'de ${g ? g.score : 0} puan yaptım! Geçebilir misin? 🚀`;
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) await navigator.share({ title: "Yörünge", text, url });
      else { await navigator.clipboard.writeText(text + " " + url); $("share").textContent = "Kopyalandı ✓"; }
    } catch (e) {}
  });
  function setMute(m) { muted = m; store.set("yorunge_mute", m ? "1" : "0"); ui.mute.textContent = m ? "🔇" : "🔊"; }
  ui.mute.addEventListener("click", () => setMute(!muted));

  // install button (Android Chrome)
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("install").classList.remove("hide"); });
  $("install").addEventListener("click", () => { if (!installEvt) return; installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; $("install").classList.add("hide"); }); });
  window.addEventListener("appinstalled", () => $("install").classList.add("hide"));

  setMute(muted);
  ui.menuBest.textContent = best ? "En iyi skor: " + best : "";
  resize();
  requestAnimationFrame(frame);

  // for automated tests only
  window.__yorunge = { get state() { return state; }, get g() { return g; }, tap, R: () => R };
})();
