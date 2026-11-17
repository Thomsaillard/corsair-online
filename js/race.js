'use strict';
/* ============ Régates : voile légère (dériveur) et IMOCA (course au large) ============ */
const CLASSES = {
  dinghy: {
    title: 'Voile légère', K: 9, len: 44, refWind: 12, windExp: 0.75, turn: 1.9, acc: 0.6, dec: 0.3, refSpd: 4,
    polar: [[0, 0], [25, 0.5], [36, 2.9], [45, 4.3], [60, 5.1], [90, 5.9], [120, 6.3], [150, 5.4], [180, 4.6]],
    upAngle: 45 * DEG, downAngle: 168 * DEG, zoom: 1.1, markR: 80, lineH: 230,
    wind: { dir0: Math.PI / 2, spd0: 11, shift: 11 * DEG, period: 42, gust: 5, puffRate: 0.6 }
  },
  imoca: {
    title: 'IMOCA', K: 7, len: 84, refWind: 16, windExp: 0.65, turn: 0.95, acc: 0.3, dec: 0.15, refSpd: 9,
    polar: [[0, 0], [28, 2], [38, 8.5], [45, 11], [60, 14], [90, 18], [110, 20.5], [130, 21], [150, 18.5], [180, 14]],
    upAngle: 47 * DEG, downAngle: 145 * DEG, zoom: 0.6, markR: 270, lineH: 420,
    wind: { dir0: Math.PI / 2, spd0: 18, shift: 9 * DEG, period: 75, gust: 7, puffRate: 0.35,
      field: (x, y, t) => ({ spd: 5.5 * Math.sin(x / 2300 + t * 0.021) * Math.cos(y / 1900 - t * 0.013), dir: 0.12 * Math.sin(y / 2600 + x / 4100 + t * 0.01) }) }
  }
};
const SAILS = [
  { id: 'J3', name: 'J3', hint: 'gros temps', len: 22, eff: [[0, .82], [70, .82], [100, .66], [180, .55]], max: 99 },
  { id: 'J2', name: 'J2', hint: 'près', len: 31, eff: [[0, 1], [65, 1], [95, .8], [130, .62], [180, .55]], max: 33 },
  { id: 'C0', name: 'Code 0', hint: 'travers', len: 44, eff: [[0, .4], [45, .5], [62, .95], [75, 1.08], [115, 1.08], [140, .9], [180, .7]], max: 27 },
  { id: 'SPI', name: 'Spi', hint: 'portant', len: 50, eff: [[0, .3], [80, .4], [105, .85], [125, 1.12], [160, 1.12], [180, .95]], max: 23 }
];
const HEEL_SF = [[0, .2], [30, .7], [50, 1], [100, .9], [150, .4], [180, .2]];
const SKIPPERS = {
  dinghy: [['Léa', '#e74c3c'], ['Malo', '#f1c40f'], ['Inès', '#2ecc71'], ['Yann', '#9b59b6'], ['Zoé', '#e67e22'], ['Tom', '#1abc9c'], ['Enzo', '#ecf0f1']],
  imoca: [['Kerguelen', '#e74c3c'], ['Mistral', '#f1c40f'], ['Biotherm·X', '#2ecc71'], ['Aurore', '#9b59b6'], ['Fastnet', '#e67e22'], ['Ouessant', '#1abc9c']]
};
const DIFFS = { 0: { name: 'Mousse', skill: [0.74, 0.86] }, 1: { name: 'Skipper', skill: [0.84, 0.95] }, 2: { name: 'Légende', skill: [0.93, 1.0] } };

