// Claude's mascot: the coral starburst — a sunburst of rounded rays with a face.
import { CX, CY, GROUND } from '../layout.js';

const form: PetForm = {
  name: 'claude',
  draw(ctx: CanvasRenderingContext2D, f: PetFrame) {
    const p = f.palette;
    const cx = CX;
    const cy = CY - f.lift + f.sleep * 14;
    const R = 36; // face disc radius
    const RAY = 26; // ray length beyond the disc
    const RAY_W = 13;
    // deterministic per-ray length variation, like the hand-drawn logo
    const VAR = [1, 0.82, 0.95, 0.78, 1, 0.88, 0.8, 0.97, 0.85, 1, 0.8, 0.92];

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, GROUND, 38 + f.lift / 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(f.tilt);
    ctx.scale((1 / Math.sqrt(f.squash)) * (1 + f.sleep * 0.12), f.squash * (1 - f.sleep * 0.28));

    // rays — slow sway when idle, spinning while working, tucked in when sleeping
    const spin =
      f.state === 'working' ? f.t * 1.2 : f.state === 'done' ? f.t * 3 : Math.sin(f.t * 0.8) * 0.06;
    const reach = (1 + 0.05 * f.breath) * (1 - f.sleep * 0.55);
    ctx.strokeStyle = p.body;
    ctx.lineWidth = RAY_W;
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = spin + (i * Math.PI) / 6;
      const inner = R - 4;
      const outer = R + RAY * VAR[i] * reach;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }

    // face disc
    const grad = ctx.createRadialGradient(-10, -12, 6, 0, 0, R + 8);
    grad.addColorStop(0, p.light);
    grad.addColorStop(1, p.body);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, R + 2, 0, Math.PI * 2);
    ctx.fill();

    // face
    const gx = f.gaze.x * 3;
    const gy = f.gaze.y * 2.5;
    const wide = f.state === 'waiting' ? 1.25 : 1;
    for (const side of [-1, 1]) {
      const ex = side * 14;
      const ey = -7;
      if (f.sleep > 0.5 || f.blink) {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ex, ey + 2, 5, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      } else if (f.state === 'done') {
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ex, ey + 3, 6, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, 6.5 * wide, 7.5 * wide, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.arc(ex + gx, ey + gy + (f.state === 'failed' ? 1.5 : 0), 3.2 * wide, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (f.state === 'failed' && f.sleep < 0.5) {
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 8, -19);
        ctx.lineTo(side * 20, -15);
        ctx.stroke();
      }
    }
    if (f.state === 'working') {
      // chomping on tokens
      ctx.fillStyle = p.dark;
      ctx.beginPath();
      ctx.ellipse(0, 10, 4, 1.5 + 4 * f.chomp, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.dark;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (f.state === 'done') ctx.arc(0, 8, 7, 0.1 * Math.PI, 0.9 * Math.PI);
      else if (f.state === 'failed') ctx.arc(0, 16, 6, 1.15 * Math.PI, 1.85 * Math.PI);
      else if (f.sleep > 0.5) ctx.arc(0, 9, 2.5, 0, Math.PI);
      else ctx.arc(0, 8, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();
  },
};

export default form;
