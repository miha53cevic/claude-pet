// Clawd: the pixel crab from Claude Code's onboarding — a stout 8-bit stack of
// orange squares with two black eyes and little side pincers. Everything is
// drawn as integer-aligned rects on a coarse grid; no rotation, no scaling,
// so the pixels stay crisp.

import { CX, GROUND } from '../layout.js';

const P = 8; // pixel size in logical units
const COLS = 15;

// body silhouette (eyes/claws/legs drawn separately so states can change them)
// O body · L top-left highlight · . empty
const BODY = [
  '....OOOOOOO....',
  '..OOOOOOOOOOO..',
  '.LLOOOOOOOOOOO.',
  '.LOOOOOOOOOOOO.',
  'OOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOO',
  '.OOOOOOOOOOOOO.',
  '..OOOOOOOOOOO..',
];

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + f))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const form: PetForm = {
  name: 'clawd',
  draw(ctx: CanvasRenderingContext2D, f: PetFrame) {
    const p = f.palette;
    const claw = shade(p.body, -0.14);
    const bodyDark = shade(p.body, -0.1); // hoisted: shade() parses hex, keep it out of the pixel loop
    const sleep = f.sleep > 0.5;

    // integer offsets only — bob, jitter, no smooth transforms
    const bob = sleep ? 2 * P : -Math.round(f.lift);
    const jitterX = f.state === 'failed' ? Math.round(Math.sin(f.t * 30) * 2) : 0;
    const left = CX - (COLS * P) / 2;
    const top = GROUND - (BODY.length + 1) * P + bob;

    // pixel ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(CX - 6 * P, GROUND - 2, 12 * P, P - 2);

    ctx.save();
    ctx.translate(left + jitterX, top);
    const px = (gx: number, gy: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(gx * P, gy * P, w * P, h * P);
    };

    // body
    for (let r = 0; r < BODY.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = BODY[r][c];
        if (ch === '.') continue;
        px(c, r, 1, 1, ch === 'L' ? p.light : r >= 8 ? bodyDark : p.body);
      }
    }

    // legs (tucked when sleeping)
    if (!sleep) {
      const step = f.state === 'working' ? Math.round(Math.sin(f.t * 10)) : 0;
      px(3, 10 + Math.max(0, step), 2, 1, claw);
      px(7, 10, 2, 1, claw);
      px(10, 10 + Math.max(0, -step), 2, 1, claw);
    }

    // pincers: C-shaped claws on both sides
    let clawDy = 0;
    if (f.state === 'working' && f.flavor === 'bash') clawDy = Math.round(Math.sin(f.t * 14));
    else if (f.state === 'working' && f.flavor === 'edit') clawDy = -Math.abs(Math.round(Math.sin(f.t * 10) * 2));
    else if (f.state === 'done') clawDy = -2 + Math.round(Math.sin(f.t * 8)); // waving
    else if (f.state === 'failed') clawDy = 2; // drooped
    else if (f.state === 'waiting') clawDy = Math.round(Math.sin(f.t * 6)) - 1;
    if (sleep) clawDy = 3;
    for (const [bar, tip] of [[-1, -2], [15, 16]] as const) {
      px(bar, 3 + clawDy, 1, 4, claw); // arm bar
      px(tip, 2 + clawDy, 1, 1, claw); // upper pincer tip
      px(tip, 6 + clawDy, 1, 1, claw); // lower pincer tip
    }

    // eyes — Clawd is famously just two black squares
    const gx = Math.round(f.gaze.x);
    const gy = Math.round(f.gaze.y);
    for (const c of [4, 9]) {
      if (sleep || f.blink) {
        px(c + gx, 4, 2, 1, p.dark); // closed: flat line
      } else if (f.state === 'done') {
        // happy ^ carets
        px(c + gx, 3, 1, 1, p.dark);
        px(c + 1 + gx, 2, 1, 1, p.dark);
        px(c + 2 + gx, 3, 1, 1, p.dark);
      } else if (f.state === 'waiting') {
        px(c + gx, 2 + gy, 2, 3, p.dark); // wide eyes
      } else {
        px(c + gx, 3 + gy, 2, 2, p.dark);
      }
    }

    // mouth only when emoting (normally mouthless, like the original)
    if (f.state === 'working') {
      // pixel chomp: alternating closed / open
      if (f.chomp > 0.5) px(6, 6, 3, 2, p.dark);
      else px(6, 7, 3, 1, p.dark);
    } else if (f.state === 'done') {
      px(6, 7, 3, 1, p.dark);
      px(5, 6, 1, 1, p.dark);
      px(9, 6, 1, 1, p.dark);
    } else if (f.state === 'failed') {
      px(6, 6, 3, 1, p.dark);
      px(5, 7, 1, 1, p.dark);
      px(9, 7, 1, 1, p.dark);
      // angry brows
      px(3, 1, 1, 1, p.dark);
      px(4, 2, 1, 1, p.dark);
      px(11, 1, 1, 1, p.dark);
      px(10, 2, 1, 1, p.dark);
    }

    ctx.restore();
  },
};

export default form;
