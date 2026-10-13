import fs from 'fs';
const txt = fs.readFileSync('src/data/chennaiMetroData.ts', 'utf8');

function parseTsArray(label, offset = 0) {
  const idx = txt.indexOf(label);
  if (idx < 0) { console.log('NOT FOUND', label); return []; }
  let i = txt.indexOf('[', idx + offset);
  if (i < 0) { console.log('NO BRACKET', label); return []; }
  const pairs = [];
  let depth = 0, start = -1, buf = '';
  const walk = (s, p) => { for (let k = 0; k < s.length; k++) { if (s[k] === '[') depth++; else if (s[k] === ']') { depth--; if (depth === 0 && p !== k - 1 && buf.trim()) { const m = buf.trim().match(/^\[?\s*([-\d.]+)\s*,\s*([-\d.]+)/); if (m) pairs.push([parseFloat(m[1]), parseFloat(m[2])]); } buf = ''; } else if (depth === 1) buf += s[k]; } };
  for (let j = i; j < txt.length; j++) { const c = txt[j]; if (c === '[') { if (depth === 0) start = j; depth++; } else if (c === ']') { depth--; if (depth === 0 && start > 0) walk(txt.slice(start + 1, j), start); } }
  return pairs;
}

const blue = parseTsArray('"blue-line"');
const green = parseTsArray('"green-line"');
console.log('BLUE len', blue.length, 'GREEN len', green.length);

function fmt(pts, set, step = 1, lo = 0, hi = pts.length) {
  const out = [];
  for (let i = Math.max(0, lo); i < Math.min(hi, pts.length); i += Math.max(1, step)) {
    const p = pts[i];
    out.push([i, +p[0].toFixed(5), +p[1].toFixed(6), i - set]);
  }
  return out;
}

const AL = [80.201533, 13.004223];

function within(pts, tg, deg = 0.0015) {
  const res = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Math.abs(p[0] - tg[0]) < deg && Math.abs(p[1] - tg[1]) < deg) res.push([i, +p[0].toFixed(6), +p[1].toFixed(6)]);
  }
  return res;
}

function nearest(pts, tg) {
  let best = null, bd = 1e9;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = Math.hypot(p[0] - tg[0], p[1] - tg[1]);
    if (d < bd) { bd = d; best = [i, +p[0].toFixed(6), +p[1].toFixed(6), d]; }
  }
  return best;
}

console.log('BLUE within 0.0015deg:', within(blue, AL, 0.0015));
console.log('GREEN within 0.0015deg:', within(green, AL, 0.0015));
console.log('BLUE nearest:', nearest(blue, AL));
console.log('GREEN nearest:', nearest(green, AL));

const blueAl = nearest(blue, AL); if (blueAl) console.log('BLUE window @', blueAl[0], fmt(blue, blueAl[0], 1, blueAl[0] - 6, blueAl[0] + 7));
const greenAl = nearest(green, AL); if (greenAl) console.log('GREEN window @', greenAl[0], fmt(green, greenAl[0], 1, greenAl[0] - 5, greenAl[0] + 6));

function cross(pts, tg) {
  let prev = null, meets = null, segIdx = -1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ax = a[0] - tg[0], ay = a[1] - tg[1];
    const bx = b[0] - tg[0], by = b[1] - tg[1];
    const az = 0, bz = 0;
    const rx = bx - ax, ry = by - ay, rz = bz - az;
    const cx = -ax, cy = -ay, cz = -az;
    const z = cx * ry - cy * rx;
    const y = cx * rz - cz * rx;
    const x = cy * rz - cz * ry;
    const dot = x * rx + y * ry + z * rz;
    const rr = rx * rx + ry * ry + rz * rz;
    if (rr === 0) continue;
    const t = -dot / rr;
    if (t >= 0 && t <= 1) {
      const ix = ax + t * rx, iy = ay + t * ry, iz = az + t * rz;
      if (Math.abs(ix) < 0.03 && Math.abs(iy) < 0.03 && Math.abs(iz) < 0.03) {
        if (meets === null) { meets = i; segIdx = i; }
      }
    }
    prev = b;
  }
  return meets;
}

console.log('BLUE cross idx:', cross(blue, AL));
console.log('GREEN cross idx:', cross(green, AL));
console.log('BLUE alt window @58:', fmt(blue, 58, 2, 30, 86));
console.log('BLUE alt window @2360:', fmt(blue, 2360, 2, 2340, 2420));
console.log('GREEN alt window @6:', fmt(green, 6, 2, 0, 20));
console.log('BLUE early @0 step6:', fmt(blue, 0, 6, 0, 36));
console.log('GREEN early @0 step5:', fmt(green, 0, 5, 0, 25));
console.log('GREEN near 107:', fmt(green, 107, 1, 90, 124));
