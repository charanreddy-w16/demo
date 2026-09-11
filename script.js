/* =========================================================
   LADDU RAJ — The Sweet Reckoning
   A cinematic, keyboard-driven ladoo-collecting game.
   Pure vanilla JS + Canvas 2D + Web Audio API. No libraries.
   ========================================================= */

// ---------- Canvas Setup ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Chrome (and other browsers) render high-DPI / retina screens at a
// devicePixelRatio > 1. Without accounting for this the canvas looks
// blurry on such displays. We size the backing buffer to the real pixel
// count and scale the drawing context back down so all existing drawing
// code (which uses CSS-pixel coordinates) keeps working unchanged.
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Real backing-buffer resolution (physical pixels) — keeps Chrome/Retina crisp
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  // CSS display size stays at logical pixels
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  // Scale drawing operations so all game code below can keep using CSS-pixel coordinates
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Game-logic space (what all spawn/collision code below reads)
  canvas.gameWidth = w;
  canvas.gameHeight = h;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ---------- DOM References ----------
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const levelEl = document.getElementById('level');
const healthBar = document.getElementById('healthBar');
const activePowerupsEl = document.getElementById('activePowerups');
const flashEl = document.getElementById('flash');

const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const newHighEl = document.getElementById('newHighScore');

const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const restartFromGameOverBtn = document.getElementById('restartFromGameOverBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const mobileKeyboard = document.getElementById('mobileKeyboard');

// ===========================================================
//                     AUDIO (Web Audio API)
// ===========================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  // Chrome's autoplay policy can leave the context "suspended" even when
  // created inside a user-gesture handler — explicitly resume it so sound
  // reliably plays on the very first interaction.
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone({ freq = 440, endFreq = null, type = 'sine', duration = 0.15, volume = 0.2, delay = 0 }) {
  try {
    const ac = getAudioCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    const now = ac.currentTime + delay;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (e) {}
}

function playNoise({ duration = 0.3, volume = 0.25, delay = 0, filterFreq = null }) {
  try {
    const ac = getAudioCtx();
    const bufferSize = ac.sampleRate * duration;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const gain = ac.createGain();
    const now = ac.currentTime + delay;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    let node = noise;
    if (filterFreq) {
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      node.connect(filter);
      node = filter;
    }
    node.connect(gain).connect(ac.destination);
    noise.start(now);
  } catch (e) {}
}

// Deep, ominous "braaam" for dramatic beats (Nolan-trailer style)
function playBraam() {
  try {
    const ac = getAudioCtx();
    [55, 82.5, 110].forEach((f, i) => {
      playTone({ freq: f, type: 'sawtooth', duration: 1.6, volume: 0.12, delay: i * 0.02 });
    });
  } catch (e) {}
}

const SFX = {
  grab: () => { playTone({ freq: 700, endFreq: 1100, type: 'triangle', duration: 0.12, volume: 0.18 }); },
  miss: () => { playNoise({ duration: 0.3, volume: 0.3, filterFreq: 500 }); playTone({ freq: 130, endFreq: 40, type: 'sawtooth', duration: 0.3, volume: 0.15 }); },
  powerup: () => { playTone({ freq: 500, endFreq: 1100, type: 'sine', duration: 0.3, volume: 0.2 }); },
  gameover: () => { playBraam(); },
  levelup: () => { playTone({ freq: 300, endFreq: 700, type: 'triangle', duration: 0.5, volume: 0.18 }); },
};

// ===========================================================
//                     GAME STATE
// ===========================================================
let game = {
  running: false,
  paused: false,
  over: false,
  score: 0,
  highScore: parseInt(localStorage.getItem('ladduRajHighScore') || '0', 10),
  level: 1,
  health: 100,
  maxHealth: 100,
  frame: 0,
};
highScoreEl.textContent = game.highScore;

// ---------- Cinematic background: drifting sweets + dust motes ----------
let bgSweets = [];
let dust = [];
const SWEET_SHAPES = ['ladoo', 'barfi', 'jalebi'];

function initBackground() {
  bgSweets = [];
  const count = Math.max(6, Math.floor((canvas.gameWidth * canvas.gameHeight) / 160000));
  for (let i = 0; i < count; i++) {
    bgSweets.push({
      x: Math.random() * canvas.gameWidth,
      y: Math.random() * canvas.gameHeight,
      r: Math.random() * 18 + 14,
      speed: Math.random() * 0.25 + 0.05,
      drift: Math.random() * Math.PI * 2,
      shape: SWEET_SHAPES[Math.floor(Math.random() * SWEET_SHAPES.length)],
      alpha: Math.random() * 0.12 + 0.05,
    });
  }
  dust = [];
  const dustCount = Math.floor((canvas.gameWidth * canvas.gameHeight) / 9000);
  for (let i = 0; i < dustCount; i++) {
    dust.push({
      x: Math.random() * canvas.gameWidth,
      y: Math.random() * canvas.gameHeight,
      r: Math.random() * 1.4 + 0.3,
      speed: Math.random() * 0.4 + 0.1,
      alpha: Math.random() * 0.3 + 0.1,
    });
  }
}
initBackground();
window.addEventListener('resize', initBackground);

function updateBackground() {
  for (const s of bgSweets) {
    s.drift += 0.005;
    s.y += s.speed;
    s.x += Math.sin(s.drift) * 0.15;
    if (s.y - s.r > canvas.gameHeight) { s.y = -s.r; s.x = Math.random() * canvas.gameWidth; }
  }
  for (const d of dust) {
    d.y += d.speed;
    if (d.y > canvas.gameHeight) { d.y = 0; d.x = Math.random() * canvas.gameWidth; }
  }
}

function drawSilhouetteSweet(s) {
  ctx.save();
  ctx.globalAlpha = s.alpha;
  ctx.fillStyle = '#3a2a12';
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackground() {
  // Deep gradient sky — cold and oppressive
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.gameHeight);
  grad.addColorStop(0, '#05070c');
  grad.addColorStop(0.55, '#0a0d16');
  grad.addColorStop(1, '#020202');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.gameWidth, canvas.gameHeight);

  // Faint god-rays from top
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 3; i++) {
    const gx = canvas.gameWidth * (0.25 + i * 0.25);
    const beam = ctx.createLinearGradient(gx, 0, gx, canvas.gameHeight);
    beam.addColorStop(0, 'rgba(216,184,119,0.5)');
    beam.addColorStop(1, 'rgba(216,184,119,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(gx - 60, 0, 120, canvas.gameHeight);
  }
  ctx.restore();

  for (const s of bgSweets) drawSilhouetteSweet(s);

  for (const d of dust) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(216,184,119,${d.alpha})`;
    ctx.fill();
  }

  // Ground shadow platform where Bheem stands
  const groundY = canvas.gameHeight - 10;
  const groundGrad = ctx.createRadialGradient(canvas.gameWidth / 2, groundY, 10, canvas.gameWidth / 2, groundY, canvas.gameWidth * 0.6);
  groundGrad.addColorStop(0, 'rgba(0,0,0,0.9)');
  groundGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundY - 60, canvas.gameWidth, 70);
}

// ===========================================================
//                     PLAYER — "BHEEM"
// ===========================================================
const player = {
  w: 90,
  h: 150,
  x: 0,
  y: 0,
  reaching: null,     // {x, y, timer} target of current grab animation
  reachTimer: 0,
  shield: false, shieldTimer: 0,
  rapidFire: false, rapidFireTimer: 0,   // "rapid fire" = faster hand / bonus reach radius
  doubleScore: false, doubleScoreTimer: 0,
  hurtFlash: 0,
};

function resetPlayer() {
  player.x = canvas.gameWidth / 2 - player.w / 2;
  player.y = canvas.gameHeight - player.h - 14;
  player.reaching = null;
  player.reachTimer = 0;
  player.shield = false; player.shieldTimer = 0;
  player.rapidFire = false; player.rapidFireTimer = 0;
  player.doubleScore = false; player.doubleScoreTimer = 0;
  player.hurtFlash = 0;
}

// Draw the intimidating caped hero
function drawPlayer() {
  const cx = player.x + player.w / 2;
  const topY = player.y;

  ctx.save();

  // Ground contact glow
  const glow = ctx.createRadialGradient(cx, topY + player.h, 5, cx, topY + player.h, 90);
  glow.addColorStop(0, 'rgba(192,57,43,0.35)');
  glow.addColorStop(1, 'rgba(192,57,43,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, topY + player.h, 90, 0, Math.PI * 2);
  ctx.fill();

  // ---- CAPE (billowing behind) ----
  const capeWave = Math.sin(game.frame * 0.05) * 10;
  ctx.beginPath();
  ctx.moveTo(cx - 30, topY + 30);
  ctx.quadraticCurveTo(cx - 70 + capeWave, topY + 90, cx - 50 + capeWave * 1.5, topY + player.h);
  ctx.lineTo(cx + 50 - capeWave * 1.5, topY + player.h);
  ctx.quadraticCurveTo(cx + 70 - capeWave, topY + 90, cx + 30, topY + 30);
  ctx.closePath();
  const capeGrad = ctx.createLinearGradient(cx, topY, cx, topY + player.h);
  capeGrad.addColorStop(0, '#7a0d0d');
  capeGrad.addColorStop(1, '#2a0303');
  ctx.fillStyle = capeGrad;
  ctx.shadowColor = 'rgba(192,57,43,0.6)';
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // ---- LEGS ----
  ctx.fillStyle = '#1c1c22';
  ctx.fillRect(cx - 22, topY + 100, 16, 45);
  ctx.fillRect(cx + 6, topY + 100, 16, 45);

  // ---- TORSO / SHIRT ----
  const torsoGrad = ctx.createLinearGradient(cx, topY + 35, cx, topY + 105);
  torsoGrad.addColorStop(0, '#3d5a3f');
  torsoGrad.addColorStop(1, '#213b23');
  ctx.fillStyle = torsoGrad;
  ctx.beginPath();
  ctx.moveTo(cx - 34, topY + 100);
  ctx.lineTo(cx - 30, topY + 38);
  ctx.quadraticCurveTo(cx, topY + 22, cx + 30, topY + 38);
  ctx.lineTo(cx + 34, topY + 100);
  ctx.closePath();
  ctx.fillStyle = torsoGrad;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Shirt label "BHEEM"
  ctx.fillStyle = '#f3e3bf';
  ctx.font = 'bold 11px Oswald, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BHEEM', cx, topY + 72);

  // ---- ARMS (one idle, one reaching if active) ----
  drawArm(cx, topY, -1); // left arm
  drawArm(cx, topY, 1);  // right arm (may override with reach)

  // ---- HEAD ----
  const headY = topY + 15;
  ctx.beginPath();
  ctx.arc(cx, headY, 20, 0, Math.PI * 2);
  ctx.fillStyle = '#6b3d1f';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Hair / crown shadow
  ctx.beginPath();
  ctx.arc(cx, headY - 4, 20, Math.PI, 0);
  ctx.fillStyle = '#150c06';
  ctx.fill();

  // Glowing intimidating eyes
  const eyeGlow = 0.6 + Math.sin(game.frame * 0.1) * 0.3;
  ctx.fillStyle = `rgba(255,60,40,${eyeGlow})`;
  ctx.shadowColor = '#ff3c28';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(cx - 7, headY + 2, 3, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 7, headY + 2, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Furrowed brow (intimidating)
  ctx.strokeStyle = '#150c06';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 12, headY - 5);
  ctx.lineTo(cx - 3, headY - 2);
  ctx.moveTo(cx + 12, headY - 5);
  ctx.lineTo(cx + 3, headY - 2);
  ctx.stroke();

  // Hurt flash overlay
  if (player.hurtFlash > 0) {
    ctx.globalAlpha = player.hurtFlash / 10;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(player.x - 20, player.y - 20, player.w + 40, player.h + 40);
    ctx.globalAlpha = 1;
    player.hurtFlash--;
  }

  // Shield dome
  if (player.shield) {
    ctx.beginPath();
    ctx.arc(cx, topY + player.h / 2, player.w * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(80,180,255,${0.4 + Math.sin(game.frame * 0.2) * 0.25})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#50b4ff';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawArm(cx, topY, side) {
  const shoulderX = cx + side * 30;
  const shoulderY = topY + 45;
  let handX = cx + side * 55;
  let handY = topY + 80;

  // If reaching for a ladoo on this side, animate hand toward it
  if (player.reaching && Math.sign(player.reaching.x - cx || 1) === side) {
    const t = player.reachTimer / 10; // 0 -> 1 progression
    handX = cx + (player.reaching.x - cx) * Math.min(t * 2, 1);
    handY = topY + 80 + (player.reaching.y - (topY + 80)) * Math.min(t * 2, 1) * 0.5;
  }

  ctx.strokeStyle = '#3d5a3f';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // Fist
  ctx.beginPath();
  ctx.arc(handX, handY, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#6b3d1f';
  ctx.fill();
}

function updatePlayer() {
  if (player.reaching) {
    player.reachTimer--;
    if (player.reachTimer <= 0) player.reaching = null;
  }
  if (player.shield) { player.shieldTimer--; if (player.shieldTimer <= 0) player.shield = false; }
  if (player.rapidFire) { player.rapidFireTimer--; if (player.rapidFireTimer <= 0) player.rapidFire = false; }
  if (player.doubleScore) { player.doubleScoreTimer--; if (player.doubleScoreTimer <= 0) player.doubleScore = false; }
  renderActivePowerups();
}

function renderActivePowerups() {
  let html = '';
  if (player.shield) html += `<span class="powerup-icon" style="color:#50b4ff">SHIELD</span>`;
  if (player.rapidFire) html += `<span class="powerup-icon" style="color:#ff2fd6">SWIFT HANDS</span>`;
  if (player.doubleScore) html += `<span class="powerup-icon" style="color:#d8b877">x2 SCORE</span>`;
  activePowerupsEl.innerHTML = html;
}

// ===========================================================
//                     LADOOS (falling collectibles)
// ===========================================================
const LADOO_TYPES = {
  classic: { r: 24, speed: 1.1, health: 1, points: 10, color: '#e8901c', ring: '#a85c0a' },
  golden:  { r: 20, speed: 1.9, health: 1, points: 25, color: '#f4c542', ring: '#b8860b' },
  heavy:   { r: 30, speed: 0.7, health: 2, points: 30, color: '#b5651d', ring: '#6e3a0f' },
  cursed:  { r: 22, speed: 2.4, health: 1, points: -15, color: '#5c2a6b', ring: '#2c0f38' }, // avoid these!
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

let ladoos = [];
let ladooSpawnTimer = 0;
let ladooSpawnInterval = 130; // starts slow, per requirement "start a bit slowly"

function activeLetters() {
  return new Set(ladoos.map(l => l.letter));
}

function spawnLadoo() {
  const pool = ['classic'];
  if (game.level >= 2) pool.push('golden');
  if (game.level >= 3) pool.push('heavy');
  if (game.level >= 4) pool.push('cursed');
  const typeKey = pool[Math.floor(Math.random() * pool.length)];
  const t = LADOO_TYPES[typeKey];

  // pick a letter not currently falling, to keep typing unambiguous
  const used = activeLetters();
  let letter;
  let attempts = 0;
  do {
    letter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    attempts++;
  } while (used.has(letter) && attempts < 30);

  const difficultyMult = 1 + (game.level - 1) * 0.12;

  ladoos.push({
    type: typeKey,
    letter,
    x: Math.random() * (canvas.gameWidth - t.r * 2) + t.r,
    y: -t.r,
    r: t.r,
    speed: t.speed * difficultyMult,
    health: t.health,
    maxHealth: t.health,
    points: t.points,
    color: t.color,
    ring: t.ring,
    spin: Math.random() * Math.PI * 2,
  });
}

function updateLadoos() {
  for (const l of ladoos) {
    l.y += l.speed;
    l.spin += 0.03;
  }
  for (let i = ladoos.length - 1; i >= 0; i--) {
    if (ladoos[i].y - ladoos[i].r > canvas.gameHeight) {
      const l = ladoos[i];
      // Cursed ladoos reaching the ground are a relief, not a loss
      if (l.type !== 'cursed') {
        spawnSplat(l.x, canvas.gameHeight - 12, l.color);
        SFX.miss();
        damagePlayer(10);
      }
      ladoos.splice(i, 1);
    }
  }
}

function drawLadoos() {
  for (const l of ladoos) {
    ctx.save();
    ctx.translate(l.x, l.y);

    // Soft ambient glow so ladoos pop from the dark cinematic bg
    const glow = ctx.createRadialGradient(0, 0, l.r * 0.3, 0, 0, l.r * 1.6);
    glow.addColorStop(0, l.color + 'aa');
    glow.addColorStop(1, l.color + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, l.r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(0, 0, l.r, 0, Math.PI * 2);
    const bodyGrad = ctx.createRadialGradient(-l.r * 0.3, -l.r * 0.3, 2, 0, 0, l.r);
    bodyGrad.addColorStop(0, l.color);
    bodyGrad.addColorStop(1, l.ring);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Texture bumps (rotating slightly for life)
    ctx.rotate(l.spin);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      ctx.beginPath();
      ctx.arc(Math.cos(a) * l.r * 0.55, Math.sin(a) * l.r * 0.55, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.rotate(-l.spin);

    // Letter branding
    ctx.fillStyle = '#1a1004';
    ctx.font = `bold ${l.r * 0.9}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.letter, 0, 1);

    ctx.restore();

    // Multi-hit health pip
    if (l.maxHealth > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(l.x - l.r, l.y - l.r - 10, l.r * 2, 4);
      ctx.fillStyle = '#f3e3bf';
      ctx.fillRect(l.x - l.r, l.y - l.r - 10, l.r * 2 * (l.health / l.maxHealth), 4);
    }
  }
}

