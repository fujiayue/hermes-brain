// Generates icon.ico — Design A: warm orange radial-gradient circle, white H
import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── PNG encoder ──────────────────────────────────────────────────────────────
function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(t, d) {
  const L = Buffer.alloc(4); L.writeUInt32BE(d.length);
  const T = Buffer.from(t), C = Buffer.alloc(4);
  C.writeUInt32BE(crc32(Buffer.concat([T, d])));
  return Buffer.concat([L, T, d, C]);
}
function encodePng(px, S) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(S); hdr.writeUInt32BE(S, 4); hdr[8] = 8; hdr[9] = 6;
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    raw[y * (1 + S * 4)] = 0;
    px.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([sig, pngChunk("IHDR", hdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// ── Render helpers ───────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

function sdfH(nx, ny) {
  const LB = Math.max(Math.abs(nx + 0.41) - 0.13, Math.abs(ny) - 0.84);
  const RB = Math.max(Math.abs(nx - 0.41) - 0.13, Math.abs(ny) - 0.84);
  const CB = Math.max(Math.abs(nx) - 0.56, Math.abs(ny) - 0.13);
  return Math.min(LB, RB, CB);
}

function renderA(S) {
  const buf = Buffer.alloc(S * S * 4);
  const cx = S / 2, cy = S / 2, r = S * 0.455;
  const sharpness = Math.max(3, S * 0.05);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ca = Math.max(0, Math.min(1, (r - dist) * sharpness / S));
      if (ca === 0) continue;

      const t = dist / r;
      const angle = Math.atan2(dy, dx);
      const highlight = Math.max(0, -Math.cos(angle - Math.PI * 1.3)) * (1 - t) * 0.4;
      const br = lerp(lerp(220, 150, t * t), 255, highlight);
      const bg = lerp(lerp(72, 35, t * t), 100, highlight * 0.5);
      const bb = lerp(lerp(18, 8, t * t), 30, highlight * 0.2);

      const scale = 0.37;
      const d = sdfH((x - cx) / (S * scale), (y - cy) / (S * scale));
      const ha = Math.max(0, Math.min(1, -d * S * scale * 4));

      const o = (y * S + x) * 4;
      buf[o]     = clamp(lerp(br, 255, ha));
      buf[o + 1] = clamp(lerp(bg, 252, ha));
      buf[o + 2] = clamp(lerp(bb, 250, ha));
      buf[o + 3] = clamp(ca * 255);
    }
  }
  return buf;
}

// ── ICO builder (PNG-in-ICO format) ─────────────────────────────────────────
function buildIco(sizes) {
  const pngs = sizes.map(s => encodePng(renderA(s), s));
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(sizes.length, 4);
  let offset = 6 + sizes.length * 16;
  const dirs = sizes.map((s, i) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(s >= 256 ? 0 : s, 0);
    d.writeUInt8(s >= 256 ? 0 : s, 1);
    d.writeUInt32LE(pngs[i].length, 8);
    d.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return d;
  });
  return Buffer.concat([hdr, ...dirs, ...pngs]);
}

const ico = buildIco([16, 32, 48, 256]);
writeFileSync(path.join(ROOT, "icon.ico"), ico);
console.log(`✓ icon.ico  (${(ico.length / 1024).toFixed(0)} KB)`);