class RaceGame {
  constructor(mode, diff) {
    this.mode = mode; this.C = CLASSES[mode]; this.diff = diff; const C = this.C;
    this.wind = new Wind(C.wind); this.parts = new Particles(); this.islands = [];
    this.t = mode === 'dinghy' ? -30 : -20; this.clock = 0; this.done = false; this.endT = 0;
    this.cam = { x: 0, y: 0, z: C.zoom };
    const mk = (x, y, label) => ({ type: 'mark', x, y, r: C.markR, label });
    const line = (cx, cy, dx, dy, label) => { const n = Math.hypot(dx, dy); dx /= n; dy /= n; return { type: 'line', x: cx, y: cy, c: { x: cx, y: cy }, d: { x: dx, y: dy }, L: { x: -dy, y: dx }, h: C.lineH, label }; };
    if (mode === 'dinghy') {
      const s = line(0, 0, 0, -1, 'Départ'), w = mk(0, -1500, 'Bouée au vent'), l = mk(0, 340, 'Bouée sous le vent');
      this.targets = [s, w, l, w, l, Object.assign({}, s, { label: 'Arrivée' })];
    } else {
      const wps = [[-1500, -4500], [3500, -6000], [6500, -1500], [2500, 1500], [-3000, 3500]];
      this.targets = [line(0, 0, -1500, -4500, 'Départ')];
      wps.forEach((p, i) => this.targets.push(mk(p[0], p[1], 'Porte ' + (i + 1))));
      this.targets.push(mk(0, 0, 'Arrivée'));
      // îles loin des routes directes
      let tries = 0;
      while (this.islands.length < 16 && tries++ < 600) {
        const x = rand(-5500, 8500), y = rand(-8000, 5500), r = rand(180, 420); let ok = true;
        for (let i = 0; i < this.targets.length - 1 && ok; i++) { const a = this.targets[i], b = this.targets[i + 1]; if (segDist(x, y, a.x, a.y, b.x, b.y) < r + 950) ok = false; }
        for (const is of this.islands) if (Math.hypot(x - is.x, y - is.y) < r + is.r + 300) ok = false;
        if (ok) this.islands.push(makeIsland(x, y, r, Math.random() < 0.5));
      }
    }
    // flotte
    const s0 = this.targets[0], names = SKIPPERS[mode].slice().sort(() => Math.random() - 0.5).slice(0, mode === 'dinghy' ? 6 : 5);
    const n = names.length + 1, up = C.wind.dir0 + Math.PI, sk = DIFFS[diff].skill;
    this.boats = []; const order = [...Array(n).keys()].sort(() => Math.random() - 0.5); const pslot = order.indexOf(0);
    for (let i = 0; i < n; i++) {
      const isP = i === 0, slot = ((order.indexOf(i) + 0.5) / n * 2 - 1) * s0.h * 0.85, hold = isP ? C.len * 6 : C.len * rand(3.5, 6);
      const b = {
        name: isP ? 'VOUS' : names[i - 1][0], color: isP ? '#3fa9f5' : names[i - 1][1], isPlayer: isP, skill: isP ? 1 : rand(sk[0], sk[1]),
        x: s0.c.x + s0.L.x * slot - s0.d.x * hold, y: s0.c.y + s0.L.y * slot - s0.d.y * hold, hdg: up - C.upAngle, spd: 0,
        sheet: 0.25, autoTrim: true, twa: 1, tws: 10, side: 1, eff: 1, wdir: C.wind.dir0, optSheet: .25, luff: false,
        heel: 0, hike: false, capsized: 0, over: 0, plane: 0,
        sail: 1, foil: false, fly: 0, stress: 0, broken: {}, chg: 0,
        leg: 0, fin: null, prog: 0,
        ai: { tack: -1, gybe: 1, cd: rand(2, 6), band: rand(.4, .9), slot, tgo: 0 }
      };
      b.ai.tgo = hold / (interp(C.polar, 50) * C.K * 0.62 * b.skill) + rand(0.3, 2.5);
      this.boats.push(b);
    }
    this.player = this.boats[0]; this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.touch = [{ label: '◀', code: 'ArrowLeft', pos: 'L' }, { label: '▶', code: 'ArrowRight', pos: 'L' },
      { label: 'Border', code: 'ArrowUp', pos: 'R' }, { label: 'Choquer', code: 'ArrowDown', pos: 'R' }, { label: 'Auto', code: 'KeyT', pos: 'R' }, { label: 'Vue', code: 'KeyC', pos: 'T' }];
    if (mode === 'dinghy') this.touch.push({ label: 'Rappel', code: 'Space', pos: 'R', big: true });
    else this.touch.push({ label: 'Foils', code: 'KeyF', pos: 'R' }, { label: 'J3', code: 'Digit1', pos: 'T' }, { label: 'J2', code: 'Digit2', pos: 'T' }, { label: 'Code 0', code: 'Digit3', pos: 'T' }, { label: 'Spi', code: 'Digit4', pos: 'T' });
    this.help = mode === 'dinghy'
      ? '← → barre · ↑ border · ↓ choquer · ESPACE rappel (maintenir) · T réglage auto · C vue · souris : regarder autour'
      : '← → barre · ↑ border · ↓ choquer · 1-4 voile d’avant · F foils · T réglage auto · C vue · souris : regarder autour';
    toast(mode === 'dinghy' ? 'Procédure de départ : 30 secondes' : 'Départ dans 20 secondes', 3);
  }

  /* ---------- physique voile ---------- */
  sailStep(b, dt, w) {
    const C = this.C, up = w.dir + Math.PI, rel = wrap(b.hdg - up), twaD = Math.abs(rel) / DEG;
    b.twa = Math.abs(rel); b.side = rel > 0 ? -1 : 1; b.tws = w.spd; b.wdir = w.dir;
    const opt = clamp((twaD * 0.5 - 5) / 85, 0, 1); b.optSheet = opt;
    const want = b.autoTrim && b.isPlayer && b.heel > 0.8 ? Math.min(1, opt + 0.24) : opt; // l'auto choque dans les surventes
    if (b.autoTrim) b.sheet += clamp(want - b.sheet, -dt * 0.7, dt * 0.7);
    let eff = clamp(1 - Math.pow(Math.abs(b.sheet - opt) / 0.42, 1.6), 0.12, 1);
    if (b.autoTrim && b.isPlayer) eff = Math.min(eff, 0.93); // le réglage manuel fin rapporte +7 %
    b.eff = eff; b.luff = b.sheet - opt > 0.15 || twaD < 27;
    let target = interp(C.polar, twaD) * Math.pow(w.spd / C.refWind, C.windExp) * eff * b.skill;
    if (this.mode === 'dinghy') {
      if (b.capsized > 0) {
        b.capsized -= dt; b.spd *= 1 - 3 * dt; b.heel = 1.4;
        if (b.capsized <= 0) { b.heel = 0.2; b.over = 0; if (b.isPlayer) toast('Redressé !', 1.5, '#7dffa0'); }
        return;
      }
      const press = Math.pow(w.spd / 13, 2), power = eff * (b.luff ? 0.45 : 1) * (1 + Math.max(0, opt - b.sheet) * 1.5);
      let ht = press * interp(HEEL_SF, twaD) * power;
      if (b.isPlayer) ht -= b.hike ? 0.55 : 0; else ht = Math.min(0.3, ht * 0.4);
      b.heel += (ht - b.heel) * 2.4 * dt;
      target *= 1 - clamp(Math.abs(b.heel) - 0.35, 0, 1) * 0.7;
      const pl = (w.spd > 11.5 && twaD > 80 && twaD < 158 && Math.abs(b.heel) < 0.5) ? 1 : 0; b.plane += (pl - b.plane) * dt * 1.2;
      target *= 1 + 0.33 * b.plane;
      if (b.heel > 1.12) { b.over += dt; if (b.over > 0.7) { b.capsized = 5.5; b.spd *= 0.3; Sfx.splash(0.3); this.parts.burst(b.x, b.y, 24, 90, 0.9, 4, '#fff'); if (b.isPlayer) toast('DESSALAGE ! Martelez ESPACE', 3, '#ff8a7a'); } } else b.over = Math.max(0, b.over - dt);
    } else {
      const s = SAILS[b.sail]; target *= interp(s.eff, twaD);
      if (b.chg > 0) { b.chg -= dt; target *= 0.6; }
      const wantFly = b.foil && b.spd > 13 && twaD > 55 && twaD < 156 ? 1 : 0; b.fly += (wantFly - b.fly) * dt * 0.9;
      target *= b.foil ? 0.95 + 0.33 * b.fly : 1;
      if (w.spd > s.max) { b.stress += (w.spd - s.max) * 0.035 * dt + 0.02 * dt; } else b.stress = Math.max(0, b.stress - 0.12 * dt);
      if (b.stress >= 1 && b.isPlayer) {
        b.broken[s.id] = true; b.stress = 0; b.sail = b.broken.J2 ? 0 : 1; b.chg = 5; Sfx.crack();
        toast('💥 ' + s.name + ' déchiré !', 3, '#ff8a7a'); this.parts.burst(b.x, b.y, 16, 120, 1, 5, '#fff');
      }
    }
    b.spd += (target - b.spd) * (target > b.spd ? C.acc : C.dec) * dt;
  }

