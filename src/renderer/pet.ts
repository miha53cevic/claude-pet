// Render loop + interaction. Owns all timing/state; a form only draws a body.
import { getForm } from './forms/index.js';
import { CX, CY, LOGICAL, PET_RADIUS } from './layout.js';
import { BUBBLE_GLYPHS } from './catalog.js';

const DEFAULT_PALETTE: PetPalette = {
  body: '#d97757', // Claude coral
  light: '#eda380',
  belly: '#f3c4a8',
  dark: '#3d2b25',
  confetti: ['#d97757', '#eda380', '#7fb069', '#e8b04b', '#6a8caf'],
};
const FAILED_PALETTE: Partial<PetPalette> = { body: '#c0504a', light: '#d97b70', belly: '#dba49a', dark: '#38201d' };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  size: number;
  spin: number;
}

// tokens being eaten while working
interface TokenChip {
  x0: number;
  y0: number;
  p: number; // 0..1 progress toward the mouth
  dur: number;
  glyph: string;
}

const TOKEN_GLYPHS = ['{ }', '=>', '();', '</>', 'if', '0x', '&&', 'fn', '[ ]', '#!'];
const MOUTH = { x: CX, y: CY + 8 };
let tokens: TokenChip[] = [];
let tokenSpawnIn = 0;

const canvas = document.getElementById('pet') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const tooltip = document.getElementById('tooltip') as HTMLDivElement;
const debugEl = document.getElementById('debug') as HTMLDivElement;

// pre-init placeholder; keep in sync with DEFAULTS in src/config.ts
let cfg: PetInit = { debug: false, form: 'claude', scale: 1, chime: 'off', palette: null };
let resolved: PetResolvedState = { state: 'idle', flavor: null, frazzle: 0, urgency: 0, subagents: 0, sessions: [] };
let gaze = { x: 0, y: 0 };
let motion: PetMotion | null = null; // set while main walks the window around
let hovering = false;
let particles: Particle[] = [];
let blinkAt = performance.now() + 2000;
let hoverStart = 0; // when the cursor entered the pet (for petting)
let pettingNow = false;
let lastUrgency = 0; // re-chime on escalation tier increases
let sweat: Particle[] = [];
let sweatSpawnIn = 0;
let hearts: Particle[] = [];
let heartSpawnIn = 0;
let hopAt = performance.now() + 5000;
let jumpStart = 0; // done-celebration jump
let pokeStart = 0; // click reaction
let lastState: PetStateName = 'idle';
let lastFrame = 0;

window.pet.onInit((v) => {
  cfg = { ...cfg, ...v };
  basePalette = { ...DEFAULT_PALETTE, ...(cfg.palette || {}) };
  failedPalette = { ...basePalette, ...FAILED_PALETTE };
  debugEl.classList.toggle('hidden', !cfg.debug);
  if (cfg.debug) {
    tooltip.classList.remove('hidden');
    renderTooltip();
  }
});
window.pet.onState((v) => {
  resolved = v;
  if (!tooltip.classList.contains('hidden')) renderTooltip();
});
window.pet.onGaze((v) => {
  gaze = v;
});
window.pet.onMotion((m) => {
  motion = m;
});

// ---------- interaction ----------

let canvasRect = canvas.getBoundingClientRect(); // refreshed on resize

function petHit(e: MouseEvent): boolean {
  const x = ((e.clientX - canvasRect.left) / canvasRect.width) * LOGICAL.w;
  const y = ((e.clientY - canvasRect.top) / canvasRect.height) * LOGICAL.h;
  return Math.hypot(x - CX, y - CY) < PET_RADIUS;
}

document.addEventListener('mousemove', (e) => {
  const over = petHit(e);
  if (over !== hovering) {
    hovering = over;
    if (over) hoverStart = performance.now();
    window.pet.hover(over);
    tooltip.classList.toggle('hidden', !over && !cfg.debug);
    if (over) renderTooltip();
  }
});

let downAt: { x: number; y: number } | null = null;
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !petHit(e)) return;
  downAt = { x: e.screenX, y: e.screenY };
  window.pet.dragStart();
});
document.addEventListener('mouseup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y);
  downAt = null;
  window.pet.dragEnd();
  if (moved < 4) pokeStart = performance.now(); // click, not drag: react
});
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (petHit(e)) window.pet.menu();
});

