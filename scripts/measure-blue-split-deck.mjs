import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.resolve('src/data/chennaiMetroData.ts'), 'utf8');

const BLUE_MARKER = 'coordinates: [[80.164159,12.980818]';
const blueStart = src.indexOf(BLUE_MARKER);
if (blueStart < 0) {
  console.error('BLUE marker not found');
  process.exit(1);
}

const raw = src.slice(blueStart);
const bodyStart = raw.indexOf('[[80.164159,12.980818]') + 1;
const body = raw.slice(bodyStart);

// Parse the full blue-line coordinate array in a single pass.
const coords = [];
{
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '[') {
      depth++;
      if (depth === 1) buf = '';
      else buf += ch;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const trimmed = buf.trim().replace(/^\[/, '').replace(/\]$/, '');
        const parts = trimmed.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          coords.push(parts);
        }
      } else if (depth > 0) {
        buf += ch;
      }
    } else if (depth >= 1) {
      buf += ch;
    }
  }
}

console.log('Blue coordinate count:', coords.length);

// Cheap equator-norm meters for rough distance estimates.
function metersPerDegreeLat(lat) {
  return 111194.8;
}
function metersPerDegreeLon(lat) {
  return 111194.8 * Math.cos((lat * Math.PI) / 180);
}

function distMetersBetween(a, b, lat) {
  const dlat = (b[1] - a[1]) * metersPerDegreeLat(lat);
  const dlon = (b[0] - a[0]) * metersPerDegreeLon(lat);
  return Math.hypot(dlat, dlon);
}

// Locate Alandur.
const ALANDUR = [80.201533, 13.004223];
let alandurIndex = 0;
{
  let best = 1e9;
  for (let i = 0; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - ALANDUR[0], coords[i][1] - ALANDUR[1]);
    if (d < best) { best = d; alandurIndex = i; }
  }
}
console.log('Alandur nearest index:', alandurIndex);
console.log('Alandur coord:', coords[alandurIndex]);

// Print a window around Alandur.
console.log('\nBLUE window around Alandur:');
for (let i = alandurIndex - 6; i <= alandurIndex + 6; i++) {
  if (i >= 0 && i < coords.length) {
    const c = coords[i];
    const d = (i === alandurIndex) ? 0 : distMetersBetween(coords[alandurIndex], c, c[1]);
    console.log(`  [${i}] ${c[0].toFixed(6)}, ${c[1].toFixed(6)}  ${d.toFixed(1)}m`);
  }
}

// Rough segment lengths.
console.log('\nCumulative length of Blue line (approx):');
let total = 0;
let last = coords[0];
for (let i = 1; i < coords.length; i++) {
  total += distMetersBetween(last, coords[i], last[1]);
  last = coords[i];
}
console.log('Total Blue length (approx):', total.toFixed(1), 'm');

// Print the index position relative to Alandur as fraction of length.
const beforeLength = (() => {
  let acc = 0;
  let last = coords[0];
  for (let i = 1; i < alandurIndex; i++) {
    acc += distMetersBetween(last, coords[i], last[1]);
    last = coords[i];
  }
  return acc;
})();
console.log('Length from start to Alandur (approx):', beforeLength.toFixed(1), 'm');
console.log('Alandur position as % of total Blue length:', (100 * beforeLength / total).toFixed(2), '%');
