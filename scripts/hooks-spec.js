// Single source of truth for which Claude Code hook events drive the pet.
// Shared by install-hooks.js, uninstall-hooks.js, and the tests.
// Plain JS on purpose — the scripts stay runnable with zero toolchain.
//
// SAFETY: these are plain http handlers with a 5s timeout. The pet's server
// always answers a bare 200 {} and can never return a permission decision.
// PermissionRequest is deliberately NOT hooked — Notification/permission_prompt
// gives the same "needs you" signal with zero contact with the permission flow.

// Keep in sync with resolvePort in src/config.ts (duplicated so the scripts
// don't depend on the TypeScript sources).
export function resolvePort(env = process.env) {
  const p = parseInt(env.CLAUDE_PET_PORT || '', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 47821;
}

export const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
];

export const hookUrl = (port) => `http://127.0.0.1:${port}/hook`;
export const handler = (port) => ({ type: 'http', url: hookUrl(port), timeout: 5 });

export function isOurs(h, port) {
  return !!h && h.type === 'http' && h.url === hookUrl(port);
}

// Pure merge: returns { settings, added } — never mutates the input.
export function mergeHooks(settings, port) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  out.hooks = out.hooks || {};
  const added = [];
  for (const event of EVENTS) {
    const groups = (out.hooks[event] = out.hooks[event] || []);
    const already = groups.some((g) => Array.isArray(g.hooks) && g.hooks.some((h) => isOurs(h, port)));
    if (already) continue;
    let star = groups.find((g) => g.matcher === '*' || g.matcher === undefined);
    if (!star) {
      star = { matcher: '*', hooks: [] };
      groups.push(star);
    }
    star.hooks = star.hooks || [];
    star.hooks.push(handler(port));
    added.push(event);
  }
  return { settings: out, added };
}

// Pure removal: strips our handlers, prunes emptied groups/arrays/keys.
export function removeHooks(settings, port) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  const removed = [];
  if (!out.hooks) return { settings: out, removed };
  for (const event of Object.keys(out.hooks)) {
    const groups = out.hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!Array.isArray(g.hooks)) continue;
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h) => !isOurs(h, port));
      if (g.hooks.length !== before) removed.push(event);
    }
    out.hooks[event] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (out.hooks[event].length === 0) delete out.hooks[event];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return { settings: out, removed };
}

// ---------- shared CLI plumbing for install-hooks.js / uninstall-hooks.js ----------

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Parses the common flags: --dry-run and --settings <file> (tests use the latter).
export function parseCliArgs(argv) {
  const si = argv.indexOf('--settings');
  return {
    dryRun: argv.includes('--dry-run'),
    file: si !== -1 ? argv[si + 1] : path.join(os.homedir(), '.claude', 'settings.json'),
  };
}

// Reads and parses the settings file; exits rather than risk clobbering a file
// we can't faithfully rewrite. `raw` is kept for trailing-newline preservation.
export function loadSettings(file, { missingOk = false } = {}) {
  if (!fs.existsSync(file)) {
    if (missingOk) return { raw: '{}\n', settings: {} };
    console.log(`${file} does not exist — nothing to do`);
    process.exit(0);
  }
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return { raw, settings: JSON.parse(raw) };
  } catch (e) {
    console.error(`refusing to touch ${file}: it does not parse as JSON (${e.message})`);
    process.exit(1);
  }
}

// Serializes with the file's original trailing-newline style.
export function renderSettings(settings, raw) {
  return JSON.stringify(settings, null, 2) + (raw.endsWith('\n') ? '\n' : '');
}

// Writes atomically (tmp file + rename).
export function writeSettingsAtomic(file, settings, raw) {
  const tmp = file + '.claude-pet-tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, renderSettings(settings, raw));
  fs.renameSync(tmp, file);
}

// Copies the file to a timestamped sibling; returns the backup path, or null
// when there was nothing to back up.
export function backupSettings(file) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.claude-pet-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  return backup;
}