function renderTooltip(): void {
  const rows = resolved.sessions.length
    ? resolved.sessions
        .map((s) => `<div class="row"><span>${esc(s.name)}</span><em>${esc(s.state)}${s.tool ? ' — ' + esc(shortTool(s.tool)) : ''}</em></div>`)
        .join('')
    : '<div class="row"><em>no active sessions</em></div>';
  tooltip.innerHTML = `<div class="title">claude-pet — ${resolved.sessions.length} session${resolved.sessions.length === 1 ? '' : 's'}</div>${rows}`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function shortTool(t: string): string {
  return t === 'permission_prompt' ? 'permission' : t === 'idle_prompt' ? 'your turn' : t;
}

// ---------- chime ----------

const CHIME_GAIN: Record<ChimeLevel, number> = { off: 0, quiet: 0.03, normal: 0.08, loud: 0.22 };

let audioCtx: AudioContext | null = null;
function chime(): void {
  const gain = CHIME_GAIN[cfg.chime] ?? 0;
  if (gain <= 0) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const play = () => {
      // a two-note rising "bo-wip!" chirp — soft triangle timbre with a
      // little pitch bend, so it sounds like the pet and not like a phone
      const ctx2 = audioCtx!;
      const t0 = ctx2.currentTime;
      const note = (freq: number, glideTo: number, at: number, dur: number, level: number) => {
        const o = ctx2.createOscillator();
        const g = ctx2.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(freq, t0 + at);
        o.frequency.exponentialRampToValueAtTime(glideTo, t0 + at + dur);
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(level, t0 + at + 0.012); // soft attack
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g).connect(ctx2.destination);
        o.start(t0 + at);
        o.stop(t0 + at + dur + 0.02);
      };
      note(590, 640, 0, 0.11, gain); // bo
      note(880, 1050, 0.09, 0.32, gain); // wip!
    };
    // without a user gesture the context can come up suspended (muted)
    if (audioCtx.state === 'suspended') audioCtx.resume().then(play, () => {});
    else play();
    if (cfg.debug) console.log('[chime] AudioContext state:', audioCtx.state);
  } catch {
    /* audio is a nicety */
  }
}

// ---------- animation ----------

function frameParams(now: number): PetFrame {
  const { state, flavor } = resolved;
  const t = now / 1000;

  if (state !== lastState) {
    if (state === 'done') {
      jumpStart = now;
      spawnConfetti();
    }
    if (state === 'waiting') chime();
    if (state !== 'waiting') lastUrgency = 0;
    lastState = state;
  }
  // escalation: re-chime each time the waiting tier rises (1min, 3min ignored)
  if (state === 'waiting' && resolved.urgency > lastUrgency) {
    lastUrgency = resolved.urgency;
    if (resolved.urgency > 0) chime();
  }

  // blink scheduling
  let blink = false;
  if (now > blinkAt) {
    blink = now - blinkAt < 130;
    if (now - blinkAt > 130) blinkAt = now + 1500 + Math.random() * 4000;
  }

  // petting: cursor held on him while he has nothing better to do
  pettingNow = hovering && now - hoverStart > 800 && (state === 'idle' || state === 'sleeping');
  if (pettingNow) blink = true; // eyes closed contentedly

  // breathing / bobbing
  const speed = state === 'working' ? 5 : state === 'waiting' ? 7 : state === 'sleeping' ? 1.2 : 2;
  const breath = Math.sin(t * speed);

  // vertical lift (bounce/jump/hop); waiting bounces harder the longer it's ignored
  const u = state === 'waiting' ? resolved.urgency : 0;
  let lift = 0;
  if (state === 'waiting') lift = Math.abs(Math.sin(t * (6 + u * 2.5))) * (12 + u * 9);
  else if (state === 'working') lift = Math.abs(Math.sin(t * 5)) * 4;
  else if (state === 'done') {
    const jt = (now - jumpStart) / 1000;
    if (jt < 0.6) lift = Math.sin((jt / 0.6) * Math.PI) * 34;
  } else if (state === 'idle') {
    if (now > hopAt) {
      const ht = (now - hopAt) / 1000;
      if (ht < 0.4) lift = Math.sin((ht / 0.4) * Math.PI) * 12;
      else hopAt = now + 8000 + Math.random() * 15000;
    }
  }
  if (pokeStart && now - pokeStart < 400) lift = Math.max(lift, Math.sin(((now - pokeStart) / 400) * Math.PI) * 18);

  // squash & stretch follows lift; droop when failed
  let squash = 1 + breath * 0.025 + lift * 0.004;
  if (state === 'failed') squash = 0.9 + breath * 0.02;

  // shake when failed; waiting tier 2 adds a frantic lateral shake
  let tilt =
    state === 'failed'
      ? Math.sin(t * 30) * 0.04
      : state === 'waiting'
        ? Math.sin(t * (6 + u * 4)) * (0.03 + u * 0.025)
        : 0;
  // a long failure streak makes him visibly nervous
  if (resolved.frazzle >= 3 && (state === 'working' || state === 'failed')) tilt += Math.sin(t * 25) * 0.03;

  // flavored gaze: search scans, web stares off, compaction spins the room
  let g = gaze;
  if (state === 'working' && flavor === 'search') g = { x: Math.sin(t * 3), y: 0.1 };
  else if (state === 'working' && flavor === 'web') g = { x: 0.7, y: -0.6 };
  else if (state === 'sleeping') g = { x: 0, y: 0 };
  if (state === 'working' && flavor === 'compact') {
    g = { x: Math.cos(t * 7), y: Math.sin(t * 7) }; // spiral eyes
    tilt += Math.sin(t * 3) * 0.12; // woozy sway
  }

  // wander poses: lean while walking, cling while climbing, stretch while
  // falling, splat on landing
  if (motion && state === 'idle') {
    if (motion.mode === 'walk') {
      lift = Math.abs(Math.sin(t * 9)) * 4;
      tilt = motion.dir * 0.05;
      g = { x: motion.dir * 0.8, y: 0.15 };
    } else if (motion.mode === 'climb') {
      lift = Math.abs(Math.sin(t * 10)) * 3;
      tilt = motion.dir * 0.45; // lean into the wall
      g = { x: motion.dir * 0.4, y: -0.8 };
    } else if (motion.mode === 'ceiling') {
      // upside-down gecko scuttle along the top edge
      tilt = Math.PI + Math.sin(t * 9) * 0.06;
      lift = Math.abs(Math.sin(t * 9)) * 2;
      g = { x: -motion.dir * 0.8, y: -0.3 }; // flipped frame: lead the motion, peek at the desktop
    } else if (motion.mode === 'fall') {
      squash = 1.18; // stretched out
      tilt = Math.sin(t * 20) * 0.05;
      g = { x: 0, y: -1 };
    } else if (motion.mode === 'land') {
      squash = 0.62; // splat
      lift = 0;
    }
  }

  const sleep = state === 'sleeping' ? 1 : 0;
  const chomp = state === 'working' ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  return { state, flavor, t, breath, blink, squash, lift, tilt, gaze: g, sleep, chomp, palette: paletteFor(state) };
}

