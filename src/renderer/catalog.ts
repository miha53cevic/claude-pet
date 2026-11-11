// Single home for the per-state and per-form rosters, imported by BOTH the
// renderer and the main process. Adding a state or form starts here.
export const FORM_NAMES = ['claude', 'clawd', 'blob', 'ghost'];

export const STATE_NAMES: PetStateName[] = ['idle', 'working', 'waiting', 'done', 'failed', 'sleeping'];

// Speech-bubble glyph per state; states without one show no bubble.
export const BUBBLE_GLYPHS: Partial<Record<PetStateName, string>> = {
  waiting: '?',
  done: '✓',
  failed: '!',
  sleeping: 'z',
};
