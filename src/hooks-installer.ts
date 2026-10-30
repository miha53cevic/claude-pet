// In-app hook install/uninstall so the packaged .app is self-contained.
// The pure merge/remove logic stays in scripts/hooks-spec.js (the single
// canonical implementation, shared with the CLI and tests); this module
// dynamically imports it — the packager ships that one file inside the asar.
// SAFETY: nothing here runs without an explicit confirmation dialog, a
// timestamped backup precedes every write, and an unparseable settings.json
// is never touched.
import { app, dialog } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

interface HookHandlerish {
  type?: string;
  url?: string;
}

interface HooksSpec {
  EVENTS: readonly string[];
  mergeHooks(settings: object, port: number): { settings: object; added: string[] };
  removeHooks(settings: object, port: number): { settings: object; removed: string[] };
  writeSettingsAtomic(file: string, settings: object, raw: string): void;
}

let specPromise: Promise<HooksSpec> | null = null;
function spec(): Promise<HooksSpec> {
  specPromise ??= import(
    pathToFileURL(path.join(app.getAppPath(), 'scripts', 'hooks-spec.js')).href
  ) as Promise<HooksSpec>;
  return specPromise;
}

const settingsFile = () => path.join(os.homedir(), '.claude', 'settings.json');

/** Cheap sync check for menu state: how many of our handlers are installed? */
export function hooksStatusSync(port: number): { installed: boolean; count: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as {
      hooks?: Record<string, Array<{ hooks?: HookHandlerish[] }>>;
    };
    const url = `http://127.0.0.1:${port}/hook`;
    let count = 0;
    for (const groups of Object.values(parsed.hooks ?? {})) {
      for (const g of groups ?? []) {
        for (const h of g.hooks ?? []) if (h.type === 'http' && h.url === url) count++;
      }
    }
    return { installed: count > 0, count };
  } catch {
    return { installed: false, count: 0 };
  }
}

function readSettings(): { raw: string; settings: object } | null {
  const file = settingsFile();
  let raw = '{}\n';
  if (fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
  try {
    return { raw, settings: JSON.parse(raw) as object };
  } catch (e) {
    dialog.showErrorBox(
      'claude-pet: cannot touch settings',
      `${file} does not parse as JSON (${(e as Error).message}) — refusing to modify it.`
    );
    return null;
  }
}

function backup(): void {
  const file = settingsFile();
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.claude-pet-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
}

export async function installHooks(port: number): Promise<void> {
  const s = await spec();
  const loaded = readSettings();
  if (!loaded) return;
  const { settings: next, added } = s.mergeHooks(loaded.settings, port);
  if (added.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Hooks already installed',
      detail: `All ${s.EVENTS.length} events already report to 127.0.0.1:${port}. Sessions started after installation feed the pet automatically.`,
    });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Install Claude Code hooks?',
    detail:
      `Adds ${added.length} http hook entr${added.length === 1 ? 'y' : 'ies'} to ~/.claude/settings.json, ` +
      `each pointing at http://127.0.0.1:${port}/hook with a 5s timeout.\n\n` +
      `A timestamped backup of the file is written first. The pet only listens — it can never ` +
      `block a tool, answer a permission, or alter a session. Only Claude Code sessions started ` +
      `after installing will report in.\n\nEvents: ${added.join(', ')}`,
  });
  if (response !== 0) return;
  try {
    backup();
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    s.writeSettingsAtomic(settingsFile(), next, loaded.raw);
    await dialog.showMessageBox({
      type: 'info',
      message: 'Hooks installed',
      detail: `Added: ${added.join(', ')}.\n\nStart a new Claude Code session anywhere and the pet will react.`,
    });
  } catch (e) {
    dialog.showErrorBox('claude-pet: install failed', String(e));
  }
}

export async function uninstallHooks(port: number): Promise<void> {
  const s = await spec();
  const loaded = readSettings();
  if (!loaded) return;
  const { settings: next, removed } = s.removeHooks(loaded.settings, port);
  if (removed.length === 0) {
    await dialog.showMessageBox({ type: 'info', message: 'No claude-pet hooks found', detail: 'Nothing to remove.' });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Remove Claude Code hooks?',
    detail: `Removes the pet's ${removed.length} http hook entr${removed.length === 1 ? 'y' : 'ies'} from ~/.claude/settings.json (backup written first). Claude Code itself is unaffected.`,
  });
  if (response !== 0) return;
  try {
    backup();
    s.writeSettingsAtomic(settingsFile(), next, loaded.raw);
    await dialog.showMessageBox({ type: 'info', message: 'Hooks removed', detail: `Removed: ${removed.join(', ')}.` });
  } catch (e) {
    dialog.showErrorBox('claude-pet: uninstall failed', String(e));
  }
}
