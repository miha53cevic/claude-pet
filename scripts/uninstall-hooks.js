#!/usr/bin/env node
// Removes the pet's http hooks from ~/.claude/settings.json.
//   node scripts/uninstall-hooks.js [--dry-run] [--settings X]   # backs up first, like install
import { resolvePort, removeHooks, parseCliArgs, loadSettings, writeSettingsAtomic, renderSettings, backupSettings } from './hooks-spec.js';

const { dryRun, file } = parseCliArgs(process.argv.slice(2));
const port = resolvePort();
const { raw, settings } = loadSettings(file);

const { settings: next, removed } = removeHooks(settings, port);

if (removed.length === 0) {
  console.log(`no claude-pet hooks found (port ${port}) — nothing to do`);
} else if (dryRun) {
  console.log(`--dry-run: would remove hooks for: ${removed.join(', ')}`);
  console.log(`--dry-run: resulting ${file}:\n`);
  console.log(renderSettings(next, raw));
} else {
  console.log(`backed up ${file} -> ${backupSettings(file)}`);
  writeSettingsAtomic(file, next, raw);
  console.log(`removed hooks for: ${removed.join(', ')}`);
}
