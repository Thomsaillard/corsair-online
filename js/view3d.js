'use strict';
/* ============ Rendu 3D : océan, ciel, bateaux modélisés, vue cockpit ============ */
const MOODS = {
  dinghy: { sun: [0.35, 0.72, -0.6], sunCol: 0xfff3d6, zen: 0x2f7fd6, hor: 0xc4e6f5, deep: 0x0a5c8c, shal: 0x2fb3c9, amp: 0.9, len: 0.5, fog: 0.00022, cloud: 0.55, light: 1.15 },
  imoca: { sun: [-0.55, 0.3, -0.78], sunCol: 0xffd9a0, zen: 0x2a5aa6, hor: 0xf1d8b4, deep: 0x083a63, shal: 0x1f84a6, amp: 4.2, len: 1.7, fog: 0.00011, cloud: 0.5, light: 1.05 },
  pirate: { sun: [0.62, 0.17, -0.76], sunCol: 0xffa25c, zen: 0x34518f, hor: 0xffb98a, deep: 0x0a3350, shal: 0x1d7d8c, amp: 2.0, len: 1.0, fog: 0.0002, cloud: 0.46, light: 0.95 }
};
const WAVES = [[0, 260, 1], [0.5, 150, 0.55], [-0.4, 95, 0.3], [1.1, 60, 0.18]];
const GLSL_COMMON = `
uniform vec3 uSun, uSunCol, uZen, uHor; uniform float uT;
vec3 skyBase(vec3 d){ float t=clamp(d.y,0.,1.); vec3 c=mix(uHor,uZen,pow(t,.5)); float s=max(dot(d,uSun),0.);
  c+=uSunCol*(pow(s,900.)*5.+pow(s,24.)*.3+pow(s,4.)*.1); return c; }
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+vec2(17.,9.);a*=.5;}return s;}
`;
const GLSL_WAVES = `
uniform float uAmp, uLen; uniform vec4 uW[4]; // dir.x, dir.z, k, amp
vec3 waves(vec2 p){ float h=0.; vec2 g=vec2(0.);
  for(int i=0;i<4;i++){ float k=uW[i].z/uLen, a=uW[i].w*uAmp, ph=k*dot(uW[i].xy,p)-sqrt(k)*6.*uT; h+=a*sin(ph); g+=uW[i].xy*(a*k*cos(ph)); }
  return vec3(h,g); }
`;

