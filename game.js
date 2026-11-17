(() => {
'use strict';

/* ============ SKINS ============ */
const SKINS = [
  {id:'blue',   name:'Classic Blue',  cost:0,   c1:'#d9f6ff', c2:'#1e90ff', glow:'0,160,255'},
  {id:'green',  name:'Neon Green',    cost:50,  c1:'#eaffd0', c2:'#22ff6a', glow:'40,255,110'},
  {id:'purple', name:'Purple Galaxy', cost:100, c1:'#f0dcff', c2:'#8a2be2', glow:'160,80,255'},
  {id:'fire',   name:'Fireball',      cost:180, c1:'#fff2a8', c2:'#ff4a10', glow:'255,110,20'},
  {id:'gold',   name:'Golden Energy', cost:300, c1:'#fffbe0', c2:'#ffb400', glow:'255,200,40'},
  {id:'rainbow',name:'Rainbow',       cost:500, c1:'#ffffff', c2:'#ff00aa', glow:'255,255,255', rainbow:true}
];
const skinById = id => SKINS.find(s => s.id === id) || SKINS[0];

/* ============ SAVE MANAGER ============ */
const Save = {
  key: 'orbitrush.save', version: 1, data: null,
  defaults: () => ({v:1, best:0, coins:0, unlocked:['blue'], skin:'blue', sound:true, games:0, stars:0}),
  load() {
    const d = this.defaults();
    try {
      const r = JSON.parse(localStorage.getItem(this.key));
      if (r && typeof r === 'object') {
        for (const k of ['best','coins','games','stars'])
          if (Number.isFinite(r[k]) && r[k] >= 0) d[k] = Math.floor(r[k]);
        if (Array.isArray(r.unlocked)) d.unlocked = r.unlocked.filter(id => SKINS.some(s => s.id === id));
        if (!d.unlocked.includes('blue')) d.unlocked.unshift('blue');
        if (typeof r.skin === 'string' && d.unlocked.includes(r.skin)) d.skin = r.skin;
        if (typeof r.sound === 'boolean') d.sound = r.sound;
      }
    } catch (e) { /* corrupted or unavailable: use defaults */ }
    this.data = d;
    return d;
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} }
};
Save.load();

/* ============ AUDIO MANAGER ============ */
const Sfx = {
  ctx: null,
  init() {
    if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) try { this.ctx = new C(); } catch (e) {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, d, type = 'sine', vol = .15, to = f, delay = 0) {
    if (!this.ctx || !Save.data.sound || crazyMuted) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + d + .02);
  },
  collect(n) { this.tone(660 + Math.min(n, 10) * 45, .12, 'sine', .15, 1100 + Math.min(n, 10) * 60); },
  coin() { this.tone(900, .08, 'square', .06, 1400); this.tone(1400, .1, 'square', .06, 1800, .06); },
  swap() { this.tone(300, .09, 'triangle', .12, 520); },
  crash() { this.tone(220, .5, 'sawtooth', .2, 35); this.tone(90, .4, 'square', .12, 30); },
  click() { this.tone(520, .06, 'sine', .1, 760); },
  deny() { this.tone(160, .15, 'square', .08, 110); }
};

/* ============ CORE STATE ============ */
const cv = document.getElementById('game'), ctx = cv.getContext('2d', {alpha: false});
const $ = id => document.getElementById(id);
let W = 0, H = 0, cx = 0, cy = 0, M = 0, R1 = 0, R2 = 0, PR = 0, BR = 0, TH = 0, DPR = 1;
let bgGrad = null;

const G = {
  state: 'menu', time: 0, runTime: 0, p: 0, lane: 1, f: 1, genAngle: 0, genLane: 1,
  score: 0, runCoins: 0, runStars: 0, combo: 0, shake: 0, dieTimer: 0, shown: {s: -1, c: -1, k: ''},
  obstacles: [], items: []
};
const hooks = window.OrbitRush = { onGameStart() {}, onGameOver() {}, pause() { pauseGame(); }, resume() { resumeGame(); } };