// ===========================================================
//                     POWER-UPS
// ===========================================================
const POWERUP_TYPES = [
  { key: 'rapid',  label: 'SWIFT HANDS', color: '#ff2fd6', symbol: 'S' },
  { key: 'shield', label: 'SHIELD',      color: '#50b4ff', symbol: 'D' },
  { key: 'double', label: 'DOUBLE SCORE',color: '#d8b877', symbol: 'X' },
];

let powerups = [];
let powerupTimer = 0;
let powerupInterval = 650;

function spawnPowerup() {
  const def = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  const used = activeLetters();
  let letter;
  let attempts = 0;
  do {
    letter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    attempts++;
  } while (used.has(letter) && attempts < 30);

  powerups.push({ ...def, letter, x: Math.random() * (canvas.gameWidth - 60) + 30, y: -30, r: 22, speed: 1.6 });
}

function updatePowerups() {
  powerups.forEach(p => p.y += p.speed);
  powerups = powerups.filter(p => p.y < canvas.gameHeight + 40);
}

function drawPowerups() {
  for (const p of powerups) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const pulse = 1 + Math.sin(game.frame * 0.15) * 0.12;
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,5,10,0.75)';
    ctx.fill();
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.color;
    ctx.font = 'bold 20px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.letter, 0, 1);
    ctx.restore();
  }
}

