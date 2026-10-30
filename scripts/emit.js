#!/usr/bin/env node
// Dev tool: POST synthetic hook payloads to the running pet.
//   npm run emit -- waiting|working|done|failed|idle|sleeping|subagent|end
import * as http from 'node:http';
import { resolvePort } from './hooks-spec.js';

const PORT = resolvePort();
const SID = 'emit-test-session';
const CWD = '/tmp/emit-test/fake-project';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const hook = (event, extra = {}) => post('/hook', { hook_event_name: event, session_id: SID, cwd: CWD, ...extra });

const SCENARIOS = {
  idle: () => hook('SessionStart'),
  working: async () => {
    await hook('SessionStart');
    await hook('UserPromptSubmit');
    await hook('PreToolUse', { tool_name: 'Bash' });
  },
  waiting: async () => {
    await hook('SessionStart');
    await hook('Notification', { notification_type: 'permission_prompt' });
  },
  done: async () => {
    await hook('SessionStart');
    await hook('Stop');
  },
  failed: async () => {
    await hook('SessionStart');
    await hook('StopFailure');
  },
  subagent: async () => {
    await hook('SessionStart');
    await hook('UserPromptSubmit');
    await hook('SubagentStart');
    await hook('SubagentStart');
  },
  compact: async () => {
    await hook('SessionStart');
    await hook('UserPromptSubmit');
    await hook('PreCompact');
  },
  frazzled: async () => {
    await hook('SessionStart');
    await hook('UserPromptSubmit');
    await hook('PreToolUse', { tool_name: 'Bash' });
    await hook('PostToolUseFailure');
    await hook('PostToolUseFailure');
    await hook('PostToolUseFailure');
  },
  end: () => hook('SessionEnd'),
  // sleeping needs 15min of silence in real life; use the debug override instead
  sleeping: () => post('/test-state', { state: 'sleeping' }),
  // send him on an adventure right now (wander mode need not be enabled)
  wander: () => post('/wander', {}),
};

const name = process.argv[2];
if (!name || !SCENARIOS[name]) {
  console.error(`usage: npm run emit -- <${Object.keys(SCENARIOS).join('|')}>`);
  process.exit(1);
}
SCENARIOS[name]()
  .then(() => console.log(`emitted: ${name}`))
  .catch((e) => {
    console.error(`could not reach the pet on 127.0.0.1:${PORT} — is it running? (${e.message})`);
    process.exit(1);
  });
