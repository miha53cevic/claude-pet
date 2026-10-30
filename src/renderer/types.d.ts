// Renderer-only ambient types (these reference DOM types, which the main
// process tsconfig doesn't load). Shared cross-process types: src/shared.d.ts.

/** Per-frame animation parameters computed by pet.ts; a form only draws. */
interface PetFrame {
  state: PetStateName;
  flavor: string | null;
  t: number;
  breath: number;
  blink: boolean;
  squash: number;
  lift: number;
  tilt: number;
  gaze: { x: number; y: number };
  sleep: number;
  /** mouth openness 0..1; pulses while working (he eats tokens) */
  chomp: number;
  palette: PetPalette;
}

interface PetForm {
  name: string;
  draw(ctx: CanvasRenderingContext2D, f: PetFrame): void;
}

/** The contextBridge API preload.ts exposes as window.pet. */
interface PetBridge {
  onInit(cb: (v: PetInit) => void): void;
  onState(cb: (v: PetResolvedState) => void): void;
  onGaze(cb: (v: { x: number; y: number }) => void): void;
  onMotion(cb: (m: PetMotion | null) => void): void;
  hover(over: boolean): void;
  dragStart(): void;
  dragEnd(): void;
  menu(): void;
}

interface Window {
  pet: PetBridge;
}
