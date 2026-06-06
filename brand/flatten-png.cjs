// Flatten an RGBA PNG to opaque RGB (no alpha channel) over a solid bg.
// Apple App Store Connect REJECTS app icons that contain an alpha channel,
// so mobile/assets/icon.png must be opaque RGB. Usage:
//   node brand/flatten-png.cjs <in.png> <out.png> [#rrggbb]
const zlib = require('zlib');
const fs = require('fs');

const [,, inPath, outPath, bgHex='#0c0a18'] = process.argv;
const bg = [parseInt(bgHex.slice(1,3),16), parseInt(bgHex.slice(3,5),16), parseInt(bgHex.slice(5,7),16)];
const buf = fs.readFileSync(inPath);

const CRC = (() => { const t=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c;} return t; })();
const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const tb=Buffer.from(type,'ascii');
  const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(Buffer.concat([tb,data])));return Buffer.concat([len,tb,data,cr]);};

let p=8,width,height,bitDepth,colorType,idat=[];
while(p<buf.length){const len=buf.readUInt32BE(p),type=buf.toString('ascii',p+4,p+8),data=buf.subarray(p+8,p+8+len);
  if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];}
  else if(type==='IDAT')idat.push(data); else if(type==='IEND')break; p+=12+len;}
if(bitDepth!==8)throw new Error('only 8-bit PNG supported');
const bpp=({0:1,2:3,4:2,6:4})[colorType]; if(!bpp)throw new Error('unsupported colorType '+colorType);

const raw=zlib.inflateSync(Buffer.concat(idat));
const stride=width*bpp+1;
const px=Buffer.alloc(width*bpp*height);
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
for(let y=0;y<height;y++){const ft=raw[y*stride];const row=raw.subarray(y*stride+1,y*stride+1+width*bpp);
  const o=y*width*bpp,oP=(y-1)*width*bpp;
  for(let x=0;x<width*bpp;x++){const a=x>=bpp?px[o+x-bpp]:0,b=y>0?px[oP+x]:0,c=(x>=bpp&&y>0)?px[oP+x-bpp]:0;
    let v=row[x]; if(ft===1)v=(v+a)&255;else if(ft===2)v=(v+b)&255;else if(ft===3)v=(v+((a+b)>>1))&255;else if(ft===4)v=(v+paeth(a,b,c))&255;
    px[o+x]=v;}}

// composite over bg, emit RGB (colorType 2)
const outRows=[];
for(let y=0;y<height;y++){const r=Buffer.alloc(1+width*3);r[0]=0;
  for(let x=0;x<width;x++){const i=y*width*bpp+x*bpp;
    let R,G,B,A;
    if(colorType===6){R=px[i];G=px[i+1];B=px[i+2];A=px[i+3];}
    else if(colorType===2){R=px[i];G=px[i+1];B=px[i+2];A=255;}
    else {R=G=B=px[i];A=colorType===4?px[i+1]:255;}
    const af=A/255;
    r[1+x*3]  =Math.round(R*af+bg[0]*(1-af));
    r[1+x*3+1]=Math.round(G*af+bg[1]*(1-af));
    r[1+x*3+2]=Math.round(B*af+bg[2]*(1-af));
  }
  outRows.push(r);
}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;//RGB
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
  chunk('IDAT',zlib.deflateSync(Buffer.concat(outRows),{level:9})),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(outPath,png);
console.log(`flattened ${width}x${height} RGBA -> RGB (opaque) ${outPath}`);
