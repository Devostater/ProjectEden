// Draws the app icon (indigo tile, white hexagon, centre dot) as PNG files for the installable app.
// No image libraries needed: each pixel is coloured from simple shape distances, then written as a PNG.
//   node scripts/make-icons.mjs
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'public');

const TOP = [0x63, 0x66, 0xf1]; // #6366f1
const BOTTOM = [0x43, 0x38, 0xca]; // #4338ca

const clamp = (v) => Math.max(0, Math.min(1, v));

// Distance to a segment.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coverage of the design at a point in 512-unit space. `full` = square tile for maskable icons.
function shade(x, y, full) {
  // Rounded tile (radius 112) or full square.
  let tile = 1;
  if (!full) {
    const r = 112;
    const cx = Math.max(r, Math.min(512 - r, x));
    const cy = Math.max(r, Math.min(512 - r, y));
    tile = clamp(r - Math.hypot(x - cx, y - cy) + 0.5);
  }
  const t = (x + y) / 1024;
  const bg = TOP.map((c, i) => c + (BOTTOM[i] - c) * t);

  // Hexagon outline, stroke width 30.
  const hex = [[256, 104], [388, 180], [388, 332], [256, 408], [124, 332], [124, 180]];
  let d = Infinity;
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = hex[i];
    const [bx, by] = hex[(i + 1) % 6];
    d = Math.min(d, segDist(x, y, ax, ay, bx, by));
  }
  const stroke = clamp(15 - d + 0.5);
  const dot = clamp(38 - Math.hypot(x - 256, y - 256) + 0.5);
  const white = Math.max(stroke, dot);
  const rgb = bg.map((c) => c + (255 - c) * white);
  return { rgb, alpha: tile };
}

function png(size, { full = false, inset = 0 } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = 512 / (size * (1 - 2 * inset));
  const offset = size * inset;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      // 2x2 supersampling for smooth edges.
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const x = (px + sx - offset) * scale;
        const y = (py + sy - offset) * scale;
        const inside = x >= 0 && y >= 0 && x <= 512 && y <= 512;
        const s = inside ? shade(x, y, full) : { rgb: TOP, alpha: full ? 1 : 0 };
        const fill = inset && !inside ? { rgb: [0x4f, 0x46, 0xe5], alpha: 1 } : s;
        r += fill.rgb[0] * fill.alpha;
        g += fill.rgb[1] * fill.alpha;
        b += fill.rgb[2] * fill.alpha;
        a += fill.alpha;
      }
      const i = py * (size * 4 + 1) + 1 + px * 4;
      raw[i] = a ? Math.round(r / a) : 0;
      raw[i + 1] = a ? Math.round(g / a) : 0;
      raw[i + 2] = a ? Math.round(b / a) : 0;
      raw[i + 3] = Math.round((a / 4) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': png(192),
  'icon-512.png': png(512),
  // Maskable: the design sits inside the safe zone on a full-bleed tile, so Android can crop it to any shape.
  'icon-maskable-512.png': png(512, { full: true, inset: 0.1 }),
  'apple-touch-icon.png': png(180, { full: true }),
  'favicon-32.png': png(32),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
