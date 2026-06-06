// Minimal PNG top-crop (no deps): keep the top `newH` rows of an 8-bit PNG.
// Used to extract the 1200x630 og card that qlmanage renders top-anchored in a square.
// Usage: node brand/crop-top.cjs <in.png> <out.png> <newHeight>
const zlib = require('zlib');
const fs = require('fs');

const [,, inPath, outPath, newHArg] = process.argv;
const newH = parseInt(newHArg, 10);
const buf = fs.readFileSync(inPath);

const CRC = (() => { const t = new Uint32Array(256);
  for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); t[n]=c; } return t; })();
function crc32(b){ let c=0xffffffff; for(let i=0;i<b.length;i++) c=CRC[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type,data){ const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb=Buffer.from(type,'ascii'); const cr=Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([tb,data])));
  return Buffer.concat([len,tb,data,cr]); }

let p = 8, width, height, bitDepth, colorType, idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p+4, p+8);
  const data = buf.subarray(p+8, p+8+len);
  if (type === 'IHDR') { width=data.readUInt32BE(0); height=data.readUInt32BE(4); bitDepth=data[8]; colorType=data[9]; }
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  p += 12 + len;
}
if (bitDepth !== 8) throw new Error('only 8-bit PNG supported, got '+bitDepth);
const bpp = ({0:1,2:3,4:2,6:4})[colorType];
if (!bpp) throw new Error('unsupported colorType '+colorType);

const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width*bpp + 1;
const out = Buffer.alloc(width*bpp*height);
function paeth(a,b,c){ const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; }
for (let y=0;y<height;y++){
  const ft = raw[y*stride];
  const row = raw.subarray(y*stride+1, y*stride+1+width*bpp);
  const o = y*width*bpp, oPrev = (y-1)*width*bpp;
  for (let x=0;x<width*bpp;x++){
    const a = x>=bpp ? out[o+x-bpp] : 0;
    const b = y>0 ? out[oPrev+x] : 0;
    const c = (x>=bpp && y>0) ? out[oPrev+x-bpp] : 0;
    let v = row[x];
    if (ft===1) v=(v+a)&0xff; else if (ft===2) v=(v+b)&0xff;
    else if (ft===3) v=(v+((a+b)>>1))&0xff; else if (ft===4) v=(v+paeth(a,b,c))&0xff;
    out[o+x]=v;
  }
}

const keep = Math.min(newH, height);
const rows = [];
for (let y=0;y<keep;y++){ const r=Buffer.alloc(1+width*bpp); r[0]=0; out.copy(r,1,y*width*bpp,(y+1)*width*bpp); rows.push(r); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(keep,4); ihdr[8]=8; ihdr[9]=colorType;
const png = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), {level:9})),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, png);
console.log(`cropped ${width}x${height} -> ${width}x${keep}  ${outPath}`);
