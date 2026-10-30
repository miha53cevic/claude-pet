// Procedural tray icon: a tiny pixel-art pet silhouette (stout body, punched
// out eyes, stubby legs — Clawd's cousin), rendered into raw bitmaps at
// runtime — the project ships no image assets. It's a macOS template image
// (pure black + alpha), so the menu bar recolors it for light/dark themes
// and highlight states. Deliberately NOT a starburst: that would collide
// with the actual Claude app's tray icon.
import { nativeImage } from 'electron';

// 14x9 cells; X = solid, . = transparent (the eye holes make the face)
const SPRITE = [
  '...XXXXXXXX...',
  '.XXXXXXXXXXXX.',
  'XXXXXXXXXXXXXX',
  'XXX..XXXX..XXX',
  'XXX..XXXX..XXX',
  'XXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXX',
  '.XXXXXXXXXXXX.',
  '..XX..XX..XX..',
];

const COLS = SPRITE[0]!.length;
const ROWS = SPRITE.length;

function render(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const cell = Math.floor(size / 16); // 1px cells at 16, 2px at 32
  const ox = Math.floor((size - COLS * cell) / 2);
  const oy = Math.floor((size - ROWS * cell) / 2) + cell; // sit slightly low, like standing
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (SPRITE[r]![c] !== 'X') continue;
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const x = ox + c * cell + dx;
          const y = oy + r * cell + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          buf[(y * size + x) * 4 + 3] = 255; // template image: alpha only, RGB stays black
        }
      }
    }
  }
  return buf;
}

export function trayIcon(): Electron.NativeImage {
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, width: 16, height: 16, buffer: render(16) });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: render(32) });
  img.setTemplateImage(true);
  return img;
}
