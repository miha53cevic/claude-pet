import { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, clipboard } from 'electron';
import * as path from 'node:path';
import { resolvePort, ConfigStore } from './config.js';
import { PetState } from './state.js';
import { startHookServer } from './hook-server.js';
import { LOGICAL, CY, PET_BOX } from './renderer/layout.js';
import { FORM_NAMES, STATE_NAMES } from './renderer/catalog.js';
import { trayIcon } from './tray-icon.js';
import { installHooks, uninstallHooks, hooksStatusSync } from './hooks-installer.js';

const PORT = resolvePort();
const DEBUG = !!process.env.CLAUDE_PET_DEBUG;

// The chime plays without any user gesture (the pet window is never even
// focusable), so Chromium's autoplay policy would keep the AudioContext
// suspended and silent. This window plays a single short beep, max.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// A pet on a non-default port is a separate creature: own config, own
// single-instance lock (the lock is scoped to the userData directory).
if (process.env.CLAUDE_PET_PORT) app.setPath('userData', `${app.getPath('userData')}-${PORT}`);


// A 30Hz timer in the main process means an uncaught throw would open an
// Electron error dialog per tick — an infinite popup storm. Cap it at one
// dialog per run; later errors just log.
let errorDialogShown = false;
process.on('uncaughtException', (err) => {
  console.error('[claude-pet] uncaught:', err);
  if (errorDialogShown) return;
  errorDialogShown = true;
  dialog.showErrorBox('claude-pet: internal error (logged)', String(err?.stack || err));
});

if (!app.requestSingleInstanceLock()) {
  // fixed port => a second instance can never work
  app.quit();
}

let win: BrowserWindow | null = null; // the primary pet
const extraWins: BrowserWindow[] = []; // clone pets (petCount - 1 of them)
const extraForms: string[] = []; // each clone's form, parallel to extraWins

// a random form nobody is wearing yet; anything goes once all forms are taken
function pickForm(): string {
  const used = [config.get('form'), ...extraForms];
  const pool = FORM_NAMES.filter((f) => !used.includes(f));
  const from = pool.length ? pool : FORM_NAMES;
  return from[Math.floor(Math.random() * from.length)]!;
}
let tray: Tray | null = null;
let config: ConfigStore;
let state: PetState;
let dragTimer: ReturnType<typeof setInterval> | null = null;
let dragWin: BrowserWindow | null = null;

const allWins = () => (win ? [win, ...extraWins] : [...extraWins]);

// Runtime-only (never persisted): a relaunch always shows the pets, so a
// hidden flock can never be stranded invisible. Unhiding lives in the tray
// menu, which stays reachable while the pets are gone.
let petsHidden = false;

function setPetsHidden(hidden: boolean): void {
  petsHidden = hidden;
  for (const w of allWins()) {
    if (hidden) w.hide();
    else w.show();
  }
}

// ---------- geometry (logical values come from renderer/layout.ts) ----------

function scale(): number {
  return config.get('scale') || 1;
}

function petBox() {
  const s = scale();
  return { l: PET_BOX.left * s, t: PET_BOX.top * s, r: PET_BOX.right * s, b: PET_BOX.bottom * s };
}

function windowSize() {
  const s = scale();
  return { width: Math.round(LOGICAL.w * s), height: Math.round(LOGICAL.h * s) };
}

function defaultPosition() {
  const d = screen.getPrimaryDisplay().workArea;
  const b = petBox();
  return { x: d.x + d.width - b.r - 24, y: d.y + d.height - b.b - 8 };
}

function clampToWorkArea(x: number, y: number) {
  const { width, height } = windowSize();
  const b = petBox();
  const d = screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, d.x - b.l), d.x + d.width - b.r)),
    y: Math.round(Math.min(Math.max(y, d.y - b.t), d.y + d.height - b.b)),
  };
}

