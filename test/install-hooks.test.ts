import test from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EVENTS, mergeHooks, removeHooks, hookUrl, resolvePort } from '../scripts/hooks-spec.js';
import type { ClaudeSettings } from '../scripts/hooks-spec.js';

const PORT = resolvePort({}); // the default port, without hardcoding it a third time
const SCRIPTS = path.join(import.meta.dirname, '..', 'scripts');

test('merge into empty settings adds every event under matcher "*"', () => {
  const { settings, added } = mergeHooks({}, PORT);
  assert.deepEqual(added, [...EVENTS]);
  for (const e of EVENTS) {
    const groups = settings.hooks![e]!;
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.matcher, '*');
    assert.equal(groups[0]!.hooks!.length, 1);
    assert.deepEqual(groups[0]!.hooks![0], { type: 'http', url: hookUrl(PORT), timeout: 5 });
  }
});

test('merge preserves unrelated hooks and is idempotent', () => {
  const original: ClaudeSettings = {
    model: 'claude-opus-4-8',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'notify.sh' }] }],
    },
  };
  const once = mergeHooks(original, PORT).settings;
  // unrelated hooks untouched
  assert.deepEqual(once.hooks!.PreToolUse![0], original.hooks!.PreToolUse![0]);
  assert.equal(once.hooks!.Stop![0]!.hooks![0]!.command, 'notify.sh');
  // ours appended to the existing "*" group for Stop, new group for PreToolUse
  assert.equal(once.hooks!.Stop![0]!.hooks!.length, 2);
  assert.equal(once.hooks!.PreToolUse!.length, 2);
  // idempotent
  const twice = mergeHooks(once, PORT);
  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.settings, once);
  // input not mutated
  assert.equal(original.hooks!.Stop![0]!.hooks!.length, 1);
});

test('install -> uninstall round-trips to the original object', () => {
  const original: ClaudeSettings = {
    permissions: { defaultMode: 'plan' },
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'notify.sh' }] }] },
  };
  const merged = mergeHooks(original, PORT).settings;
  const { settings: restored, removed } = removeHooks(merged, PORT);
  assert.ok(removed.length > 0);
  assert.deepEqual(restored, original);
});

test('uninstall drops emptied groups, arrays, and the hooks key itself', () => {
  const merged = mergeHooks({ model: 'x' }, PORT).settings;
  const { settings: restored } = removeHooks(merged, PORT);
  assert.deepEqual(restored, { model: 'x' });
});

test('removeHooks only touches our port', () => {
  const settings = mergeHooks({}, 9999).settings;
  const { settings: after, removed } = removeHooks(settings, PORT);
  assert.deepEqual(removed, []);
  assert.deepEqual(after, settings);
});

// ---- CLI end-to-end on a temp file ----

function run(script: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI: install then uninstall restores byte-identical content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-test-'));
  const file = path.join(dir, 'settings.json');
  const originalContent =
    JSON.stringify({ permissions: { defaultMode: 'plan' }, model: 'claude-opus-4-8' }, null, 2) + '\n';
  fs.writeFileSync(file, originalContent);

  run('install-hooks.js', ['--settings', file]);
  const installed = JSON.parse(fs.readFileSync(file, 'utf8')) as ClaudeSettings;
  assert.ok(installed.hooks && installed.hooks.Stop);
  // a backup was created
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('claude-pet-backup')));

  // second install is a no-op
  const out = run('install-hooks.js', ['--settings', file]);
  assert.match(out, /already installed/);

  run('uninstall-hooks.js', ['--settings', file]);
  assert.equal(fs.readFileSync(file, 'utf8'), originalContent);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: --dry-run writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-test-'));
  const file = path.join(dir, 'settings.json');
  const content = '{}\n';
  fs.writeFileSync(file, content);
  const out = run('install-hooks.js', ['--dry-run', '--settings', file]);
  assert.match(out, /would add hooks/);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(fs.readdirSync(dir).length, 1); // no backup created
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: refuses to touch a file that does not parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-test-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => run('install-hooks.js', ['--settings', file]));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: CLAUDE_PET_PORT is honored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-test-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{}\n');
  run('install-hooks.js', ['--settings', file], { CLAUDE_PET_PORT: '50505' });
  const installed = JSON.parse(fs.readFileSync(file, 'utf8')) as ClaudeSettings;
  assert.equal(installed.hooks!.Stop![0]!.hooks![0]!.url, 'http://127.0.0.1:50505/hook');
  fs.rmSync(dir, { recursive: true, force: true });
});
