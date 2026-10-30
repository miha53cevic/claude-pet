// Session registry + state resolution. Pure logic, no Electron imports,
// so test/state.test.ts can drive it with a fake clock.

const PRIORITY: PetStateName[] = ['waiting', 'failed', 'working', 'done', 'idle'];

export const DONE_MS = 2500; // celebration length
export const FAILED_FLASH_MS = 1500; // PostToolUseFailure blip, then back to working
export const WORKING_STALE_MS = 3 * 60 * 1000; // silent "working" decays to idle
export const EVICT_MS = 60 * 60 * 1000; // silent session is forgotten entirely
export const SLEEP_AFTER_MS = 15 * 60 * 1000; // everything idle this long -> sleeping
export const OVERRIDE_MS = 8000; // how long a menu/debug test state is shown
export const URGENCY_1_MS = 60 * 1000; // a minute of ignored waiting -> insistent
export const URGENCY_2_MS = 180 * 1000; // three minutes -> frantic
const FRAZZLE_CAP = 5;
const EMIT_MIN_INTERVAL_MS = 100; // coalesce renderer updates to <=10/sec

const TOOL_FLAVORS: Record<string, string> = {
  Bash: 'bash',
  Read: 'search',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebFetch: 'web',
  WebSearch: 'web',
  '(compacting)': 'compact', // pseudo-tool set by PreCompact
};

interface SessionRec {
  state: PetStateName;
  cwd: string;
  /** last tool name while working; the notification type while waiting */
  tool: string | null;
  subagents: number;
  lastTs: number;
  until: number;
  /** consecutive PostToolUseFailure count this turn */
  failStreak: number;
  /** when the session entered waiting (0 = not waiting) */
  waitingSince: number;
}

export interface PetStateOptions {
  now?: () => number;
  onChange?: ((resolved: PetResolvedState) => void) | null;
  projectFilter?: string | null;
}

export class PetState {
  readonly sessions = new Map<string, SessionRec>();
  /** ring buffer of the last 50 normalized events */
  readonly events: Array<PetEvent & { ts: number }> = [];