function positionIsVisible(pos: { x: number; y: number } | null): pos is { x: number; y: number } {
  if (!pos) return false;
  const { width, height } = windowSize();
  const cx = pos.x + width / 2;
  const cy = pos.y + height / 2;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });
}

// ---------- window ----------

function makePetWindow(pos: { x: number; y: number }): BrowserWindow {
  const { width, height } = windowSize();
  const w = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: !petsHidden,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through empty corners
  w.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));
  return w;
}

function createWindow(): void {
  const saved = config.get('position');
  win = makePetWindow(positionIsVisible(saved) ? saved : defaultPosition());
  win.webContents.on('did-finish-load', () => sendInit());
}

function initPayload(): PetInit {
  return {
    debug: DEBUG,
    form: config.get('form'),
    scale: config.get('scale'),
    chime: config.get('chime'),
    palette: config.get('palette'),
  };
}

function sendInit(): void {
  if (win) win.webContents.send('pet:init', initPayload());
  extraWins.forEach((w, i) =>
    w.webContents.send('pet:init', { ...initPayload(), form: extraForms[i] ?? pickForm(), chime: 'off' })
  );
  const resolved = state.resolve();
  for (const w of allWins()) w.webContents.send('pet:state', resolved);
}

// ---------- pet copies ----------

function offsetFromPrimary(i: number): { x: number; y: number } {
  const [px, py] = win!.getPosition();
  const { width } = windowSize();
  return clampToWorkArea(px - (i + 1) * Math.round(width * 0.72), py); // fan out leftward
}

function spawnExtra(i: number): void {
  const saved = config.get('extraPositions')[i] ?? null;
  const w = makePetWindow(positionIsVisible(saved) ? saved : offsetFromPrimary(i));
  extraForms[i] = pickForm();
  w.webContents.on('did-finish-load', () => {
    // own form, no chime — one chime is enough
    w.webContents.send('pet:init', { ...initPayload(), form: extraForms[i]!, chime: 'off' });
    w.webContents.send('pet:state', state.resolve());
  });
  extraWins.push(w);
}

function setPetCount(n: number): void {
  config.set('petCount', n);
  while (extraWins.length > n - 1) {
    extraWins.pop()!.destroy();
    extraForms.pop();
  }
  while (extraWins.length < n - 1) spawnExtra(extraWins.length);
}

function persistPos(w: BrowserWindow): void {
  if (w.isDestroyed()) return;
  const [x, y] = w.getPosition();
  if (w === win) {
    config.set('position', { x, y });
  } else {
    const i = extraWins.indexOf(w);
    if (i >= 0) {
      const arr = [...config.get('extraPositions')];
      arr[i] = { x, y };
      config.set('extraPositions', arr);
    }
  }
}

// ---------- tray ----------

