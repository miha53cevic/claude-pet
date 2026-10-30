import test from 'node:test';
import * as assert from 'node:assert';
import { PetState, DONE_MS, FAILED_FLASH_MS, WORKING_STALE_MS, EVICT_MS, SLEEP_AFTER_MS, URGENCY_1_MS, URGENCY_2_MS } from '../src/state.ts';
import type { PetStateOptions } from '../src/state.ts';

function makeState(opts: PetStateOptions = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const changes: PetResolvedState[] = [];
  const state = new PetState({ now: clock.now, onChange: (s) => changes.push(s), ...opts });
  return { state, clock, changes };
}

const evt = (event: string, extra: Partial<PetEvent> = {}): PetEvent => ({
  event,
  session_id: 's1',
  cwd: '/repo/project-a',
  ...extra,
});

test('prompt submit -> working, stop -> done -> idle after decay', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('SessionStart'));
  state.applyEvent(evt('UserPromptSubmit'));
  assert.equal(state.resolve().state, 'working');
  state.applyEvent(evt('Stop'));
  assert.equal(state.resolve().state, 'done');
  clock.advance(DONE_MS + 1);
  state.tick();
  assert.equal(state.resolve().state, 'idle');
});

test('priority: waiting beats working across sessions', () => {
  const { state } = makeState();
  state.applyEvent(evt('UserPromptSubmit', { session_id: 'a', cwd: '/repo/a' }));
  state.applyEvent(evt('Notification', { session_id: 'b', cwd: '/repo/b', notification_type: 'permission_prompt' }));
  const r = state.resolve();
  assert.equal(r.state, 'waiting');
  assert.equal(r.sessions.length, 2);
});

test('tool flavor from PreToolUse', () => {
  const { state } = makeState();
  state.applyEvent(evt('PreToolUse', { tool_name: 'Bash' }));
  assert.equal(state.resolve().flavor, 'bash');
  state.applyEvent(evt('PreToolUse', { tool_name: 'Grep' }));
  assert.equal(state.resolve().flavor, 'search');
  state.applyEvent(evt('PreToolUse', { tool_name: 'Edit' }));
  assert.equal(state.resolve().flavor, 'edit');
  state.applyEvent(evt('PreToolUse', { tool_name: 'WebSearch' }));
  assert.equal(state.resolve().flavor, 'web');
  state.applyEvent(evt('PreToolUse', { tool_name: 'SomethingElse' }));
  assert.equal(state.resolve().flavor, 'generic');
});

test('tool failure flashes failed then returns to working', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('PreToolUse', { tool_name: 'Bash' }));
  state.applyEvent(evt('PostToolUseFailure'));
  assert.equal(state.resolve().state, 'failed');
  clock.advance(FAILED_FLASH_MS + 1);
  state.tick();
  assert.equal(state.resolve().state, 'working');
});

test('StopFailure is sticky until next event', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('StopFailure'));
  clock.advance(60_000);
  state.tick();
  assert.equal(state.resolve().state, 'failed');
  state.applyEvent(evt('UserPromptSubmit'));
  assert.equal(state.resolve().state, 'working');
});

test('stale working decays to idle; silent session evicted; long quiet -> sleeping', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('UserPromptSubmit'));
  clock.advance(WORKING_STALE_MS + 1);
  state.tick();
  assert.equal(state.resolve().state, 'idle');
  clock.advance(EVICT_MS + 1);
  state.tick();
  assert.equal(state.resolve().sessions.length, 0);
  clock.advance(SLEEP_AFTER_MS + 1);
  state.tick();
  assert.equal(state.resolve().state, 'sleeping');
});

test('SessionEnd unregisters; unknown events change nothing', () => {
  const { state } = makeState();
  state.applyEvent(evt('SessionStart'));
  state.applyEvent(evt('TotallyUnknownEvent'));
  assert.equal(state.resolve().sessions.length, 1);
  state.applyEvent(evt('SessionEnd'));
  assert.equal(state.resolve().sessions.length, 0);
});

test('subagent counting across sessions, never negative', () => {
  const { state } = makeState();
  state.applyEvent(evt('SubagentStart', { session_id: 'a' }));
  state.applyEvent(evt('SubagentStart', { session_id: 'b' }));
  assert.equal(state.resolve().subagents, 2);
  state.applyEvent(evt('SubagentStop', { session_id: 'a' }));
  state.applyEvent(evt('SubagentStop', { session_id: 'a' }));
  assert.equal(state.resolve().subagents, 1);
});

test('projectFilter ignores sessions outside the prefix', () => {
  const { state } = makeState({ projectFilter: '/repo/inside' });
  state.applyEvent(evt('UserPromptSubmit', { cwd: '/repo/outside/x' }));
  assert.equal(state.resolve().sessions.length, 0);
  state.applyEvent(evt('UserPromptSubmit', { session_id: 's2', cwd: '/repo/inside/x' }));
  assert.equal(state.resolve().state, 'working');
});

test('ring buffer caps at 50 events', () => {
  const { state } = makeState();
  for (let i = 0; i < 60; i++) state.applyEvent(evt('UserPromptSubmit'));
  assert.equal(state.events.length, 50);
});

test('onChange fires on change, not on identical snapshots', () => {
  const { state, clock, changes } = makeState();
  state.applyEvent(evt('UserPromptSubmit'));
  clock.advance(200);
  state.applyEvent(evt('UserPromptSubmit')); // same resolved snapshot
  clock.advance(200);
  state.tick();
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.state, 'working');
});

test('compaction is a working flavor, cleared by PostCompact', () => {
  const { state } = makeState();
  state.applyEvent(evt('PreCompact'));
  assert.equal(state.resolve().state, 'working');
  assert.equal(state.resolve().flavor, 'compact');
  state.applyEvent(evt('PostCompact'));
  assert.equal(state.resolve().flavor, 'generic');
});

test('frazzle counts consecutive failures, resets on new prompt, caps at 5', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('UserPromptSubmit'));
  for (let i = 0; i < 3; i++) state.applyEvent(evt('PostToolUseFailure'));
  assert.equal(state.resolve().frazzle, 3);
  clock.advance(FAILED_FLASH_MS + 1);
  state.tick(); // back to working, streak survives the flash
  assert.equal(state.resolve().frazzle, 3);
  for (let i = 0; i < 4; i++) state.applyEvent(evt('PostToolUseFailure'));
  assert.equal(state.resolve().frazzle, 5); // capped
  state.applyEvent(evt('UserPromptSubmit'));
  assert.equal(state.resolve().frazzle, 0);
});

test('waiting urgency escalates over time and resets when answered', () => {
  const { state, clock } = makeState();
  state.applyEvent(evt('Notification', { notification_type: 'permission_prompt' }));
  assert.equal(state.resolve().urgency, 0);
  clock.advance(URGENCY_1_MS + 1000);
  state.tick();
  assert.equal(state.resolve().urgency, 1);
  // repeated notifications must not refresh the clock
  state.applyEvent(evt('Notification', { notification_type: 'permission_prompt' }));
  assert.equal(state.resolve().urgency, 1);
  clock.advance(URGENCY_2_MS - URGENCY_1_MS);
  state.tick();
  assert.equal(state.resolve().urgency, 2);
  state.applyEvent(evt('UserPromptSubmit')); // answered
  assert.equal(state.resolve().urgency, 0);
  assert.equal(state.resolve().state, 'working');
});
