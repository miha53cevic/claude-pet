// Shared logical geometry, imported by BOTH the renderer and the main process
// (main compiles its own copy under out/main/renderer/). The window is
// LOGICAL w x h; the pet stands at (CX, GROUND) with his center around CY.
// Headroom above the head is kept SMALL on purpose: macOS refuses to move any
// window's top edge above the menu bar, so every logical pixel above the pet
// is space he can never reach when dragged to the top of the screen.
export const LOGICAL = { w: 260, h: 260 };
export const CX = 130;
export const CY = 96;
export const GROUND = 148;

// Visual bounds of the pet inside the window (hand-tuned to cover every form
// plus bounce headroom). Main clamps against this box, not the window rect —
// the transparent chrome may overhang screen edges as long as the pet stays
// on screen.
export const PET_BOX = { left: 55, top: 22, right: 205, bottom: 160 };

// Hover/click hit circle around (CX, CY), generous by design.
export const PET_RADIUS = 72;