function applyPowerup(p) {
  SFX.powerup();
  if (p.key === 'rapid') { player.rapidFire = true; player.rapidFireTimer = 60 * 8; }
  else if (p.key === 'shield') { player.shield = true; player.shieldTimer = 60 * 8; }
  else if (p.key === 'double') { player.doubleScore = true; player.doubleScoreTimer = 60 * 8; }
}

// ===========================================================
//                     PARTICLES (bursts + ground splats)
// ===========================================================
let particles = [];

function spawnBurst(x, y, color, count = 16) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = Math.random() * 3.5 + 1;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 30 + Math.random() * 15, maxLife: 45, color, size: Math.random() * 3 + 1.5, gravity: 0 });
  }
}

function spawnSplat(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const angle = Math.PI + (Math.random() - 0.5) * Math.PI; // spray upward-ish then falls
    const speed = Math.random() * 3 + 1;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2, life: 40, maxLife: 40, color, size: Math.random() * 3 + 2, gravity: 0.25 });
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity || 0;
    p.vx *= 0.97;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
}

function drawParticles() {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

// ===========================================================
//                     INPUT -> GRAB LOGIC
// ===========================================================
// Typing a letter (or tapping the on-screen key) attempts to grab the
// lowest (most urgent) ladoo or powerup currently bearing that letter.
function tryGrabLetter(letter) {
  if (!game.running || game.paused || game.over) return;
  letter = letter.toUpperCase();

  // Prefer ladoos over powerups if both share the letter (rare)
  let target = null;
  let targetList = null;
  let bestY = -Infinity;

  for (const l of ladoos) {
    if (l.letter === letter && l.y > bestY) { target = l; bestY = l.y; targetList = ladoos; }
  }
  if (!target) {
    for (const p of powerups) {
      if (p.letter === letter && p.y > bestY) { target = p; bestY = p.y; targetList = powerups; }
    }
  }
  if (!target) return; // no match currently falling

  // Trigger hand-reach animation toward the target's position
  player.reaching = { x: target.x, y: target.y };
  player.reachTimer = 10;

  if (targetList === ladoos) {
    target.health--;
    if (target.health <= 0) {
      const isCursed = target.type === 'cursed';
      spawnBurst(target.x, target.y, isCursed ? '#5c2a6b' : target.color);
      if (isCursed) {
        SFX.miss();
        damagePlayer(15); // grabbing a cursed ladoo hurts him
      } else {
        SFX.grab();
        addScore(target.points);
      }
      ladoos.splice(ladoos.indexOf(target), 1);
    } else {
      SFX.grab();
    }
  } else {
    applyPowerup(target);
    powerups.splice(powerups.indexOf(target), 1);
  }
}

// ===========================================================
//                     HEALTH / SCORE / LEVEL
// ===========================================================
function damagePlayer(amount) {
  if (player.shield) return;
  game.health -= amount;
  player.hurtFlash = 10;
  triggerFlash();
  if (game.health <= 0) {
    game.health = 0;
    endGame();
  }
  updateHealthUI();
}

function updateHealthUI() {
  const pct = Math.max(0, game.health / game.maxHealth) * 100;
  healthBar.style.width = pct + '%';
}

function addScore(points) {
  const mult = player.doubleScore ? 2 : 1;
  game.score += Math.max(0, points) * mult;
  scoreEl.textContent = game.score;

  const newLevel = Math.floor(game.score / 250) + 1;
  if (newLevel !== game.level) {
    game.level = newLevel;
    levelEl.textContent = game.level;
    SFX.levelup();
    triggerFlash();
  }
}

function triggerFlash() {
  flashEl.classList.remove('active');
  void flashEl.offsetWidth; // restart animation
  flashEl.classList.add('active');
}

function increaseDifficulty() {
  ladooSpawnInterval = Math.max(30, 130 - game.level * 10);
}

// ===========================================================
//                     GAME LOOP
// ===========================================================
function update() {
  if (!game.running || game.paused || game.over) return;
  game.frame++;
  updateBackground();
  updatePlayer();
  updateLadoos();
  updatePowerups();
  updateParticles();
  increaseDifficulty();

  ladooSpawnTimer++;
  if (ladooSpawnTimer >= ladooSpawnInterval) {
    ladooSpawnTimer = 0;
    spawnLadoo();
    if (game.level >= 5 && Math.random() < 0.35) spawnLadoo();
  }

  powerupTimer++;
  if (powerupTimer >= powerupInterval) {
    powerupTimer = 0;
    spawnPowerup();
  }
}

function draw() {
  drawBackground();
  if (game.running) {
    drawLadoos();
    drawPowerups();
    drawPlayer();
    drawParticles();
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();

// ===========================================================
//                     GAME FLOW CONTROL
// ===========================================================
function startGame() {
  getAudioCtx(); // unlock audio on user gesture

  game.running = true;
  game.paused = false;
  game.over = false;
  game.score = 0;
  game.level = 1;
  game.health = game.maxHealth;
  game.frame = 0;
  ladooSpawnTimer = 0;
  ladooSpawnInterval = 130;
  powerupTimer = 0;
  ladoos = [];
  powerups = [];
  particles = [];

  resetPlayer();
  scoreEl.textContent = 0;
  levelEl.textContent = 1;
  updateHealthUI();
  renderActivePowerups();

  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  pauseBtn.style.display = 'inline-block';
  restartBtn.style.display = 'inline-block';
  pauseBtn.innerHTML = '&#10074;&#10074;';
}

function togglePause() {
  if (!game.running || game.over) return;
  game.paused = !game.paused;
  pauseScreen.classList.toggle('hidden', !game.paused);
  pauseBtn.innerHTML = game.paused ? '&#9654;' : '&#10074;&#10074;';
}

function endGame() {
  game.running = false;
  game.over = true;
  SFX.gameover();
  triggerFlash();

  finalScoreEl.textContent = game.score;
  const isNewHigh = game.score > game.highScore;
  if (isNewHigh) {
    game.highScore = game.score;
    localStorage.setItem('ladduRajHighScore', String(game.highScore));
    highScoreEl.textContent = game.highScore;
  }
  newHighEl.classList.toggle('hidden', !isNewHigh);

  gameOverScreen.classList.remove('hidden');
  pauseBtn.style.display = 'none';
}

// ===========================================================
//                     INPUT HANDLING
// ===========================================================
window.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
  if (/^[a-zA-Z]$/.test(e.key)) tryGrabLetter(e.key);
});

startBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', togglePause);
pauseBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', startGame);
restartFromGameOverBtn.addEventListener('click', startGame);

// ---------- On-screen keyboard (for touch/mobile devices) ----------
function buildMobileKeyboard() {
  mobileKeyboard.innerHTML = '';
  ALPHABET.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'key-btn';
    btn.textContent = letter;
    // pointerdown unifies touch/mouse/pen in one event across Chrome, so we
    // avoid the double-fire that touchstart + mousedown can cause together.
    const fire = (e) => { e.preventDefault(); tryGrabLetter(letter); };
    btn.addEventListener('pointerdown', fire, { passive: false });
    mobileKeyboard.appendChild(btn);
  });
}
buildMobileKeyboard();

// Initial UI state
pauseBtn.style.display = 'none';
restartBtn.style.display = 'none';
updateHealthUI();
