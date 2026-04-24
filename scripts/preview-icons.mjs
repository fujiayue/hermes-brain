// Generates 4 PNG icon previews (256×256) for the user to choose from.
import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = 256; // size

// ── PNG encoder ──────────────────────────────────────────────────────────────
function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(t, d) {
  const L = Buffer.alloc(4); L.writeUInt32BE(d.length);
  const T = Buffer.from(t), C = Buffer.alloc(4);
  C.writeUInt32BE(crc32(Buffer.concat([T, d])));
  return Buffer.concat([L, T, d, C]);
}
function savePng(px, file) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(S); hdr.writeUInt32BE(S, 4); hdr[8] = 8; hdr[9] = 6;
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    raw[y * (1 + S * 4)] = 0;
    px.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4);
  }
  writeFileSync(file, Buffer.concat([sig, chunk("IHDR", hdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const newBuf = () => Buffer.alloc(S * S * 4);
function px(buf, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  const o = (y * S + x) * 4;
  buf[o] = clamp(r); buf[o + 1] = clamp(g); buf[o + 2] = clamp(b); buf[o + 3] = clamp(a);
}

// Signed-distance field for letter "H" in normalised [-1,1] space
function sdfH(nx, ny) {
  const LB = Math.max(Math.abs(nx + 0.41) - 0.13, Math.abs(ny) - 0.84);
  const RB = Math.max(Math.abs(nx - 0.41) - 0.13, Math.abs(ny) - 0.84);
  const CB = Math.max(Math.abs(nx) - 0.56, Math.abs(ny) - 0.13);
  return Math.min(LB, RB, CB);
}

// Alpha of H at pixel (x,y); scale shrinks the letter to fill ~70% of S
function hA(x, y, cx = S / 2, cy = S / 2, scale = 0.37) {
  const d = sdfH((x - cx) / (S * scale), (y - cy) / (S * scale));
  return Math.max(0, Math.min(1, -d * S * scale * 4));
}

// Smooth edge alpha for a circle
function circleA(x, y, cx, cy, r) {
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return Math.max(0, Math.min(1, (r - d) * 3));
}

// Smooth alpha for rounded-rect (corner radius rr, inset pad)
function rrectA(x, y, cx, cy, rr, pad = 0) {
  const dx = Math.max(0, Math.abs(x - cx) - (S / 2 - rr - pad));
  const dy = Math.max(0, Math.abs(y - cy) - (S / 2 - rr - pad));
  return Math.max(0, Math.min(1, (rr - Math.sqrt(dx * dx + dy * dy)) * 3));
}

// ── Design A: 渐变圆 — warm orange radial gradient, white H ──────────────────
function designA() {
  const buf = newBuf();
  const cx = S / 2, cy = S / 2, r = S * 0.455;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ca = circleA(x, y, cx, cy, r);
      if (ca === 0) continue;
      const t = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r;
      const angle = Math.atan2(y - cy, x - cx);
      // Radial gradient: bright top-left → deep bottom-right
      const highlight = Math.max(0, -Math.cos(angle - Math.PI * 1.3)) * (1 - t) * 0.4;
      const br = lerp(lerp(220, 150, t * t), 255, highlight);
      const bg = lerp(lerp(72, 35, t * t), 100, highlight * 0.5);
      const bb = lerp(lerp(18, 8, t * t), 30, highlight * 0.2);
      const ha = hA(x, y);
      px(buf, x, y, lerp(br, 255, ha), lerp(bg, 252, ha), lerp(bb, 250, ha), ca * 255);
    }
  }
  return buf;
}

// ── Design B: 暗金 — near-black rounded square, amber H + soft glow ──────────
function designB() {
  const buf = newBuf();
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ra = rrectA(x, y, cx, cy, S * 0.18);
      if (ra === 0) continue;
      // SDF-based glow: distance from H boundary
      const d = sdfH((x - cx) / (S * 0.37), (y - cy) / (S * 0.37));
      const glow = d < 0 ? 1 : Math.exp(-d * d * 380) * 0.85;
      const ha = hA(x, y);
      const bgR = 22, bgG = 20, bgB = 16;
      const gr = lerp(bgR, lerp(180, 251, ha), glow);
      const gg = lerp(bgG, lerp(110, 191, ha), glow);
      const gb = lerp(bgB, lerp(15, 36, ha), glow);
      px(buf, x, y, gr, gg, gb, ra * 255);
    }
  }
  return buf;
}

// ── Design C: 极简 — cream rounded square, orange border + orange H ──────────
function designC() {
  const buf = newBuf();
  const cx = S / 2, cy = S / 2;
  const rr = S * 0.19, bw = S * 0.025; // border width
  const [cr, cg, cb] = [200, 84, 26];  // Claude orange
  const [bgr, bgg, bgb] = [250, 249, 247]; // cream
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const outer = rrectA(x, y, cx, cy, rr);
      if (outer === 0) continue;
      const inner = rrectA(x, y, cx, cy, rr, bw);
      const isBorder = inner < 0.5;
      const ha = hA(x, y, cx, cy, 0.35);
      let r, g, b;
      if (ha > 0.02) { r = lerp(bgr, cr, ha); g = lerp(bgg, cg, ha); b = lerp(bgb, cb, ha); }
      else if (isBorder) { r = cr; g = cg; b = cb; }
      else { r = bgr; g = bgg; b = bgb; }
      px(buf, x, y, r, g, b, outer * 255);
    }
  }
  return buf;
}

// ── Design D: 脉冲圆 — dark circle, orange concentric rings, solid H ─────────
function designD() {
  const buf = newBuf();
  const cx = S / 2, cy = S / 2, r = S * 0.455;
  const [dr, dg, db] = [18, 16, 14];   // near-black
  const [or2, og, ob] = [200, 84, 26]; // orange
  const rings = 5, rw = r / (rings * 2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ca = circleA(x, y, cx, cy, r);
      if (ca === 0) continue;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const frac = (dist / rw) % 1;
      const ringPulse = frac < 0.45 ? Math.sin(frac / 0.45 * Math.PI) : 0;
      const fade = (1 - dist / r) ** 1.5;
      const rm = ringPulse * fade * 0.55;
      const ha = hA(x, y);
      const br = lerp(dr, or2, rm), bg = lerp(dg, og, rm), bb2 = lerp(db, ob, rm);
      px(buf, x, y, lerp(br, or2, ha), lerp(bg, og, ha), lerp(bb2, ob, ha), ca * 255);
    }
  }
  return buf;
}

// ── Render all ───────────────────────────────────────────────────────────────
const designs = [
  ["A-gradient-circle", designA],
  ["B-dark-gold",       designB],
  ["C-minimal-cream",   designC],
  ["D-pulse-rings",     designD],
];
for (const [name, fn] of designs) {
  const file = path.join(ROOT, `icon-preview-${name}.png`);
  savePng(fn(), file);
  console.log(`✓ icon-preview-${name}.png`);
}
