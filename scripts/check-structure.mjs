// Quick structural check: confirm blue-line and green-line are the only two entries
// and print their byte offsets + tail bytes so we can see what follows the arrays.
const fs = require('fs');
const src = fs.readFileSync('src/data/chennaiMetroData.ts', 'utf8');

const blueIdx = src.indexOf('"blue-line"');
const greenIdx = src.indexOf('"green-line"');
console.log('blue-line at', blueIdx);
console.log('green-line at', greenIdx);
console.log('gap (blue->green) bytes:', greenIdx - blueIdx);

// Print 120 chars from each start so we can confirm header shape.
console.log('\n--- BLUE HEAD ---');
console.log(src.slice(blueIdx, blueIdx + 120));

console.log('\n--- GREEN HEAD (with context before) ---');
console.log(src.slice(greenIdx - 120, greenIdx + 200));

// Print a chunk from the end of the blue array region so we can see transition text.
const blueEnd = src.indexOf(']', blueIdx);
console.log('\n--- around BLUE END ---');
console.log(src.slice(blueEnd - 60, blueEnd + 260));