  /* ---------- IA de navigation ---------- */
  navHeading(b, tx, ty, w) {
    const C = this.C, a = b.ai, brg = Math.atan2(ty - b.y, tx - b.x), up = w.dir + Math.PI;
    const off = wrap(brg - up), offD = wrap(brg - w.dir), dn = Math.PI - C.downAngle;
    // couloir : écart latéral à la route directe, pour ne pas s'égarer
    const pv = b.leg > 0 ? this.targets[b.leg - 1] : b, ldx = tx - pv.x, ldy = ty - pv.y, ll = Math.hypot(ldx, ldy) || 1;
    const xt = b.leg > 0 ? (ldx * (b.y - pv.y) - ldy * (b.x - pv.x)) / ll : 0, lim = C.len * 9;
    const inward = h => (ldx * Math.sin(h) - ldy * Math.cos(h)) * xt < 0;
    if (Math.abs(off) < C.upAngle + 0.03) {
      if (Math.abs(xt) > lim) { if (!inward(up + a.tack * C.upAngle)) { a.tack = -a.tack; a.cd = 4; } }
      else if (Math.sign(off) !== a.tack && Math.abs(off) > a.band * C.upAngle && a.cd <= 0) { a.tack = -a.tack; a.cd = rand(5, 9); a.band = rand(.35, .95); }
      return up + a.tack * C.upAngle;
    }
    if (Math.abs(offD) < dn - 0.03) {
      if (Math.abs(xt) > lim) { if (!inward(w.dir + a.gybe * dn)) { a.gybe = -a.gybe; a.cd = 4; } }
      else if (Math.sign(offD) !== a.gybe && Math.abs(offD) > a.band * dn && a.cd <= 0) { a.gybe = -a.gybe; a.cd = rand(6, 10); a.band = rand(.35, .95); }
      return w.dir + a.gybe * dn;
    }
    a.tack = off > 0 ? 1 : -1; a.gybe = offD > 0 ? 1 : -1;
    return brg;
  }
  aiStep(b, dt, w) {
    const C = this.C, tg = this.targets[Math.min(b.leg, this.targets.length - 1)]; b.ai.cd -= dt;
    let tx = tg.x, ty = tg.y;
    if (tg.type === 'line') { const k = b.leg === 0 ? 1 : 0.4; const back = cross2(tg, b.x, b.y) < 0 ? -1.6 : 1; tx = tg.c.x + tg.L.x * b.ai.slot * k * 0.8 + tg.d.x * 90 * back; ty = tg.c.y + tg.L.y * b.ai.slot * k * 0.8 + tg.d.y * 90 * back; }
    if (b.leg === 0 && this.t < -b.ai.tgo) { b.spd *= 1 - 2 * dt; b.sheet = Math.min(1, b.sheet + dt); return; } // attend derrière la ligne, voile choquée
    if (b.fin !== null) { b.sheet = Math.min(1, b.sheet + dt * 0.3); b.autoTrim = false; return; }
    const des = this.navHeading(b, tx, ty, w), dh = wrap(des - b.hdg), tr = C.turn * 0.85 * dt;
    b.hdg += clamp(dh, -tr, tr); b.spd -= Math.min(1, Math.abs(dh)) * b.spd * 0.1 * dt;
    if (this.mode === 'imoca') {
      const twaD = b.twa / DEG, cur = SAILS[b.sail]; let best = b.sail, be = -1;
      SAILS.forEach((s, i) => { if (s.max > w.spd + 1.5) { const e = interp(s.eff, twaD); if (e > be) { be = e; best = i; } } });
      if (best !== b.sail && b.chg <= 0 && (cur.max <= w.spd + 0.5 || be > interp(cur.eff, twaD) + 0.09)) { b.sail = best; b.chg = 4.5; }
      b.foil = twaD > 58; b.stress = 0;
    }
  }