let basePalette: PetPalette = DEFAULT_PALETTE;
let failedPalette: PetPalette = { ...DEFAULT_PALETTE, ...FAILED_PALETTE };

function paletteFor(state: PetStateName): PetPalette {
  return state === 'failed' ? failedPalette : basePalette;
}

function spawnConfetti(): void {
  const colors = paletteFor('done').confetti;
  for (let i = 0; i < 24; i++) {
    particles.push({
      x: CX,
      y: CY - 40,
      vx: (Math.random() - 0.5) * 160,
      vy: -60 - Math.random() * 120,
      color: colors[i % colors.length]!,
      life: 1.2 + Math.random() * 0.5,
      size: 3 + Math.random() * 3,
      spin: Math.random() * Math.PI,
    });
  }
}

function drawExtras(f: PetFrame, dt: number): void {
  // tokens drift in and get munched while working
  if (f.state === 'working' && !document.hidden) {
    tokenSpawnIn -= dt;
    if (tokenSpawnIn <= 0 && tokens.length < 4) {
      const a = -Math.PI * (0.15 + Math.random() * 0.7); // from the upper arc
      const r = 105 + Math.random() * 25;
      tokens.push({
        x0: Math.min(248, Math.max(12, MOUTH.x + Math.cos(a) * r)),
        y0: Math.max(8, MOUTH.y + Math.sin(a) * r),
        p: 0,
        dur: 1.0 + Math.random() * 0.5,
        glyph: TOKEN_GLYPHS[Math.floor(Math.random() * TOKEN_GLYPHS.length)]!,
      });
      tokenSpawnIn = 0.35 + Math.random() * 0.55;
    }
  }
  tokens = tokens.filter((tk) => (tk.p += dt / tk.dur) < 1);
  for (const tk of tokens) {
    const q = tk.p * tk.p * (3 - 2 * tk.p); // smoothstep toward the mouth
    const x = tk.x0 + (MOUTH.x - tk.x0) * q;
    const y = tk.y0 + (MOUTH.y - tk.y0) * q - Math.sin(tk.p * Math.PI) * 14; // slight arc
    const shrink = tk.p > 0.75 ? 1 - ((tk.p - 0.75) / 0.25) * 0.7 : 1; // swallowed
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(shrink, shrink);
    ctx.rotate(Math.sin(tk.p * 6) * 0.15);
    const w = tk.glyph.length * 6 + 8;
    ctx.fillStyle = f.palette.dark;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -8, w, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#f5ece6';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tk.glyph, 0, 0);
    ctx.restore();
  }

  // confetti
  particles = particles.filter((p) => (p.life -= dt) > 0);
  for (const p of particles) {
    p.vy += 300 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.spin += dt * 6;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life);
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // frazzle sweat: droplets beside the head while he struggles
  if ((f.state === 'working' || f.state === 'failed') && resolved.frazzle > 0 && !document.hidden) {
    sweatSpawnIn -= dt;
    if (sweatSpawnIn <= 0 && sweat.length <= resolved.frazzle) {
      const side = Math.random() < 0.5 ? -1 : 1;
      sweat.push({
        x: CX + side * (26 + Math.random() * 12),
        y: CY - 28,
        vx: side * 14,
        vy: 10,
        color: 'rgba(150,200,255,0.85)',
        life: 0.9,
        size: 2.5,
        spin: 0,
      });
      sweatSpawnIn = Math.max(0.25, 0.95 - resolved.frazzle * 0.13);
    }
  }
  sweat = sweat.filter((p) => (p.life -= dt) > 0);
  for (const p of sweat) {
    p.vy += 240 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life * 1.6);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.size, p.size * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // petting hearts
  if (pettingNow && !document.hidden) {
    heartSpawnIn -= dt;
    if (heartSpawnIn <= 0 && hearts.length < 5) {
      hearts.push({
        x: CX + (Math.random() - 0.5) * 44,
        y: CY - 44,
        vx: (Math.random() - 0.5) * 14,
        vy: -32,
        color: f.palette.body,
        life: 1.2,
        size: 11 + Math.random() * 4,
        spin: (Math.random() - 0.5) * 0.5,
      });
      heartSpawnIn = 0.4;
    }
  }
  hearts = hearts.filter((p) => (p.life -= dt) > 0);
  for (const p of hearts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin * p.life);
    ctx.globalAlpha = Math.min(1, p.life);
    ctx.fillStyle = p.color;
    ctx.font = `bold ${Math.round(p.size)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♥', 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // orbiting subagent dots
  const n = Math.min(resolved.subagents, 6);
  for (let i = 0; i < n; i++) {
    const a = f.t * 2 + (i * Math.PI * 2) / n;
    ctx.fillStyle = f.palette.light;
    ctx.beginPath();
    ctx.arc(CX + Math.cos(a) * 78, CY - 30 + Math.sin(a) * 26, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // bubble ('?' grows into '!?' when the wait has been ignored too long)
  let ch = BUBBLE_GLYPHS[f.state];
  if (f.state === 'waiting' && resolved.urgency >= 2) ch = '!?';
  if (ch) {
    const pulse =
      f.state === 'waiting' ? 1 + Math.sin(f.t * (6 + resolved.urgency * 3)) * (0.12 + resolved.urgency * 0.05) : 1;
    const drift = f.state === 'sleeping' ? Math.sin(f.t * 1.2) * 4 : 0;
    const bx = CX + 52 + drift;
    const by = CY - 56 - f.lift * 0.5 - drift;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = f.palette.dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-12, 16, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = f.state === 'failed' ? f.palette.body : f.palette.dark;
    ctx.font = ch.length > 1 ? 'bold 13px -apple-system, sans-serif' : 'bold 18px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, 1);
    ctx.restore();
  }
}

// ---------- main loop ----------

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  canvasRect = canvas.getBoundingClientRect();
}
window.addEventListener('resize', resize);
resize();

function loop(now: number): void {
  if (document.hidden) {
    requestAnimationFrame(loop); // rAF stalls while hidden; resumes on show
    return;
  }
  const s = resolved.state;
  const fps = s === 'idle' || s === 'sleeping' ? 12 : 30;
  const due = lastFrame + 1000 / fps;
  if (now < due - 1) {
    // sleep until the next frame is due instead of waking at display refresh
    setTimeout(() => requestAnimationFrame(loop), due - now);
    return;
  }
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr * (canvas.clientWidth / LOGICAL.w), 0, 0, dpr * (canvas.clientHeight / LOGICAL.h), 0, 0);
  ctx.clearRect(0, 0, LOGICAL.w, LOGICAL.h);

  const f = frameParams(now);
  getForm(cfg.form).draw(ctx, f);
  drawExtras(f, dt);

  if (cfg.debug) {
    debugEl.textContent = `${f.state}${f.flavor ? ':' + f.flavor : ''}${motion ? ' · ' + motion.mode : ''} · ${resolved.sessions.length}s`;
  }
}
requestAnimationFrame(loop);