function buildMenu(forClone = false): Menu {
  const scales = [1, 1.5, 2];
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: forClone ? 'clone — settings live on the main pet' : `claude-pet — port ${PORT}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Form',
      submenu: FORM_NAMES.map((f): Electron.MenuItemConstructorOptions => ({
        label: f,
        type: 'radio',
        checked: config.get('form') === f,
        click: () => {
          config.set('form', f);
          sendInit();
        },
      })),
    },
    {
      label: 'Scale',
      submenu: scales.map((s): Electron.MenuItemConstructorOptions => ({
        label: `${s}×`,
        type: 'radio',
        checked: scale() === s,
        click: () => {
          config.set('scale', s);
          for (const w of allWins()) {
            const { width, height } = windowSize();
            w.setSize(width, height);
            const [x, y] = w.getPosition();
            const c = clampToWorkArea(x, y);
            w.setPosition(c.x, c.y);
          }
          sendInit();
        },
      })),
    },
    {
      label: 'Pets',
      submenu: [1, 2, 3, 4].map((n): Electron.MenuItemConstructorOptions => ({
        label: `${n}`,
        type: 'radio',
        checked: config.get('petCount') === n,
        click: () => setPetCount(n),
      })),
    },
    { type: 'separator' },
    {
      label: petsHidden ? 'Show pets' : 'Hide pets',
      click: () => setPetsHidden(!petsHidden),
    },
    {
      label: 'Wander',
      submenu: (
        [
          ['off', 'Off'],
          ['drift', 'Drift (subtle)'],
          ['adventure', 'Adventure (climb & drop)'],
        ] as Array<[WanderMode, string]>
      ).map(([mode, label]): Electron.MenuItemConstructorOptions => ({
        label,
        type: 'radio',
        checked: config.get('wander') === mode,
        click: () => {
          config.set('wander', mode);
          setWander(mode);
        },
      })),
    },
    {
      label: 'Chime on waiting',
      submenu: (
        [
          ['off', 'Off'],
          ['quiet', 'Quiet'],
          ['normal', 'Normal'],
          ['loud', 'Loud'],
        ] as Array<[ChimeLevel, string]>
      ).map(([level, label]): Electron.MenuItemConstructorOptions => ({
        label,
        type: 'radio',
        checked: config.get('chime') === level,
        click: () => {
          config.set('chime', level);
          sendInit();
        },
      })),
    },
    {
      label: 'Claude Code hooks',
      submenu: ((): Electron.MenuItemConstructorOptions[] => {
        const st = hooksStatusSync(PORT);
        return [
          { label: st.installed ? `installed (${st.count} events)` : 'not installed', enabled: false },
          { label: 'Install / update hooks…', click: () => void installHooks(PORT) },
          { label: 'Uninstall hooks…', enabled: st.installed, click: () => void uninstallHooks(PORT) },
        ];
      })(),
    },
    ...(app.isPackaged
      ? ([
          {
            label: 'Start at login',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    { type: 'separator' },
    {
      label: 'Test state',
      submenu: STATE_NAMES.map((s): Electron.MenuItemConstructorOptions => ({ label: s, click: () => forceTestState(s) })),
    },
    {
      label: 'Copy debug info',
      click: () => clipboard.writeText(JSON.stringify(state.debugInfo(), null, 2)),
    },
    { type: 'separator' },
    { label: 'Reset position', click: () => moveTo(defaultPosition()) },
    { label: 'Quit', click: () => app.quit() },
  ];
  if (forClone) {
    // clones show the menu for reference, but only the main pet takes changes
    const disable = (items: Electron.MenuItemConstructorOptions[]): void => {
      for (const it of items) {
        if (it.label === 'Quit') continue; // quitting is always allowed
        it.enabled = false;
        if (Array.isArray(it.submenu)) disable(it.submenu);
      }
    };
    disable(template);
  }
  return Menu.buildFromTemplate(template);
}

function forceTestState(s: string): void {
  if ((STATE_NAMES as string[]).includes(s)) state.setOverride(s as PetStateName);
}

// ---------- drag / gaze / wander ----------

function moveTo(pos: { x: number; y: number }): void {
  if (!win) return;
  const c = clampToWorkArea(pos.x, pos.y);
  win.setPosition(c.x, c.y);
  config.set('position', c);
}

ipcMain.on('pet:hover', (e, over: boolean) => {
  BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(!over, { forward: true });
});

ipcMain.on('pet:dragstart', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (dragTimer) clearInterval(dragTimer);
  dragWin = w;
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = w.getPosition();
  const offset = { x: cursor.x - wx, y: cursor.y - wy };
  dragTimer = setInterval(() => {
    if (w.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    w.setPosition(c.x - offset.x, c.y - offset.y);
  }, 16);
});

ipcMain.on('pet:dragend', () => {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  if (!dragWin || dragWin.isDestroyed()) {
    dragWin = null;
    return;
  }
  const [x, y] = dragWin.getPosition();
  const c = clampToWorkArea(x, y);
  dragWin.setPosition(c.x, c.y);
  persistPos(dragWin);
  dragWin = null;
});

ipcMain.on('pet:menu', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) buildMenu(w !== win).popup({ window: w });
});

function startGaze(): void {
  const last = new Map<number, { x: number; y: number }>();
  setInterval(() => {
    const c = screen.getCursorScreenPoint();
    const { width, height } = windowSize();
    for (const w of allWins()) {
      if (!w.isVisible()) continue;
      const [wx, wy] = w.getPosition();
      // normalized vector from this pet's eyes to the cursor, clamped to unit circle
      let dx = (c.x - (wx + width / 2)) / 400;
      let dy = (c.y - (wy + height * (CY / LOGICAL.h))) / 400;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      // skip the IPC when the cursor hasn't meaningfully moved (the common case)
      const prev = last.get(w.id);
      if (prev && Math.abs(dx - prev.x) < 0.01 && Math.abs(dy - prev.y) < 0.01) continue;
      const v = { x: dx, y: dy };
      last.set(w.id, v);
      w.webContents.send('pet:gaze', v);
    }
  }, 200); // ~5Hz
}

// ---------- wander ----------
//
// 'drift'      — the old behavior: a small sideways shuffle every 30s.
// 'adventure'  — occasional journeys: long walks along the bottom of the
//                screen, climbing a screen corner, and dropping from the top.
// The main process moves the window through phases and sends the renderer a
// PetMotion hint so the pet can lean/stretch/squash to match.

const WALK_SPEED = 220; // px/s
const CLIMB_SPEED = 320; // px/s
const GRAVITY = 3000; // px/s^2
const STEP_MS = 33;

let wanderTimer: ReturnType<typeof setTimeout> | null = null; // schedules the next outing
let adventureTimer: ReturnType<typeof setInterval> | null = null; // per-frame stepper while on one
let adventureWin: BrowserWindow | null = null; // which pet is out adventuring

function randomPet(): BrowserWindow | null {
  const candidates = allWins().filter((w) => !w.isDestroyed() && w.isVisible());
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function setWander(mode: WanderMode): void {
  if (wanderTimer) {
    clearTimeout(wanderTimer);
    wanderTimer = null;
  }
  stopAdventure();
  if (mode === 'drift') wanderTimer = setTimeout(driftLoop, 30000);
  else if (mode === 'adventure') scheduleAdventure(5000); // first outing soon after enabling
}

function scheduleAdventure(delay = 45000 + Math.random() * 75000): void {
  if (wanderTimer) clearTimeout(wanderTimer);
  wanderTimer = setTimeout(startAdventure, delay);
}

function sendMotion(w: BrowserWindow, m: PetMotion | null): void {
  if (!w.isDestroyed()) w.webContents.send('pet:motion', m);
}

function stopAdventure(): void {
  if (adventureTimer) {
    clearInterval(adventureTimer);
    adventureTimer = null;
    if (adventureWin) sendMotion(adventureWin, null);
    adventureWin = null;
  }
}

interface WanderStep {
  kind: 'walk' | 'climb' | 'ceilwalk' | 'pause' | 'fall' | 'land';
  toX?: number;
  toY?: number;
  ms?: number;
  dir?: 1 | -1;
}

function startAdventure(): void {
  if (adventureTimer) return; // already out
  const target = randomPet(); // any pet can be the adventurer
  if (!target || dragTimer || state.resolve().state !== 'idle') {
    if (config.get('wander') === 'adventure') scheduleAdventure(20000); // busy — try again soon
    return;
  }
  const [x, y] = target.getPosition();
  const { width, height } = windowSize();
  const d = screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 }).workArea;
  const b = petBox();
  const groundY = Math.round(d.y + d.height - b.b);
  const minX = Math.round(d.x - b.l);
  const maxX = Math.round(d.x + d.width - b.r);
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  let plan: WanderStep[];
  if (Math.random() < 0.5) {
    // a long stroll in a couple of legs
    plan = [
      { kind: 'walk', toX: rand(minX, maxX) },
      { kind: 'pause', ms: rand(400, 1200) },
      { kind: 'walk', toX: rand(minX, maxX) },
    ];
  } else {
    // climb a screen corner, walk upside-down along the top to the far
    // corner, and only there let go and drop
    const leftSide = Math.random() < 0.5;
    plan = [
      { kind: 'walk', toX: leftSide ? minX : maxX },
      { kind: 'climb', toY: d.y, dir: leftSide ? -1 : 1 },
      { kind: 'pause', ms: rand(600, 1500) },
      { kind: 'ceilwalk', toX: leftSide ? maxX : minX, dir: leftSide ? 1 : -1 },
      { kind: 'pause', ms: rand(300, 800) },
      { kind: 'fall' },
      { kind: 'land', ms: 350 },
      { kind: 'walk', toX: rand(minX + (maxX - minX) * 0.2, maxX - (maxX - minX) * 0.2) },
    ];
  }
  // if the user parked him above the ground (dragging is free-form), get
  // down honestly first instead of teleporting to the bottom on step one
  if (y < groundY - 2) plan.unshift({ kind: 'fall' }, { kind: 'land', ms: 350 });

  if (DEBUG) console.log(`[wander] pet #${allWins().indexOf(target)} plan:`, plan.map((p) => p.kind).join(' -> '));
  runPlan(target, plan, groundY);
}