  update(dt) {
    const C = this.C, p = this.player; this.t += dt; this.clock += dt;
    this.wind.update(dt, this.cam); this.parts.update(dt);
    const prevT = this.t - dt;
    if (prevT < 0) {
      const a = Math.ceil(-prevT), b = Math.ceil(-this.t);
      if (b < a && b > 0 && (b <= 5 || b === 10 || b === 20)) Sfx.beep(660, 0.12, 'square', 0.08);
      if (this.t >= 0) { Sfx.horn(); toast('TOP DÉPART !', 2, '#ffe066'); const s0 = this.targets[0]; if (p.leg === 0 && cross2(s0, p.x, p.y) < 0) toast('Départ anticipé : repassez la ligne !', 4, '#ff8a7a'); }
    }
    // --- joueur ---
    if (p.fin === null) {
      const st = steerInput();
      if (!(p.capsized > 0)) { p.hdg += st * C.turn * (0.4 + 0.6 * clamp(p.spd / C.refSpd, 0, 1)) * dt; p.spd -= Math.abs(st) * p.spd * 0.09 * dt; }
      if (keys.ArrowUp) { p.sheet = Math.max(0, p.sheet - 0.55 * dt); p.autoTrim = false; }
      if (keys.ArrowDown) { p.sheet = Math.min(1, p.sheet + 0.55 * dt); p.autoTrim = false; }
      if (pressed.KeyT) { p.autoTrim = !p.autoTrim; toast(p.autoTrim ? 'Réglage automatique (93 %)' : 'Réglage manuel', 1.5); }
      if (this.mode === 'dinghy') {
        p.hike = !!keys.Space;
        if (p.capsized > 0 && pressed.Space) { p.capsized -= 0.4; this.parts.burst(p.x, p.y, 4, 60, 0.5, 3, '#fff'); }
      } else {
        for (let i = 0; i < 4; i++) if (pressed['Digit' + (i + 1)] || pressed['Numpad' + (i + 1)]) {
          if (p.broken[SAILS[i].id]) toast(SAILS[i].name + ' hors d’usage', 1.5, '#ff8a7a');
          else if (i !== p.sail) { p.sail = i; p.chg = 4; p.stress = 0; toast('Changement de voile : ' + SAILS[i].name, 1.5); }
        }
        if (pressed.KeyF) { p.foil = !p.foil; toast(p.foil ? 'Foils déployés' : 'Foils rentrés', 1.2); }
      }
    } else { p.autoTrim = false; p.sheet = Math.min(1, p.sheet + dt * 0.3); }
    // --- tous les bateaux ---
    for (const b of this.boats) {
      const w = this.wind.at(b.x, b.y), px = b.x, py = b.y;
      if (!b.isPlayer) this.aiStep(b, dt, w);
      this.sailStep(b, dt, w);
      b.spd = Math.max(0, b.spd);
      const v = b.spd * C.K; b.x += Math.cos(b.hdg) * v * dt; b.y += Math.sin(b.hdg) * v * dt;
      wakeUpdate(b, dt, C.len * 0.45, 1.5);
      // embruns
      if (b.spd > (this.mode === 'dinghy' ? 5.6 : 15) && Math.random() < dt * 30) {
        const s = Math.random() < 0.5 ? 1 : -1, bx = b.x + Math.cos(b.hdg) * C.len * 0.3, by = b.y + Math.sin(b.hdg) * C.len * 0.3;
        this.parts.add(bx, by, Math.cos(b.hdg + s * 2.2) * v * 0.5, Math.sin(b.hdg + s * 2.2) * v * 0.5, 0.5, 2.2, 'rgba(255,255,255,.8)', 3, 2);
      }
      // îles
      for (const is of this.islands) { const d = Math.hypot(b.x - is.x, b.y - is.y); if (d < is.r + 20) { const a = Math.atan2(b.y - is.y, b.x - is.x); b.x = is.x + Math.cos(a) * (is.r + 20); b.y = is.y + Math.sin(a) * (is.r + 20); if (b.spd > 3 && b.isPlayer) { toast('Échouage !', 1.5, '#ff8a7a'); Sfx.crack(); } b.spd *= 0.2; } }
      // passage des marques
      if (b.fin === null) {
        const tg = this.targets[b.leg]; let ok = false;
        if (tg.type === 'line') { const s0 = cross2(tg, px, py), s1 = cross2(tg, b.x, b.y), al = (b.x - tg.c.x) * tg.L.x + (b.y - tg.c.y) * tg.L.y; ok = this.t >= 0 && s0 > 0 && s1 <= 0 && Math.abs(al) <= tg.h; }
        else ok = Math.hypot(b.x - tg.x, b.y - tg.y) < tg.r;
        if (ok) {
          b.leg++;
          if (b.leg >= this.targets.length) { b.fin = this.t; if (b.isPlayer) { Sfx.horn(); this.endT = 2.2; } }
          else if (b.isPlayer) { Sfx.beep(880, 0.15, 'triangle', 0.12); if (b.leg > 1) toast(tg.label + ' ✔', 1.6, '#7dffa0'); }
        }
        const nt = this.targets[Math.min(b.leg, this.targets.length - 1)]; b.prog = b.leg * 1e5 - Math.hypot(b.x - nt.x, b.y - nt.y);
      }
    }
    // collisions entre bateaux
    const md = C.len * 0.55;
    for (let i = 0; i < this.boats.length; i++) for (let j = i + 1; j < this.boats.length; j++) {
      const a = this.boats[i], b = this.boats[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < md && d > 0.01) { const k = (md - d) / d * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; a.spd *= 1 - dt; b.spd *= 1 - dt; }
    }
    // caméra
    const v = p.spd * C.K, base = C.zoom * clamp(Math.min(W, H) / 760, 0.55, 1.25), zt = base * (this.mode === 'imoca' ? 1 - clamp((p.spd - 12) / 60, 0, 0.3) : 1);
    this.cam.z += (zt - this.cam.z) * dt * 1.5;
    this.cam.x += (p.x + Math.cos(p.hdg) * v * 0.7 - this.cam.x) * Math.min(1, dt * 3); this.cam.y += (p.y + Math.sin(p.hdg) * v * 0.7 - this.cam.y) * Math.min(1, dt * 3);
    Sfx.wind(clamp(p.tws / 30 + p.spd / 60, 0, 1));
    if (this.endT > 0) { this.endT -= dt; if (this.endT <= 0 && !this.done) { this.done = true; this.finish(); } }
  }

