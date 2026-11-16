'use strict';
/* ============ Bataille navale pirate : survie par vagues, butin, chantier naval ============ */
const SHIPS = {
  SLOOP: { name: 'Sloop', hp: 100, spd: 11, turn: 1.25, guns: 2, reload: 2.4, len: 58, wid: 20, masts: 1, up: 42, gold: 80 },
  BRIG: { name: 'Brick', hp: 200, spd: 9.6, turn: 0.92, guns: 4, reload: 3.2, len: 82, wid: 27, masts: 2, up: 54, gold: 160, cost: 700 },
  FRIGATE: { name: 'Frégate', hp: 340, spd: 9.2, turn: 0.74, guns: 6, reload: 3.6, len: 108, wid: 33, masts: 3, up: 57, gold: 320, cost: 1800 },
  MANOWAR: { name: 'Vaisseau de ligne', hp: 580, spd: 7.8, turn: 0.52, guns: 9, reload: 4.2, len: 138, wid: 42, masts: 3, up: 60, gold: 700, cost: 4000 }
};
const SHIP_ORDER = ['SLOOP', 'BRIG', 'FRIGATE', 'MANOWAR'];
const TEAMS = {
  player: { sail: '#f4efe2', flag: '#3fa9f5', hull: '#6b4423' },
  pirate: { sail: '#23262b', flag: '#e74c3c', hull: '#3d2a1a' },
  navy: { sail: '#efe6cf', flag: '#c0392b', hull: '#7a5230' },
  merchant: { sail: '#d9c08f', flag: '#f1c40f', hull: '#8a6238' }
};
const PK = 11, WORLD_R = 4200, PORT_R = 250, SHOT_V = 500, SHOT_RANGE = 560;

class PirateGame {
  constructor() {
    this.wind = new Wind({ dir0: rand(0, TAU), spd0: 14, shift: 25 * DEG, period: 120, gust: 4, puffRate: 0.3 });
    this.parts = new Particles(); this.cam = { x: 0, y: 300, z: 0.8 }; this.clock = 0;
    this.shots = []; this.loot = []; this.barrels = []; this.ships = []; this.islands = [];
    this.port = makeIsland(0, 0, 120, false);
    let tries = 0;
    while (this.islands.length < 30 && tries++ < 2000) {
      const a = rand(0, TAU), d = rand(650, WORLD_R - 200), x = Math.cos(a) * d, y = Math.sin(a) * d, r = rand(90, 240);
      if (this.islands.every(i => Math.hypot(x - i.x, y - i.y) > r + i.r + 260)) this.islands.push(makeIsland(x, y, r, Math.random() < 0.4));
    }
    this.up = { hull: 0, dmg: 0, reload: 0, sails: 0, chain: false };
    this.gold = 0; this.total = 0; this.kills = 0; this.wave = 0; this.waveT = 4; this.barrelN = 0; this.done = false; this.endT = 0; this.shopOpen = false; this.nearPort = false; this.shake = 0;
    this.player = this.mkShip('SLOOP', 'player', 0, PORT_R + 60, -Math.PI / 2); this.player.sail = 0.5;
    this.ships.push(this.player);
    this.touch = [{ label: '◀', code: 'ArrowLeft', pos: 'L' }, { label: '▶', code: 'ArrowRight', pos: 'L' }, { label: 'Voiles +', code: 'ArrowUp', pos: 'R' }, { label: 'Voiles −', code: 'ArrowDown', pos: 'R' },
      { label: '🔥 Bâbord', code: 'KeyQ', pos: 'R', big: true }, { label: 'Tribord 🔥', code: 'KeyE', pos: 'R', big: true }, { label: 'Baril', code: 'Space', pos: 'T' }, { label: 'Port', code: 'KeyB', pos: 'T' }, { label: 'Vue', code: 'KeyC', pos: 'T' }];
    this.help = '← → barre · ↑ ↓ voilure · A / E bordées bâbord / tribord (Q / E en QWERTY) · ESPACE baril · B chantier naval (au port) · C vue · souris : regarder autour';
    toast('Défendez votre port, pillez, améliorez !', 3.5, '#ffe066');
  }
  mkShip(type, team, x, y, hdg, lvl = 0) {
    const st = SHIPS[type], hp = st.hp * (team === 'player' ? 1 : (0.75 + lvl * 0.04));
    return { type, st, team, x, y, hdg, spd: 0, sail: 1, hp, maxHp: hp, rl: 0, rr: 0, slow: 0, sink: 0, fireT: 0, wdir: 0, ai: { side: Math.random() < .5 ? 1 : -1, t: rand(0, 3), aim: rand(.75, 1) }, lvl };
  }
  stats(s) { // stats effectives (améliorations du joueur)
    if (s.team !== 'player') return { spd: s.st.spd * (s.team === 'merchant' ? 0.82 : 0.93), reload: s.st.reload * 1.35, dmg: 8 + s.lvl * 0.35 };
    return { spd: s.st.spd * (1 + this.up.sails * 0.06), reload: s.st.reload * Math.pow(0.9, this.up.reload), dmg: 11 * (1 + this.up.dmg * 0.15) };
  }
  free(x, y, m) { if (Math.hypot(x, y) < PORT_R + m) return false; return this.islands.every(i => Math.hypot(x - i.x, y - i.y) > i.r + m); }

