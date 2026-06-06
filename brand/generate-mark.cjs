// Plume Nexus master brand mark — "Rosette ×8 + Eye Hub" (chosen 2026-06-06).
// Eight iridescent plumes converging on a peacock-eye nexus, in a gold-ringed badge.
// Reproducible source of truth: emits the canonical SVGs. Run: node brand/generate-mark.cjs
const fs = require('fs');
const path = require('path');

const CREAM='#f6efdc', INK='#1d1338', GOLD='#f3da90', PLUM='#6a4fa0', DEEP='#2b1d4d', TEAL='#2a9d8f';

function hx(c){return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];}
function iriColor(t){
  const st=[[0,'#2b1d4d'],[0.3,'#2a9d8f'],[0.6,'#6a4fa0'],[1,'#f3da90']];
  let a=st[0],b=st[st.length-1];
  for(let i=0;i<st.length-1;i++){if(t>=st[i][0]&&t<=st[i+1][0]){a=st[i];b=st[i+1];break;}}
  const f=(t-a[0])/((b[0]-a[0])||1),ca=hx(a[1]),cb=hx(b[1]);
  return `rgb(${ca.map((v,i)=>Math.round(v+(cb[i]-v)*f)).join(',')})`;
}
function plume(o){
  const {grad='url(#pcV)',n=13,maxLen=8,T=4,B=33,bow=0,mono=false}=o;
  const cx=32, P={bx:cx,by:B,cx1:cx+bow,cy1:(T+B)/2,tx:cx,ty:T};
  const sp=t=>{const u=1-t;return{
    x:u*u*P.bx+2*u*t*P.cx1+t*t*P.tx, y:u*u*P.by+2*u*t*P.cy1+t*t*P.ty,
    dx:2*u*(P.cx1-P.bx)+2*t*(P.tx-P.cx1), dy:2*u*(P.cy1-P.by)+2*t*(P.ty-P.cy1)};};
  const geo=[];
  for(let i=0;i<n;i++){
    const t=i/(n-1);
    const s0=sp(t), tl=Math.hypot(s0.dx,s0.dy)||1, ux=s0.dx/tl, uy=s0.dy/tl;
    const baseLen=maxLen*Math.sin(Math.PI*Math.pow(t,0.8)), sw=(55-24*t)*Math.PI/180;
    for(const s of [-1,1]){
      const nx=-uy*s, ny=ux*s;
      let bdx=nx*Math.cos(sw)+ux*Math.sin(sw), bdy=ny*Math.cos(sw)+uy*Math.sin(sw);
      const bl=Math.hypot(bdx,bdy)||1; bdx/=bl; bdy/=bl;
      const L=baseLen; if(L<0.6)continue;
      const ex=s0.x+bdx*L, ey=s0.y+bdy*L;
      const pxs=-bdy,pys=bdx, wb=1.8*(0.32+0.9*Math.sin(Math.PI*t)), curl=s*0.9;
      const blx=s0.x-pxs*wb/2,bly=s0.y-pys*wb/2,brx=s0.x+pxs*wb/2,bry=s0.y+pys*wb/2;
      const c1x=s0.x+bdx*L*0.5+pxs*wb*0.2+nx*curl,c1y=s0.y+bdy*L*0.5+pys*wb*0.2+ny*curl;
      const c2x=s0.x+bdx*L*0.5-pxs*wb*0.2+nx*curl,c2y=s0.y+bdy*L*0.5-pys*wb*0.2+ny*curl;
      geo.push({t,s,rx:s0.x,ry:s0.y,ex,ey,
        d:`M${blx.toFixed(1)} ${bly.toFixed(1)} Q ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)} Q ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${brx.toFixed(1)} ${bry.toFixed(1)} Z`});
    }
  }
  const Lt=geo.filter(g=>g.s<0).sort((a,b)=>a.t-b.t), Rt=geo.filter(g=>g.s>0).sort((a,b)=>b.t-a.t);
  let uv=''; if(Lt.length&&Rt.length){let d=`M ${Lt[0].rx.toFixed(1)} ${Lt[0].ry.toFixed(1)} `;
    Lt.forEach(g=>d+=`L ${g.ex.toFixed(1)} ${g.ey.toFixed(1)} `); Rt.forEach(g=>d+=`L ${g.ex.toFixed(1)} ${g.ey.toFixed(1)} `);
    uv=`<path d="${d}Z" fill="${grad}" opacity="0.12"/>`;}
  if(mono){
    const m=geo.map(g=>`<path d="${g.d}" fill="#ffffff"/>`).join('');
    const r=`<path d="M${P.bx} ${P.by} Q ${P.cx1} ${P.cy1} ${P.tx} ${P.ty}" stroke="#ffffff" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
    return m+r;
  }
  const calamus=`<path d="M${P.bx-1.5} ${P.by-3} Q ${P.bx} ${P.by+5} ${P.bx+1.5} ${P.by-3} Z" fill="${GOLD}" opacity="0.5"/>`;
  const shadow=`<g transform="translate(0.8 0.9)" opacity="0.24">${geo.map(g=>`<path d="${g.d}" fill="${INK}"/>`).join('')}</g>`;
  const main=geo.map(g=>`<path d="${g.d}" fill="${iriColor(g.t)}" opacity="0.97"/>`).join('');
  const sheen=geo.filter(g=>g.t>0.22).map(g=>`<path d="M${g.rx.toFixed(1)} ${g.ry.toFixed(1)} L ${((g.rx+g.ex)/2).toFixed(1)} ${((g.ry+g.ey)/2).toFixed(1)}" stroke="${CREAM}" stroke-width="0.4" stroke-linecap="round" opacity="${(0.12+0.2*g.t).toFixed(2)}"/>`).join('');
  const rachis=`<path d="M${P.bx} ${P.by} Q ${P.cx1} ${P.cy1} ${P.tx} ${P.ty}" stroke="${GOLD}" stroke-width="1.7" fill="none" stroke-linecap="round" opacity="0.95"/>`;
  return uv+calamus+shadow+main+sheen+rachis;
}
function eyeHub(mono){return mono
  ?`<circle cx="32" cy="32" r="5.2" fill="none" stroke="#ffffff" stroke-width="1.8"/><circle cx="32" cy="32" r="2.4" fill="#ffffff"/>`
  :`<ellipse cx="32" cy="32" rx="5.2" ry="5.2" fill="${DEEP}"/><circle cx="32" cy="32" r="5.2" fill="none" stroke="${TEAL}" stroke-width="1.8"/><circle cx="32" cy="32" r="2.6" fill="${GOLD}"/><circle cx="32" cy="32" r="0.95" fill="${INK}"/>`;}
function rosette(count,mono){
  let g='';for(let i=0;i<count;i++)g+=`<g transform="rotate(${(360/count*i).toFixed(2)} 32 32)">${plume({mono})}</g>`;
  return g+eyeHub(mono);
}

const DEFS = `<defs>
    <linearGradient id="pcV" gradientUnits="userSpaceOnUse" x1="32" y1="3" x2="32" y2="60"><stop offset="0%" stop-color="#f3da90"/><stop offset="44%" stop-color="#7a5bb0"/><stop offset="100%" stop-color="#2b1d4d"/></linearGradient>
    <radialGradient id="pcR" gradientUnits="userSpaceOnUse" cx="32" cy="27" r="31"><stop offset="0%" stop-color="#6a4fa0"/><stop offset="100%" stop-color="#1d1338"/></radialGradient>
  </defs>`;

const ROSETTE = rosette(8);

// 1) Badge mark — circular roundel on transparent (favicon / web Logo / wordmark lockup)
const badge =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEFS}
  <circle cx="32" cy="32" r="27.5" fill="url(#pcR)"/>
  <circle cx="32" cy="32" r="27.5" fill="none" stroke="#f3da90" stroke-width="1.2" opacity="0.55"/>
  <g transform="translate(32 32) scale(0.82) translate(-32 -32)">${ROSETTE}</g>
</svg>`;

// 2) App icon — full-bleed rounded square (iOS/Android/PWA PNG source)
const appicon =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEFS}
  <rect x="0" y="0" width="64" height="64" rx="14" fill="#0c0a18"/>
  <circle cx="32" cy="32" r="29" fill="url(#pcR)"/>
  <circle cx="32" cy="32" r="29" fill="none" stroke="#f3da90" stroke-width="1.1" opacity="0.5"/>
  <g transform="translate(32 32) scale(0.92) translate(-32 -32)">${ROSETTE}</g>
</svg>`;

// 3) Bare rosette — no disc, transparent (Splash screen, floats on dark canvas)
const bare =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEFS}
  <g transform="translate(32 32) scale(1.04) translate(-32 -32)">${ROSETTE}</g>
</svg>`;

// 4) Monochrome white silhouette — Android notification icon (alpha-masked)
const mono =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g transform="translate(32 32) scale(1.05) translate(-32 -32)">${rosette(8,true)}</g>
</svg>`;

// 5) Android adaptive foreground — rosette scaled into the 66% safe zone, transparent
const adaptive =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEFS}
  <g transform="translate(32 32) scale(0.62) translate(-32 -32)">${ROSETTE}</g>
</svg>`;

const out = path.join(__dirname);
fs.writeFileSync(path.join(out,'plumenexus-mark.svg'), badge.trim()+'\n');
fs.writeFileSync(path.join(out,'plumenexus-appicon.svg'), appicon.trim()+'\n');
fs.writeFileSync(path.join(out,'plumenexus-rosette.svg'), bare.trim()+'\n');
fs.writeFileSync(path.join(out,'plumenexus-notification.svg'), mono.trim()+'\n');
fs.writeFileSync(path.join(out,'plumenexus-adaptive.svg'), adaptive.trim()+'\n');
console.log('wrote brand/plumenexus-mark.svg         (badge, transparent)');
console.log('wrote brand/plumenexus-appicon.svg      (full-bleed app icon)');
console.log('wrote brand/plumenexus-rosette.svg      (bare rosette, transparent)');
console.log('wrote brand/plumenexus-notification.svg (white mono silhouette)');
console.log('wrote brand/plumenexus-adaptive.svg     (android adaptive foreground)');
