// Single home for the per-state and per-form rosters, imported by BOTH the
// renderer and the main process. Adding a state or form starts here.
export const FORM_NAMES = ['claude', 'clawd', 'blob', 'ghost'];

export const STATE_NAMES: PetStateName[] = ['idle', 'working', 'waiting', 'done', 'failed', 'sleeping'];

// One glyph per state: the tray title uses all of them; the speech bubble
// shows only the BUBBLE_STATES subset.
export const STATE_GLYPHS: Record<PetStateName, string> = {
  idle: '○',
  working: '●',
  waiting: '?',
  done: '✓',
  failed: '!',
  sleeping: 'z',
};

export const BUBBLE_STATES: PetStateName[] = ['waiting', 'done', 'failed', 'sleeping'];