/* Platform SDKs load only on their own hosts; local builds stay offline. */
let pokiActive = false, crazyActive = false, crazyResumePending = false, crazyMuted = false;
const platformReady = Promise.resolve(window.__platformSdkReady).then(async () => {
  if (window.PokiSDK && typeof window.PokiSDK.init === 'function') {
    try { await window.PokiSDK.init(); } catch (e) {}
    try { window.PokiSDK.gameLoadingFinished(); } catch (e) {}
  }
  const crazySdk = window.CrazyGames?.SDK;
  if (crazySdk?.init) { try { await crazySdk.init(); } catch (e) {} }
  const game = window.CrazyGames?.SDK?.game;
  if (game) {
    const applySettings = settings => { crazyMuted = !!settings?.muteAudio; };
    applySettings(game.settings);
    if (typeof game.addSettingsChangeListener === 'function') game.addSettingsChangeListener(applySettings);
  }
});
function platformGameplayStart() {
  platformReady.then(() => {
    if (G.state !== 'play') return;
    if (!pokiActive && window.PokiSDK?.gameplayStart) { window.PokiSDK.gameplayStart(); pokiActive = true; }
    const game = window.CrazyGames?.SDK?.game;
    if ((!crazyActive || crazyResumePending) && game?.gameplayStart) { game.gameplayStart(); crazyActive = true; crazyResumePending = false; }
  });
}
function platformGameplayStop(focusChange = false) {
  try { if (pokiActive && window.PokiSDK?.gameplayStop) window.PokiSDK.gameplayStop(); } catch (e) {}
  pokiActive = false;
  if (focusChange && crazyActive) crazyResumePending = true;
  if (!focusChange) {
    try { const game = window.CrazyGames?.SDK?.game; if (crazyActive && game?.gameplayStop) game.gameplayStop(); } catch (e) {}
    crazyActive = false;
    crazyResumePending = false;
  }
}

/* ============ RESIZE ============ */
function resize() {
  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const lowPower = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || navigator.connection?.saveData;
  const dprCap = lowPower ? 1.25 : coarsePointer ? 1.5 : 2;
  DPR = Math.min(window.devicePixelRatio || 1, dprCap);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx = W / 2; cy = H / 2; M = Math.min(W, H);
  PR = M * .19; R1 = M * .30; R2 = M * .42; BR = Math.max(8, M * .026); TH = M * .045;
  bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#080a24'); bgGrad.addColorStop(1, '#020309');
}
window.addEventListener('resize', resize); resize();

/* ============ BACKGROUND STARS ============ */
const stars = Array.from({length: 130}, () => ({a: Math.random() * 6.283, d: Math.random(), s: Math.random() * 1.6 + .4, t: Math.random() * 6}));

/* ============ PARTICLES (pooled) ============ */
const PN = 260, parts = Array.from({length: PN}, () => ({on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, col: '#fff'}));
let pIdx = 0;
function emit(x, y, n, col, speed, life, size) {
  for (let i = 0; i < n; i++) {
    const p = parts[pIdx = (pIdx + 1) % PN], a = Math.random() * 6.283, v = Math.random() * speed;
    p.on = true; p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.life = p.max = life * (.5 + Math.random() * .5); p.size = size * (.5 + Math.random()); p.col = col;
  }
}
function updateParticles(dt) {
  for (const p of parts) if (p.on) {
    p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96;
  }
}

/* ============ ORBIT / PLAYER ============ */
const laneR = l => l ? R2 : R1;
const ballPos = () => { const r = R1 + (R2 - R1) * G.f; return {r, x: cx + Math.cos(G.p) * r, y: cy + Math.sin(G.p) * r}; };
function ballColor() {
  const s = skinById(Save.data.skin);
  return s.rainbow ? `hsl(${(G.time * 220) % 360},100%,60%)` : s.c2;
}
function switchLane() {
  if (G.state !== 'play') return;
  G.lane ^= 1; Sfx.swap();
  const b = ballPos(); emit(b.x, b.y, 8, ballColor(), 120, .4, 3);
}

