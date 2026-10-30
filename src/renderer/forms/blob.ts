// The default pet: a soft rounded blob with feet.
// A form only draws a body — pet.js owns all timing, bubbles, particles, dots.
// f: {state, flavor, t, breath, blink, squash, lift, tilt, gaze, sleep, palette}

import { CX, CY, GROUND } from '../layout.js';

const form: PetForm = {
  name: 'blob',
  draw(ctx: CanvasRenderingContext2D, f: PetFrame) {
    const p = f.palette;
    const cx = CX;
    const cy = CY - f.lift + f.sleep * 16; // sleeping loaf rests on the ground
    const r = 52;
    const squashX = 1 / Math.sqrt(f.squash);
    const sleep = f.sleep;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f.tilt);

    // shadow on the "ground"
    ctx.save();
    ctx.translate(0, GROUND - cy);
    ctx.scale(1 + f.lift / 80, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 40, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // feet (tucked when sleeping)
    if (sleep < 0.5) {
      const tap = f.flavor === 'bash' ? Math.sin(f.t * 14) * 4 : 0;
      const hammer = f.flavor === 'edit' ? Math.max(0, Math.sin(f.t * 10)) * 8 : 0;
      ctx.fillStyle = p.dark;
      ctx.beginPath();
      ctx.ellipse(-26, 48 - Math.max(0, tap), 12, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(26, 48 - Math.max(0, -tap) - hammer, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // body — squashed blob, flattened into a loaf when sleeping
    ctx.save();
    ctx.scale(squashX * (1 + sleep * 0.25), f.squash * (1 - sleep * 0.35));
    const grad = ctx.createRadialGradient(-14, -20, 8, 0, 0, r + 12);
    grad.addColorStop(0, p.light);
    grad.addColorStop(1, p.body);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-r, 10);
    ctx.bezierCurveTo(-r, -r * 1.05, r, -r * 1.05, r, 10);
    ctx.bezierCurveTo(r, r * 0.85, -r, r * 0.85, -r, 10);
    ctx.fill();
    // belly
    ctx.fillStyle = p.belly;
    ctx.beginPath();
    ctx.ellipse(0, 24, r * 0.55, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // face
    drawFace(ctx, f, p, sleep);
    ctx.restore();
  },
};

export default form;

function drawFace(ctx: CanvasRenderingContext2D, f: PetFrame, p: PetPalette, sleep: number) {
  const gx = f.gaze.x * 4;
  const gy = f.gaze.y * 3;
  const eyeY = -12;
  const eyeDX = 20;
  const wide = f.state === 'waiting' ? 1.3 : 1;

  for (const side of [-1, 1]) {
    const ex = side * eyeDX;
    if (sleep > 0.5 || f.blink) {
      // closed: gentle arc
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY + 2, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (f.state === 'done') {
      // happy ^^
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY + 4, 7, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 8 * wide, 9 * wide, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.dark;
      ctx.beginPath();
      ctx.arc(ex + gx, eyeY + gy + (f.state === 'failed' ? 2 : 0), 4 * wide, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // brows when failed
  if (f.state === 'failed' && sleep < 0.5) {
    ctx.strokeStyle = p.dark;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 12, -28);
      ctx.lineTo(side * 28, -24);
      ctx.stroke();
    }
  }

  // mouth
  if (f.state === 'working') {
    // chomping on tokens
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.ellipse(0, 8, 4.5, 1.5 + 4.5 * f.chomp, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = p.dark;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (f.state === 'done') ctx.arc(0, 6, 8, 0.1 * Math.PI, 0.9 * Math.PI);
    else if (f.state === 'failed') ctx.arc(0, 16, 7, 1.15 * Math.PI, 1.85 * Math.PI);
    else if (sleep > 0.5) ctx.arc(0, 8, 3, 0, Math.PI);
    else ctx.arc(0, 6, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}
