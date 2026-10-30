// Ambient types shared by the main process, the renderer, and the tools.
// No imports/exports on purpose — everything here is global in all tsconfigs.
// DOM-dependent types (PetFrame, PetForm, the window.pet bridge) live in
// src/renderer/types.d.ts instead, because the main process has no DOM lib.

type PetStateName = 'idle' | 'working' | 'waiting' | 'done' | 'failed' | 'sleeping';

type WanderMode = 'off' | 'drift' | 'adventure';

type ChimeLevel = 'off' | 'quiet' | 'normal' | 'loud';

/** Motion hint sent while the main process walks the window around the screen. */
interface PetMotion {
  mode: 'walk' | 'climb' | 'ceiling' | 'fall' | 'land';
  dir: 1 | -1;
}

/** One normalized Claude Code hook event, as produced by hook-server's normalize(). */
interface PetEvent {
  event: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string | null;
  notification_type?: string | null;
}

interface PetSessionInfo {
  name: string;
  cwd: string;
  state: string;
  tool: string | null;
}

/** What the state machine resolves the whole world to; sent to the renderer. */
interface PetResolvedState {
  state: PetStateName;
  flavor: string | null;
  /** max consecutive tool failures across live sessions, capped at 5 */
  frazzle: number;
  /** waiting escalation tier 0-2 (0 unless waiting) */
  urgency: number;
  subagents: number;
  sessions: PetSessionInfo[];
}

interface PetPalette {
  body: string;
  light: string;
  belly: string;
  dark: string;
  confetti: string[];
}

/** Payload of the pet:init IPC message. */
interface PetInit {
  debug: boolean;
  form: string;
  scale: number;
  chime: ChimeLevel;
  palette: Partial<PetPalette> | null;
}
