/**
 * Generates the OrbitHub brand assets (no binary blobs are committed by hand).
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Pure Node: the PNG encoder below avoids adding an image dependency to the
 * repository just to draw a logo.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'apps', 'mobile', 'assets');

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- draw ---- */

const BACKGROUND_TOP = [11, 16, 32];
const BACKGROUND_BOTTOM = [22, 30, 56];
const RING_START = [91, 124, 250];
const RING_END = [167, 139, 250];
const CORE = [245, 247, 255];
const SATELLITE = [255, 184, 107];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Approximate distance to an ellipse outline, good enough for a logo. */
function ellipseRingDistance(x, y, rx, ry, thickness) {
  const distance = (Math.hypot(x / rx, y / ry) - 1) * Math.min(rx, ry);
  return Math.abs(distance) - thickness / 2;
}

function circleDistance(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

/**
 * @param {number} size square edge in pixels
 * @param {{ background?: boolean, scale?: number }} options
 */
function renderMark(size, { background = true, scale = 1 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3;
  const cx = size / 2;
  const cy = size / 2;
  const unit = (size / 1024) * scale;

  const rx = 300 * unit;
  const ry = 140 * unit;
  const ringThickness = 72 * unit;
  const coreRadius = 104 * unit;
  const satelliteRadius = 50 * unit;
  const satelliteAngle = (-38 * Math.PI) / 180;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          // Rotate into the orbit plane.
          const dx = px - cx;
          const dy = py - cy;
          const rxr = dx * Math.cos(satelliteAngle) - dy * Math.sin(satelliteAngle);
          const ryr = dx * Math.sin(satelliteAngle) + dy * Math.cos(satelliteAngle);

          let colour = null;
          let alpha = 0;

          if (background) {
            const t = (px + py) / (2 * size);
            colour = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, t);
            alpha = 1;
          }

          const ringDistance = ellipseRingDistance(rxr, ryr, rx, ry, ringThickness);
          if (ringDistance <= 0) {
            const t = (rxr + rx) / (2 * rx);
            colour = mix(RING_START, RING_END, Math.min(1, Math.max(0, t)));
            alpha = 1;
          }

          if (circleDistance(px, py, cx, cy, coreRadius) <= 0) {
            colour = CORE;
            alpha = 1;
          }

          // The satellite rides the orbit: (rx, 0) in ring space maps back here.
          const satelliteX = cx + rx * Math.cos(satelliteAngle);
          const satelliteY = cy - rx * Math.sin(satelliteAngle);
          if (circleDistance(px, py, satelliteX, satelliteY, satelliteRadius) <= 0) {
            colour = SATELLITE;
            alpha = 1;
          }

          if (colour) {
            r += colour[0] * alpha;
            g += colour[1] * alpha;
            b += colour[2] * alpha;
            a += alpha;
          }
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round((a / total) * 255);
      }
    }
  }

  return encodePng(size, size, rgba);
}

/* ---------------------------------------------------------------- write ---- */

mkdirSync(assetsDir, { recursive: true });

const outputs = [
  ['icon.png', renderMark(1024, { background: true })],
  ['adaptive-icon.png', renderMark(1024, { background: false, scale: 0.62 })],
  ['splash-icon.png', renderMark(512, { background: false, scale: 0.72 })],
  ['favicon.png', renderMark(64, { background: true })],
];

for (const [name, buffer] of outputs) {
  writeFileSync(join(assetsDir, name), buffer);
  console.log(`wrote assets/${name} (${(buffer.length / 1024).toFixed(1)} kB)`);
}