function runPlan(target: BrowserWindow, plan: WanderStep[], groundY: number): void {
  adventureWin = target;
  let idx = 0;
  let vy = 0; // fall velocity
  let waitLeft = 0; // pause/land countdown
  let lastSent = '';

  const setMode = (m: PetMotion | null) => {
    const key = m ? m.mode + m.dir : 'null';
    if (key === lastSent) return;
    lastSent = key;
    if (DEBUG && !target.isDestroyed()) console.log('[wander]', key, 'at', target.getPosition().join(','));
    sendMotion(target, m);
  };

  const finish = () => {
    stopAdventure();
    persistPos(target);
    if (config.get('wander') === 'adventure') scheduleAdventure();
  };

  adventureTimer = setInterval(() => {
    try {
      stepFrame();
    } catch (e) {
      // never let a wander bug take down the app (or spam dialogs) —
      // abandon the outing where he stands
      console.error('[wander] aborted:', e);
      finish();
    }
  }, STEP_MS);

  function stepFrame(): void {
    if (target.isDestroyed() || !target.isVisible() || dragTimer) {
      finish();
      return;
    }
    const step = plan[idx];
    if (!step) {
      finish();
      return;
    }
    const [wx, wy] = target.getPosition();
    // a session needs him: cut the outing short (but never freeze mid-air —
    // if he's off the ground, swap the rest of the plan for a quick drop)
    if (state.resolve().state !== 'idle' && step.kind !== 'fall' && step.kind !== 'land') {
      if (wy < groundY - 2) {
        plan = [{ kind: 'fall' }, { kind: 'land', ms: 350 }];
        idx = 0;
        vy = 0;
      } else {
        finish();
      }
      return;
    }
    const dt = STEP_MS / 1000;
    switch (step.kind) {
      case 'walk': {
        const dir: 1 | -1 = step.toX! > wx ? 1 : -1;
        const nx = wx + dir * WALK_SPEED * dt;
        const arrived = dir > 0 ? nx >= step.toX! : nx <= step.toX!;
        target.setPosition(Math.round(arrived ? step.toX! : nx), groundY);
        setMode({ mode: 'walk', dir });
        if (arrived) idx++;
        break;
      }
      case 'climb': {
        const ny = wy - CLIMB_SPEED * dt;
        const arrived = ny <= step.toY!;
        target.setPosition(wx, Math.round(arrived ? step.toY! : ny));
        setMode({ mode: 'climb', dir: step.dir! });
        if (arrived) idx++;
        break;
      }
      case 'ceilwalk': {
        // hand-over-hand along the top edge; y stays pinned to the ceiling
        const dir = step.dir!;
        const nx = wx + dir * WALK_SPEED * dt;
        const arrived = dir > 0 ? nx >= step.toX! : nx <= step.toX!;
        target.setPosition(Math.round(arrived ? step.toX! : nx), wy);
        setMode({ mode: 'ceiling', dir });
        if (arrived) idx++;
        break;
      }
      case 'pause': {
        setMode(null); // just perching
        if (waitLeft === 0) waitLeft = step.ms!;
        waitLeft -= STEP_MS;
        if (waitLeft <= 0) {
          waitLeft = 0;
          idx++;
        }
        break;
      }
      case 'fall': {
        vy += GRAVITY * dt;
        const ny = wy + vy * dt;
        const landed = ny >= groundY;
        target.setPosition(wx, Math.round(landed ? groundY : ny));
        setMode({ mode: 'fall', dir: 1 });
        if (landed) {
          vy = 0;
          idx++;
        }
        break;
      }
      case 'land': {
        setMode({ mode: 'land', dir: 1 });
        if (waitLeft === 0) waitLeft = step.ms!;
        waitLeft -= STEP_MS;
        if (waitLeft <= 0) {
          waitLeft = 0;
          idx++;
        }
        break;
      }
    }
  }
}