/* ============ OBSTACLE & COLLECTIBLE GENERATION ============ */
function omega() { return 1.7 + 1.4 * Math.min(1, G.runTime / 100); }
function spawnWave() {
  const lvl = Math.min(1, G.runTime / 100), w = omega();
  const lane = Math.random() < .5 ? 0 : 1, free = 1 - lane;
  const len = .35 + Math.random() * .3 + lvl * .3;
  // gap guarantees enough time to switch lanes (~0.3s) plus margin: no impossible patterns
  const gap = w * .34 + .18 + (1 - lvl) * Math.random() * .8 + Math.random() * .3;
  const start = G.genAngle + gap, mid = start + len / 2;
  G.obstacles.push({a: mid, half: len / 2, lane});
  if (Math.random() < .6) G.items.push({a: mid, lane: free, type: Math.random() < .6 ? 'star' : 'coin', hit: false});
  if (Math.random() < .5) G.items.push({a: G.genAngle + gap * .75, lane: free, type: 'coin', hit: false});
  G.genAngle = start + len; G.genLane = lane;
}

/* ============ GAME FLOW ============ */
function startGame() {
  Sfx.init();
  Object.assign(G, {state: 'play', runTime: 0, p: 0, lane: 1, f: 1, score: 0, runCoins: 0, runStars: 0, combo: 0, shake: 0, genAngle: 1.8});
  G.obstacles.length = 0; G.items.length = 0;
  UI.show(null); $('hud').classList.remove('hidden'); G.shown.s = G.shown.c = -1; G.shown.k = '';
  hooks.onGameStart();
  platformGameplayStart();
}
function die() {
  platformGameplayStop();
  G.state = 'dying'; G.dieTimer = .8; G.shake = 1; Sfx.crash();
  const b = ballPos(); emit(b.x, b.y, 50, ballColor(), 340, 1, 4); emit(b.x, b.y, 25, '#ff5a3c', 260, .8, 3);
  const d = Save.data, sc = Math.floor(G.score);
  G.newBest = sc > d.best; if (G.newBest) d.best = sc;
  d.games++; Save.save(); hooks.onGameOver(sc);
}
function pauseGame(focusChange = false) { if (G.state === 'play') { platformGameplayStop(focusChange); G.state = 'paused'; UI.show('pause'); } }
function resumeGame() { if (G.state === 'paused') { G.state = 'play'; UI.show(null); platformGameplayStart(); } }
function collect(it) {
  it.hit = true; G.combo++;
  const mult = Math.min(5, 1 + Math.floor(G.combo / 5)), b = ballPos(), d = Save.data;
  if (it.type === 'star') { G.score += 10 * mult; G.runStars++; d.stars++; Sfx.collect(G.combo); emit(b.x, b.y, 18, '#ffe65a', 200, .6, 3); }
  else { G.score += 5 * mult; G.runCoins++; d.coins++; Sfx.coin(); emit(b.x, b.y, 12, '#ffb400', 160, .5, 3); }
}

/* ============ UPDATE ============ */
function update(dt) {
  G.time += dt;
  G.shake = Math.max(0, G.shake - dt * 2.2);
  updateParticles(dt);
  const st = G.state;
  if (st === 'menu' || st === 'over') { G.p += dt * .8; G.f += (1 - G.f) * Math.min(1, dt * 8); return; }
  if (st === 'dying') { G.dieTimer -= dt; if (G.dieTimer <= 0) { G.state = 'over'; showOver(); } return; }
  if (st !== 'play') return;

  G.runTime += dt;
  const w = omega();
  G.p += w * dt;
  G.f += (G.lane - G.f) * Math.min(1, dt * 14);
  G.score += dt * w * 2.5;
  while (G.genAngle < G.p + 2.6) spawnWave();

  const b = ballPos(), br = BR * .75;
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    if (o.a < G.p - 1.2) { G.obstacles.splice(i, 1); continue; }
    const rl = laneR(o.lane);
    if (Math.abs(b.r - rl) < TH / 2 + br && Math.abs(o.a - G.p) < o.half + br / rl) { die(); return; }
  }
  for (let i = G.items.length - 1; i >= 0; i--) {
    const it = G.items[i];
    if (it.a < G.p - .5) { if (!it.hit) G.combo = 0; G.items.splice(i, 1); continue; }
    if (it.hit) continue;
    const r = laneR(it.lane), dx = cx + Math.cos(it.a) * r - b.x, dy = cy + Math.sin(it.a) * r - b.y;
    if (dx * dx + dy * dy < (BR + M * .024) ** 2) collect(it);
  }
  if (Math.random() < dt * 60) { const bp = ballPos(); emit(bp.x, bp.y, 1, ballColor(), 25, .45, BR * .45); }
  updateHud();
}

