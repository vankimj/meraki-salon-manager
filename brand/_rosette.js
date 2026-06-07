// Shared compact feather-rosette renderer for the redesign mockups.
// Injects the Plume Nexus mark (8 iridescent plumes + peacock-eye hub) into any
// element with [data-rosette]. Attributes: data-size, data-disc ("1"=badge), data-mono.
(function () {
  const GOLD='#f3da90', INK='#1d1338', CREAM='#f6efdc', PLUM='#6a4fa0', DEEP='#2b1d4d', TEAL='#2a9d8f';
  const hx = c => [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
  function iri(t){
    const st=[[0,'#2b1d4d'],[0.3,'#2a9d8f'],[0.6,'#6a4fa0'],[1,'#f3da90']];
    let a=st[0],b=st[st.length-1];
    for(let i=0;i<st.length-1;i++){if(t>=st[i][0]&&t<=st[i+1][0]){a=st[i];b=st[i+1];break;}}
    const f=(t-a[0])/((b[0]-a[0])||1),ca=hx(a[1]),cb=hx(b[1]);
    return `rgb(${ca.map((v,i)=>Math.round(v+(cb[i]-v)*f)).join(',')})`;
  }
  function plume(){
    const n=13,maxLen=8,T=4,B=33,cx=32, geo=[];
    for(let i=0;i<n;i++){const t=i/(n-1),ry=B+(T-B)*t,rx=cx;
      const ang=(55-24*t)*Math.PI/180, baseLen=maxLen*Math.sin(Math.PI*Math.pow(t,0.8));
      for(const s of [-1,1]){const nx=-0*s, ny=s; // vertical spine
        let bdx=(-(-1))*0; // simplify: barbs go outward+up
        const ux=0,uy=-1, pnx=-uy*s, pny=ux*s;
        let dx=pnx*Math.cos(ang)+ux*Math.sin(ang), dy=pny*Math.cos(ang)+uy*Math.sin(ang);
        const dl=Math.hypot(dx,dy)||1; dx/=dl; dy/=dl;
        const L=baseLen; const ex=rx+dx*L, ey=ry+dy*L;
        const px=-dy,py=dx, wb=1.8*(0.32+0.9*Math.sin(Math.PI*t)), curl=s*0.9;
        const blx=rx-px*wb/2,bly=ry-py*wb/2,brx=rx+px*wb/2,bry=ry+py*wb/2;
        const c1x=rx+dx*L*.5+px*wb*.2+pnx*curl,c1y=ry+dy*L*.5+py*wb*.2+pny*curl;
        const c2x=rx+dx*L*.5-px*wb*.2+pnx*curl,c2y=ry+dy*L*.5-py*wb*.2+pny*curl;
        geo.push({t,d:`M${blx.toFixed(1)} ${bly.toFixed(1)} Q ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)} Q ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${brx.toFixed(1)} ${bry.toFixed(1)} Z`});
      }
    }
    const shadow=`<g transform="translate(0.7 0.8)" opacity="0.22">${geo.map(g=>`<path d="${g.d}" fill="${INK}"/>`).join('')}</g>`;
    const main=geo.map(g=>`<path d="${g.d}" fill="${iri(g.t)}"/>`).join('');
    const rach=`<path d="M${cx} ${B} L ${cx} ${T}" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round"/>`;
    return shadow+main+rach;
  }
  function eyeHub(){return `<ellipse cx="32" cy="32" rx="5.2" ry="5.2" fill="${DEEP}"/><circle cx="32" cy="32" r="5.2" fill="none" stroke="${TEAL}" stroke-width="1.8"/><circle cx="32" cy="32" r="2.6" fill="${GOLD}"/><circle cx="32" cy="32" r="0.95" fill="${INK}"/>`;}
  function rosetteInner(){let g='';for(let i=0;i<8;i++)g+=`<g transform="rotate(${(45*i).toFixed(1)} 32 32)">${plume()}</g>`;return g+eyeHub();}
  const INNER = rosetteInner();
  function svg(size, disc){
    const body = disc
      ? `<circle cx="32" cy="32" r="27.5" fill="url(#pcR)"/><circle cx="32" cy="32" r="27.5" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity="0.55"/><g transform="translate(32 32) scale(0.82) translate(-32 -32)">${INNER}</g>`
      : INNER;
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="display:block">
      <defs><radialGradient id="pcR" gradientUnits="userSpaceOnUse" cx="32" cy="27" r="31"><stop offset="0%" stop-color="#6a4fa0"/><stop offset="100%" stop-color="#1d1338"/></radialGradient></defs>
      ${body}</svg>`;
  }
  document.querySelectorAll('[data-rosette]').forEach(el=>{
    el.innerHTML = svg(+(el.dataset.size||48), el.dataset.disc==='1');
  });
})();
