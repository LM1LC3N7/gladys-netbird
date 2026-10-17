// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark-to-blue gradient and a
// mesh of peers (connected ones lit green, one grey, one amber for an expired
// login) linked by their tunnels. Plain Node (zlib), no dependency, no logo.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [12, 16, 30];
const BLUE = [22, 70, 120];
const WHITE = [236, 242, 250];
const GREEN = [70, 210, 120];
const GREY = [120, 130, 145];
const AMBER = [255, 170, 50];
const LINK = [110, 170, 230];

// The peers: [x, y, radius, light].
const PEERS = [
  [400, 267, 54, GREEN],
  [170, 140, 38, GREEN],
  [630, 130, 38, GREEN],
  [150, 400, 38, GREY],
  [650, 405, 38, AMBER],
  [400, 470, 30, GREEN],
  [400, 70, 30, GREEN],
];
// Tunnels between peers (indexes); the grey one has none lit.
const LINKS = [
  [0, 1],
  [0, 2],
  [0, 4],
  [0, 5],
  [0, 6],
  [1, 6],
  [2, 6],
  [1, 2],
  [4, 5],
];

function segment(x, y, [x0, y0], [x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

function pixel(x, y) {
  let color = mix(DARK, BLUE, (x / WIDTH) * 0.45 + (y / HEIGHT) * 0.55);
  for (const [a, b] of LINKS) {
    const d = segment(x, y, PEERS[a], PEERS[b]);
    color = mix(color, LINK, smooth(2.5, d) * 0.85);
  }
  // The grey peer: a dashed, dim link (disconnected).
  const d = segment(x, y, PEERS[0], PEERS[3]);
  if (Math.floor((x + y) / 12) % 2 === 0) color = mix(color, GREY, smooth(2, d) * 0.6);
  for (const [cx, cy, r, light] of PEERS) {
    const dist = Math.hypot(x - cx, y - cy);
    color = mix(color, WHITE, smooth(r, dist) * 0.95);
    color = mix(color, DARK, smooth(r - 5, dist) * 0.85);
    // A screen: a rounded inner square.
    const qx = Math.abs(x - cx) - r * 0.42;
    const qy = Math.abs(y - cy + r * 0.08) - r * 0.3;
    const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 3;
    color = mix(color, BLUE, smooth(0, box) * 0.9);
    // The status light under the screen.
    color = mix(color, light, smooth(r * 0.14, Math.hypot(x - cx, y - (cy + r * 0.55))));
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