/* ============ RENDER ============ */
function glowDot(x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
}
function render() {
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (G.shake > 0) ctx.translate((Math.random() - .5) * 22 * G.shake, (Math.random() - .5) * 22 * G.shake);
  const diag = Math.hypot(W, H) / 2;
  glowDot(cx - M * .35, cy - M * .2, M * .7, '90,40,200', .14);
  glowDot(cx + M * .4, cy + M * .3, M * .6, '0,120,200', .1);
  // stars
  for (const s of stars) {
    const a = s.a + G.time * .02 * (1 + s.s), d = s.d * diag * 1.05 + 10;
    ctx.globalAlpha = .35 + .55 * Math.abs(Math.sin(G.time * s.s + s.t));
    ctx.fillStyle = '#cfe8ff'; ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  // planet
  glowDot(cx, cy, PR * 1.9, '70,150,255', .5 + Math.sin(G.time * 1.5) * .06);
  const pg = ctx.createRadialGradient(cx - PR * .35, cy - PR * .35, PR * .1, cx, cy, PR);
  pg.addColorStop(0, '#9d8cff'); pg.addColorStop(.5, '#4a38c8'); pg.addColorStop(1, '#0d0a3d');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, PR, 0, 6.283); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, PR, 0, 6.283); ctx.clip();
  ctx.fillStyle = 'rgba(180,220,255,.08)';
  for (let i = 0; i < 4; i++) ctx.fillRect(cx - PR, cy - PR * .7 + i * PR * .4 + Math.sin(G.time * .6 + i) * 4, PR * 2, PR * .12);
  ctx.restore();
  // orbit rings
  for (const r of [R1, R2]) {
    ctx.strokeStyle = 'rgba(0,229,255,.08)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = 'rgba(105,232,255,.4)'; ctx.lineWidth = 2; ctx.stroke();
  }
  // obstacles
  ctx.lineCap = 'round'; ctx.lineWidth = TH;
  for (const o of G.obstacles) {
    const r = laneR(o.lane), h = Math.max(.01, o.half - TH / 2 / r);
    ctx.strokeStyle = 'rgba(255,60,80,.25)'; ctx.lineWidth = TH * 1.7;
    ctx.beginPath(); ctx.arc(cx, cy, r, o.a - h, o.a + h); ctx.stroke();
    ctx.strokeStyle = '#ff4466'; ctx.lineWidth = TH;
    ctx.beginPath(); ctx.arc(cx, cy, r, o.a - h, o.a + h); ctx.stroke();
    ctx.strokeStyle = '#ffb3c0'; ctx.lineWidth = TH * .25;
    ctx.beginPath(); ctx.arc(cx, cy, r, o.a - h, o.a + h); ctx.stroke();
  }
  // items
  for (const it of G.items) {
    if (it.hit) continue;
    const r = laneR(it.lane), x = cx + Math.cos(it.a) * r, y = cy + Math.sin(it.a) * r, s = M * .022;
    if (it.type === 'star') {
      glowDot(x, y, s * 2.6, '255,230,90', .6);
      ctx.fillStyle = '#ffe65a'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? s * .5 : s * 1.2, a = -1.571 + i * .6283 + G.time; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    } else {
      glowDot(x, y, s * 2.2, '255,180,0', .5);
      const g = ctx.createRadialGradient(x - s * .3, y - s * .3, 0, x, y, s);
      g.addColorStop(0, '#fff6b0'); g.addColorStop(1, '#ffb400');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * .85, 0, 6.283); ctx.fill();
    }
  }
  // particles (additive)
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) if (p.on) { ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // player
  if (G.state !== 'dying' && G.state !== 'over' || G.state === 'over' && false) {
    const b = ballPos(), s = skinById(Save.data.skin);
    glowDot(b.x, b.y, BR * 3, s.rainbow ? '255,255,255' : s.glow, .55);
    const g = ctx.createRadialGradient(b.x - BR * .3, b.y - BR * .3, 0, b.x, b.y, BR);
    g.addColorStop(0, s.c1); g.addColorStop(1, ballColor());
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, BR, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}

/* ============ UI MANAGER ============ */
const UI = {
  screens: ['menu', 'shop', 'over', 'pause'],
  show(id) { for (const s of this.screens) $(s).classList.toggle('show', s === id); if (id) $('hud').classList.toggle('hidden', id !== 'pause'); },
  refresh() {
    const d = Save.data;
    $('menuBest').textContent = d.best; $('menuCoins').textContent = d.coins; $('shopCoins').textContent = d.coins;
    $('btnSound').textContent = 'Sound: ' + (d.sound ? 'On' : 'Off');
  },
  shop() {
    const d = Save.data, grid = $('skinGrid'); grid.innerHTML = '';
    for (const s of SKINS) {
      const owned = d.unlocked.includes(s.id), el = document.createElement('div');
      el.className = 'skin' + (d.skin === s.id ? ' sel' : '');
      const bg = s.rainbow ? 'conic-gradient(#f0f,#0ff,#ff0,#f0f)' : `radial-gradient(circle at 35% 35%,${s.c1},${s.c2})`;
      el.innerHTML = `<div class="swatch" style="background:${bg};--g:rgba(${s.glow},.7)"></div><div class="name">${s.name}</div>`;
      const b = document.createElement('button'); b.className = 'btn';
      b.textContent = d.skin === s.id ? 'Selected' : owned ? 'Select' : `Buy · ${s.cost}`;
      b.onclick = () => {
        Sfx.init();
        if (!owned) {
          if (d.coins < s.cost) { Sfx.deny(); el.classList.remove('deny'); void el.offsetWidth; el.classList.add('deny'); return; }
          d.coins -= s.cost; d.unlocked.push(s.id);
        }
        d.skin = s.id; Save.save(); Sfx.click(); UI.refresh(); UI.shop();
      };
      el.appendChild(b); grid.appendChild(el);
    }
  }
};
function updateHud() {
  const sc = Math.floor(G.score), mult = Math.min(5, 1 + Math.floor(G.combo / 5));
  const k = G.combo >= 3 ? `Combo ${G.combo}${mult > 1 ? '  x' + mult : ''}` : '';
  if (sc !== G.shown.s) { G.shown.s = sc; $('hudScore').textContent = sc; }
  if (G.runCoins !== G.shown.c) { G.shown.c = G.runCoins; $('hudCoins').textContent = Save.data.coins; }
  if (k !== G.shown.k) { G.shown.k = k; $('hudCombo').textContent = k; }
}
function showOver() {
  const sc = Math.floor(G.score), d = Save.data;
  $('hud').classList.add('hidden');
  $('overScore').textContent = sc; $('overBest').textContent = d.best; $('overCoins').textContent = G.runCoins;
  $('newBest').classList.toggle('on', !!G.newBest);
  UI.refresh(); UI.show('over');
}
function go(screen) { Sfx.init(); Sfx.click(); G.state = screen === 'menu' ? 'menu' : G.state; UI.refresh(); UI.show(screen); }

/* ============ INPUT ============ */
const bind = (id, fn) => $(id).addEventListener('click', fn);
bind('btnPlay', () => { Sfx.init(); Sfx.click(); startGame(); });
bind('btnAgain', () => { Sfx.init(); Sfx.click(); startGame(); });
bind('btnMenu', () => go('menu'));
bind('btnShop', () => { UI.shop(); go('shop'); });
bind('btnShopBack', () => go('menu'));
bind('btnResume', () => { Sfx.click(); resumeGame(); });
bind('btnSound', () => { const d = Save.data; d.sound = !d.sound; Save.save(); Sfx.init(); Sfx.click(); UI.refresh(); });

cv.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); switchLane(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); if (!e.repeat) { Sfx.init(); switchLane(); } }
  else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) G.state === 'play' ? pauseGame() : resumeGame();
});
document.addEventListener('touchmove', e => {
  if (!e.target.closest('#skinGrid')) e.preventDefault();
}, {passive: false});
window.addEventListener('wheel', e => e.preventDefault(), {passive: false});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseGame(true); Save.save(); } last = 0; });
window.addEventListener('pagehide', () => Save.save());
window.addEventListener('blur', () => pauseGame(true));

/* ============ GAME LOOP ============ */
let last = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min((t - last) / 1000, .05) : .016;
  last = t;
  update(dt); render();
}
UI.refresh(); UI.show('menu');
requestAnimationFrame(frame);
})();
