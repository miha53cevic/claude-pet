// Second form: a floaty ghost with a wavy skirt. Proves the form registry.
import { CX, CY, GROUND } from '../layout.js';

const form: PetForm = {
  name: 'ghost',
  draw(ctx: CanvasRenderingContext2D, f: PetFrame) {
    const p = f.palette;
    const cx = CX;
    const float = Math.sin(f.t * 1.5) * 5;
    const cy = CY - 10 - f.lift - float;
    const r = 50;
    const sleep = f.sleep;

    ctx.save();

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(cx, GROUND + 2, 34 - float, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(cx, cy);
    ctx.rotate(f.tilt);
    ctx.scale(1 / Math.sqrt(f.squash), f.squash * (1 - sleep * 0.25));
    ctx.globalAlpha = 0.94;

    // body with wavy hem
    const grad = ctx.createRadialGradient(-12, -22, 6, 0, 0, r + 16);
    grad.addColorStop(0, p.light);
    grad.addColorStop(1, p.body);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, -8, r, Math.PI, 0);
    const hem = 44;
    const waves = 5;
    for (let i = 0; i <= waves; i++) {
      const x = r - (i * 2 * r) / waves;
      const y = hem + Math.sin(f.t * 4 + i * 1.6) * 4 * (i % 2 ? 1 : -1);
      ctx.quadraticCurveTo(x + r / waves, hem + 12, x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // eyes
    const gx = f.gaze.x * 4;
    const gy = f.gaze.y * 3;
    for (const side of [-1, 1]) {
      const ex = side * 18;
      if (sleep > 0.5 || f.blink) {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ex, -10, 5, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      } else if (f.state === 'done') {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ex, -8, 6, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.ellipse(ex + gx, -12 + gy, 5, f.state === 'waiting' ? 8 : 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // small mouth
    if (f.state === 'working') {
      // chomping on tokens
      ctx.fillStyle = p.dark;
      ctx.beginPath();
      ctx.ellipse(0, 6, 3.5, 1.2 + 3.5 * f.chomp, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (f.state === 'failed') ctx.arc(0, 12, 6, 1.15 * Math.PI, 1.85 * Math.PI);
      else ctx.arc(0, 4, 4, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();
  },
};

export default form;
