import fs from 'fs';
const src = fs.readFileSync('src/data/chennaiMetroData.ts', 'utf8');

function extractArray(label) {
  const start = src.indexOf(label);
  if (start < 0) { console.log('start < 0 for', label); return null; }
  const open = src.indexOf('[', start);
  if (open < 0) { console.log('open < 0 for', label, 'at', start); return null; }
  const close = src.indexOf(']', open);
  if (close < 0) { console.log('close < 0 for', label, 'at', open); return null; }
  const body = src.slice(open + 1, close);
  console.log('body length', body.length, 'first 160', body.slice(0, 160));
  const coords = [];
  let depth = 0, buf = '';
  let char_i = 0;
  for (; char_i < body.length; char_i++) {
    const ch = body[char_i];
    if (ch === '[') { depth++; if (depth === 1) buf = ''; else buf += ch; }
    else if (ch === ']') {
      depth--;
      if (depth === 0 && buf.trim()) {
        const trimmed = buf.trim().replace(/^\[/, '').replace(/\]$/, '');
        const parts = trimmed.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) coords.push(parts);
      } else if (depth > 0) { buf += ch; }
    } else if (depth >= 1) { buf += ch; }
  }
  console.log('final coords length', coords.length);
  return coords;
}

const blue = extractArray('"blue-line"');
const green = extractArray('"green-line"');
console.log('blue', blue && blue.length, 'green', green && green.length);
if (!blue || !blue.length || !green || !green.length) { console.log('ABORT: arrays empty or null'); process.exit(1); }

function fmt(pts, i) {
  const c = pts[i];
  return `[${i}] ${c[0].toFixed(6)}, ${c[1].toFixed(6)}`;
}

const ALANDUR = [80.201533, 13.004223];

function nearestIndex(pts, target) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - target[0], pts[i][1] - target[1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const bi = nearestIndex(blue, ALANDUR);
const gi = nearestIndex(green, ALANDUR);
console.log('blue nearest idx', bi, fmt(blue, bi));
console.log('green nearest idx', gi, fmt(green, gi));

console.log('BLUE window around Alandur:');
for (let i = bi - 5; i <= bi + 5; i++) {
  if (i >= 0 && i < blue.length) console.log(fmt(blue, i));
}
console.log('GREEN window around Alandur:');
for (let i = gi - 5; i <= gi + 5; i++) {
  if (i >= 0 && i < green.length) console.log(fmt(green, i));
}

function bearing(pts, i) {
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[Math.min(pts.length - 1, i + 1)];
  const dx = (p1[0] - p0[0]) * Math.cos((p0[1] * Math.PI) / 180);
  const dy = p1[1] - p0[1];
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

console.log('blue bearing @Alandur:', bearing(blue, bi).toFixed(2), 'deg (90=E, 0=N)');
console.log('green bearing @Alandur:', bearing(green, gi).toFixed(2), 'deg');
console.log('blue bearing @bi+2:', bearing(blue, bi + 2).toFixed(2));
console.log('blue bearing @bi-2:', bearing(blue, bi - 2).toFixed(2));
