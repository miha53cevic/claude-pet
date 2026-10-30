#!/usr/bin/env node
// Merges the pet's http hooks into ~/.claude/settings.json.
//   node scripts/install-hooks.js --dry-run     # print what would change, write nothing
//   node scripts/install-hooks.js               # backup, then write
//   node scripts/install-hooks.js --settings X  # operate on a different file (tests)
import * as fs from 'node:fs';
import { resolvePort, mergeHooks, parseCliArgs, loadSettings, writeSettingsAtomic, renderSettings } from './hooks-spec.js';

const { dryRun, file } = parseCliArgs(process.argv.slice(2));
const port = resolvePort();
const { raw, settings } = loadSettings(file, { missingOk: true });

const { settings: next, added } = mergeHooks(settings, port);

if (added.length === 0) {
  console.log(`already installed (port ${port}) — nothing to do`);
} else if (dryRun) {
  console.log(`--dry-run: would add hooks for: ${added.join(', ')}`);
  console.log(`--dry-run: resulting ${file}:\n`);
  console.log(renderSettings(next, raw));
} else {
  if (fs.existsSync(file)) {
    const backup = `${file}.claude-pet-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
    console.log(`backed up ${file} -> ${backup}`);
  }
  writeSettingsAtomic(file, next, raw);
  console.log(`installed hooks for: ${added.join(', ')} (port ${port})`);
  console.log('run `npm run uninstall-hooks` to revert.');
}