  spawnWave() {
    this.wave++; const n = this.wave, p = this.player; let budget = 0.5 + n * 1.1; const list = [];
    if (n % 5 === 0) { list.push(['MANOWAR', 'pirate']); budget -= 5; toast('☠ Vague ' + n + ' — L’Écumeur Noir approche !', 4, '#ff8a7a'); } else toast('Vague ' + n, 2.5, '#ffe066');
    list.push([n > 6 ? 'BRIG' : 'SLOOP', 'merchant']);
    while (budget > 0.5) {
      const r = Math.random();
      if (n >= 7 && budget >= 7 && r < 0.25) { list.push(['MANOWAR', 'navy']); budget -= 7; }
      else if (n >= 4 && budget >= 4 && r < 0.5) { list.push(['FRIGATE', Math.random() < .5 ? 'navy' : 'pirate']); budget -= 4; }
      else if (n >= 2 && budget >= 2 && r < 0.75) { list.push(['BRIG', Math.random() < .5 ? 'navy' : 'pirate']); budget -= 2; }
      else { list.push(['SLOOP', 'pirate']); budget -= 1; }
      if (list.length > 9) break;
    }
    const base = rand(0, TAU);
    list.forEach((l, i) => {
      let x, y, k = 0; do { const a = base + rand(-0.9, 0.9) + (l[1] === 'merchant' ? Math.PI : 0), d = rand(1300, 1750); x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; const dd = Math.hypot(x, y); if (dd > WORLD_R - 150) { x *= (WORLD_R - 150) / dd; y *= (WORLD_R - 150) / dd; } } while (!this.free(x, y, 110) && k++ < 40);
      this.ships.push(this.mkShip(l[0], l[1], x, y, Math.atan2(p.y - y, p.x - x), n));
    });
  }

