#!/usr/bin/env node
// Packages the pet into a real, double-clickable claude-pet.app under dist/.
//   npm run package
// The app icon is generated procedurally (a colored render of the tray
// sprite) — the project still ships zero image assets. Unsigned: fine for
// the machine it was built on; other Macs will need right-click -> Open.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';

const ROOT = path.join(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');

// ---------- app icon ----------

// Keep in sync with SPRITE in src/tray-icon.ts (colored variant: E = eyes).
const SPRITE = [
  '...XXXXXXXX...',
  '.XXXXXXXXXXXX.',
  'XXXXXXXXXXXXXX',
  'XXXEEXXXXEEXXX',
  'XXXEEXXXXEEXXX',
  'XXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXX',
  '.XXXXXXXXXXXX.',
  '..XX..XX..XX..',
];
const COLORS = { X: [0xd9, 0x77, 0x57, 0xff], E: [0x3d, 0x2b, 0x25, 0xff] };

// Minimal PNG encoder (RGBA, no interlace) — enough for an icon master.
function encodePng(width, height, rgba) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderMaster(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cols = SPRITE[0].length;
  const rows = SPRITE.length;
  const cell = Math.floor((size * 0.82) / cols); // ~9% margin per side
  const ox = Math.floor((size - cols * cell) / 2);
  const oy = Math.floor((size - rows * cell) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = COLORS[SPRITE[r][c]];
      if (!color) continue;
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const i = ((oy + r * cell + dy) * size + ox + c * cell + dx) * 4;
          rgba[i] = color[0];
          rgba[i + 1] = color[1];
          rgba[i + 2] = color[2];
          rgba[i + 3] = color[3];
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

function makeIcns() {
  const iconset = path.join(BUILD, 'icon.iconset');
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const master = path.join(BUILD, 'icon-1024.png');
  fs.writeFileSync(master, renderMaster(1024));
  for (const size of [16, 32, 64, 128, 256, 512]) {
    const out1 = path.join(iconset, `icon_${size}x${size}.png`);
    const out2 = path.join(iconset, `icon_${size}x${size}@2x.png`);
    execFileSync('sips', ['-z', String(size), String(size), master, '--out', out1], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), master, '--out', out2], { stdio: 'ignore' });
  }
  const icns = path.join(BUILD, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
  return icns;
}

// ---------- package ----------

const icns = makeIcns();
console.log('icon generated:', path.relative(ROOT, icns));

const appPaths = await packager({
  dir: ROOT,
  name: 'claude-pet',
  appBundleId: 'com.claude-pet.app',
  out: path.join(ROOT, 'dist'),
  overwrite: true,
  icon: icns,
  prune: true, // no production deps -> node_modules drops out entirely
  ignore: [
    /^\/(src|test|build|dist)(\/|$)/,
    /^\/scripts\/(?!hooks-spec\.js$).+/, // the app's in-app installer imports hooks-spec.js at runtime
    /^\/tsconfig.*\.json$/,
    /^\/\.gitignore$/,
    /^\/nohup\.out$/,
  ],
});
console.log('packaged:', appPaths.join(', '));
console.log('\nRun it:   open "' + path.join(appPaths[0], 'claude-pet.app') + '"');
console.log('Install:  cp -r "' + path.join(appPaths[0], 'claude-pet.app') + '" /Applications/');
