import fs from 'fs';
const txt = fs.readFileSync('src/data/chennaiMetroData.ts', 'utf8');
const extract = (label) => {
  const seg = txt.slice(txt.indexOf(label), txt.indexOf(label) + 500000);
  const m = seg.match(/coordinates:\s*\[([^\]]+)\]/s);
  const body = m ? m[1] : '';
  const out = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '[') { cur = ''; depth = 1; continue; }
    if (depth === 1) {
      if (ch === ',') {
        const p = cur.trim().split(',');
        if (p.length >= 2) out.push([parseFloat(p[0]), parseFloat(p[1].replace(']', ''))];
        cur = '';
      } else if (ch === ']') {
        const p = cur.trim().split(',');
        if (p.length >= 2) out.push([parseFloat(p[0]), parseFloat(p[1])]);
        depth = 0;
      } else { cur += ch; }
    }
  }
  return out;
};
const blue = extract('"blue-line"');
const green = extract('"green-line"');
console.log('blue len', blue.length, 'green len', green.length);
const alandur = [80.201533, 13.004223];
function near(pts) {
  let best = null, bd = 1e9;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = Math.hypot(p[0] - alandur[0], p[1] - alandur[1]);
    if (d < bd) { bd = d; best = [i, p]; }
  }
  return best;
}
console.log('blue alandur idx', near(blue));
console.log('green alandur idx', near(green));
console.log('blue 120-140');
for (let i = 120; i < 140; i++) if (i < blue.length) console.log(i, blue[i]);
console.log('green 42-60');
for (let i = 42; i < 60; i++) if (i < green.length) console.log(i, green[i]);
console.log('blue around 121');
for (let i = 115; i < 135; i++) if (i < blue.length) console.log(i, blue[i]);
console.log('green around 43');
for (let i = 38; i < 55; i++) if (i < green.length) console.log(i, green[i]);
