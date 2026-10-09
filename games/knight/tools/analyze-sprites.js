// Analyze a sprite sheet PNG: decode with zlib, print per-cell color map
// Usage: node tools/analyze-sprites.js <pngPath> <tileW> <tileH>
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let pos = 8, w, h, bitDepth, colorType, idat = [], plte = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  // unfilter
  let prev = Buffer.alloc(stride);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[off]; off++;
    const line = Buffer.from(raw.slice(off, off + stride)); off += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); break; }
      }
      line[x] = v & 0xff;
    }
    // write RGBA
    const ro = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (colorType === 3) {
        const idx = line[x * bpp];
        const a = trns && idx < trns.length ? trns[idx] : 255;
        if (plte) {
          out[ro + x * 4] = plte[idx * 3];
          out[ro + x * 4 + 1] = plte[idx * 3 + 1];
          out[ro + x * 4 + 2] = plte[idx * 3 + 2];
        }
        out[ro + x * 4 + 3] = a;
      } else {
        out[ro + x * 4] = line[x * bpp];
        out[ro + x * 4 + 1] = bpp > 1 ? line[x * bpp + 1] : line[x * bpp];
        out[ro + x * 4 + 2] = bpp > 2 ? line[x * bpp + 2] : line[x * bpp];
        out[ro + x * 4 + 3] = bpp > 3 ? line[x * bpp + 3] : 255;
      }
    }
    prev = line;
  }
  return { w, h, data: out };
}

const [, , pngPath, twS, thS] = process.argv;
const tw = parseInt(twS), th = parseInt(thS);
const { w, h, data } = decodePNG(fs.readFileSync(pngPath));
const cols = Math.floor(w / tw), rows = Math.floor(h / th);
console.log(`Sheet: ${w}x${h}, tiles ${cols}x${rows} (${tw}x${th}px)`);
console.log('Legend: . = empty, letter = dominant color, # = multi-color, size in (x,y)');
const name = ['R','G','B','C','M','Y','K','W','O','P','E'];
function colorLetter(c) {
  const [r, g, b, a] = c;
  if (a < 40) return '.';
  if (r > 200 && g > 200 && b > 200) return 'W';
  if (r < 70 && g < 70 && b < 70) return 'K';
  if (r > 180 && g < 110 && b < 110) return 'R';
  if (r < 110 && g > 150 && b < 110) return 'G';
  if (r < 110 && g < 110 && b > 180) return 'B';
  if (r > 150 && g > 150 && b < 110) return 'Y';
  if (r > 180 && g > 110 && b < 110) return 'O';
  if (r > 150 && g < 110 && b > 150) return 'P';
  if (r < 110 && g > 150 && b > 150) return 'C';
  if (r > 150 && g > 130 && b < 90) return 'M';
  return 'E';
}
for (let ty = 0; ty < rows; ty++) {
  let line = '';
  for (let tx = 0; tx < cols; tx++) {
    // sample the tile's center region, count colors & dominant
    const counts = {};
    let total = 0, dom = [0, 0, 0, 0], domN = 0;
    const seen = new Set();
    for (let y = 0; y < th; y += 2) for (let x = 0; x < tw; x += 2) {
      const i = ((ty * th + y) * w + tx * tw + x) * 4;
      const a = data[i + 3];
      if (a < 40) continue;
      total++;
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > domN) { domN = counts[key]; dom = [data[i], data[i + 1], data[i + 2], a]; }
      seen.add(key);
    }
    if (total === 0) { line += '  . '; continue; }
    const fill = Math.min(99, Math.round((total / ((th / 2) * (tw / 2))) * 100));
    const letter = seen.size >= 4 ? '#' : colorLetter(dom);
    line += `${letter}${String(fill).padStart(2, '0')} `;
  }
  console.log(`r${ty}: ${line}`);
}