const R3 = {
  ok: false, view: Store.get('view', 'cockpit'), game: null, models: new Map(), look: { yaw: 0, pitch: 0, drag: false, glance: 0, glanceT: 0 }, last: 0, t: 0,
  init() {
    if (!window.THREE) return;
    try {
      const T = THREE; this.gl = $('gl');
      this.r = new T.WebGLRenderer({ canvas: this.gl, antialias: true, powerPreference: 'high-performance' });
      this.cam = new T.PerspectiveCamera(68, 1, 1, 60000); this.resize(); window.addEventListener('resize', () => this.resize());
      this.ok = true;
    } catch (e) { this.ok = false; }
    // regard libre à la souris
    const L = this.look;
    cv.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { L.drag = true; L.px = e.clientX; L.py = e.clientY; } });
    window.addEventListener('pointerup', () => { L.drag = false; });
    window.addEventListener('pointermove', e => { if (L.drag) { L.yaw = clamp(L.yaw + (e.clientX - L.px) * 0.006, -2.6, 2.6); L.pitch = clamp(L.pitch + (e.clientY - L.py) * 0.004, -0.5, 0.6); L.px = e.clientX; L.py = e.clientY; } });
  },
  resize() { if (!this.r) return; this.r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); this.r.setSize(window.innerWidth, window.innerHeight, false); this.cam.aspect = window.innerWidth / window.innerHeight; this.cam.updateProjectionMatrix(); },
  active() { return this.ok && this.view !== 'top'; },
  cycle() { const v = ['cockpit', 'chase', 'top'], i = v.indexOf(this.view); this.view = this.ok ? v[(i + 1) % 3] : 'top'; Store.set('view', this.view); toast({ cockpit: 'Vue cockpit', chase: 'Vue poursuite', top: 'Vue du ciel' }[this.view], 1.2); },
  waveH(x, z) { let h = 0; const m = this.mood; for (const w of this.wv) { const k = w.k / m.len; h += w.a * m.amp * Math.sin(k * (w.dx * x + w.dz * z) - Math.sqrt(k) * 6 * this.t); } return h; },

  /* ---------- scène ---------- */
  build(game) {
    const T = THREE, mode = game.mode || 'pirate', m = this.mood = MOODS[mode];
    this.game = game; this.models.clear(); this.t = 0;
    const sc = this.scene = new T.Scene(); sc.fog = new T.FogExp2(m.hor, m.fog * 1.4);
    const sun = new T.Vector3(...m.sun).normalize(); this.sun = sun;
    sc.add(new T.HemisphereLight(new T.Color(m.hor).lerp(new T.Color(0xffffff), 0.5), 0x1b3a55, 1.5 * m.light));
    const dl = new T.DirectionalLight(new T.Color(m.sunCol).lerp(new T.Color(0xffffff), 0.55), 2.6 * m.light); dl.position.copy(sun).multiplyScalar(1000); sc.add(dl);
    const wd = game.wind.dir0; this.wv = WAVES.map(w => ({ dx: Math.cos(wd + w[0]), dz: Math.sin(wd + w[0]), k: TAU / w[1], a: w[2] }));
    const U = this.uni = {
      uSun: { value: sun }, uSunCol: { value: new T.Color(m.sunCol) }, uZen: { value: new T.Color(m.zen) }, uHor: { value: new T.Color(m.hor) }, uT: { value: 0 },
      uAmp: { value: m.amp }, uLen: { value: m.len }, uW: { value: this.wv.map(w => new T.Vector4(w.dx, w.dz, w.k, w.a)) },
      uCam: { value: new T.Vector3() }, uDeep: { value: new T.Color(m.deep) }, uShal: { value: new T.Color(m.shal) }, uFog: { value: m.fog },
      uPuff: { value: Array.from({ length: 8 }, () => new T.Vector4()) }, uCloud: { value: m.cloud }, uWd: { value: new T.Vector2(Math.cos(wd), Math.sin(wd)) }
    };
    // ciel
    this.sky = new T.Mesh(new T.SphereGeometry(50000, 32, 16), new T.ShaderMaterial({
      uniforms: U, side: T.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: GLSL_COMMON + `uniform float uCloud; uniform vec2 uWd; varying vec3 vD;
        void main(){ vec3 d=normalize(vD); vec3 c=skyBase(d);
          if(d.y>0.){ vec2 uv=d.xz/(d.y+.1)*1.1+uWd*uT*.012; float cl=smoothstep(uCloud,uCloud+.28,fbm(uv)); float lit=fbm(uv+uSun.xz*.25);
            vec3 cc=mix(uHor*.85,vec3(1.),.35+.55*smoothstep(.3,.7,lit))+uSunCol*.25*pow(max(dot(d,uSun),0.),6.); c=mix(c,cc,cl*smoothstep(0.,.2,d.y)*.9); }
          gl_FragColor=vec4(c,1.);
          #include <colorspace_fragment>
        }`
    })); this.sky.renderOrder = -2; sc.add(this.sky);
    // océan : grille radiale dense près de la caméra
    const nr = 150, ns = 180, pos = [0, 0, 0], idx = [];
    for (let i = 0; i < nr; i++) { const r = 1.2 * Math.exp(i * Math.log(45000 / 1.2) / (nr - 1)); for (let j = 0; j < ns; j++) { const a = j / ns * TAU; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); } }
    for (let j = 0; j < ns; j++) idx.push(0, 1 + (j + 1) % ns, 1 + j);
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < ns; j++) { const a = 1 + i * ns + j, b = 1 + i * ns + (j + 1) % ns, c2 = a + ns, d = b + ns; idx.push(a, b, c2, b, d, c2); }
    const og = new T.BufferGeometry(); og.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); og.setIndex(idx);
    this.sea = new T.Mesh(og, new T.ShaderMaterial({
      uniforms: U, fog: false,
      vertexShader: GLSL_COMMON + GLSL_WAVES + `uniform vec3 uCam; varying vec3 vW;
        void main(){ vec4 w=modelMatrix*vec4(position,1.); float d=length(w.xz-uCam.xz); w.y=waves(w.xz).x*(1.-smoothstep(500.*uLen,2600.*uLen,d)); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: GLSL_COMMON + GLSL_WAVES + `uniform vec3 uCam,uDeep,uShal; uniform float uFog; uniform vec4 uPuff[8]; varying vec3 vW;
        void main(){ vec2 p=vW.xz; float dist=length(vW-uCam); vec3 wv=waves(p); float far=1./(1.+dist*.0009/uLen);
          vec2 q=p/uLen*.1, e=vec2(.07,0.); vec2 mv=uT*vec2(.5,.3);
          float n0=fbm(q+mv)+.45*fbm(q*3.3-mv*1.6);
          vec2 dg=vec2(fbm(q+e+mv)+.45*fbm((q+e)*3.3-mv*1.6)-n0, fbm(q+e.yx+mv)+.45*fbm((q+e.yx)*3.3-mv*1.6)-n0)/e.x*.1;
          float gust=0.; for(int i=0;i<8;i++){ float r=uPuff[i].z; if(r>0.) gust+=uPuff[i].w*max(0.,1.-length(p-uPuff[i].xy)/r); }
          dg*=max(.3,1.+gust*1.5);
          vec3 N=normalize(vec3(-wv.y*mix(.35,1.,far)-dg.x*mix(.3,1.,far),1.,-wv.z*mix(.35,1.,far)-dg.y*mix(.3,1.,far)));
          vec3 V=normalize(uCam-vW); float fr=.02+.98*pow(1.-max(dot(N,V),0.),5.);
          vec3 R=reflect(-V,N); R.y=abs(R.y)+.02; vec3 refl=skyBase(normalize(R));
          float crest=clamp(wv.x/(uAmp*1.6)*.5+.5,0.,1.);
          vec3 base=mix(uDeep,uShal,crest*crest*.8+.08*max(dot(N,uSun),0.));
          base*=1.-.3*clamp(gust,-.6,1.);
          vec3 col=mix(base,refl,fr);
          float foam=smoothstep(.9,1.08,crest+.22*noise(p/uLen*.1+mv)+gust*.1)*smoothstep(.35,.7,fbm(p/uLen*.7-mv*2.))*far;
          col=mix(col,vec3(.95,.97,1.),foam*.8);
          col=mix(col,uHor,1.-exp(-dist*uFog));
          gl_FragColor=vec4(col,1.);
          #include <colorspace_fragment>
        }`
    })); this.sea.renderOrder = -1; sc.add(this.sea);
    // décor fixe
    const all = (game.islands || []).slice(); if (game.port) all.push(game.port);
    const trees = [];
    for (const is of all) { sc.add(mkIsland(is, trees, is === game.port)); }
    if (trees.length) { const im = new T.InstancedMesh(new T.ConeGeometry(1, 2.4, 6), MAT(0x2f7d43, { flatShading: true }), trees.length), o = new T.Object3D(); trees.forEach((t, i) => { o.position.set(t[0], t[1] + t[3] * 1.1, t[2]); o.scale.setScalar(t[3]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); sc.add(im); }
    if (game.port) sc.add(mkFort());
    this.buoys = [];
    if (game.targets) {
      const seen = new Set(), s = game.C.len / 44;
      for (const tg of game.targets) {
        const key = tg.type + tg.x + ',' + tg.y; if (seen.has(key)) continue; seen.add(key);
        if (tg.type === 'line') {
          const ax = tg.c.x - tg.L.x * tg.h, ay = tg.c.y - tg.L.y * tg.h, bx = tg.c.x + tg.L.x * tg.h, by = tg.c.y + tg.L.y * tg.h;
          this.addBuoy(mkBuoy(s, 0xff7a1a), ax, ay, tg, false); this.addBuoy(mkCommittee(s), bx, by, tg, false, Math.atan2(tg.d.y, tg.d.x));
          for (let i = 1; i < 16; i++) { const b = new T.Mesh(new T.SphereGeometry(1.1 * s, 8, 6), MAT(0xffe066)); this.addBuoy(b, lerp(ax, bx, i / 16), lerp(ay, by, i / 16), tg, false); }
        } else this.addBuoy(mkBuoy(s * 1.25, 0xff7a1a), tg.x, tg.y, tg, true);
      }
    }
    this.beam = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 12, 1, true), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.32, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false })); this.beam.visible = false; sc.add(this.beam);
    // dynamiques : boulets, butin, barils, particules, sillages
    this.pool = { shot: [], loot: [], barrel: [] };
    const N = 900; this.pg = new T.BufferGeometry(); this.pg.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3)); this.pg.setAttribute('col', new T.BufferAttribute(new Float32Array(N * 4), 4)); this.pg.setAttribute('size', new T.BufferAttribute(new Float32Array(N), 1));
    this.pts = new T.Points(this.pg, new T.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uS: { value: 1 } },
      vertexShader: 'attribute vec4 col; attribute float size; uniform float uS; varying vec4 vC; void main(){ vC=col; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*uS/max(1.,-mv.z); gl_Position=projectionMatrix*mv; }',
      fragmentShader: `varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(vC.rgb,vC.a*smoothstep(.5,.15,d));
        #include <colorspace_fragment>
      }`
    })); this.pts.frustumCulled = false; sc.add(this.pts);
    const WN = 16 * 40 * 2; this.wg = new T.BufferGeometry(); this.wg.setAttribute('position', new T.BufferAttribute(new Float32Array(WN * 3), 3)); this.wg.setAttribute('color', new T.BufferAttribute(new Float32Array(WN * 4), 4));
    const wi = []; for (let b = 0; b < 16; b++) for (let i = 0; i < 39; i++) { const a = (b * 40 + i) * 2; wi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } this.wg.setIndex(wi);
    this.wake = new T.Mesh(this.wg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false })); this.wake.frustumCulled = false; sc.add(this.wake);
    this.camPos = null; this.look.yaw = 0; this.look.pitch = 0;
  },
  addBuoy(mesh, x, y, tg, main, rot = 0) { mesh.position.set(x, 0, y); mesh.rotation.y = -rot; this.scene.add(mesh); this.buoys.push({ mesh, x, y, tg, main, ph: Math.random() * 6 }); },
  poolSync(name, n, make) { const p = this.pool[name]; while (p.length < n) { const m = make(); this.scene.add(m); p.push(m); } p.forEach((m, i) => { m.visible = i < n; }); return p; },

  /* ---------- image ---------- */
  render(game) {
    if (game !== this.game) this.build(game);
    const T = THREE, now = performance.now(), dt = paused ? 0 : Math.min(0.05, (now - this.last) / 1000 || 0); this.last = now; this.t += dt;
    const t = this.t, U = this.uni, p = game.player, list = game.boats || game.ships, isRace = !!game.boats;
    U.uT.value = t;
    // bateaux
    const alive = new Set();
    for (const b of list) {
      let m = this.models.get(b); const kind = isRace ? game.mode : b.type + b.team;
      if (!m || m.kind !== kind) { if (m) this.scene.remove(m.g); m = isRace ? (game.mode === 'dinghy' ? mkDinghy3(b) : mkImoca3(b)) : mkShip3(b); m.kind = kind; m.sd = b.side || 1; this.scene.add(m.g); this.models.set(b, m); }
      alive.add(b);
      const L = m.L, ch = Math.cos(b.hdg), sh = Math.sin(b.hdg), hb = this.waveH(b.x + ch * L * 0.4, b.y + sh * L * 0.4), hs = this.waveH(b.x - ch * L * 0.4, b.y - sh * L * 0.4), hp = this.waveH(b.x + sh * m.B, b.y - ch * m.B), hq = this.waveH(b.x - sh * m.B, b.y + ch * m.B);
      m.g.position.set(b.x, (hb + hs + hp + hq) / 4, b.y); m.g.rotation.order = 'YZX';
      m.pitch = Math.atan2(hb - hs, L * 0.8) * 0.8; m.roll = Math.atan2(hp - hq, m.B * 2) * 0.5;
      m.update(b, t, dt, game, b === p && this.view === 'cockpit');
      m.g.rotation.set(m.roll, -b.hdg, m.pitch);
    }
    for (const [b, m] of this.models) if (!alive.has(b)) { this.scene.remove(m.g); this.models.delete(b); }
    // bouées
    const nt = game.targets ? game.targets[Math.min(p.leg, game.targets.length - 1)] : null;
    for (const b of this.buoys) { const h = this.waveH(b.x, b.y); b.mesh.position.y = h; if (b.main) { b.mesh.rotation.z = Math.sin(t * 1.3 + b.ph) * 0.12; b.mesh.rotation.x = Math.cos(t * 1.1 + b.ph) * 0.12; } }
    if (nt && p.fin === null) { const s = game.C.len; this.beam.visible = true; this.beam.position.set(nt.x, s * 6, nt.y); this.beam.scale.set(nt.type === 'line' ? s * 0.1 : s * 0.22, s * 12, nt.type === 'line' ? s * 0.1 : s * 0.22); this.beam.material.opacity = 0.25 + 0.1 * Math.sin(t * 4); } else this.beam.visible = false;
    // pirate : boulets, butin, barils
    if (!isRace) {
      const live = game.shots.filter(s => s.live), sp = this.poolSync('shot', live.length, () => new T.Mesh(new T.SphereGeometry(1.6, 8, 6), MAT(0x111111, { roughness: 0.4 })));
      live.forEach((s, i) => { if (!s.l0) s.l0 = s.life; const f = 1 - s.life / s.l0; sp[i].position.set(s.x, 7 + 16 * Math.sin(Math.PI * Math.min(1, f)) - 6 * f, s.y); });
      const lp = this.poolSync('loot', game.loot.length, () => { const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(9, 7, 7), MAT(0x8a5a2b))); const b = new T.Mesh(new T.BoxGeometry(9.3, 1.4, 7.3), MAT(0xffd23f, { emissive: 0xaa7a00, metalness: 0.6, roughness: 0.3 })); b.position.y = 1.5; g.add(b); return g; });
      game.loot.forEach((l, i) => { lp[i].position.set(l.x, this.waveH(l.x, l.y) + 1.5, l.y); lp[i].rotation.set(Math.sin(t + l.ph) * 0.2, l.ph + t * 0.3, Math.cos(t * 1.2 + l.ph) * 0.2); });
      const bp = this.poolSync('barrel', game.barrels.length, () => new T.Mesh(new T.CylinderGeometry(4, 4, 9, 10), MAT(0x5a3a1c)));
      game.barrels.forEach((b, i) => { bp[i].position.set(b.x, this.waveH(b.x, b.y) + 1, b.y); bp[i].rotation.set(1.57, 0, t + i); });
    }
    // particules
    const P = game.parts.a, pa = this.pg.attributes, n = Math.min(P.length, 900);
    for (let i = 0; i < n; i++) { const q = P[i], k = clamp(q.life / q.max, 0, 1), c = cssCol(q.color); pa.position.setXYZ(i, q.x, 2.5 + (1 - k) * q.size * 1.6 + (q.grow > 4 ? (1 - k) * 14 : 0), q.y); pa.col.setXYZW(i, c[0], c[1], c[2], c[3] * k); pa.size.setX(i, q.size * 2.2); }
    this.pg.setDrawRange(0, n); pa.position.needsUpdate = pa.col.needsUpdate = pa.size.needsUpdate = true; this.pts.material.uniforms.uS.value = this.gl.height / (2 * Math.tan(this.cam.fov * DEG / 2));
    // sillages
    const wp = this.wg.attributes.position, wc = this.wg.attributes.color; let bi = 0;
    for (const b of list) {
      if (bi >= 16) break; const k = b.wake || [], m = this.models.get(b), w0 = m ? m.B * 0.55 : 4, base = bi * 80, cnt = Math.min(40, k.length), off = k.length - cnt;
      for (let i = 0; i < 40; i++) {
        const v = base + i * 2; if (i >= cnt || cnt < 2) { wp.setXYZ(v, 0, -50, 0); wp.setXYZ(v + 1, 0, -50, 0); wc.setXYZW(v, 1, 1, 1, 0); wc.setXYZW(v + 1, 1, 1, 1, 0); continue; }
        const a = k[off + i], nx = k[off + Math.min(cnt - 1, i + 1)], pv = k[off + Math.max(0, i - 1)]; let dx = nx.x - pv.x, dy = nx.y - pv.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const w = w0 * (0.45 + (1 - a.a) * 1.9), h = this.waveH(a.x, a.y) + 0.35, al = clamp(a.a, 0, 1) ** 1.5 * 0.3 * Math.min(1, i / 4) * Math.min(1, (cnt - 1 - i) / 2);
        wp.setXYZ(v, a.x - dy * w, h, a.y + dx * w); wp.setXYZ(v + 1, a.x + dy * w, h, a.y - dx * w); wc.setXYZW(v, 1, 1, 1, al); wc.setXYZW(v + 1, 1, 1, 1, al);
      }
      bi++;
    }
    for (; bi < 16; bi++) for (let i = 0; i < 80; i++) wc.setW(bi * 80 + i, 0);
    wp.needsUpdate = wc.needsUpdate = true;
    // risées visibles sur l'eau
    const pf = game.wind.puffs; U.uPuff.value.forEach((v, i) => { const q = pf[i]; if (q) v.set(q.x, q.y, q.r, clamp(q.str / 6, -1, 1) * (q.k || 0)); else v.set(0, 0, 0, 0); });
    // caméra
    const m = this.models.get(p), cam = this.cam, Lk = this.look;
    if (!Lk.drag) { Lk.yaw *= 1 - Math.min(1, dt * 2.5); Lk.pitch *= 1 - Math.min(1, dt * 2.5); }
    if (!isRace) { if (p.rl > (this.prl || 0) + 0.5) { Lk.glance = -1; Lk.glanceT = 1.3; } if (p.rr > (this.prr || 0) + 0.5) { Lk.glance = 1; Lk.glanceT = 1.3; } this.prl = p.rl; this.prr = p.rr; }
    Lk.glanceT = Math.max(0, Lk.glanceT - dt); Lk.gy = (Lk.gy || 0) + ((Lk.glanceT > 0 ? Lk.glance * 1.15 : 0) - (Lk.gy || 0)) * Math.min(1, dt * 5);
    m.g.updateMatrixWorld(true);
    if (this.view === 'cockpit') {
      const eye = m.eye.clone().applyMatrix4(m.g.matrixWorld), yaw = b2yaw(p.hdg) , a = p.hdg + Lk.yaw + Lk.gy + (m.lookYaw || 0);
      const up = new T.Vector3(0, 1, 0).applyQuaternion(m.g.quaternion).lerp(new T.Vector3(0, 1, 0), 0.45).normalize();
      eye.y = Math.max(eye.y, this.waveH(eye.x, eye.z) + m.L * 0.04);
      cam.position.copy(eye); cam.up.copy(up); cam.fov = 72;
      const pit = (m.lookPitch || -0.06) - Lk.pitch + m.pitch * 0.5;
      cam.lookAt(eye.x + Math.cos(a) * 100, eye.y + Math.sin(pit) * 100, eye.z + Math.sin(a) * 100);
    } else {
      const a = p.hdg + Lk.yaw + Lk.gy * 0.5, d = m.L * 2.4, tx = p.x - Math.cos(a) * d, tz = p.y - Math.sin(a) * d, ty = m.L * (0.85 + Lk.pitch) + m.g.position.y * 0.5;
      if (!this.camPos) this.camPos = new T.Vector3(tx, ty, tz); this.camPos.lerp(new T.Vector3(tx, ty, tz), Math.min(1, dt * 4));
      cam.position.copy(this.camPos); cam.up.set(0, 1, 0); cam.fov = 58; cam.lookAt(p.x + Math.cos(p.hdg) * m.L * 0.6, m.L * 0.35, p.y + Math.sin(p.hdg) * m.L * 0.6);
    }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    U.uCam.value.copy(cam.position); this.sky.position.copy(cam.position); this.sea.position.set(cam.position.x, 0, cam.position.z);
    this.r.render(this.scene, cam);
  },

  /* ---------- repères projetés sur le HUD ---------- */
  marker(c, x, y, h, color, label, arrow = true) {
    const v = new THREE.Vector3(x, h, y).project(this.cam), front = v.z < 1, sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    if (front && sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30) {
      c.fillStyle = color; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - 8, sy - 14); c.lineTo(sx + 8, sy - 14); c.closePath(); c.fill();
      if (label) { c.font = `800 13px ${FONT}`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,10,25,.7)'; c.strokeText(label, sx, sy - 20); c.fillStyle = color; c.fillText(label, sx, sy - 20); }
      return { sx, sy };
    }
    if (!arrow) return null;
    const f = new THREE.Vector3(); this.cam.getWorldDirection(f); const rel = wrap(Math.atan2(y - this.cam.position.z, x - this.cam.position.x) - Math.atan2(f.z, f.x)), right = rel > 0, ex = right ? W - 34 : 34, ey = H * 0.5 - Math.cos(rel) * H * 0.18;
    c.save(); c.translate(ex, ey); c.rotate(right ? 0 : Math.PI); c.fillStyle = color; c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -11); c.lineTo(-8, 11); c.closePath(); c.fill(); c.restore();
    if (label) txt(c, label, right ? ex - 22 : ex + 22, ey + 5, 12, color, right ? 'right' : 'left', '800');
    return null;
  }
};
const b2yaw = h => -h;
const _cc = new Map();
function cssCol(s) { let c = _cc.get(s); if (c) return c; let m; if (s[0] === '#') { const h = s.length === 4 ? s.slice(1).replace(/./g, '$&$&') : s.slice(1), n = parseInt(h, 16); c = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]; } else if ((m = s.match(/rgba?\(([^)]+)\)/))) { const v = m[1].split(',').map(Number); c = [v[0] / 255, v[1] / 255, v[2] / 255, v.length > 3 ? v[3] : 1]; } else c = [1, 1, 1, 1]; c = [c[0] * c[0], c[1] * c[1], c[2] * c[2], c[3]]; _cc.set(s, c); return c; }

/* ---------- briques de modélisation ---------- */
const MAT = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0 }, o));
function box(g, w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; }
function cyl(g, r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 10) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); m.position.set(x, y, z); g.add(m); return m; }
function rod(g, r, len, mat, x, y, z, axis) { const m = cyl(g, r, r, len, mat, x, y, z, 8); if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2; return m; }
// coque par couples : beam(x), free(x) pour x de -0.5 (poupe) à 0.5 (étrave)
function hull(g, L, beam, free, draft, hullMat, deckMat, chine = 0.82, n = 18) {
  const P = [], I = [], D = [], DI = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n - 0.5, x = u * L, b = Math.max(0.001, beam(u)) * L, f = free(u) * L, d = draft * L * (0.35 + 0.65 * Math.sin(Math.PI * (i / n)) ** 0.6);
    P.push(x, f, -b, x, f * 0.2, -b * chine, x, -d, 0, x, f * 0.2, b * chine, x, f, b);
    D.push(x, f * 0.82, -b * 0.97, x, f * 0.82, b * 0.97);
    if (i < n) { const a = i * 5; for (let k = 0; k < 4; k++) I.push(a + k, a + k + 5, a + k + 1, a + k + 1, a + k + 5, a + k + 6); DI.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
  }
  I.push(0, 1, 2, 0, 2, 4, 2, 3, 4); // tableau arrière
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); hg.setIndex(I); hg.computeVertexNormals();
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(D, 3)); dg.setIndex(DI); dg.computeVertexNormals();
  hullMat.side = THREE.DoubleSide; deckMat.side = THREE.DoubleSide; g.add(new THREE.Mesh(hg, hullMat)); g.add(new THREE.Mesh(dg, deckMat));
}
// voile : guindant en x=-rake*v, bordure vers l'arrière, creux vers +z
function sailGeo(foot, height, headK, camber, rake = 0, nu = 8, nv = 10) {
  const P = [], I = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const v = j / nv, u = i / nu, ch = foot * (1 - (1 - headK) * Math.pow(v, 0.9)); P.push(-rake * v - u * ch, v * height, camber * ch * Math.sin(Math.PI * Math.pow(u, 0.8)) * (1 - 0.3 * v)); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; I.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
function squareSailGeo(w, h, camber) {
  const P = [], I = [], n = 8;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const u = i / n, v = j / n; P.push(camber * w * (1 - (2 * u - 1) ** 2) * (0.35 + 0.65 * Math.sin(Math.PI * v)), -v * h, (u - 0.5) * w * (1 - 0.06 * Math.sin(Math.PI * v))); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; I.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const sailMat = (color, o = {}) => MAT(color, Object.assign({ side: THREE.DoubleSide, roughness: 0.9 }, o));
// angle de bôme lissé + creux (signé) d'une voile
function trimSail(m, b, dt) {
  m.sd += (b.side - m.sd) * Math.min(1, dt * 4);
  const beta = Math.min((5 + b.sheet * 85) * DEG, Math.max(b.twa, 0.09));
  return { phi: -m.sd * beta, camber: b.luff ? Math.sin(R3.t * 19) * 0.35 : -m.sd };
}

function mkDinghy3(b) {
  const T = THREE, g = new T.Group(), L = 44, f = 0.075 * L, col = new T.Color(b.color);
  hull(g, L, u => 0.165 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u + 0.08) / 0.58, 2.6)), 0.6) * (u < -0.3 ? 0.9 + (u + 0.5) * 0.5 : 1), () => 0.075, 0.03, MAT(col, { roughness: 0.35 }), MAT(0xf4f4ee, { roughness: 0.6 }));
  box(g, L * 0.42, 0.6, L * 0.15, MAT(0x8fa3b0), -L * 0.2, f * 0.78, 0);
  const alu = MAT(0xcfd6dc, { metalness: 0.7, roughness: 0.35 }), mx = L * 0.2;
  cyl(g, 0.38, 0.5, 60, alu, mx, f + 30, 0);
  const rig = new T.Group(); rig.position.set(mx, f + 5, 0); g.add(rig);
  rod(rig, 0.4, 27, alu, -13.5, 0, 0, 'x');
  const sail = new T.Mesh(sailGeo(26, 52, 0.04, 0.11), sailMat(0xffffff)); rig.add(sail);
  const stripe = new T.Mesh(sailGeo(9, 9, 0.5, 0.11), sailMat(col)); stripe.position.set(-8, 30, 0.6); rig.add(stripe);
  // safran et barre
  const helm = new T.Group(); helm.position.set(-L * 0.5, f, 0); g.add(helm);
  box(helm, 1.6, 9, 0.5, MAT(0xf4f4ee), -0.6, -3.5, 0); rod(helm, 0.3, 12, MAT(0x5a3a1c), 6, 0.8, 0, 'x');
  const ext = new T.Group(); ext.position.set(12, 0.9, 0); helm.add(ext); rod(ext, 0.2, 9, MAT(0x222222), 0, 0, 4.5, 'z');
  // équipier
  const crew = new T.Group(); g.add(crew);
  box(crew, 3.2, 5.5, 3.4, MAT(col), 0, 3.4, 0); const head = new T.Mesh(new T.SphereGeometry(1.7, 10, 8), MAT(0xffcf9e)); head.position.y = 7.6; crew.add(head); box(crew, 6, 1.6, 3, MAT(0x26384d), 2.5, 0.8, 0);
  // girouette
  const vane = new T.Group(); vane.position.set(mx, f + 61, 0); g.add(vane); box(vane, 5, 0.25, 0.6, MAT(0xff3b2f, { emissive: 0x661008 }), -2.5, 0, 0);
  const m = { g, L, B: L * 0.16, eye: new T.Vector3(), cz: 0, lookPitch: -0.1 };
  m.update = (b, t, dt, game, fp) => {
    const s = trimSail(m, b, dt), cap = b.capsized > 0;
    rig.rotation.y = s.phi; sail.scale.z = s.camber; stripe.scale.z = s.camber;
    const heel = cap ? 1.5 : clamp(b.heel, -0.6, 1.3) * 0.5; m.roll += -m.sd * heel;
    const out = b.isPlayer ? (b.hike ? 0.24 : 0.12) : 0.12 + Math.max(0, b.heel) * 0.25; m.cz += (m.sd * out * L - m.cz) * Math.min(1, dt * 5);
    crew.position.set(-L * 0.17, f, m.cz); crew.rotation.x = -clamp(m.cz / L, -0.3, 0.3) * 2.2; crew.visible = !fp;
    const st = b.isPlayer ? steerInput() : 0; helm.rotation.y += (st * 0.35 - helm.rotation.y) * Math.min(1, dt * 8); ext.rotation.y = -helm.rotation.y + (m.cz > 0 ? 0 : Math.PI);
    vane.rotation.y = -(wrap(b.wdir - b.hdg)) + Math.PI;
    m.eye.set(-L * 0.3, f + 9, m.cz * 1.15); m.lookYaw = -m.cz / L * 0.9;
  };
  return m;
}

function mkImoca3(b) {
  const T = THREE, g = new T.Group(), L = 84, f = 0.07 * L, col = new T.Color(b.color), inner = new T.Group(); g.add(inner);
  hull(inner, L, u => 0.158 * (u < 0.1 ? 0.93 + 0.07 * Math.min(1, (u + 0.5) / 0.4) : Math.pow(Math.max(0, 1 - Math.pow((u - 0.1) / 0.41, 2.3)), 0.75)), u => 0.07 + (u > 0.3 ? (u - 0.3) * 0.03 : 0), 0.03, MAT(0x141a22, { roughness: 0.3 }), MAT(0xe9edf2, { roughness: 0.55 }), 0.9);
  const acc = MAT(col, { roughness: 0.4 }), carbon = MAT(0x1a1d22, { roughness: 0.4, metalness: 0.3 });
  box(inner, L * 0.2, 2.6, L * 0.17, acc, -L * 0.1, f + 0.9, 0); box(inner, L * 0.1, 2.2, L * 0.13, acc, L * 0.04, f + 0.8, 0);
  box(inner, L * 0.19, 0.3, L * 0.168, MAT(0x0c1420, { roughness: 0.2, metalness: 0.5 }), -L * 0.1, f + 2.3, 0);
  for (const s of [-1, 1]) { box(inner, L * 0.22, 2.2, 1, MAT(0xe9edf2), -L * 0.36, f + 0.7, s * L * 0.125); cyl(inner, 1.3, 1.5, 1.6, carbon, -L * 0.3, f + 1.2, s * L * 0.07, 12); box(inner, 1.2, 8, 0.5, carbon, -L * 0.47, -2, s * L * 0.09); }
  const mx = L * 0.07, mh = 128; cyl(inner, 0.7, 1.0, mh, carbon, mx, f + mh / 2, 0);
  rod(inner, 0.5, L * 0.2, carbon, L * 0.58, f * 0.95, 0, 'x');
  const rig = new T.Group(); rig.position.set(mx, f + 7, 0); inner.add(rig); rod(rig, 0.7, 40, carbon, -20, 0, 0, 'x');
  const main = new T.Mesh(sailGeo(40, 118, 0.34, 0.1), sailMat(0x2a2f37, { roughness: 0.6 })); rig.add(main);
  const logo = new T.Mesh(sailGeo(16, 22, 0.8, 0.1), sailMat(col)); logo.position.set(-9, 50, 0.9); rig.add(logo);
  // voiles d'avant : pivot autour de l'étai
  const heads = SAILS.map((s, i) => {
    const big = i >= 2, tx = big ? L * 0.66 : L * 0.46, top = [0.72, 0.88, 0.97, 0.98][i] * mh, J = tx - mx, grp = new T.Group(); grp.position.set(tx, f + 1, 0);
    const mesh = new T.Mesh(sailGeo([22, 31, 46, 54][i], top, 0.03, [0.09, 0.1, 0.16, 0.3][i], J), sailMat(i === 3 ? col : i === 2 ? 0xf4f4f4 : 0xe8e8e8, { transparent: true, opacity: 0.97 })); grp.add(mesh); inner.add(grp);
    return { grp, mesh, axis: new T.Vector3(-J, top, 0).normalize() };
  });
  // foils
  const foilM = MAT(0xff8c1a, { roughness: 0.35 }), foils = [-1, 1].map(s => { const fg = new T.Group(); fg.position.set(L * 0.06, f * 0.5, s * L * 0.15); box(fg, 3.2, 0.7, 13, foilM, 0, -1.5, s * 6).rotation.x = s * 0.35; box(fg, 2.6, 0.6, 9, foilM, 0, -1, s * 15).rotation.x = -s * 0.55; inner.add(fg); return fg; });
  const vane = new T.Group(); vane.position.set(mx, f + mh + 1.5, 0); inner.add(vane); box(vane, 7, 0.35, 0.8, MAT(0xff3b2f, { emissive: 0x661008 }), -3.5, 0, 0);
  // barre franche et répétiteurs
  const tiller = new T.Group(); tiller.position.set(-L * 0.44, f + 2.2, 0); inner.add(tiller); rod(tiller, 0.35, 12, carbon, 6, 0, 0, 'x');
  const scr = MAT(0x06121f, { emissive: 0x1d6fa8, emissiveIntensity: 0.8 }); for (const s of [-1, 1]) box(inner, 0.3, 1.2, 2, scr, -L * 0.2 - 0.2, f + 1.3, s * 2.4);
  const m = { g, L, B: L * 0.15, eye: new T.Vector3(), cz: 0, lookPitch: -0.05 };
  m.update = (b, t, dt, game) => {
    const s = trimSail(m, b, dt); rig.rotation.y = s.phi; main.scale.z = s.camber; logo.scale.z = s.camber;
    heads.forEach((h, i) => { h.grp.visible = i === b.sail && !(b.chg > 0 && Math.sin(t * 12) > 0.2); if (h.grp.visible) { const beta = Math.min((5 + b.sheet * 85) * DEG + (i >= 2 ? 0.25 : 0.12), Math.max(b.twa, 0.09)); h.grp.quaternion.setFromAxisAngle(h.axis, -m.sd * beta); h.mesh.scale.z = s.camber; } });
    foils.forEach((fg, i) => { const k = b.foil ? 1 : 0.25; fg.scale.z += (k - fg.scale.z) * Math.min(1, dt * 3); });
    const power = interp(HEEL_SF, b.twa / DEG) * clamp(b.tws / 18, 0.3, 1.3) * b.eff; m.roll += -m.sd * power * (0.3 - 0.16 * b.fly);
    inner.position.y = b.fly * 5.5 + Math.sin(t * 2.3) * 0.5 * b.fly; m.pitch += b.fly * 0.035;
    const st = b.isPlayer ? steerInput() : 0; tiller.rotation.y += (st * 0.3 - tiller.rotation.y) * Math.min(1, dt * 8);
    vane.rotation.y = -(wrap(b.wdir - b.hdg)) + Math.PI;
    m.cz += (m.sd * L * 0.1 - m.cz) * Math.min(1, dt * 2); m.eye.set(-L * 0.43, f + 11 + inner.position.y, m.cz); m.lookYaw = -m.cz / L * 0.9;
  };
  return m;
}

function mkShip3(s) {
  const T = THREE, st = s.st, L = st.len, tm = TEAMS[s.team], g = new T.Group(), inner = new T.Group(); g.add(inner);
  const hb = st.wid / L * 0.5, f = 0.115 * L, dk = f * 0.82, wood = MAT(tm.hull, { roughness: 0.85 }), dark = MAT(0x2a1a0c, { roughness: 0.9 }), deck = MAT(0xb08a5a, { roughness: 0.9 }), iron = MAT(0x1b1b1d, { roughness: 0.5, metalness: 0.6 });
  hull(inner, L, u => hb * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u + 0.06) / 0.57, 3.2)), 0.55) * (u < -0.35 ? 0.86 : 1), u => 0.115 + 0.05 * Math.pow(Math.abs(u) * 2, 2.2), 0.05, wood, deck, 0.92);
  // gaillards
  const qh = 0.045 * L; box(inner, L * 0.24, qh, st.wid * 0.8, wood, -L * 0.36, dk + qh / 2, 0); box(inner, L * 0.24, 0.5, st.wid * 0.8, deck, -L * 0.36, dk + qh + 0.2, 0);
  box(inner, L * 0.14, qh * 0.6, st.wid * 0.6, wood, L * 0.34, dk + qh * 0.3, 0);
  for (const sd of [-1, 1]) { box(inner, L * 0.24, qh * 0.5, 0.8, dark, -L * 0.36, dk + qh * 1.25, sd * st.wid * 0.4); }
  box(inner, 0.8, qh * 0.5, st.wid * 0.8, dark, -L * 0.48, dk + qh * 1.25, 0);
  box(inner, 0.4, f * 0.5, st.wid * 0.5, MAT(0x3a2a14, { emissive: 0xffb347, emissiveIntensity: 0.7 }), -L * 0.492, f * 0.75, 0);
  // canons
  for (let i = 0; i < st.guns; i++) { const x = (st.guns === 1 ? 0 : (i / (st.guns - 1) - 0.5)) * L * 0.62; for (const sd of [-1, 1]) { const c = cyl(inner, 0.011 * L + 0.5, 0.014 * L + 0.6, 0.075 * L + 3, iron, x, dk + 0.02 * L + 0.8, sd * (L * hb * 0.86), 8); c.rotation.x = Math.PI / 2; } }
  // beaupré
  const bs = rod(inner, 0.012 * L, L * 0.3, dark, L * 0.58, f * 1.5, 0, 'x'); bs.rotation.z = Math.PI / 2 - 0.28;
  // mâts, vergues, voiles carrées
  const sm = sailMat(tm.sail), rigs = [], mh0 = L * 0.95;
  for (let k = 0; k < st.masts; k++) {
    const mx = st.masts === 1 ? L * 0.06 : lerp(-L * 0.24, L * 0.27, k / (st.masts - 1)), main = st.masts === 1 || k === 1, mh = mh0 * (main ? 1 : 0.84), yw = st.wid * (main ? 1.35 : 1.15);
    cyl(inner, 0.008 * L, 0.014 * L, mh, dark, mx, dk + mh / 2, 0, 8); cyl(inner, 0.03 * L, 0.024 * L, 0.012 * L, dark, mx, dk + mh * 0.66, 0, 10);
    const lo = dk + L * 0.2, tiers = [[lo + (mh - L * 0.2) * 0.5, (mh - L * 0.2) * 0.5, 1], [dk + mh * 0.97, (mh - L * 0.2) * 0.42, 0.72]];
    for (const [y, h, wk] of tiers) { const r = new T.Group(); r.position.set(mx, y, 0); inner.add(r); rod(r, 0.007 * L + 0.2, yw * 2 * wk, dark, 0, 0, 0, 'z'); const sl = new T.Mesh(squareSailGeo(yw * 2 * wk * 0.94, h, 0.16), sm); r.add(sl); rigs.push({ r, sl, k, top: wk < 1 }); }
  }
  // pavillon
  const flag = new T.Group(); flag.position.set(st.masts === 1 ? L * 0.06 : (st.masts === 2 ? L * 0.27 : L * 0.015), dk + mh0 * (st.masts === 2 ? 0.84 : 1) + 2, 0); inner.add(flag);
  const fm = new T.Mesh(new T.PlaneGeometry(0.11 * L + 3, 0.06 * L + 2), MAT(tm.flag, { side: T.DoubleSide, emissive: tm.flag, emissiveIntensity: 0.25 })); fm.position.x = (0.11 * L + 3) / 2; flag.add(fm);
  // barre à roue
  const wheel = new T.Group(), wy = dk + qh + 0.045 * L, wr = 0.026 * L + 0.6; wheel.position.set(-L * 0.3, wy, 0); inner.add(wheel);
  const rim = new T.Mesh(new T.TorusGeometry(wr, wr * 0.09, 6, 20), MAT(0x6b4423)); rim.rotation.y = Math.PI / 2; wheel.add(rim);
  for (let i = 0; i < 4; i++) { const sp = rod(wheel, wr * 0.06, wr * 2.5, MAT(0x8a5a2b), 0, 0, 0, 'z'); sp.rotation.x = Math.PI / 2 + i * Math.PI / 4; }
  box(inner, 0.5 + 0.004 * L, wy - dk - qh, 0.5 + 0.004 * L, dark, -L * 0.3 + 0.8, dk + qh + (wy - dk - qh) / 2, 0);
  const m = { g, L, B: st.wid * 0.5, eye: new T.Vector3(-L * 0.375, dk + qh + 0.085 * L + 1.5, 0), lookPitch: -0.03, wa: 0 };
  m.update = (s, t, dt) => {
    const wa = wrap(s.wdir - s.hdg), brace = clamp(wa * 0.5, -0.9, 0.9), blow = Math.cos(wa) >= 0 ? 1 : -1, luff = s.twaD < st.up - 6;
    for (const rg of rigs) { rg.r.rotation.y = -brace; rg.sl.visible = s.sail >= 1 || (s.sail > 0 && rg.top); rg.sl.scale.x = luff ? Math.sin(t * 16 + rg.k) * 0.3 : blow * (0.6 + 0.4 * s.sail); }
    flag.rotation.y = -wa + Math.sin(t * 7) * 0.15;
    const hl = Math.sin(wa) * clamp(s.spd / 10, 0, 1) * 0.1 * s.sail; m.roll += hl + Math.sin(t * 0.9 + L) * 0.025;
    if (s === R3.game.player) { m.wa += steerInput() * dt * 3; } wheel.rotation.x = m.wa;
    if (s.sink > 0) { const k = 1 - s.sink / 3; inner.position.y = -k * L * 0.25; m.roll += k * 0.9; m.pitch -= k * 0.25; } else inner.position.y = 0;
  };
  return m;
}

/* ---------- décor ---------- */
function mkIsland(is, trees, port) {
  const T = THREE, n = is.pts.length, H = is.r * (is.rocky ? 0.62 : 0.3), prof = [[1.28, -6, 0], [1.02, 1.5, 0], [0.76, H * 0.22, 1], [0.42, H * 0.72, 2], [0.14, H, 2]], P = [], C = [], I = [];
  const cols = is.rocky ? [[0.5, 0.52, 0.5], [0.36, 0.4, 0.4], [0.47, 0.5, 0.5]] : [[0.92, 0.82, 0.58], [0.3, 0.6, 0.3], [0.2, 0.47, 0.24]];
  prof.forEach(([s, y, ci], k) => { for (let i = 0; i < n; i++) { const jit = 1 + (hash2(i * 7 + k, is.x) - 0.5) * 0.14 * (k > 1 ? 1 : 0); P.push(is.pts[i][0] * s * jit, y * (k > 2 ? 0.8 + hash2(i, k + is.y) * 0.4 : 1), is.pts[i][1] * s * jit); C.push(...cols[ci]); } });
  P.push(0, H * 1.05, 0); C.push(...cols[2]);
  for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < n; i++) { const a = k * n + i, b = k * n + (i + 1) % n; I.push(a, a + n, b, b, a + n, b + n); }
  const top = prof.length * n, lk = (prof.length - 1) * n; for (let i = 0; i < n; i++) I.push(lk + i, top, lk + (i + 1) % n);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
  const m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })); m.position.set(is.x, 0, is.y);
  if (!is.rocky && !port) for (const t of is.trees) { const d = Math.hypot(t[0], t[1]) / is.r; trees.push([is.x + t[0], H * (1 - d * 0.9) * 0.8, is.y + t[1], t[2] * 0.9]); }
  return m;
}
function mkFort() {
  const T = THREE, g = new T.Group(), st = MAT(0xb9a58a, { roughness: 0.95, flatShading: true }), y0 = 26;
  box(g, 80, 26, 80, st, 0, y0 + 8, 0); box(g, 60, 6, 60, MAT(0x8c7a62), 0, y0 + 22, 0);
  for (const [x, z] of [[-40, -40], [40, -40], [-40, 40], [40, 40]]) { cyl(g, 13, 15, 44, st, x, y0 + 16, z, 10); cyl(g, 15, 13, 6, MAT(0x8c7a62), x, y0 + 40, z, 10); }
  cyl(g, 0.8, 0.8, 40, MAT(0x3a2412), 0, y0 + 44, 0); const fl = new T.Mesh(new T.PlaneGeometry(26, 14), MAT(0x3fa9f5, { side: T.DoubleSide, emissive: 0x1a5f99 })); fl.position.set(13, y0 + 56, 0); g.add(fl);
  box(g, 20, 3, 120, MAT(0x7a5230), 0, 2.5, 150); box(g, 90, 3, 16, MAT(0x7a5230), 0, 2.5, 200); for (let i = 0; i < 6; i++) cyl(g, 1.6, 1.6, 12, MAT(0x3a2412), (i % 2 ? 9 : -9), -1, 100 + i * 18, 6);
  return g;
}
function mkBuoy(s, color) {
  const T = THREE, g = new T.Group(), m = MAT(color, { roughness: 0.4, emissive: color, emissiveIntensity: 0.15 });
  cyl(g, 3.2 * s, 3.6 * s, 4 * s, m, 0, 1.2 * s, 0, 14); cyl(g, 0.6 * s, 3.2 * s, 5 * s, m, 0, 5.7 * s, 0, 14); cyl(g, 0.25 * s, 0.25 * s, 5 * s, MAT(0x222222), 0, 10 * s, 0, 6);
  const f = new T.Mesh(new T.PlaneGeometry(3.4 * s, 2.2 * s), MAT(color, { side: T.DoubleSide })); f.position.set(1.7 * s, 11.4 * s, 0); g.add(f); return g;
}
function mkCommittee(s) {
  const T = THREE, g = new T.Group(), L = 40 * s;
  hull(g, L, u => 0.17 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u + 0.1) / 0.6, 3)), 0.6), () => 0.1, 0.03, MAT(0xf4f4f4, { roughness: 0.4 }), MAT(0xd9d2c0));
  box(g, L * 0.3, L * 0.09, L * 0.2, MAT(0xc0392b), -L * 0.05, L * 0.13, 0); cyl(g, 0.3 * s, 0.3 * s, L * 0.45, MAT(0x222222), L * 0.05, L * 0.32, 0, 6);
  const f = new T.Mesh(new T.PlaneGeometry(L * 0.16, L * 0.1), MAT(0xff7a1a, { side: T.DoubleSide, emissive: 0x7a3000 })); f.position.set(L * 0.13, L * 0.5, 0); g.add(f); return g;
}
