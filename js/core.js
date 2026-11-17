'use strict';
/* ============ CORSAIR — moteur commun : maths, entrées, audio, vent, rendu ============ */
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const hash2 = (i, j) => { let h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
// interpolation linéaire dans une table [[x,y],...] triée
function interp(tb, x) {
  if (x <= tb[0][0]) return tb[0][1];
  for (let i = 1; i < tb.length; i++) if (x <= tb[i][0]) {
    const a = tb[i - 1], b = tb[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
  }
  return tb[tb.length - 1][1];
}
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
const Store = {
  get(k, d) { try { const v = localStorage.getItem('corsair.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('corsair.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- Canvas ---------- */
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
window.addEventListener('resize', resize); resize();

/* ---------- Entrées ---------- */
const keys = {}, pressed = {};
let usingKbd = false; // clavier physique détecté (iPad avec clavier, etc.)
// Safari iPad ne remplit pas toujours e.code (et nomme les flèches « UIKeyInput… ») : on normalise.
const KEY_ALIAS = {
  ArrowLeft: 'ArrowLeft', Left: 'ArrowLeft', UIKeyInputLeftArrow: 'ArrowLeft',
  ArrowRight: 'ArrowRight', Right: 'ArrowRight', UIKeyInputRightArrow: 'ArrowRight',
  ArrowUp: 'ArrowUp', Up: 'ArrowUp', UIKeyInputUpArrow: 'ArrowUp',
  ArrowDown: 'ArrowDown', Down: 'ArrowDown', UIKeyInputDownArrow: 'ArrowDown',
  ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape', UIKeyInputEscape: 'Escape'
};
const KEYCODES = { 27: 'Escape', 32: 'Space', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' };
function keyOf(e) {
  if (KEY_ALIAS[e.key]) return KEY_ALIAS[e.key];
  if (e.code && e.code !== 'Unidentified') return e.code;
  const kc = e.keyCode || e.which || 0;
  if (KEYCODES[kc]) return KEYCODES[kc];
  if (kc >= 65 && kc <= 90) return 'Key' + String.fromCharCode(kc);
  if (kc >= 48 && kc <= 57) return 'Digit' + (kc - 48);
  if (e.key && e.key.length === 1) { const k = e.key.toUpperCase(); if (k >= 'A' && k <= 'Z') return 'Key' + k; if (k >= '0' && k <= '9') return 'Digit' + k; }
  return e.key || '';
}
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // raccourcis système (Cmd+Tab…)
  const k = keyOf(e); e.gameKey = k;
  if (!keys[k]) pressed[k] = true;
  keys[k] = true; Sfx.init();
  if (!usingKbd) { usingKbd = true; document.body.classList.add('kbd'); }
  if (k.startsWith('Arrow') || k === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[keyOf(e)] = false; });
// un toucher d'écran réaffiche les commandes tactiles
window.addEventListener('touchstart', e => { if (usingKbd && !e.target.closest('#touch')) { usingKbd = false; document.body.classList.remove('kbd'); } }, { passive: true });
const touchUI = () => IS_TOUCH && !usingKbd;
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const steerInput = () => (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);

/* ---------- Audio synthétique ---------- */
const Sfx = {
  ac: null, muted: Store.get('muted', false), windGain: null, windFilter: null, noise: null,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ac = new AC(); const ac = this.ac;
      this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.master = ac.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(ac.destination);
      const src = ac.createBufferSource(); src.buffer = this.noise; src.loop = true;
      this.windFilter = ac.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 400; this.windFilter.Q.value = 0.6;
      this.windGain = ac.createGain(); this.windGain.gain.value = 0;
      src.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master); src.start();
    } catch (e) { this.ac = null; }
  },
  toggleMute() { this.muted = !this.muted; Store.set('muted', this.muted); if (this.master) this.master.gain.value = this.muted ? 0 : 1; },
  wind(level) { // 0..1
    if (!this.ac) return; const t = this.ac.currentTime;
    this.windGain.gain.setTargetAtTime(0.02 + level * 0.11, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(280 + level * 650, t, 0.4);
  },
  beep(freq, dur = 0.15, type = 'sine', vol = 0.15) {
    if (!this.ac) return; const ac = this.ac, t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  horn() { this.beep(220, 0.9, 'sawtooth', 0.12); this.beep(277, 0.9, 'sawtooth', 0.08); },
  burst(vol, dur, freq) {
    if (!this.ac) return; const ac = this.ac, t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise; f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(60, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  boom(vol = 0.5) { this.burst(vol, 0.55, 900); this.beep(70, 0.3, 'sine', vol * 0.6); },
  splash(vol = 0.12) { this.burst(vol, 0.35, 2600); },
  crack() { this.burst(0.35, 0.18, 4000); },
  coin() { this.beep(1320, 0.08, 'square', 0.05); setTimeout(() => this.beep(1760, 0.14, 'square', 0.05), 70); }
};

/* ---------- Vent : bascules, risées, champ spatial ---------- */
class Wind {
  // dir = direction VERS laquelle souffle le vent (rad). o: {dir, spd, shift, period, gust, field}
  constructor(o) { Object.assign(this, { dir0: Math.PI / 2, spd0: 12, shift: 10 * DEG, period: 50, gust: 4, field: null, puffRate: 0.5 }, o); this.t = 0; this.puffs = []; this.cur = this.dir0; this.ph = rand(0, 6); }
  update(dt, cam) {
    this.t += dt; const t = this.t;
    this.cur = this.dir0 + this.shift * (Math.sin(t * TAU / this.period + this.ph) + 0.45 * Math.sin(t * TAU / (this.period * 0.37) + 1.3 + this.ph));
    const vw = W / cam.z, vh = H / cam.z, R = Math.max(vw, vh);
    if (Math.random() < dt * this.puffRate && this.puffs.length < 9) {
      const up = this.cur + Math.PI, a = up + rand(-1.1, 1.1), d = R * rand(0.4, 0.9), lull = Math.random() < 0.25;
      this.puffs.push({ x: cam.x + Math.cos(a) * d, y: cam.y + Math.sin(a) * d, r: R * rand(0.13, 0.3), str: lull ? -this.gust * 0.6 : this.gust * rand(0.6, 1.2), tw: rand(-9, 9) * DEG, life: 0, max: rand(14, 26) });
    }
    const vx = Math.cos(this.cur) * 55, vy = Math.sin(this.cur) * 55;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]; p.x += vx * dt; p.y += vy * dt; p.life += dt;
      p.k = Math.min(1, p.life / 3, (p.max - p.life) / 3);
      if (p.life > p.max || Math.hypot(p.x - cam.x, p.y - cam.y) > R * 1.8) this.puffs.splice(i, 1);
    }
  }
  at(x, y) {
    let dir = this.cur, spd = this.spd0;
    if (this.field) { const f = this.field(x, y, this.t); spd += f.spd; dir += f.dir; }
    for (const p of this.puffs) {
      const d = Math.hypot(x - p.x, y - p.y); if (d < p.r) { const k = (1 - d / p.r) * p.k; spd += p.str * Math.min(1, k * 1.8); dir += p.tw * k; }
    }
    return { dir, spd: Math.max(2, spd) };
  }
  draw(c) { // risées (sombres) et molles (claires) sur l'eau
    for (const p of this.puffs) {
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r), a = 0.3 * p.k;
      g.addColorStop(0, p.str > 0 ? `rgba(2,22,50,${a})` : `rgba(150,215,235,${a * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill();
    }
  }
}

/* ---------- Particules ---------- */
class Particles {
  constructor() { this.a = []; }
  add(x, y, vx, vy, life, size, color, grow = 0, drag = 0) { if (this.a.length < 900) this.a.push({ x, y, vx, vy, life, max: life, size, color, grow, drag }); }
  burst(x, y, n, speed, life, size, color, grow = 0) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(0.2, 1) * speed; this.add(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.5, 1), size * rand(0.6, 1.3), color, grow, 1.5); } }
  update(dt) { for (let i = this.a.length - 1; i >= 0; i--) { const p = this.a[i]; p.life -= dt; if (p.life <= 0) { this.a[i] = this.a[this.a.length - 1]; this.a.pop(); continue; } const k = 1 - p.drag * dt; p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt; p.size += p.grow * dt; } }
  draw(c) { for (const p of this.a) { c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU); c.fill(); } c.globalAlpha = 1; }
}

/* ---------- Caméra & eau ---------- */
function camBegin(c, cam) { c.save(); c.translate(W / 2, H / 2); c.scale(cam.z, cam.z); c.translate(-cam.x, -cam.y); }
function camEnd(c) { c.restore(); }
function drawWater(c, cam, t, wind, pal) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  camBegin(c, cam);
  wind.draw(c);
  // clapot : petites crêtes animées, ancrées au monde, dérivant sous le vent
  const cell = cam.z < 0.7 ? 230 : 150, vw = W / cam.z / 2 + cell, vh = H / cam.z / 2 + cell;
  const dx = Math.cos(wind.cur), dy = Math.sin(wind.cur), drift = (t * 14) % cell;
  const i0 = Math.floor((cam.x - vw) / cell), i1 = Math.ceil((cam.x + vw) / cell), j0 = Math.floor((cam.y - vh) / cell), j1 = Math.ceil((cam.y + vh) / cell);
  c.lineWidth = 2 / Math.sqrt(cam.z); c.lineCap = 'round';
  const nx = -dy, ny = dx;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const h = hash2(i, j), h2 = hash2(j + 31, i - 17), ph = Math.sin(t * (0.6 + h) + h * 40);
    if (ph < 0) continue;
    const x = (i + h) * cell + dx * drift, y = (j + h2) * cell + dy * drift, l = 10 + h2 * 22;
    c.strokeStyle = `rgba(255,255,255,${0.16 * ph})`;
    c.beginPath(); c.moveTo(x - nx * l, y - ny * l); c.quadraticCurveTo(x + dx * 5, y + dy * 5, x + nx * l, y + ny * l); c.stroke();
  }
  camEnd(c);
}
// sillage : liste de points {x,y,a}
function wakeUpdate(b, dt, half, minSpd) {
  b.wake = b.wake || []; b.wakeT = (b.wakeT || 0) + dt;
  if (b.wakeT > 0.09 && b.spd > minSpd) { b.wakeT = 0; b.wake.push({ x: b.x - Math.cos(b.hdg) * half, y: b.y - Math.sin(b.hdg) * half, a: 1 }); }
  for (const p of b.wake) p.a -= dt * 0.45;
  while (b.wake.length && b.wake[0].a <= 0) b.wake.shift();
}
function wakeDraw(c, b, w) {
  const k = b.wake; if (!k || k.length < 2) return; c.lineCap = 'round';
  for (let i = 1; i < k.length; i++) {
    c.strokeStyle = `rgba(255,255,255,${k[i].a * 0.33})`; c.lineWidth = w * (1.2 + (1 - k[i].a) * 2.2);
    c.beginPath(); c.moveTo(k[i - 1].x, k[i - 1].y); c.lineTo(k[i].x, k[i].y); c.stroke();
  }
}
// îles procédurales
function makeIsland(x, y, r, rocky) {
  const pts = [], n = 14; for (let i = 0; i < n; i++) { const a = i / n * TAU, rr = r * rand(0.78, 1.12); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  const trees = []; for (let i = 0; i < r / 9; i++) { const a = rand(0, TAU), d = rand(0, r * 0.5); trees.push([Math.cos(a) * d, Math.sin(a) * d, rand(7, 15)]); }
  return { x, y, r: r * 0.9, pts, trees, rocky };
}
function blob(c, pts, s) {
  c.beginPath(); const n = pts.length;
  for (let i = 0; i <= n; i++) { const p = pts[i % n], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2 * s, my = (p[1] + q[1]) / 2 * s; if (i === 0) c.moveTo(mx, my); else c.quadraticCurveTo(p[0] * s, p[1] * s, mx, my); }
  c.closePath();
}
function drawIsland(c, is) {
  c.save(); c.translate(is.x, is.y);
  c.fillStyle = 'rgba(120,220,220,0.22)'; blob(c, is.pts, 1.22); c.fill();
  c.fillStyle = is.rocky ? '#7d8a8f' : '#e8d5a3'; blob(c, is.pts, 1); c.fill();
  c.fillStyle = is.rocky ? '#59666b' : '#4fa35a'; blob(c, is.pts, 0.74); c.fill();
  for (const t of is.trees) { c.fillStyle = is.rocky ? '#434e52' : '#2f7d43'; c.beginPath(); c.arc(t[0], t[1], t[2], 0, TAU); c.fill(); c.fillStyle = is.rocky ? '#6d7b80' : '#3f9a55'; c.beginPath(); c.arc(t[0] - 2, t[1] - 2, t[2] * 0.55, 0, TAU); c.fill(); }
  c.restore();
}

/* ---------- HUD ---------- */
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
function panel(c, x, y, w, h, r = 10) {
  c.fillStyle = 'rgba(6,18,32,0.72)'; c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); c.stroke();
}
function txt(c, s, x, y, size = 14, color = '#fff', align = 'left', weight = '600') {
  c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = color; c.fillText(s, x, y);
}
// rose des vents : flèche = direction où va le vent ; bateau au centre
function drawCompass(c, cx, cy, r, windDir, tws, hdg) {
  panel(c, cx - r - 10, cy - r - 10, r * 2 + 20, r * 2 + 44, 14);
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
  txt(c, 'N', cx, cy - r + 13, 10, 'rgba(255,255,255,.55)', 'center');
  c.save(); c.translate(cx, cy); c.rotate(hdg); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(11, 0); c.lineTo(-8, -5); c.lineTo(-8, 5); c.closePath(); c.fill(); c.restore();
  c.save(); c.translate(cx, cy); c.rotate(windDir); c.strokeStyle = '#5fd4ff'; c.fillStyle = '#5fd4ff'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(-r + 2, 0); c.lineTo(-r * 0.45, 0); c.stroke(); c.beginPath(); c.moveTo(-r * 0.32, 0); c.lineTo(-r * 0.55, -6); c.lineTo(-r * 0.55, 6); c.closePath(); c.fill(); c.restore();
  txt(c, tws.toFixed(0) + ' nds', cx, cy + r + 24, 15, '#5fd4ff', 'center', '700');
}
// indicateur de cible hors écran
function drawPointer(c, cam, tx, ty, color, label) {
  const sx = (tx - cam.x) * cam.z + W / 2, sy = (ty - cam.y) * cam.z + H / 2, m = 60;
  if (sx > m && sx < W - m && sy > m && sy < H - m) return;
  const a = Math.atan2(sy - H / 2, sx - W / 2), k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
  const px = W / 2 + Math.cos(a) * k, py = H / 2 + Math.sin(a) * k;
  c.save(); c.translate(px, py); c.rotate(a); c.fillStyle = color; c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -10); c.lineTo(-8, 10); c.closePath(); c.fill(); c.restore();
  if (label) txt(c, label, px - Math.cos(a) * 30, py - Math.sin(a) * 30 + 5, 12, color, 'center', '700');
}
/* messages flottants */
const toasts = [];
function toast(msg, dur = 2.5, color = '#fff') { const o = toasts.find(m => m.msg === msg); if (o) { o.t = Math.max(o.t, dur * 0.8); return; } toasts.push({ msg, t: dur, max: dur, color }); if (toasts.length > 3) toasts.shift(); }
function drawToasts(c, dt) {
  let y = H * 0.24;
  for (let i = toasts.length - 1; i >= 0; i--) {
    const m = toasts[i]; m.t -= dt; if (m.t <= 0) { toasts.splice(i, 1); continue; }
    c.globalAlpha = Math.min(1, m.t * 2, (m.max - m.t) * 5 + 0.2);
    c.font = `800 ${Math.min(30, W / 22)}px ${FONT}`; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = 'rgba(0,10,25,.8)'; c.strokeText(m.msg, W / 2, y); c.fillStyle = m.color; c.fillText(m.msg, W / 2, y);
    y += 40;
  }
  c.globalAlpha = 1;
}
