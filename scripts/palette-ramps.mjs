/**
 * Builds full, gamut-safe brand ramps for the shortlisted hues and verifies AA before rendering.
 * Chroma is deliberately held well below the gamut maximum: at 92% of max these hues go neon,
 * which reads as a toy, not a marketplace.
 */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export function oklchToRgb(L, C, H) {
  const h=(H*Math.PI)/180, a=C*Math.cos(h), b=C*Math.sin(h);
  const l_=L+0.3963377774*a+0.2158037573*b, m_=L-0.1055613458*a-0.0638541728*b, s_=L-0.0894841775*a-1.291485548*b;
  const l=l_**3,m=m_**3,s=s_**3;
  const lr=+4.0767416621*l-3.3077115913*m+0.2309699292*s;
  const lg=-1.2684380046*l+2.6097574011*m-0.3413193965*s;
  const lb=-0.0041960863*l-0.7034186147*m+1.707614701*s;
  const gamma=(u)=>(u<=0.0031308?12.92*u:1.055*Math.pow(u,1/2.4)-0.055);
  return { r:clamp01(gamma(lr)), g:clamp01(gamma(lg)), b:clamp01(gamma(lb)),
           inGamut:[lr,lg,lb].every(v=>v>=-0.0001&&v<=1.0001) };
}
export const hexOf=({r,g,b})=>'#'+[r,g,b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
function relLum({r,g,b}){const lin=u=>u<=0.04045?u/12.92:((u+0.055)/1.055)**2.4;return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
export function wcag(c1,c2){const[a,b]=[relLum(c1),relLum(c2)].sort((x,y)=>y-x);return (a+0.05)/(b+0.05);}
function maxChroma(L,H){let lo=0,hi=0.4;for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(oklchToRgb(L/100,mid,H).inGamut)lo=mid;else hi=mid;}return lo;}

const STEPS = [50,100,200,300,400,500,600,700,800,900,950,1000];
const LS     = [97, 94, 88, 80, 72, 65, 58, 50, 42, 35, 27, 20];
// Chroma envelope: peaks mid-ramp, falls off at both ends, as the sRGB gamut narrows there.
// The top of the ramp is lifted deliberately — at the gamut-proportional value those tints
// come out near-grey, and brand-50/100/200 are exactly the steps that carry the visible brand
// wash on badge backgrounds and selected rows.
const ENV    = [0.55,0.62,0.72,0.80,0.90,0.96,1.00,0.94,0.82,0.68,0.52,0.40];

/** `intensity` scales the whole envelope: 1.0 = gamut edge (neon), ~0.62 = commerce-restrained. */
export function buildRamp(H, intensity = 0.62) {
  return LS.map((L, i) => {
    const C = maxChroma(L, H) * ENV[i] * intensity;
    const c = oklchToRgb(L / 100, C, H);
    return { step: STEPS[i], L, C: +C.toFixed(3), hex: hexOf(c), inGamut: c.inGamut, rgb: c };
  });
}

export const CANDIDATES = [
  { id: 'indigo',  name: 'Indigo',      hue: 275, intensity: 0.66 },
  { id: 'violet',  name: 'Violet',      hue: 295, intensity: 0.62 },
  { id: 'plum',    name: 'Plum',        hue: 320, intensity: 0.58 },
  { id: 'cyan',    name: 'Deep Cyan',   hue: 205, intensity: 0.80 },
];

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const white = oklchToRgb(1, 0, 0);
  for (const c of CANDIDATES) {
    const ramp = buildRamp(c.hue, c.intensity);
    const b600 = ramp.find(r => r.step === 600), b700 = ramp.find(r => r.step === 700);
    const b800 = ramp.find(r => r.step === 800), b300 = ramp.find(r => r.step === 300);
    const n950 = oklchToRgb(0.18, 0.014, 242.5), n0 = oklchToRgb(0.992, 0.002, 242.5);
    console.log(`\n## ${c.name} (hue ${c.hue})`);
    console.log('   ' + ramp.map(r => r.hex).join(' '));
    const oog = ramp.filter(r => !r.inGamut);
    console.log(`   out of gamut: ${oog.length ? oog.map(r=>r.step).join(',') : 'none'}`);
    console.log(`   white on brand-600 : ${wcag(white, b600.rgb).toFixed(2)}:1  ${wcag(white,b600.rgb)>=4.5?'PASS':'FAIL'}`);
    console.log(`   white on brand-700 : ${wcag(white, b700.rgb).toFixed(2)}:1  ${wcag(white,b700.rgb)>=4.5?'PASS':'FAIL'}`);
    console.log(`   white on brand-800 : ${wcag(white, b800.rgb).toFixed(2)}:1  (hover)`);
    console.log(`   brand-700 on white : ${wcag(b700.rgb, n0).toFixed(2)}:1  (link)  ${wcag(b700.rgb,n0)>=4.5?'PASS':'FAIL'}`);
    console.log(`   n950 on brand-300  : ${wcag(n950, b300.rgb).toFixed(2)}:1  (dark btn) ${wcag(n950,b300.rgb)>=4.5?'PASS':'FAIL'}`);
  }
}
