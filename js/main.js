'use strict';
/* ============ Menus, boucle principale, commandes tactiles ============ */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const $ = id => document.getElementById(id);
let game = null, paused = false, lastMode = null, diff = Store.get('diff', 1), last = performance.now(), menuT = 0;
const menuWind = new Wind({ dir0: 0.5, spd0: 12, gust: 5, puffRate: 0.5 }), menuCam = { x: 0, y: 0, z: 0.9 };

function show(id, on) { $(id).classList.toggle('show', on); }
function refreshMenu() {
  document.querySelectorAll('.diff button').forEach(b => b.classList.toggle('on', +b.dataset.d === diff));
  const b = (m) => { const v = Store.get('best.' + m + '.' + diff, null); return v === null ? '—' : fmtTime(v); };
  $('rec-imoca').textContent = 'Record : ' + b('imoca'); $('rec-dinghy').textContent = 'Record : ' + b('dinghy'); $('rec-pirate').textContent = 'Record : ' + Store.get('best.pirate', 0) + ' or';
}
function startGame(mode) {
  Sfx.init(); toasts.length = 0; lastMode = mode; paused = false;
  game = mode === 'pirate' ? new PirateGame() : new RaceGame(mode, diff);
  ['menu', 'end', 'pause', 'shop'].forEach(i => show(i, false)); buildTouch();
}
function toMenu() { game = null; paused = false;['end', 'pause', 'shop'].forEach(i => show(i, false)); show('menu', true); $('touch').innerHTML = ''; refreshMenu(); Sfx.wind(0.15); }
function showEnd(title, html) { $('end-title').textContent = title; $('end-body').innerHTML = html; show('end', true); $('touch').innerHTML = ''; }
function setPause(p) { if (!game || game.done) return; if (game.shopOpen) { game.closeShop(); return; } paused = p; show('pause', p); }

function buildTouch() {
  const root = $('touch'); root.innerHTML = ''; if (!IS_TOUCH || !game) return;
  const groups = { L: document.createElement('div'), R: document.createElement('div'), T: document.createElement('div') };
  groups.L.className = 'tg tl'; groups.R.className = 'tg tr'; groups.T.className = 'tg tt';
  for (const t of game.touch) {
    const b = document.createElement('button'); b.textContent = t.label; if (t.big) b.className = 'big';
    const down = e => { e.preventDefault(); Sfx.init(); if (!keys[t.code]) pressed[t.code] = true; keys[t.code] = true; b.classList.add('on'); };
    const up = e => { e.preventDefault(); keys[t.code] = false; b.classList.remove('on'); };
    b.addEventListener('touchstart', down, { passive: false }); b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    groups[t.pos].appendChild(b);
  }
  const pz = document.createElement('button'); pz.textContent = '⏸'; pz.addEventListener('touchstart', e => { e.preventDefault(); setPause(true); }, { passive: false }); groups.T.appendChild(pz);
  root.append(groups.L, groups.R, groups.T);
}

window.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') setPause(!paused);
  if (e.code === 'KeyC' && game && !e.repeat) R3.cycle();
  if (e.code === 'KeyM') { Sfx.toggleMute(); $('mute').textContent = Sfx.muted ? '🔇' : '🔊'; }
  if (e.code === 'KeyB' && game && game.shopOpen && !e.repeat) { game.closeShop(); delete pressed.KeyB; }
});
document.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => startGame(c.dataset.mode)));
document.querySelectorAll('.diff button').forEach(b => b.addEventListener('click', () => { diff = +b.dataset.d; Store.set('diff', diff); refreshMenu(); }));
$('again').onclick = () => startGame(lastMode); $('end-menu').onclick = toMenu; $('resume').onclick = () => setPause(false); $('restart').onclick = () => startGame(lastMode); $('quit').onclick = toMenu;
$('shop-close').onclick = () => game && game.closeShop();
$('mute').onclick = () => { Sfx.init(); Sfx.toggleMute(); $('mute').textContent = Sfx.muted ? '🔇' : '🔊'; }; $('mute').textContent = Sfx.muted ? '🔇' : '🔊';
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.done) setPause(true); });

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  $('gl').style.display = game && R3.active() ? 'block' : 'none';
  if (game) {
    if (pressed.KeyC && IS_TOUCH) R3.cycle();
    if (!paused) game.update(dt);
    game.draw(ctx); drawToasts(ctx, paused ? 0 : dt);
  } else {
    menuT += dt; menuCam.x += dt * 30; menuCam.y += dt * 12; menuWind.update(dt, menuCam); drawWater(ctx, menuCam, menuT, menuWind, ['#12708f', '#0a3f6b']);
  }
  for (const k in pressed) delete pressed[k];
  requestAnimationFrame(frame);
}
R3.init(); refreshMenu(); requestAnimationFrame(frame);
