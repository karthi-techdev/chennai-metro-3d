import fs from 'fs';
const txt = fs.readFileSync('src/data/chennaiMetroData.ts', 'utf8');

function extract(label, offset = 8) {
  const seg = txt.slice(txt.indexOf(label) + offset, txt.indexOf(label) + offset + 300000);
  const m = seg.match(/coordinates:\s*\[([^\]]+)\]/s);
  const s = m ? m[1] : '';
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') {
      let j = i + 1;
      const a = s.slice(j, s.indexOf(',', j)).trim();
      const bS = s.slice(s.indexOf(',', j) + 1, s.indexOf(']', j));
      const b = bS.trim();
      if (a && b && !isNaN(a) && !isNaN(b)) out.push([parseFloat(a), parseFloat(b)]);
      i = s.indexOf(']', i) + 1;
    } else { i++; }
  }
  return out;
}

const blue = extract('"blue-line"');
const green = extract('"green-line"');
console.log('blue len', blue.length, 'green len', green.length);

function near(pts, tg) {
  let best = null, bd = 1e9;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = Math.hypot(p[0] - tg[0], p[1] - tg[1]);
    if (d < bd) { bd = d; best = [i, p]; }
  }
  return best;
}

const alandur = [80.201533, 13.004223];
console.log('blue near alandur', near(blue, alandur));
console.log('green near alandur', near(green, alandur));

function window(pts, lo, hi, step = 5) {
  const o = [];
  for (let i = lo; i < hi && i < pts.length; i += step) o.push([i, pts[i]]);
  return o;
}
console.log('blue around 60-140:', window(blue, 60, 140, 5));
console.log('green around 20-120:', window(green, 20, 120, 5));
console.log('blue around 110-140 step1:', window(blue, 110, 140, 1));
console.log('green around 35-70 step1:', window(green, 35, 70, 1));
console.log('blue 118-128 step1:', window(blue, 118, 128, 1));
console.log('green 40-46 step1:', window(green, 40, 46, 1));