  fire(s, side) { // side : -1 bâbord, +1 tribord
    const st = this.stats(s), n = s.st.guns, a = s.hdg + side * Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const off = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * s.st.len * 0.62, sp = rand(-0.07, 0.07);
      this.shots.push({ s, off, side, a: a + sp, delay: i * 0.07 + rand(0, 0.05), life: SHOT_RANGE / SHOT_V * rand(0.92, 1.05), dmg: st.dmg, team: s.team, live: false, x: 0, y: 0, vx: 0, vy: 0, chain: s.team === 'player' && this.up.chain });
    }
    if (side < 0) s.rl = st.reload; else s.rr = st.reload;
  }

  damage(s, d, x, y, by) {
    if (s.sink > 0) return; s.hp -= d;
    this.parts.burst(x, y, 7, 130, 0.6, 2.5, '#c89b5e'); this.parts.burst(x, y, 3, 40, 0.9, 6, 'rgba(60,60,60,.7)', 10);
    if (s === this.player) { this.shake = 0.25; Sfx.crack(); }
    if (s.hp <= 0) {
      s.sink = 3; Sfx.boom(0.6); this.parts.burst(s.x, s.y, 40, 220, 1.2, 6, '#ffb347', 6); this.parts.burst(s.x, s.y, 20, 80, 2, 10, 'rgba(40,40,40,.7)', 14);
      if (s !== this.player) {
        if (by === 'player') this.kills++;
        const g = s.st.gold * (s.team === 'merchant' ? 2.2 : 1) * (1 + s.lvl * 0.05), k = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < k; i++) this.loot.push({ x: s.x + rand(-40, 40), y: s.y + rand(-40, 40), g: Math.round(g / k), t: 45, ph: rand(0, 6) });
      } else { this.endT = 2.8; toast('Votre navire sombre…', 3, '#ff8a7a'); }
    }
  }

  sailStepP(s, dt, w) {
    const st = this.stats(s), rel = wrap(s.hdg - (w.dir + Math.PI)), twaD = Math.abs(rel) / DEG, u = s.st.up; s.wdir = w.dir; s.twaD = twaD;
    const pol = interp([[0, -0.04], [u - 12, 0], [u, 0.38], [90, 0.82], [125, 1], [160, 0.93], [180, 0.8]], twaD);
    let target = pol * st.spd * s.sail * Math.pow(w.spd / 14, 0.5) * (0.55 + 0.45 * clamp(s.hp / s.maxHp * 1.6, 0, 1));
    if (s.slow > 0) { s.slow -= dt; target *= 0.45; }
    s.spd += (target - s.spd) * (target > s.spd ? 0.35 : 0.22) * dt;
  }

  aiStep(s, dt, w) {
    const p = this.player, a = s.ai; if (p.sink > 0) { s.sail = 0.5; return; }
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), brg = Math.atan2(dy, dx), up = w.dir + Math.PI, ua = (s.st.up + 4) * DEG; let des;
    a.t -= dt; if (a.t <= 0) { a.t = rand(5, 10); if (Math.random() < 0.3) a.side = -a.side; }
    if (s.team === 'merchant') {
      if (d < 950) { des = brg + Math.PI; const off = wrap(des - up); if (Math.abs(off) < ua) des = up + (off >= 0 ? 1 : -1) * ua; s.sail = 1; }
      else { des = Math.atan2(-s.y, -s.x) + a.side * 1.3; s.sail = 0.5; }
    } else {
      s.sail = 1;
      if (d > 420) des = brg + a.side * 0.25; else des = brg + a.side * (d < 220 ? 1.95 : d > 330 ? 1.2 : Math.PI / 2);
      const off = wrap(des - up); if (Math.abs(off) < ua) des = up + (off >= 0 ? 1 : -1) * ua;
    }
    // évitement : îles, port, bord du monde
    const ax = s.x + Math.cos(s.hdg) * (s.st.len + 150), ay = s.y + Math.sin(s.hdg) * (s.st.len + 150);
    for (const is of this.obst) { if (Math.hypot(ax - is.x, ay - is.y) < is.r + 110 || Math.hypot(s.x - is.x, s.y - is.y) < is.r + 90) { const away = Math.atan2(s.y - is.y, s.x - is.x); des = away + (wrap(s.hdg - away) >= 0 ? 1 : -1) * 1.1; break; } }
    if (Math.hypot(s.x, s.y) > WORLD_R - 250) des = Math.atan2(-s.y, -s.x);
    const dh = wrap(des - s.hdg), tr = s.st.turn * (0.4 + 0.6 * clamp(s.spd / 5, 0, 1)) * dt; s.hdg += clamp(dh, -tr, tr);
    // tir : cible dans le travers, avec anticipation
    if (d < SHOT_RANGE * 0.92) {
      const tt = d / SHOT_V, pv = p.spd * PK, lx = p.x + Math.cos(p.hdg) * pv * tt * a.aim - s.x, ly = p.y + Math.sin(p.hdg) * pv * tt * a.aim - s.y, rel = wrap(Math.atan2(ly, lx) - s.hdg);
      if (Math.abs(Math.abs(rel) - Math.PI / 2) < 0.2) { if (rel > 0 && s.rr <= 0) this.fire(s, 1); else if (rel < 0 && s.rl <= 0) this.fire(s, -1); }
    }
  }

  update(dt) {
    if (this.shopOpen) return;
    const p = this.player; this.clock += dt; this.wind.update(dt, this.cam); this.parts.update(dt); this.shake = Math.max(0, this.shake - dt);
    this.obst = this.islands.concat([this.port]);
    // --- joueur ---
    if (p.sink <= 0) {
      const st = steerInput(); p.hdg += st * p.st.turn * (0.35 + 0.65 * clamp(p.spd / 5, 0, 1)) * dt; p.spd -= Math.abs(st) * p.spd * 0.06 * dt;
      if (pressed.ArrowUp) p.sail = Math.min(1, p.sail + 0.5); if (pressed.ArrowDown) p.sail = Math.max(0, p.sail - 0.5);
      if ((keys.KeyQ || keys.KeyA) && p.rl <= 0) this.fire(p, -1);
      if ((keys.KeyE || keys.KeyD) && p.rr <= 0) this.fire(p, 1);
      if (pressed.Space) { if (this.barrelN > 0) { this.barrelN--; this.barrels.push({ x: p.x - Math.cos(p.hdg) * p.st.len * 0.6, y: p.y - Math.sin(p.hdg) * p.st.len * 0.6, arm: 1.2, t: 60 }); Sfx.splash(); } else toast('Plus de barils — achetez-en au port', 1.5); }
      const dp = Math.hypot(p.x, p.y); this.nearPort = dp < PORT_R + 170;
      const threat = this.ships.some(s => s !== p && s.team !== 'merchant' && s.sink <= 0 && Math.hypot(s.x - p.x, s.y - p.y) < 650);
      if (this.nearPort && !threat && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.07 * dt); if (Math.random() < dt * 8) this.parts.add(p.x + rand(-20, 20), p.y + rand(-20, 20), 0, -25, 0.8, 2.5, '#7dffa0'); }
      if (pressed.KeyB) { if (this.nearPort) this.openShop(); else toast('Le chantier naval est au port (centre de la carte)', 2); }
    }
    // --- navires ---
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i], w = this.wind.at(s.x, s.y);
      if (s.sink > 0) { s.sink -= dt; s.spd *= 1 - 2 * dt; if (Math.random() < dt * 12) this.parts.add(s.x + rand(-30, 30), s.y + rand(-20, 20), 0, 0, 1, 4, 'rgba(255,255,255,.6)', 8); if (s.sink <= 0 && s !== p) { this.ships.splice(i, 1); continue; } }
      else { if (s !== p) this.aiStep(s, dt, w); this.sailStepP(s, dt, w); s.rl -= dt; s.rr -= dt; }
      const v = s.spd * PK; s.x += Math.cos(s.hdg) * v * dt; s.y += Math.sin(s.hdg) * v * dt;
      wakeUpdate(s, dt, s.st.len * 0.45, 1.2);
      for (const is of this.obst) { const d = Math.hypot(s.x - is.x, s.y - is.y), m = is.r + s.st.wid * 0.7; if (d < m) { const a = Math.atan2(s.y - is.y, s.x - is.x); s.x = is.x + Math.cos(a) * m; s.y = is.y + Math.sin(a) * m; if (s.spd > 3.5) { if (s === p) toast('Échouage !', 1.2, '#ff8a7a'); this.damage(s, s.spd * 1.2, s.x, s.y); } s.spd *= 0.4; } }
      const dc = Math.hypot(s.x, s.y); if (dc > WORLD_R) { s.x *= WORLD_R / dc; s.y *= WORLD_R / dc; s.spd *= 0.9; if (s === p && Math.random() < dt) toast('Brumes infranchissables — faites demi-tour', 1.5); }
      if (s.sink <= 0 && s.hp < s.maxHp * 0.45 && Math.random() < dt * 9) this.parts.add(s.x + rand(-10, 10), s.y + rand(-8, 8), Math.cos(w.dir) * 30, Math.sin(w.dir) * 30, 1.3, 5, s.hp < s.maxHp * 0.22 ? 'rgba(255,140,40,.7)' : 'rgba(50,50,50,.55)', 9);
    }
    // abordages (collisions)
    for (let i = 0; i < this.ships.length; i++) for (let j = i + 1; j < this.ships.length; j++) {
      const a = this.ships[i], b = this.ships[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = (a.st.len + b.st.len) * 0.3;
      if (d < m && d > 0.01) { const k = (m - d) / d * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; if (a.team !== b.team && a.sink <= 0 && b.sink <= 0) { this.damage(a, 14 * dt * (b.st.len / 60), a.x + dx / 2, a.y + dy / 2, b.team); this.damage(b, 14 * dt * (a.st.len / 60), a.x + dx / 2, a.y + dy / 2, a.team); } a.spd *= 1 - dt; b.spd *= 1 - dt; }
    }
    // --- boulets ---
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const b = this.shots[i];
      if (!b.live) {
        b.delay -= dt; if (b.delay > 0) continue; const s = b.s; if (s.sink > 0) { this.shots.splice(i, 1); continue; }
        b.live = true; b.x = s.x + Math.cos(s.hdg) * b.off + Math.cos(s.hdg + b.side * Math.PI / 2) * s.st.wid * 0.5; b.y = s.y + Math.sin(s.hdg) * b.off + Math.sin(s.hdg + b.side * Math.PI / 2) * s.st.wid * 0.5;
        const sv = s.spd * PK * 0.5; b.vx = Math.cos(b.a) * SHOT_V + Math.cos(s.hdg) * sv; b.vy = Math.sin(b.a) * SHOT_V + Math.sin(s.hdg) * sv;
        for (let k = 0; k < 4; k++) this.parts.add(b.x, b.y, Math.cos(b.a) * rand(30, 110) + rand(-15, 15), Math.sin(b.a) * rand(30, 110) + rand(-15, 15), rand(0.6, 1.3), 5, 'rgba(235,235,235,.6)', 12, 2);
        this.parts.add(b.x, b.y, 0, 0, 0.1, 8, '#ffd27a');
        const dl = Math.hypot(b.x - this.cam.x, b.y - this.cam.y); if (dl < 1500) Sfx.boom(s === this.player ? 0.3 : 0.22 * (1 - dl / 1500));
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; let dead = false;
      for (const s of this.ships) {
        if (s.sink > 0 || s === b.s || (s.team !== 'player' && b.team !== 'player')) continue;
        const dx = b.x - s.x, dy = b.y - s.y; if (Math.abs(dx) > s.st.len || Math.abs(dy) > s.st.len) continue;
        const c = Math.cos(-s.hdg), sn = Math.sin(-s.hdg), lx = dx * c - dy * sn, ly = dx * sn + dy * c, ex = s.st.len * 0.5, ey = s.st.wid * 0.55;
        if (lx * lx / (ex * ex) + ly * ly / (ey * ey) < 1) { this.damage(s, b.dmg, b.x, b.y, b.team); if (b.chain) s.slow = 4; dead = true; break; }
      }
      if (!dead) for (const is of this.obst) if (Math.hypot(b.x - is.x, b.y - is.y) < is.r) { dead = true; this.parts.burst(b.x, b.y, 5, 60, 0.5, 3, '#d8c79a'); break; }
      if (!dead && b.life <= 0) { dead = true; this.parts.burst(b.x, b.y, 6, 50, 0.5, 3, 'rgba(255,255,255,.8)'); }
      if (dead) this.shots.splice(i, 1);
    }
    // --- barils explosifs ---
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i]; b.arm -= dt; b.t -= dt; let boom = false;
      if (b.arm <= 0) for (const s of this.ships) if (s.sink <= 0 && s !== p && Math.hypot(s.x - b.x, s.y - b.y) < s.st.len * 0.5 + 14) boom = true;
      if (boom) { Sfx.boom(0.6); this.parts.burst(b.x, b.y, 36, 260, 1, 7, '#ffb347', 8); for (const s of this.ships) { const d = Math.hypot(s.x - b.x, s.y - b.y); if (d < 150 && s !== p) this.damage(s, 95 * (1 - d / 200), s.x, s.y, 'player'); } }
      if (boom || b.t <= 0) this.barrels.splice(i, 1);
    }
    // --- butin ---
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i]; l.t -= dt; const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d < 170 && p.sink <= 0) { l.x += (p.x - l.x) / d * 160 * dt; l.y += (p.y - l.y) / d * 160 * dt; }
      if (d < p.st.len * 0.5 && p.sink <= 0) { this.gold += l.g; this.total += l.g; Sfx.coin(); toast('+' + l.g + ' or', 1, '#ffd23f'); this.loot.splice(i, 1); } else if (l.t <= 0) this.loot.splice(i, 1);
    }
    // --- vagues ---
    const hostile = this.ships.filter(s => s !== p && s.team !== 'merchant' && s.sink <= 0).length;
    if (hostile === 0 && p.sink <= 0) { this.waveT -= dt; if (this.waveT <= 0) { this.ships = this.ships.filter(s => s === p || s.team !== 'merchant' || Math.hypot(s.x - p.x, s.y - p.y) < 1600); this.spawnWave(); this.waveT = 9; } }
    // caméra
    const v = p.spd * PK, zt = 0.82 * clamp(Math.min(W, H) / 760, 0.5, 1.2) * (60 / (p.st.len * 0.35 + 40));
    this.cam.z += (zt - this.cam.z) * dt; this.cam.x += (p.x + Math.cos(p.hdg) * v * 0.6 - this.cam.x) * Math.min(1, dt * 3); this.cam.y += (p.y + Math.sin(p.hdg) * v * 0.6 - this.cam.y) * Math.min(1, dt * 3);
    Sfx.wind(clamp(0.3 + p.spd / 25, 0, 1));
    if (this.endT > 0) { this.endT -= dt; if (this.endT <= 0 && !this.done) { this.done = true; this.finish(); } }
  }

  finish() {
    const best = Store.get('best.pirate', 0), rec = this.total > best; if (rec) Store.set('best.pirate', this.total);
    showEnd('PAR LE FOND…', `<p>Vous avez tenu jusqu’à la <b>vague ${this.wave}</b>, coulé <b>${this.kills}</b> navires et amassé <b class="gold">${this.total} pièces d’or</b>.</p><p>${rec ? '<span class="gold">Nouveau record !</span>' : 'Record : ' + best + ' pièces d’or'}</p>`);
  }

  /* ---------- chantier naval ---------- */
  shopItems() {
    const p = this.player, u = this.up, idx = SHIP_ORDER.indexOf(p.type), next = SHIP_ORDER[idx + 1], it = [];
    if (next) { const n = SHIPS[next]; it.push({ t: '⛵ ' + n.name, d: `${n.guns} canons par bord · ${n.hp} PV`, cost: n.cost, buy: () => { const r = p.hp / p.maxHp; p.type = next; p.st = n; p.maxHp = n.hp * (1 + u.hull * 0.2); p.hp = p.maxHp; } }); }
    else it.push({ t: '⛵ Vaisseau de ligne', d: 'Le plus puissant navire des mers', own: true });
    const lv = (k, t, d, base) => it.push(u[k] >= 5 ? { t, d: d + ' · niveau max', own: true } : { t: t + ' ' + '★'.repeat(u[k]) + '☆'.repeat(5 - u[k]), d, cost: base * (u[k] + 1), buy: () => { u[k]++; if (k === 'hull') { p.maxHp = p.st.hp * (1 + u.hull * 0.2); p.hp = p.maxHp; } } });
    lv('hull', '🛡 Coque renforcée', '+20 % de points de vie', 200); lv('dmg', '💥 Poudre noire', '+15 % de dégâts', 250); lv('reload', '⏱ Canonniers d’élite', '−10 % de rechargement', 250); lv('sails', '🪁 Voilure fine', '+6 % de vitesse', 200);
    it.push(u.chain ? { t: '⛓ Boulets chaînés', d: 'Vos tirs ralentissent l’ennemi', own: true } : { t: '⛓ Boulets chaînés', d: 'Vos tirs ralentissent l’ennemi', cost: 500, buy: () => { u.chain = true; } });
    it.push({ t: '🛢 3 barils explosifs (' + this.barrelN + ')', d: 'ESPACE pour larguer dans votre sillage', cost: 150, buy: () => { this.barrelN += 3; } });
    return it;
  }
  openShop() { this.shopOpen = true; this.renderShop(); document.getElementById('shop').classList.add('show'); }
  closeShop() { this.shopOpen = false; document.getElementById('shop').classList.remove('show'); }
  renderShop() {
    document.getElementById('shop-gold').textContent = this.gold; const box = document.getElementById('shop-items'); box.innerHTML = '';
    this.shopItems().forEach(it => {
      const b = document.createElement('button'); b.className = 'item' + (it.own ? ' own' : this.gold < it.cost ? ' poor' : '');
      b.innerHTML = `<b>${it.t}</b><span>${it.d}</span><em>${it.own ? 'ACQUIS' : it.cost + ' or'}</em>`;
      if (!it.own) b.onclick = () => { if (this.gold >= it.cost) { this.gold -= it.cost; it.buy(); Sfx.coin(); this.renderShop(); } };
      box.appendChild(b);
    });
  }

  /* ---------- rendu ---------- */
  draw(c) {
    const cam = this.cam, t = this.clock, p = this.player;
    if (R3.active()) {
      c.clearRect(0, 0, W, H); R3.render(this);
      for (const s of this.ships) if (s !== p && s.sink <= 0) {
        const col = s.team === 'merchant' ? '#f1c40f' : '#ff5a4a', q = R3.marker(c, s.x, s.y, s.st.len * 1.25, col, Math.round(Math.hypot(s.x - p.x, s.y - p.y) / 10) + ' m');
        if (q) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(q.sx - 26, q.sy - 44, 52, 6); c.fillStyle = col; c.fillRect(q.sx - 26, q.sy - 44, 52 * clamp(s.hp / s.maxHp, 0, 1), 6); }
      }
      if (!this.nearPort) R3.marker(c, 0, 0, 90, '#7dffa0', 'Port');
      if (this.shake > 0) { c.fillStyle = `rgba(255,60,40,${this.shake * 0.8})`; c.fillRect(0, 0, W, H); }
      this.hud(c); return;
    }
    const sx = this.shake > 0 ? rand(-6, 6) * this.shake * 4 : 0, sy = this.shake > 0 ? rand(-6, 6) * this.shake * 4 : 0; cam.x += sx; cam.y += sy;
    drawWater(c, cam, t, this.wind, ['#12708f', '#0b4a6e']);
    camBegin(c, cam);
    // limite du monde
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 60; c.beginPath(); c.arc(0, 0, WORLD_R + 40, 0, TAU); c.stroke();
    for (const s of this.ships) wakeDraw(c, s, s.st.wid * 0.3);
    for (const is of this.islands) drawIsland(c, is);
    // port
    c.setLineDash([12, 12]); c.strokeStyle = this.nearPort ? 'rgba(125,255,160,.7)' : 'rgba(255,255,255,.3)'; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, PORT_R + 170, 0, TAU); c.stroke(); c.setLineDash([]);
    drawIsland(c, this.port);
    c.fillStyle = '#7a5230'; c.fillRect(-10, 90, 20, 110); c.fillRect(-45, 180, 90, 16);
    c.fillStyle = '#b9a58a'; c.fillRect(-38, -38, 76, 76); c.fillStyle = '#8c7a62'; c.fillRect(-26, -26, 52, 52); c.fillStyle = '#3fa9f5'; c.beginPath(); c.moveTo(0, -60); c.lineTo(34, -50); c.lineTo(0, -40); c.fill(); c.fillRect(-1.5, -60, 3, 40);
    for (const l of this.loot) { const b = Math.sin(t * 3 + l.ph) * 2; c.fillStyle = 'rgba(255,220,80,.25)'; c.beginPath(); c.arc(l.x, l.y, 20 + b, 0, TAU); c.fill(); c.fillStyle = '#8a5a2b'; c.fillRect(l.x - 9, l.y - 7 + b, 18, 14); c.fillStyle = '#ffd23f'; c.fillRect(l.x - 9, l.y - 2 + b, 18, 3); c.fillRect(l.x - 2, l.y - 7 + b, 4, 14); }
    for (const b of this.barrels) { c.fillStyle = '#5a3a1c'; c.beginPath(); c.arc(b.x, b.y, 9, 0, TAU); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 2; c.stroke(); c.fillStyle = b.arm <= 0 && Math.sin(t * 10) > 0 ? '#ff4a3a' : '#333'; c.beginPath(); c.arc(b.x, b.y, 3, 0, TAU); c.fill(); }
    // arcs de tir du joueur
    if (p.sink <= 0) for (const side of [-1, 1]) {
      const ready = (side < 0 ? p.rl : p.rr) <= 0, a = p.hdg + side * Math.PI / 2;
      c.fillStyle = ready ? 'rgba(255,220,120,.07)' : 'rgba(255,255,255,.02)'; c.beginPath(); c.moveTo(p.x, p.y); c.arc(p.x, p.y, SHOT_RANGE, a - 0.2, a + 0.2); c.closePath(); c.fill();
    }
    for (const s of this.ships) drawShip(c, s, t);
    c.fillStyle = '#111'; for (const b of this.shots) if (b.live) { c.beginPath(); c.arc(b.x, b.y, 3.6, 0, TAU); c.fill(); }
    this.parts.draw(c);
    for (const s of this.ships) if (s !== p && s.sink <= 0) { const w = s.st.len * 0.7, y = s.y - s.st.len * 0.62; c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(s.x - w / 2, y, w, 6); c.fillStyle = s.team === 'merchant' ? '#f1c40f' : '#e74c3c'; c.fillRect(s.x - w / 2, y, w * clamp(s.hp / s.maxHp, 0, 1), 6); }
    camEnd(c); cam.x -= sx; cam.y -= sy;
    for (const s of this.ships) if (s !== p && s.sink <= 0) drawPointer(c, cam, s.x, s.y, s.team === 'merchant' ? '#f1c40f' : '#e74c3c');
    if (!this.nearPort) drawPointer(c, cam, 0, 0, '#7dffa0', 'Port');
    this.hud(c);
  }

  hud(c) {
    const p = this.player, st = this.stats(p), x0 = 12, small = W < 720; let y = 12;
    panel(c, x0, y, 230, 104);
    txt(c, p.st.name.toUpperCase(), x0 + 14, y + 20, 11, '#9fc4dd'); txt(c, p.spd.toFixed(1) + ' nds', x0 + 216, y + 20, 12, '#fff', 'right');
    c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(x0 + 14, y + 28, 202, 13); const hr = clamp(p.hp / p.maxHp, 0, 1); c.fillStyle = hr > 0.5 ? '#4cd17a' : hr > 0.25 ? '#ffd23f' : '#ff5a4a'; c.fillRect(x0 + 14, y + 28, 202 * hr, 13);
    txt(c, Math.ceil(Math.max(0, p.hp)) + ' / ' + Math.round(p.maxHp), x0 + 115, y + 39, 10, '#06121f', 'center', '800');
    txt(c, '💰 ' + this.gold, x0 + 14, y + 66, 20, '#ffd23f', 'left', '800'); txt(c, 'Vague ' + this.wave, x0 + 216, y + 64, 14, '#fff', 'right', '700');
    txt(c, 'VOILURE', x0 + 14, y + 90, 11, '#9fc4dd'); for (let i = 0; i < 2; i++) { c.fillStyle = p.sail > i * 0.5 ? '#f4efe2' : 'rgba(255,255,255,.14)'; c.fillRect(x0 + 74 + i * 30, y + 80, 26, 11); }
    const up = p.twaD < p.st.up; txt(c, up ? '⚠ FACE AU VENT' : this.barrelN ? '🛢 × ' + this.barrelN : '', x0 + 216, y + 90, 11, up ? '#ff8a7a' : '#fff', 'right', '700');
    // canons
    const cy = H - (IS_TOUCH ? 170 : 62);
    [[-1, p.rl, 'BÂBORD'], [1, p.rr, 'TRIBORD']].forEach(([s, r, n]) => {
      const cx = W / 2 + s * 78, k = clamp(1 - r / st.reload, 0, 1), rdy = r <= 0;
      const aim = rdy && this.ships.some(e => e !== p && e.sink <= 0 && Math.hypot(e.x - p.x, e.y - p.y) < SHOT_RANGE * 0.95 && Math.abs(wrap(Math.atan2(e.y - p.y, e.x - p.x) - p.hdg) - s * Math.PI / 2) < 0.24);
      if (aim) { c.fillStyle = 'rgba(125,255,160,.9)'; c.beginPath(); c.arc(cx, cy, 36, 0, TAU); c.fill(); txt(c, 'FEU !', cx, cy - 42, 13, '#7dffa0', 'center', '800'); }
      c.fillStyle = 'rgba(6,18,32,.72)'; c.beginPath(); c.arc(cx, cy, 30, 0, TAU); c.fill(); c.strokeStyle = rdy ? '#ffd23f' : 'rgba(255,255,255,.25)'; c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
      txt(c, IS_TOUCH ? '🔥' : s < 0 ? 'A' : 'E', cx, cy + 3, 18, rdy ? '#fff' : '#777', 'center', '800'); txt(c, n, cx, cy + 16, 8, rdy ? '#ffd23f' : '#777', 'center');
    });
    if (this.nearPort && p.sink <= 0) { panel(c, W / 2 - 150, cy - 82, 300, 34); txt(c, IS_TOUCH ? '⚓ Au port — touchez « Port »' : '⚓ Au port — B : chantier naval', W / 2, cy - 60, 14, '#7dffa0', 'center', '700'); }
    const r = small ? 30 : 40; drawCompass(c, W - r - 22, r + 22, r, p.wdir, this.wind.at(p.x, p.y).spd, p.hdg);
    // minicarte
    if (!(IS_TOUCH && W < 900)) {
      const m = Math.min(170, H * 0.26), mx = W - m - 12, my = IS_TOUCH ? r * 2 + 70 : H - m - 30, s = m / (WORLD_R * 2.1), X = x => mx + m / 2 + x * s, Y = y => my + m / 2 + y * s;
      panel(c, mx, my, m, m, m / 2); c.fillStyle = 'rgba(120,200,130,.65)'; for (const is of this.islands) { c.beginPath(); c.arc(X(is.x), Y(is.y), Math.max(1.5, is.r * s), 0, TAU); c.fill(); }
      c.fillStyle = '#7dffa0'; c.fillRect(X(0) - 3, Y(0) - 3, 6, 6); c.fillStyle = '#ffd23f'; for (const l of this.loot) c.fillRect(X(l.x) - 1, Y(l.y) - 1, 2, 2);
      for (const sh of this.ships) { if (sh.sink > 0) continue; c.fillStyle = sh === p ? '#fff' : sh.team === 'merchant' ? '#f1c40f' : '#ff5a4a'; c.beginPath(); c.arc(X(sh.x), Y(sh.y), sh === p ? 3.5 : 2.5, 0, TAU); c.fill(); }
    }
    if (!IS_TOUCH && this.clock < 30) txt(c, this.help, W / 2, H - 12, 12, 'rgba(255,255,255,.7)', 'center', '500');
  }
}