  ranking() { return this.boats.slice().sort((a, b) => (a.fin !== null || b.fin !== null) ? ((a.fin === null ? 1e9 : a.fin) - (b.fin === null ? 1e9 : b.fin)) : b.prog - a.prog); }
  finish() {
    const r = this.ranking(), pos = r.indexOf(this.player) + 1, key = 'best.' + this.mode + '.' + this.diff, best = Store.get(key, null), t = this.player.fin;
    const rec = best === null || t < best; if (rec) Store.set(key, t);
    let rows = r.map((b, i) => `<tr class="${b.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${b.color}"></span>${b.name}</td><td>${b.fin !== null ? fmtTime(b.fin) : 'en course'}</td></tr>`).join('');
    const title = pos === 1 ? 'VICTOIRE !' : pos <= 3 ? 'PODIUM !' : 'ARRIVÉE';
    showEnd(title, `<p>${this.C.title} · ${DIFFS[this.diff].name} — vous terminez <b>${pos}<sup>${pos === 1 ? 'er' : 'e'}</sup></b> en <b>${fmtTime(t)}</b>${rec ? ' · <span class="gold">nouveau record !</span>' : ' · record ' + fmtTime(best)}</p><table class="res">${rows}</table>`);
  }

  /* ---------- rendu ---------- */
  draw(c) {
    const C = this.C, p = this.player, cam = this.cam, t = this.clock;
    if (R3.active()) {
      const nt = this.targets[Math.min(p.leg, this.targets.length - 1)];
      c.clearRect(0, 0, W, H); R3.render(this);
      for (const b of this.boats) if (!b.isPlayer) R3.marker(c, b.x, b.y, C.len * 1.7, b.color, b.name, false);
      if (p.fin === null) R3.marker(c, nt.x, nt.y, C.len * 0.9, '#ffd23f', nt.label + ' · ' + (d => this.mode === 'dinghy' ? Math.round(d / 3) + ' m' : (d / 600).toFixed(1) + ' nm')(Math.hypot(nt.x - p.x, nt.y - p.y)));
      this.hud(c, nt); return;
    }
    drawWater(c, cam, t, this.wind, this.mode === 'dinghy' ? ['#1c8fb5', '#136f95'] : ['#0f5f8f', '#0a3f6b']);
    camBegin(c, cam);
    for (const is of this.islands) drawIsland(c, is);
    const nt = this.targets[Math.min(p.leg, this.targets.length - 1)], lw = 1 / cam.z;
    // laylines vers la marque au vent
    if (nt.type === 'mark' && p.fin === null) {
      const w = this.wind.at(nt.x, nt.y), off = Math.abs(wrap(Math.atan2(nt.y - p.y, nt.x - p.x) - (w.dir + Math.PI)));
      if (off < C.upAngle + 0.25) { c.setLineDash([10 * lw, 14 * lw]); c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1.5 * lw; for (const s of [-1, 1]) { const a = w.dir + s * C.upAngle; c.beginPath(); c.moveTo(nt.x, nt.y); c.lineTo(nt.x + Math.cos(a) * 2600, nt.y + Math.sin(a) * 2600); c.stroke(); } c.setLineDash([]); }
    }
    // parcours
    const seen = new Set();
    this.targets.forEach((tg, i) => {
      if (seen.has(tg.x + ',' + tg.y + tg.type)) return; seen.add(tg.x + ',' + tg.y + tg.type);
      const active = tg.x === nt.x && tg.y === nt.y && tg.type === nt.type, pulse = 0.5 + 0.5 * Math.sin(t * 4);
      if (tg.type === 'line') {
        const ax = tg.c.x - tg.L.x * tg.h, ay = tg.c.y - tg.L.y * tg.h, bx = tg.c.x + tg.L.x * tg.h, by = tg.c.y + tg.L.y * tg.h;
        c.setLineDash([14 * lw, 10 * lw]); c.strokeStyle = active ? `rgba(255,224,102,${0.5 + 0.5 * pulse})` : 'rgba(255,255,255,.3)'; c.lineWidth = 3 * lw; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]);
        drawBuoy(c, ax, ay, C.len * 0.2, '#ff7a1a'); drawCommittee(c, bx, by, C.len * 0.5, Math.atan2(tg.d.y, tg.d.x));
      } else {
        c.setLineDash([8 * lw, 10 * lw]); c.strokeStyle = active ? `rgba(255,224,102,${0.45 + 0.5 * pulse})` : 'rgba(255,255,255,.18)'; c.lineWidth = 2 * lw; c.beginPath(); c.arc(tg.x, tg.y, tg.r, 0, TAU); c.stroke(); c.setLineDash([]);
        drawBuoy(c, tg.x, tg.y, C.len * 0.24, active ? '#ffd23f' : '#ff7a1a');
      }
    });
    for (const b of this.boats) wakeDraw(c, b, C.len * 0.09);
    this.parts.draw(c);
    const sorted = this.boats.slice().sort((a, b) => a.isPlayer - b.isPlayer);
    for (const b of sorted) { (this.mode === 'dinghy' ? drawDinghy : drawImoca)(c, b, t); }
    // noms
    for (const b of this.boats) if (!b.isPlayer) { c.font = `700 ${12 / cam.z}px ${FONT}`; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillText(b.name, b.x, b.y - C.len * 0.7); }
    camEnd(c);
    if (p.fin === null) drawPointer(c, cam, nt.x, nt.y, '#ffd23f', (d => this.mode === 'dinghy' ? Math.round(d / 3) + ' m' : (d / 600).toFixed(1) + ' nm')(Math.hypot(nt.x - p.x, nt.y - p.y)));
    this.hud(c, nt);
  }

  hud(c, nt) {
    const p = this.player, C = this.C, small = W < 720, x0 = 12; let y = 12;
    // chrono
    if (this.t < 0) {
      const s = Math.ceil(-this.t); panel(c, W / 2 - 80, 10, 160, 62); txt(c, 'DÉPART DANS', W / 2, 30, 11, '#9fc4dd', 'center'); txt(c, s + ' s', W / 2, 62, 30, s <= 5 ? '#ffd23f' : '#fff', 'center', '800');
    } else { panel(c, W / 2 - 80, 10, 160, 62); txt(c, nt.label.toUpperCase() + (this.mode === 'dinghy' ? ' · ' + Math.min(p.leg, 5) + '/5' : ''), W / 2, 30, 11, '#9fc4dd', 'center'); txt(c, fmtTime(p.fin !== null ? p.fin : this.t), W / 2, 62, 28, '#fff', 'center', '800'); }
    // vitesse & angles
    const brg = Math.atan2(nt.y - p.y, nt.x - p.x), vmg = p.spd * Math.cos(wrap(brg - p.hdg));
    panel(c, x0, y, 190, 96);
    txt(c, p.spd.toFixed(1), x0 + 14, y + 44, 40, p.fly > 0.5 || p.plane > 0.5 ? '#7dffa0' : '#fff', 'left', '800'); txt(c, 'nds', x0 + 14 + c.measureText(p.spd.toFixed(1)).width + 6, y + 44, 14, '#9fc4dd');
    txt(c, 'Angle au vent', x0 + 14, y + 66, 11, '#9fc4dd'); txt(c, Math.round(p.twa / DEG) + '° ' + (p.side > 0 ? 'tribord' : 'bâbord'), x0 + 176, y + 66, 12, p.twa < 34 * DEG ? '#ff8a7a' : '#fff', 'right');
    txt(c, 'VMG marque', x0 + 14, y + 84, 11, '#9fc4dd'); txt(c, vmg.toFixed(1) + ' nds', x0 + 176, y + 84, 12, vmg < 0 ? '#ff8a7a' : '#fff', 'right');
    y += 104;
    // réglage d'écoute
    panel(c, x0, y, 190, 50);
    txt(c, 'ÉCOUTE ' + Math.round(p.eff * 100) + ' %', x0 + 14, y + 18, 11, p.eff > 0.9 ? '#7dffa0' : p.eff > 0.6 ? '#ffd23f' : '#ff8a7a'); txt(c, p.autoTrim ? 'AUTO' : 'MANUEL', x0 + 176, y + 18, 10, p.autoTrim ? '#9fc4dd' : '#ffd23f', 'right');
    const gx = x0 + 14, gw = 162, gy = y + 28; c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(gx, gy, gw, 9);
    c.fillStyle = 'rgba(125,255,160,.75)'; const o0 = clamp(p.optSheet - 0.07, 0, 1), o1 = clamp(p.optSheet + 0.07, 0, 1); c.fillRect(gx + o0 * gw, gy, (o1 - o0) * gw, 9);
    c.fillStyle = '#fff'; c.fillRect(gx + p.sheet * gw - 2, gy - 4, 4, 17);
    y += 58;
    if (this.mode === 'dinghy') {
      panel(c, x0, y, 190, 50); const h = p.heel, col = Math.abs(h) < 0.4 ? '#7dffa0' : h < 0.95 ? '#ffd23f' : '#ff5a4a';
      txt(c, p.capsized > 0 ? 'DESSALÉ !' : 'GÎTE' + (p.hike ? ' · au rappel' : ''), x0 + 14, y + 18, 11, col); if (p.plane > 0.5) txt(c, 'PLANNING', x0 + 176, y + 18, 10, '#7dffa0', 'right');
      const gx2 = x0 + 14, gy2 = y + 28; c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(gx2, gy2, gw, 9); c.fillStyle = 'rgba(125,255,160,.35)'; c.fillRect(gx2 + gw * 0.3, gy2, gw * 0.32, 9);
      c.fillStyle = col; c.fillRect(gx2 + clamp(0.3 + h * 0.6, 0, 1) * gw - 2, gy2 - 4, 4, 17);
    } else {
      panel(c, x0, y, 190, 92); const twaD = p.twa / DEG;
      SAILS.forEach((s, i) => {
        const bx = x0 + 10 + i * 44, e = interp(s.eff, twaD), over = p.tws > s.max, cur = i === p.sail;
        c.fillStyle = p.broken[s.id] ? 'rgba(80,80,80,.5)' : cur ? 'rgba(63,169,245,.55)' : 'rgba(255,255,255,.08)'; c.beginPath(); c.roundRect(bx, y + 8, 40, 40, 6); c.fill();
        txt(c, String(i + 1), bx + 5, y + 20, 9, '#9fc4dd'); txt(c, s.name, bx + 20, y + 33, s.name.length > 3 ? 9 : 12, p.broken[s.id] ? '#777' : '#fff', 'center', '700');
        c.fillStyle = p.broken[s.id] ? '#555' : over ? '#ff5a4a' : e > 0.98 ? '#7dffa0' : e > 0.8 ? '#ffd23f' : '#888'; c.fillRect(bx + 5, y + 40, 30, 4);
      });
      const s = SAILS[p.sail];
      txt(c, p.chg > 0 ? 'Manœuvre en cours…' : p.tws > s.max ? '⚠ Trop de vent pour ' + s.name + ' !' : s.name + ' : ' + s.hint, x0 + 14, y + 64, 11, p.tws > s.max ? '#ff8a7a' : '#9fc4dd');
      if (p.stress > 0.02) { c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(x0 + 14, y + 68, 162, 4); c.fillStyle = '#ff5a4a'; c.fillRect(x0 + 14, y + 68, 162 * p.stress, 4); }
      txt(c, 'FOILS [F]', x0 + 14, y + 84, 11, '#9fc4dd'); txt(c, !p.foil ? 'rentrés' : p.fly > 0.5 ? 'EN VOL ✈' : 'déployés', x0 + 176, y + 84, 11, p.fly > 0.5 ? '#7dffa0' : p.foil ? '#ffd23f' : '#fff', 'right', '700');
    }
    // compas
    const r = small ? 30 : 40; drawCompass(c, W - r - 22, r + 22, r, p.wdir, p.tws, p.hdg);
    // classement
    if (H > 520) {
      const rk = this.ranking(), ry = r * 2 + 68, rw = small ? 104 : 150; panel(c, W - rw - 12, ry, rw, rk.length * 19 + 12);
      rk.forEach((b, i) => { const yy = ry + 21 + i * 19; c.fillStyle = b.color; c.beginPath(); c.arc(W - rw, yy - 4, 4, 0, TAU); c.fill(); txt(c, (i + 1) + '. ' + b.name, W - rw + 9, yy, 12, b.isPlayer ? '#ffd23f' : '#fff', 'left', b.isPlayer ? '800' : '500'); if (b.fin !== null && !small) txt(c, fmtTime(b.fin), W - 20, yy, 10, '#9fc4dd', 'right'); });
    }
    this.minimap(c);
    if (!touchUI() && this.clock < 25) txt(c, this.help, W / 2, H - 14, 12, 'rgba(255,255,255,.7)', 'center', '500');
  }

  minimap(c) {
    if (touchUI() && W < 900) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const t of this.targets) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); }
    const pad = this.mode === 'dinghy' ? 500 : 1200; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const mh = Math.min(190, H * 0.28), s = mh / (y1 - y0), mw = Math.max(110, (x1 - x0) * s), mx = touchUI() ? W / 2 - mw / 2 : W - mw - 12, my = H - mh - (touchUI() ? 12 : 30);
    const ox = mx + (mw - (x1 - x0) * s) / 2;
    panel(c, mx, my, mw, mh); c.save(); c.beginPath(); c.rect(mx, my, mw, mh); c.clip();
    const X = x => ox + (x - x0) * s, Y = y => my + (y - y0) * s;
    c.fillStyle = 'rgba(120,200,130,.7)'; for (const is of this.islands) { c.beginPath(); c.arc(X(is.x), Y(is.y), Math.max(2, is.r * s), 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.beginPath(); this.targets.forEach((t, i) => i ? c.lineTo(X(t.x), Y(t.y)) : c.moveTo(X(t.x), Y(t.y))); c.stroke();
    const nt = this.targets[Math.min(this.player.leg, this.targets.length - 1)];
    for (const t of this.targets) { c.fillStyle = t === nt || (t.x === nt.x && t.y === nt.y) ? '#ffd23f' : '#ff7a1a'; c.beginPath(); c.arc(X(t.x), Y(t.y), 3, 0, TAU); c.fill(); }
    for (const b of this.boats) { c.fillStyle = b.color; c.strokeStyle = '#fff'; c.beginPath(); c.arc(X(b.x), Y(b.y), b.isPlayer ? 4 : 2.6, 0, TAU); c.fill(); if (b.isPlayer) c.stroke(); }
    c.restore();
  }
}