  private now: () => number;
  private onChange: ((resolved: PetResolvedState) => void) | null;
  private projectFilter: string | null;
  private lastActivity: number;
  private override: { state: PetStateName; until: number } | null = null;
  private _lastEmit = 0;
  private _lastSnapshot = '';
  private _lastEmittedState = '';
  private _emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ now = () => Date.now(), onChange = null, projectFilter = null }: PetStateOptions = {}) {
    this.now = now;
    this.onChange = onChange;
    this.projectFilter = projectFilter;
    this.lastActivity = now();
  }

  applyEvent(evt: PetEvent): void {
    if (!evt || typeof evt.event !== 'string') return;
    const t = this.now();
    this.events.push({ ...evt, ts: t });
    if (this.events.length > 50) this.events.shift();

    const id = evt.session_id || 'unknown';
    if (this.projectFilter && evt.cwd && !evt.cwd.startsWith(this.projectFilter)) return;

    let s = this.sessions.get(id);
    if (!s && evt.event !== 'SessionEnd') {
      s = { state: 'idle', cwd: '', tool: null, subagents: 0, lastTs: t, until: 0, failStreak: 0, waitingSince: 0 };
      this.sessions.set(id, s);
    }
    if (!s) return;
    s.lastTs = t;
    if (evt.cwd) s.cwd = evt.cwd;

    switch (evt.event) {
      case 'SessionStart':
        s.state = 'idle';
        s.failStreak = 0;
        break;
      case 'UserPromptSubmit':
        s.state = 'working';
        s.tool = null;
        s.failStreak = 0;
        break;
      case 'PreToolUse':
        s.state = 'working';
        s.tool = evt.tool_name || null;
        break;
      case 'PostToolUseFailure':
        s.state = 'failed';
        s.until = t + FAILED_FLASH_MS;
        s.failStreak += 1;
        break;
      case 'Notification':
        if (evt.notification_type === 'permission_prompt' || evt.notification_type === 'idle_prompt') {
          if (s.state !== 'waiting') s.waitingSince = t; // don't refresh on repeats
          s.state = 'waiting';
          s.tool = evt.notification_type;
        }
        break;
      case 'Stop':
        s.state = 'done';
        s.until = t + DONE_MS;
        s.tool = null;
        s.failStreak = 0;
        break;
      case 'StopFailure':
        s.state = 'failed';
        s.until = 0; // sticky until next event
        break;
      case 'SessionEnd':
        this.sessions.delete(id);
        break;
      case 'SubagentStart':
        s.subagents += 1;
        break;
      case 'SubagentStop':
        s.subagents = Math.max(0, s.subagents - 1);
        break;
      case 'PreCompact':
        s.state = 'working';
        s.tool = '(compacting)'; // tooltip reads "working — (compacting)"
        break;
      case 'PostCompact':
        s.state = 'working';
        s.tool = null;
        break;
      default:
        return; // unknown event: recorded in ring buffer, no state change
    }
    if (s.state !== 'waiting') s.waitingSince = 0;
    this.lastActivity = t;
    this._maybeEmit();
  }

  /** Force a state for OVERRIDE_MS — the "Test state" menu and POST /test-state. */
  setOverride(state: PetStateName): void {
    this.override = { state, until: this.now() + OVERRIDE_MS };
    this._maybeEmit();
  }

  /** Called periodically (main runs this at 1Hz) to expire timed states. */
  tick(): void {
    const t = this.now();
    if (this.override && t >= this.override.until) this.override = null;

    if (!this.override && this.sessions.size === 0) {
      // Nothing can change except the sleeping flip; skip the resolve+stringify
      // that _maybeEmit would do. This is the all-day idle path.
      const want: PetStateName = t - this.lastActivity > SLEEP_AFTER_MS ? 'sleeping' : 'idle';
      if (want === this._lastEmittedState) return;
    }

    for (const [id, s] of this.sessions) {
      if (t - s.lastTs > EVICT_MS) {
        this.sessions.delete(id);
        continue;
      }
      if (s.until && t >= s.until) {
        // Only Stop (done -> idle) and the PostToolUseFailure flash
        // (failed -> working) ever set `until`.
        s.state = s.state === 'done' ? 'idle' : 'working';
        s.until = 0;
      }
      if (s.state === 'working' && t - s.lastTs > WORKING_STALE_MS) {
        s.state = 'idle';
      }
    }
    this._maybeEmit();
  }

  resolve(): PetResolvedState {
    const live = [...this.sessions.values()];
    const subagents = live.reduce((n, s) => n + s.subagents, 0);
    const sessions = live.map((s) => this.sessionInfo(s));
    const frazzle = Math.min(FRAZZLE_CAP, Math.max(0, ...live.map((s) => s.failStreak)));

    if (this.override && this.now() < this.override.until) {
      return { state: this.override.state, flavor: null, frazzle: 0, urgency: 0, subagents, sessions };
    }

    const state =
      PRIORITY.find((p) => live.some((s) => s.state === p)) ??
      (this.now() - this.lastActivity > SLEEP_AFTER_MS ? 'sleeping' : 'idle');
    const top = live.find((s) => s.state === state);

    // escalate with the longest-ignored waiting session
    let urgency = 0;
    if (state === 'waiting') {
      const stamps = live.filter((s) => s.state === 'waiting' && s.waitingSince > 0).map((s) => s.waitingSince);
      if (stamps.length) {
        const waited = this.now() - Math.min(...stamps);
        urgency = waited > URGENCY_2_MS ? 2 : waited > URGENCY_1_MS ? 1 : 0;
      }
    }

    return { state, flavor: this.flavorOf(state, top?.tool ?? null), frazzle, urgency, subagents, sessions };
  }

  private sessionInfo(s: SessionRec): PetSessionInfo {
    return {
      name: (s.cwd || '').split('/').filter(Boolean).pop() || 'session',
      cwd: s.cwd,
      state: s.state,
      tool: s.tool,
    };
  }

  private flavorOf(state: PetStateName, tool: string | null): string | null {
    if (state === 'working') return (tool && TOOL_FLAVORS[tool]) || 'generic';
    if (state === 'waiting') return tool || 'permission_prompt';
    return null;
  }

  /** The debug payload served by GET /state and "Copy debug info". */
  debugInfo(): { resolved: PetResolvedState; events: Array<PetEvent & { ts: number }> } {
    return { resolved: this.resolve(), events: this.events };
  }

  // Emit at most one renderer update per EMIT_MIN_INTERVAL_MS; a burst of
  // events (PreToolUse fires constantly) coalesces into a trailing emit.
  private _maybeEmit(): void {
    if (!this.onChange || this._emitTimer) return;
    const resolved = this.resolve();
    const snap = JSON.stringify(resolved);
    if (snap === this._lastSnapshot) return;
    const wait = EMIT_MIN_INTERVAL_MS - (this.now() - this._lastEmit);
    if (wait > 0) {
      this._emitTimer = setTimeout(() => {
        this._emitTimer = null;
        this._maybeEmit();
      }, wait);
      this._emitTimer.unref?.();
      return;
    }
    this._lastEmit = this.now();
    this._lastSnapshot = snap;
    this._lastEmittedState = resolved.state;
    this.onChange(resolved);
  }
}