function drawShip(c, s, t) {
  const st = s.st, L = st.len, B = st.wid, tm = TEAMS[s.team];
  c.save(); c.translate(s.x, s.y); c.rotate(s.hdg);
  if (s.sink > 0) { c.globalAlpha = clamp(s.sink / 3, 0, 1); c.rotate((3 - s.sink) * 0.12); c.scale(0.7 + s.sink * 0.1, 0.7 + s.sink * 0.1); }
  c.fillStyle = 'rgba(0,20,40,.25)'; c.beginPath(); c.ellipse(3, 6, L * 0.52, B * 0.6, 0, 0, TAU); c.fill();
  const hull = k => { c.beginPath(); c.moveTo(L * 0.5 * k, 0); c.quadraticCurveTo(L * 0.3 * k, -B * 0.55 * k, -L * 0.1, -B * 0.5 * k); c.lineTo(-L * 0.46 * k, -B * 0.4 * k); c.quadraticCurveTo(-L * 0.52 * k, 0, -L * 0.46 * k, B * 0.4 * k); c.lineTo(-L * 0.1, B * 0.5 * k); c.quadraticCurveTo(L * 0.3 * k, B * 0.55 * k, L * 0.5 * k, 0); c.closePath(); };
  hull(1); c.fillStyle = tm.hull; c.fill(); c.strokeStyle = '#2a1a0c'; c.lineWidth = 1.5; c.stroke();
  hull(0.82); c.fillStyle = '#b08a5a'; c.fill();
  c.strokeStyle = 'rgba(70,45,20,.35)'; c.lineWidth = 1; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(-L * 0.36, i * B * 0.13); c.lineTo(L * 0.3, i * B * 0.13); c.stroke(); }
  // canons
  c.fillStyle = '#1a1a1a'; for (let i = 0; i < st.guns; i++) { const x = (st.guns === 1 ? 0 : (i / (st.guns - 1) - 0.5)) * L * 0.62; c.fillRect(x - 2, -B * 0.58, 4, B * 0.22); c.fillRect(x - 2, B * 0.36, 4, B * 0.22); }
  c.strokeStyle = '#3a2412'; c.lineWidth = 2; c.beginPath(); c.moveTo(L * 0.48, 0); c.lineTo(L * 0.66, 0); c.stroke();
  // mâts et voiles carrées, brassées selon le vent
  const wa = wrap(s.wdir - s.hdg), brace = clamp(wa * 0.5, -0.9, 0.9), blow = Math.cos(wa) >= 0 ? 1 : -1, luff = s.twaD < st.up - 6;
  for (let m = 0; m < st.masts; m++) {
    const mx = st.masts === 1 ? L * 0.06 : lerp(-L * 0.28, L * 0.26, m / (st.masts - 1)), yard = B * (m === 1 || st.masts === 1 ? 1.25 : 1.05);
    c.save(); c.translate(mx, 0); c.rotate(brace);
    if (s.sail > 0 && s.sink <= 0) {
      const d = (luff ? Math.sin(t * 18 + m) * 3 : (5 + s.sail * 7) * blow) * (L / 80), w = yard * (0.55 + 0.45 * s.sail);
      c.beginPath(); c.moveTo(0, -w); c.quadraticCurveTo(d * 2, 0, 0, w); c.quadraticCurveTo(d * 0.3, 0, 0, -w); c.fillStyle = tm.sail; c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
    }
    c.strokeStyle = '#3a2412'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, -yard); c.lineTo(0, yard); c.stroke(); c.restore();
    c.fillStyle = '#2a1a0c'; c.beginPath(); c.arc(mx, 0, 3, 0, TAU); c.fill();
  }
  // pavillon (flotte sous le vent)
  c.save(); c.translate(-L * 0.44, 0); c.rotate(wa); c.fillStyle = tm.flag; c.beginPath(); c.moveTo(0, -1.5); c.lineTo(15, -4 + Math.sin(t * 10) * 2); c.lineTo(15, 4 + Math.sin(t * 10) * 2); c.lineTo(0, 1.5); c.fill(); c.restore();
  if (s.slow > 0) { c.strokeStyle = '#5fd4ff'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.ellipse(0, 0, L * 0.55, B * 0.75, 0, 0, TAU); c.stroke(); c.setLineDash([]); }
  c.restore();
}