// the old subtle behavior: a small eased shuffle, rescheduled while enabled
function driftLoop(): void {
  driftStep();
  if (config.get('wander') === 'drift') wanderTimer = setTimeout(driftLoop, 30000);
}

function driftStep(): void {
  const w = randomPet();
  if (!w || dragTimer) return;
  if (state.resolve().state !== 'idle') return;
  const [x, y] = w.getPosition();
  const target = clampToWorkArea(x + (Math.random() * 80 - 40), y);
  // drift over ~2s at 60Hz-ish
  let step = 0;
  const steps = 60;
  const sx = x;
  const drift = setInterval(() => {
    step += 1;
    if (step >= steps || dragTimer || w.isDestroyed()) {
      clearInterval(drift);
      return;
    }
    const t = step / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    w.setPosition(Math.round(sx + (target.x - sx) * ease), y);
  }, 33);
}

// ---------- app lifecycle ----------

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();

  config = new ConfigStore(app.getPath('userData'));
  state = new PetState({
    projectFilter: config.get('projectFilter'),
    onChange: (resolved) => {
      for (const w of allWins()) w.webContents.send('pet:state', resolved);
    },
  });
  setInterval(() => state.tick(), 1000);

  try {
    await startHookServer({
      port: PORT,
      state,
      onTestState: forceTestState,
      onSnapshot: (i) => (allWins()[i] ?? win!).webContents.capturePage().then((img) => img.toPNG()),
      onWander: () => startAdventure(),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    dialog.showErrorBox(
      'claude-pet: port in use',
      `Could not listen on 127.0.0.1:${PORT} (${err.code || err.message}).\n\n` +
        `Most likely another claude-pet instance is running. The port is fixed because ` +
        `~/.claude/settings.json hard-codes it; quit the other instance or set CLAUDE_PET_PORT everywhere.`
    );
    app.quit();
    return;
  }

  tray = new Tray(trayIcon());
  tray.setToolTip('claude-pet');
  const popupMenu = () => buildMenu().popup();
  tray.on('click', popupMenu);
  tray.on('right-click', popupMenu);

  createWindow();
  setPetCount(config.get('petCount'));
  startGaze();
  setWander(config.get('wander'));

  // laptop undocked etc: if our saved spot vanished, snap back to the default corner
  const ensureVisible = () => {
    for (const w of allWins()) {
      const [x, y] = w.getPosition();
      if (positionIsVisible({ x, y })) continue;
      if (w === win) moveTo(defaultPosition());
      else {
        const p = offsetFromPrimary(extraWins.indexOf(w));
        w.setPosition(p.x, p.y);
      }
    }
  };
  screen.on('display-removed', ensureVisible);
  screen.on('display-metrics-changed', ensureVisible);
});

app.on('window-all-closed', () => app.quit());
