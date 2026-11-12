/* Hand-drawn canvas charts. No chart library. devicePixelRatio aware. */
(function (global) {
  const GREEN = "#00d35a";
  const ORANGE = "#ff9f0a";
  const RED = "#ff453a";
  const MUTED = "rgba(235,235,245,0.3)";

  function size(canvas, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    const h = cssH || canvas.clientHeight || 160;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function lineChart(canvas, opts) {
    const { ctx, w, h } = size(canvas, opts.height || 160);
    ctx.clearRect(0, 0, w, h);
    const pts = opts.points || [];
    const pad = { l: 8, r: 8, t: 24, b: 8 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    if (!pts.length) {
      // empty: dashed start line
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = MUTED;
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + ih * 0.6);
      ctx.lineTo(pad.l + iw, pad.t + ih * 0.6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = MUTED;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Waiting for the first trade", pad.l, pad.t + ih * 0.6 - 10);
      return;
    }
    const values = pts.map((p) => +p.value);
    const start = opts.start != null ? +opts.start : values[0];
    let min = Math.min(start, ...values);
    let max = Math.max(start, ...values);
    if (min === max) { min -= 1; max += 1; }
    const y = (v) => pad.t + ih * (1 - (v - min) / (max - min));
    const x = (i) => pad.l + (pts.length === 1 ? iw / 2 : (iw * i) / (pts.length - 1));

    // fill
    const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    g.addColorStop(0, "rgba(0,211,90,0.28)");
    g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(values[i])) : ctx.moveTo(x(i), y(values[i]))));
    ctx.lineTo(x(pts.length - 1), pad.t + ih);
    ctx.lineTo(x(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // start dashed
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = MUTED;
    ctx.beginPath();
    ctx.moveTo(pad.l, y(start));
    ctx.lineTo(pad.l + iw, y(start));
    ctx.stroke();
    ctx.setLineDash([]);

    // line
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(values[i])) : ctx.moveTo(x(i), y(values[i]))));
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.stroke();

    // marks, stacked if they collide
    const marks = (opts.marks || []).slice();
    const used = [];
    marks.forEach((m) => {
      const ts = m.ts;
      let idx = pts.findIndex((p) => p.ts >= ts);
      if (idx < 0) idx = pts.length - 1;
      const mx = x(idx);
      let row = 0;
      while (used.some((u) => Math.abs(u.x - mx) < 60 && u.row === row)) row++;
      used.push({ x: mx, row });
      const my = y(values[idx]) - 10 - row * 14;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = m.color || "#0a84ff";
      ctx.textAlign = "center";
      ctx.fillText(m.label, mx, Math.max(12, my));
    });
  }

  function candleChart(canvas, opts) {
    const { ctx, w, h } = size(canvas, opts.height || 220);
    ctx.clearRect(0, 0, w, h);
    const cs = opts.candles || [];
    const pad = { l: 8, r: 8, t: 8, b: 40 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    if (!cs.length) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("No candles yet", pad.l, pad.t + 24);
      return;
    }
    const highs = cs.map((c) => c.h);
    const lows = cs.map((c) => c.l);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (opts.stop != null) { min = Math.min(min, opts.stop); max = Math.max(max, opts.stop); }
    if (opts.trail != null) { min = Math.min(min, opts.trail); max = Math.max(max, opts.trail); }
    if (min === max) { min -= 1; max += 1; }
    const y = (v) => pad.t + ih * (1 - (v - min) / (max - min));
    const n = cs.length;
    const slot = iw / n;
    const body = Math.max(1, slot * 0.6);
    const maxV = Math.max(...cs.map((c) => c.v || 0), 1);
    // volume
    cs.forEach((c, i) => {
      const vx = pad.l + i * slot + (slot - body) / 2;
      const vh = ((c.v || 0) / maxV) * (pad.b - 8);
      ctx.fillStyle = (c.c >= c.o) ? "rgba(0,211,90,0.35)" : "rgba(255,69,58,0.35)";
      ctx.fillRect(vx, h - 4 - vh, body, vh);
    });
    // trailing stop
    if (opts.trail != null) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(pad.l, y(opts.trail));
      ctx.lineTo(pad.l + iw, y(opts.trail));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ORANGE;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Risk trailing stop", pad.l, y(opts.trail) - 4);
    }
    if (opts.stop != null) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = RED;
      ctx.beginPath();
      ctx.moveTo(pad.l, y(opts.stop));
      ctx.lineTo(pad.l + iw, y(opts.stop));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    cs.forEach((c, i) => {
      const cx = pad.l + i * slot + slot / 2;
      ctx.strokeStyle = c.c >= c.o ? GREEN : RED;
      ctx.beginPath();
      ctx.moveTo(cx, y(c.h));
      ctx.lineTo(cx, y(c.l));
      ctx.stroke();
      const top = y(Math.max(c.o, c.c));
      const bot = y(Math.min(c.o, c.c));
      ctx.fillStyle = c.c >= c.o ? GREEN : RED;
      ctx.fillRect(cx - body / 2, top, body, Math.max(1, bot - top));
    });
  }

  function scoreRing(canvas, score, minScore) {
    const { ctx, w, h } = size(canvas, canvas.clientHeight || 140);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.36;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(84,84,88,0.55)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const t = Math.max(0, Math.min(100, score || 0)) / 100;
    ctx.strokeStyle = (score || 0) >= (minScore || 70) ? GREEN : "#ffd60a";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(score == null ? "—" : String(score), cx, cy);
  }

  global.DeskCharts = { lineChart, candleChart, scoreRing };
})(window);