function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1); return Math.hypot(px - ax - dx * t, py - ay - dy * t); }
// > 0 avant la ligne (côté pré-départ), <= 0 une fois franchie dans le sens de la course
function cross2(tg, x, y) { return -((x - tg.c.x) * tg.d.x + (y - tg.c.y) * tg.d.y); }

/* ---------- dessins ---------- */
function drawBuoy(c, x, y, r, col) {
  c.fillStyle = 'rgba(0,20,40,.25)'; c.beginPath(); c.arc(x + r * 0.3, y + r * 0.3, r, 0, TAU); c.fill();
  c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU); c.fill();
}
function drawCommittee(c, x, y, l, a) {
  c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = '#f4f4f4'; c.beginPath(); c.moveTo(l, 0); c.quadraticCurveTo(l * 0.3, -l * 0.42, -l, -l * 0.34); c.lineTo(-l, l * 0.34); c.quadraticCurveTo(l * 0.3, l * 0.42, l, 0); c.fill();
  c.fillStyle = '#c0392b'; c.fillRect(-l * 0.5, -l * 0.2, l * 0.8, l * 0.4); c.fillStyle = '#ff7a1a'; c.fillRect(-l * 0.1, -l * 0.08, l * 0.5, l * 0.16); c.restore();
}
// voile vue de dessus : croissant entre M et E, creux dans le sens du vent
function sailShape(c, mx, my, ex, ey, b, depth, t, fill, stroke) {
  const wa = wrap(b.wdir - b.hdg), wx = Math.cos(wa), wy = Math.sin(wa), cx = ex - mx, cy = ey - my, l = Math.hypot(cx, cy) || 1;
  let nx = -cy / l, ny = cx / l; if (nx * wx + ny * wy < 0) { nx = -nx; ny = -ny; }
  let d = depth; if (b.luff) d = depth * 0.35 * Math.sin(t * 22 + b.x);
  const qx = (mx + ex) / 2, qy = (my + ey) / 2;
  c.beginPath(); c.moveTo(mx, my); c.quadraticCurveTo(qx + nx * d * 2, qy + ny * d * 2, ex, ey); c.quadraticCurveTo(qx + nx * d * 0.5, qy + ny * d * 0.5, mx, my);
  c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 1; c.stroke();
}
function boomEnd(b, mx, len, extra = 0) {
  const beta = Math.min((5 + b.sheet * 85) * DEG + extra, Math.max(b.twa, 0.09)), th = Math.PI + b.side * beta;
  return [mx + Math.cos(th) * len, Math.sin(th) * len];
}
function drawDinghy(c, b, t) {
  c.save(); c.translate(b.x, b.y); c.rotate(b.hdg);
  const lee = -b.side;
  if (b.capsized > 0) {
    c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.moveTo(8, lee * 4); c.lineTo(2, lee * 44); c.lineTo(-18, lee * 8); c.closePath(); c.fill();
    c.fillStyle = b.color; c.beginPath(); c.ellipse(0, 0, 22, 4.5, 0, 0, TAU); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
    c.fillStyle = '#ffcf9e'; c.beginPath(); c.arc(-4, -lee * 7 + Math.sin(t * 9) * 2, 3.2, 0, TAU); c.fill();
    c.restore(); return;
  }
  c.fillStyle = 'rgba(0,25,50,.22)'; c.beginPath(); c.ellipse(-2, 3, 23, 9, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(23, 0); c.quadraticCurveTo(9, -9.5, -21, -7.5); c.lineTo(-21, 7.5); c.quadraticCurveTo(9, 9.5, 23, 0); c.closePath();
  c.fillStyle = '#f7f7f2'; c.fill(); c.strokeStyle = b.color; c.lineWidth = 2.4; c.stroke();
  c.fillStyle = 'rgba(40,60,80,.35)'; c.beginPath(); c.roundRect(-17, -4.5, 21, 9, 3); c.fill();
  // barreur : sort au rappel
  const sy = b.side * (b.hike ? 11.5 : b.isPlayer ? 4.5 : 4.5 + Math.min(6, Math.max(0, b.heel) * 20));
  c.fillStyle = b.color; c.beginPath(); c.ellipse(-7, sy * 0.75, 3.2, 4.2, 0, 0, TAU); c.fill(); c.fillStyle = '#ffcf9e'; c.beginPath(); c.arc(-7, sy, 2.8, 0, TAU); c.fill();
  const e = boomEnd(b, 8, 25);
  sailShape(c, 8, 0, e[0], e[1], b, 3.5 + clamp(b.heel, 0, 1.2) * 9, t, 'rgba(255,255,255,.95)', 'rgba(60,80,100,.6)');
  c.strokeStyle = '#333'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(8, 0); c.lineTo(e[0], e[1]); c.stroke();
  c.fillStyle = '#222'; c.beginPath(); c.arc(8, 0, 1.6, 0, TAU); c.fill();
  c.restore();
}
function drawImoca(c, b, t) {
  c.save(); c.translate(b.x, b.y); c.rotate(b.hdg);
  const fly = b.fly, sh = 4 + fly * 10;
  c.fillStyle = `rgba(0,20,45,${0.28 - fly * 0.1})`; c.beginPath(); c.ellipse(-2 + sh * 0.4, sh, 43, 14, 0, 0, TAU); c.fill();
  if (fly > 0.02) c.scale(1 + fly * 0.07, 1 + fly * 0.07);
  if (b.foil) { c.strokeStyle = '#ff8c1a'; c.lineWidth = 3.2; c.lineCap = 'round'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(4, s * 11); c.quadraticCurveTo(6, s * 24, 15, s * 31); c.stroke(); } }
  // coque
  c.beginPath(); c.moveTo(42, 0); c.quadraticCurveTo(38, -8, 20, -11.5); c.lineTo(-40, -13); c.lineTo(-42, 0); c.lineTo(-40, 13); c.lineTo(20, 11.5); c.quadraticCurveTo(38, 8, 42, 0); c.closePath();
  c.fillStyle = '#10161f'; c.fill(); c.strokeStyle = b.color; c.lineWidth = 2.6; c.stroke();
  c.fillStyle = '#e9edf2'; c.beginPath(); c.moveTo(36, 0); c.quadraticCurveTo(30, -6, 16, -8.5); c.lineTo(-37, -10); c.lineTo(-37, 10); c.lineTo(16, 8.5); c.quadraticCurveTo(30, 6, 36, 0); c.fill();
  c.fillStyle = b.color; c.beginPath(); c.roundRect(-26, -6.5, 22, 13, 5); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-36, -7, 8, 14);
  // bout-dehors
  c.strokeStyle = '#222'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(40, 0); c.lineTo(54, 0); c.stroke();
  // grand-voile
  const e = boomEnd(b, 6, 40);
  sailShape(c, 6, 0, e[0], e[1], b, 5, t, 'rgba(38,44,54,.96)', 'rgba(255,255,255,.5)');
  // voile d'avant
  if (!(b.chg > 0 && Math.sin(t * 14) > 0)) {
    const s = SAILS[b.sail], big = b.sail >= 2, tx = big ? 54 : 38, h = boomEnd(b, tx, s.len, big ? 0.25 : 0.12);
    sailShape(c, tx, 0, h[0], h[1], b, b.sail === 3 ? 12 : b.sail === 2 ? 7 : 4, t, b.sail === 3 ? b.color : 'rgba(250,250,250,.95)', 'rgba(30,40,55,.6)');
  }
  c.fillStyle = '#000'; c.beginPath(); c.arc(6, 0, 2, 0, TAU); c.fill();
  c.restore();
}
