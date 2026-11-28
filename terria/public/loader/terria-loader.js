/*!
 * TERRIA — cinematic WebGL2 loading screen.
 *
 * Usage:
 *   <script src="terria-loader.js" data-logo="terria-logo.webp" data-bg="bg.webp"></script>
 *   TerriaLoader.set(0.42);   // progress 0..1
 *   TerriaLoader.done();      // finish: waits for the intro, plays the exit, removes itself
 *   TerriaLoader.fail(text);  // show an error instead of the progress bar
 *   TerriaLoader.introDone    // true once the logo has finished assembling
 * Events on window: terria-loader-intro (logo assembled), terria-loader-reveal (the
 * screen starts to fade out), terria-loader-done (removed).
 *
 * TERRIA game: the scene is rendered with a transparent background over the picture
 * given in data-bg (shown as it is, cover-fitted). ?nosplash skips the loader.
 *
 * Pipeline: logo texture → CPU-derived height/normal + grass mask → ~1500 instanced
 * 3D fragments that fly in and lock together (with extruded thickness), lit by a moving
 * sun with normal mapping, grass that grows and sways in the wind, depth-of-field dust and
 * falling crumbs → post pass (god rays, bloom, ACES tone map, vignette, grain).
 * Falls back to a CSS version without WebGL2; honours prefers-reduced-motion.
 */
(() => {
'use strict';
const SCRIPT = document.currentScript;
const LOGO_URL = (SCRIPT && SCRIPT.dataset.logo) || 'terria-logo.webp';
const BG_URL = (SCRIPT && SCRIPT.dataset.bg) || '';
const emit = (name) => dispatchEvent(new Event(name));
if (/[?&]nosplash(=|&|$)/.test(location.search)) {
  window.TerriaLoader = { set() {}, done() { emit('terria-loader-reveal'); emit('terria-loader-done'); }, fail(m) { console.error(m); },
    introDone: true, progress: 1 };
  return;
}
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- timeline (seconds) ----------
const T_ASSEMBLED = 4.6;   // last fragment lands
const T_INTRO_END = 6.6;   // grass grown, camera settled; done() can exit after this
const EXIT_DUR = 1.7;
// Regions in logo UV space (v down)
const LETTERS_V = 0.762;
const region = (u, v) => v > LETTERS_V ? 2 : ((u > 0.636) || (u < 0.36 && v > 0.257)) ? 1 : 0; // 0 body,1 arc,2 letters

// ---------- DOM ----------
const css = `
#terria-loader{position:fixed;inset:0;z-index:2147483000;background:#5b8c40 center/cover no-repeat;overflow:hidden;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .8s ease}
#terria-loader.tl-gone{opacity:0;pointer-events:none}
#terria-loader canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#terria-loader .tl-ui{position:absolute;left:50%;bottom:clamp(40px,11vh,110px);transform:translateX(-50%);
  width:min(64vw,380px);opacity:0;transition:opacity 1s ease}
#terria-loader.tl-ui-on .tl-ui{opacity:1}
#terria-loader.tl-exit .tl-ui{opacity:0;transition-duration:.35s}
#terria-loader .tl-track{position:relative;height:3px;background:rgba(30,20,8,.45);border-radius:3px;overflow:visible;box-shadow:0 1px 3px rgba(0,0,0,.35)}
#terria-loader .tl-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;
  background:linear-gradient(90deg,#5b3b1e,#9b6a35 40%,#a7d443 85%,#e4ff9a);box-shadow:0 0 10px rgba(170,230,80,.55),0 0 2px rgba(255,240,180,.8)}
#terria-loader .tl-fill::after{content:"";position:absolute;right:-8px;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;
  background:radial-gradient(rgba(255,250,210,.95),rgba(200,255,120,.35) 35%,transparent 70%)}
#terria-loader .tl-row{display:flex;justify-content:space-between;margin-top:12px;color:#fbf1d8;font-size:10.5px;
  letter-spacing:.42em;text-transform:uppercase;font-variant-numeric:tabular-nums;
  text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 10px rgba(0,0,0,.55)}
#terria-loader .tl-row b{font-weight:600;color:#fff;letter-spacing:.18em}
#terria-loader.tl-failed .tl-track,#terria-loader.tl-failed .tl-row b{display:none}
#terria-loader.tl-failed .tl-row{justify-content:center;text-align:center;letter-spacing:.04em;text-transform:none;font-size:14px;line-height:1.4}
#terria-loader .tl-fallback{position:absolute;left:50%;top:44%;width:min(76vw,620px);transform:translate(-50%,-50%);
  animation:tl-fb 7s ease-in-out infinite;filter:drop-shadow(0 20px 30px #000)}
@keyframes tl-fb{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-10px)}}`;
const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
const root = document.createElement('div');
root.id = 'terria-loader';
root.setAttribute('role', 'progressbar'); root.setAttribute('aria-label', 'Загрузка TERRIA');
root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '100');
root.innerHTML = `<canvas></canvas><div class="tl-ui"><div class="tl-track"><div class="tl-fill"></div></div>
  <div class="tl-row"><span>Загрузка</span><b>0%</b></div></div>`;
if (BG_URL) root.style.backgroundImage = `url("${BG_URL}")`;
(document.body || document.documentElement).appendChild(root);
const canvas = root.querySelector('canvas');
const fillEl = root.querySelector('.tl-fill'), pctEl = root.querySelector('.tl-row b');

// ---------- public API (works even before WebGL is up) ----------
let target = 0, shown = 0, doneRequested = false, exitStart = -1, removed = false, introDone = false, failed = false;
window.TerriaLoader = {
  set(p) { target = Math.max(target, Math.min(1, +p || 0)); },
  done() { if (!failed) { doneRequested = true; target = 1; } },
  fail(msg) {
    failed = true; doneRequested = false;
    root.classList.add('tl-ui-on', 'tl-failed'); root.querySelector('.tl-row span').textContent = msg;
  },
  get progress() { return shown; },
  get introDone() { return introDone; }
};
const markIntro = () => { if (!introDone) { introDone = true; emit('terria-loader-intro'); } };
// The animation starts once the logo and the background picture are both there
// (the picture never holds it up for more than 3 s).
let bgReady = !BG_URL;
if (BG_URL) {
  const bg = new Image(); bg.decoding = 'async';
  bg.onload = bg.onerror = () => { bgReady = true; }; bg.src = BG_URL;
  setTimeout(() => { bgReady = true; }, 3000);
}

const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
if (!gl) return fallback();

// ---------- helpers ----------
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function prog(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
function tex(w, h, data, linear = true, fmt = gl.RGBA8, srcFmt = gl.RGBA, type = gl.UNSIGNED_BYTE) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, srcFmt, type, data);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
let seed = 1337; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- shaders ----------
const COMMON = `#version 300 es
precision highp float;
uniform mat4 uVP; uniform float uTime, uExit;`;

const FRAG_VS = COMMON + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aUV;      // u0 v0 u1 v1
layout(location=2) in vec4 aHome;    // x y w h (world)
layout(location=3) in vec4 aStart;   // xyz, spin amount
layout(location=4) in vec4 aAxis;    // xyz axis, delay
layout(location=5) in vec4 aMisc;    // duration, seed, region, -
uniform float uLayer;                // 0 = face, >0 = extrusion layers behind
out vec2 vUV; out vec3 vN0; out float vAlpha, vLayer, vLand; out mat3 vRot;
mat3 rotAxis(vec3 a, float ang){ a=normalize(a); float s=sin(ang),c=cos(ang),oc=1.-c;
  return mat3(oc*a.x*a.x+c, oc*a.x*a.y+a.z*s, oc*a.z*a.x-a.y*s,
              oc*a.x*a.y-a.z*s, oc*a.y*a.y+c, oc*a.y*a.z+a.x*s,
              oc*a.z*a.x+a.y*s, oc*a.y*a.z-a.x*s, oc*a.z*a.z+c); }
float easeOutBack(float x){ float c1=1.25, c3=c1+1.; return 1.+c3*pow(x-1.,3.)+c1*pow(x-1.,2.); }
void main(){
  float delay=aAxis.w, dur=aMisc.x, sd=aMisc.y;
  float p=clamp((uTime-delay)/dur,0.,1.);
  float e = aMisc.z>1.5 ? easeOutBack(p) : 1.-pow(1.-p,4.);
  // path: start → arc over a curved trajectory → home
  vec3 home=vec3(aHome.xy, 0.);
  vec3 mid = mix(aStart.xyz, home, .5) + vec3(0., .35, .6)*(1.-abs(aStart.y)*.2);
  float q=1.-pow(1.-p,2.2);
  vec3 pos = mix(mix(aStart.xyz,mid,q), mix(mid,home,q), q);
  pos = mix(pos, home, smoothstep(.75,1.,p));
  mat3 R = rotAxis(aAxis.xyz, aStart.w*(1.-e));
  float scl = mix(.35,1.,smoothstep(0.,.6,p));
  // exit: fragments blast away from the camera-facing plane
  float x=clamp(uExit*1.5 - sd*.5, 0., 1.);
  vec3 dir=normalize(vec3(aHome.xy*1.3 + (vec2(sd,fract(sd*7.3))-.5)*.9, .9+sd));
  pos += dir*x*x*4.5 + vec3(0.,-1.,0.)*x*x*x*1.2;
  R = rotAxis(aAxis.zxy, x*x*9.*(sd+.3)) * R;
  scl *= 1.-x*.4;
  vec3 local = vec3(aCorner*aHome.zw*1.012*scl, -uLayer);
  vec3 wp = pos + R*local;
  gl_Position = uVP*vec4(wp,1.);
  vUV = mix(aUV.xy, aUV.zw, vec2(aCorner.x+.5, .5-aCorner.y));
  vRot = R; vAlpha = smoothstep(0.,.18,p)*(1.-smoothstep(.55,1.,x)); vLayer=uLayer; vLand=p;
}`;

const FRAG_FS = COMMON + `
uniform sampler2D uAlb, uNrm; uniform vec3 uSun; uniform vec2 uGrow; uniform float uLit;
in vec2 vUV; in float vAlpha, vLayer, vLand; in mat3 vRot;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
void main(){
  vec4 nm = texture(uNrm, vUV);
  float grassM = nm.a;
  // grass growth: front sweeps top→bottom inside each region (symbol / letters)
  bool letters = vUV.y > ${LETTERS_V.toFixed(3)};
  float lv = letters ? (vUV.y-${LETTERS_V.toFixed(3)})/(1.-${LETTERS_V.toFixed(3)}) : vUV.y/${LETTERS_V.toFixed(3)};
  float g = letters ? uGrow.y : uGrow.x;
  float front = g*1.25 - .12 + (noise(vUV*vec2(60.,25.))-.5)*.18;
  float grown = smoothstep(lv-.06, lv+.02, front);
  // wind: only grass pixels sway, more at blade tips (high-frequency gust field)
  float gust = noise(vec2(vUV.x*6. - uTime*.55, uTime*.2))*.8+.2;
  vec2 uv = vUV + vec2(sin(uTime*2.3 + vUV.x*55. + vUV.y*30.)*.0012, 0.)*grassM*grown*gust;
  vec4 alb = texture(uAlb, uv);
  if (alb.a < .04) discard;
  vec3 col = alb.rgb;
  float L = dot(col, vec3(.3,.59,.11));
  vec3 dirt = vec3(L*.95, L*.66, L*.42) * (.85 + .3*noise(vUV*180.));
  float gm = grassM * (1.-grown*.999);
  col = mix(col, dirt, gm);
  // blades appear with a fresh bright tint at the growth front
  col += vec3(.18,.32,.02)*grassM*smoothstep(.12,0.,abs(front-lv))*g*(1.-g)*4.;
  // lighting
  vec3 n = normalize(vRot*(nm.xyz*2.-1.));
  vec3 Ld = normalize(uSun);
  float dif = max(dot(n,Ld),0.);
  vec3 H = normalize(Ld+vec3(0,0,1));
  float rock = (1.-grassM)*smoothstep(.15,.5,L);
  float spec = pow(max(dot(n,H),0.), 28.)*rock*.55 + pow(max(dot(n,H),0.),6.)*grassM*grown*.12;
  float rim = pow(1.-max(n.z,0.),2.)*.35;
  vec3 sunC = vec3(1.,.86,.62);
  vec3 lit = col*(vec3(.34,.36,.42) + sunC*dif*.8) + sunC*spec + vec3(.55,.75,.35)*rim*grassM;
  // extrusion layers: dark soil sides with gentle falloff
  if (vLayer > 0.) lit = col*vec3(.16,.12,.09)*(1.-vLayer*3.) ;
  lit *= uLit;
  // freshly landing fragments flash slightly (impact)
  lit += vec3(.5,.42,.3)*smoothstep(.85,1.,vLand)*(1.-smoothstep(1.,1.,vLand))*.0;
  o = vec4(lit, alb.a*vAlpha);
}`;

const DUST_VS = COMMON + `
layout(location=0) in vec4 aP;   // seed xyz, kind
uniform vec2 uRes; uniform float uFocus;
out float vA, vBlur; out vec3 vC;
float h(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec3 s=aP.xyz; float kind=aP.w; vec3 p; float a; float size;
  if (kind < .5) {           // floating dust in a volume
    p = vec3((s.x-.5)*5.5, mod(s.y*3.2 + uTime*(.03+.05*s.z), 3.2)-1.6, (s.z-.5)*3.2);
    p.x += sin(uTime*.35 + s.y*20.)*.08; p.z += cos(uTime*.3 + s.x*17.)*.06;
    a = (.35+.65*h(s.x*91.))*smoothstep(0.,1.5,uTime)*(.6+.4*sin(uTime*1.3+s.z*30.));
    size = .010 + .016*h(s.y*13.);
  } else if (kind < 1.5) {   // crumbs falling from the logo's lower edges (looping)
    float per = 2.4 + s.z*2.5, t = mod(uTime + s.y*per, per), on = step(${T_ASSEMBLED.toFixed(1)}, uTime - t);
    p = vec3((s.x-.5)*1.9, -.25 - s.z*.35 - 1.6*t*t, .02);
    a = on*(1.-t/per)*.9; size = .008 + .01*s.y;
  } else {                   // assembly dust swirl converging to the logo
    float t = clamp(uTime/${T_ASSEMBLED.toFixed(1)},0.,1.);
    float ang = s.x*6.283 + t*3.5*(s.z+.5), r = mix(2.4+s.y*1.4, .25+s.y*.6, pow(t,.7));
    p = vec3(cos(ang)*r*1.2, sin(ang)*r*.55, (s.z-.5)*1.2*(1.-t));
    a = smoothstep(0.,.15,t)*(1.-smoothstep(.75,1.,t))*.8; size=.012+.01*s.z;
  }
  vec4 c = uVP*vec4(p,1.);
  gl_Position = c;
  float depth = c.w;
  vBlur = clamp(abs(depth-uFocus)*.55, 0., 1.);
  gl_PointSize = clamp(size*uRes.y/depth*(1.+vBlur*4.), 1., 64.);
  vA = a*(1.-uExit)*mix(1.,.25,vBlur);
  vC = kind<.5 ? vec3(1.,.88,.66) : kind<1.5 ? vec3(.42,.30,.18) : vec3(.75,.6,.42);
}`;
const DUST_FS = `#version 300 es
precision highp float; in float vA, vBlur; in vec3 vC; out vec4 o;
void main(){ vec2 d=gl_PointCoord-.5; float r=length(d)*2.;
  float m = mix(1.-smoothstep(.55,1.,r), (1.-smoothstep(.75,1.,r))*(.55+.45*smoothstep(.5,.95,r)), vBlur);
  o = vec4(vC*m*vA, m*vA); }`;

const SHADOW_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform float uA; out vec4 o;
void main(){ vec2 d=(vUV-.5)*vec2(2.,2.); float m=exp(-dot(d,d)*3.2); o=vec4(0.,0.,0.,m*uA); }`;
const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aCorner; uniform mat4 uVP; uniform vec4 uRect; out vec2 vUV;
void main(){ vUV=aCorner+.5; vec3 p=vec3(uRect.x+aCorner.x*uRect.z, uRect.y, aCorner.y*uRect.w); gl_Position=uVP*vec4(p,1.); }`;

const POST_VS = `#version 300 es
layout(location=0) in vec2 aCorner; out vec2 vUV; void main(){ vUV=aCorner+.5; gl_Position=vec4(aCorner*2.,0.,1.); }`;
const BRIGHT_FS = `#version 300 es
precision highp float; uniform sampler2D uSrc; in vec2 vUV; out vec4 o;
void main(){ vec3 c=texture(uSrc,vUV).rgb; float l=dot(c,vec3(.3,.59,.11)); o=vec4(c*smoothstep(.62,1.,l),1.); }`;
const BLUR_FS = `#version 300 es
precision highp float; uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUV; out vec4 o;
void main(){ vec3 c=texture(uSrc,vUV).rgb*.227;
  c+=(texture(uSrc,vUV+uDir*1.385).rgb+texture(uSrc,vUV-uDir*1.385).rgb)*.316;
  c+=(texture(uSrc,vUV+uDir*3.231).rgb+texture(uSrc,vUV-uDir*3.231).rgb)*.070; o=vec4(c,1.); }`;
const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom; uniform vec2 uLightPos, uRes; uniform float uTime, uRays, uFade;
in vec2 vUV; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  // chromatic fringe towards the edges
  vec2 dc = vUV-.5; float ca = dot(dc,dc)*.006;
  vec4 sc = texture(uScene,vUV);
  vec3 c = vec3(texture(uScene,vUV+dc*ca).r, sc.g, texture(uScene,vUV-dc*ca).b);
  vec3 b = texture(uBloom,vUV).rgb;
  // volumetric light shafts: march from pixel towards the sun, sampling the bright buffer
  vec2 st = (vUV-uLightPos)/48.*.9; vec2 uv=vUV; float dec=1.; vec3 rays=vec3(0.);
  float j = hash(vUV*uRes+uTime);
  uv -= st*j;
  for(int i=0;i<48;i++){ uv-=st; rays+=texture(uBloom,uv).rgb*dec; dec*=.955; }
  rays *= .03*uRays;
  // soft sky glow around light source
  float lg = exp(-length((vUV-uLightPos)*vec2(uRes.x/uRes.y,1.))*3.2)*.10*uRays;
  vec3 col = c + b*.45 + rays*vec3(1.,.85,.6) + lg*vec3(1.,.8,.55);
  col = aces(col*1.25);
  float vig = smoothstep(1.15,.35,length(dc*vec2(uRes.x/uRes.y*.75,1.)));
  col *= mix(.25,1.,vig);
  // transparent background: alpha = logo coverage, light (rays, bloom) shows as a haze
  float a = clamp(max(sc.a, max(col.r, max(col.g, col.b))), 0., 1.);
  col += (hash(vUV*uRes + fract(uTime)*91.)-.5)*.022*sc.a;
  col = pow(max(col, vec3(0.)), vec3(.97,1.,1.03));      // slight warm grade
  col = min(col, vec3(a));
  o = vec4(col, a)*uFade;
}`;

// ---------- programs & geometry ----------
let P;
try {
  P = {
    frag: prog(FRAG_VS, FRAG_FS), dust: prog(DUST_VS, DUST_FS), shadow: prog(QUAD_VS, SHADOW_FS),
    bright: prog(POST_VS, BRIGHT_FS), blur: prog(POST_VS, BLUR_FS), final: prog(POST_VS, FINAL_FS)
  };
} catch (e) { console.error('[TerriaLoader]', e); return fallback(); }

const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5,-.5, .5,-.5, -.5,.5, .5,.5]), gl.STATIC_DRAW);
const quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

let fragVAO, fragCount = 0, dustVAO, dustCount = 0, albTex, nrmTex, logoAspect = 1.5, ready = false;

// dust particles: 0 = ambient dust, 1 = falling crumbs, 2 = assembly swirl
(() => {
  const N0 = 420, N1 = 70, N2 = 520, a = [];
  for (let i = 0; i < N0; i++) a.push(rnd(), rnd(), rnd(), 0);
  for (let i = 0; i < N1; i++) a.push(rnd(), rnd(), rnd(), 1);
  for (let i = 0; i < N2; i++) a.push(rnd(), rnd(), rnd(), 2);
  dustCount = N0 + N1 + N2;
  dustVAO = gl.createVertexArray(); gl.bindVertexArray(dustVAO);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
})();

// ---------- logo analysis ----------
const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async'; img.src = LOGO_URL;
img.onerror = () => fallback();
img.onload = () => {
  const W = img.naturalWidth, H = img.naturalHeight; logoAspect = W / H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  let data; try { data = x.getImageData(0, 0, W, H).data; } catch (e) { return fallback(); } // file:// taint
  const N = W * H, hgt = new Float32Array(N), grass = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3] / 255;
    const L = (r*.3 + g*.59 + b*.11) / 255;
    hgt[i] = a * (.55 + .45*L);                          // silhouette + luminance relief
    grass[i] = Math.max(0, Math.min(1, Math.min((g - r*.85) / 25, (g - b - 20) / 30)));
  }
  const blur = (src, rad) => {                          // separable box blur
    const tmp = new Float32Array(N), out = new Float32Array(N), k = 1 / (2*rad + 1);
    for (let y = 0; y < H; y++) { let s = 0; for (let i = -rad; i <= rad; i++) s += src[y*W + Math.min(W-1, Math.max(0, i))];
      for (let xx = 0; xx < W; xx++) { tmp[y*W+xx] = s*k; s += src[y*W + Math.min(W-1, xx+rad+1)] - src[y*W + Math.max(0, xx-rad)]; } }
    for (let xx = 0; xx < W; xx++) { let s = 0; for (let i = -rad; i <= rad; i++) s += tmp[Math.min(H-1, Math.max(0, i))*W + xx];
      for (let y = 0; y < H; y++) { out[y*W+xx] = s*k; s += tmp[Math.min(H-1, y+rad+1)*W + xx] - tmp[Math.max(0, y-rad)*W + xx]; } }
    return out;
  };
  const hb = blur(blur(hgt, 3), 2), hf = blur(hgt, 1), gb = blur(grass, 1);
  const nrm = new Uint8Array(N * 4);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y*W + xx, l = Math.max(0, xx-1), r = Math.min(W-1, xx+1), u = Math.max(0, y-1), d = Math.min(H-1, y+1);
    // two-scale relief: big bevel from soft height + fine detail from sharp height
    const dx = (hb[y*W+r] - hb[y*W+l]) * 9 + (hf[y*W+r] - hf[y*W+l]) * 5;
    const dy = (hb[d*W+xx] - hb[u*W+xx]) * 9 + (hf[d*W+xx] - hf[u*W+xx]) * 5;
    let nx = -dx, ny = dy, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    nrm[i*4] = (nx*.5+.5)*255; nrm[i*4+1] = (ny*.5+.5)*255; nrm[i*4+2] = (nz*.5+.5)*255;
    nrm[i*4+3] = Math.min(1, gb[i]*1.5) * 255;
  }
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  albTex = tex(W, H, null); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  nrmTex = tex(W, H, nrm);

  // ---------- fragments ----------
  const T = Math.round(W / 52), WW = 2.0, HH = WW / logoAspect, inst = [];
  for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
    const tw = Math.min(T, W - tx), th = Math.min(T, H - ty);
    let cnt = 0; for (let yy = ty; yy < ty+th; yy += 2) for (let xx = tx; xx < tx+tw; xx += 2) if (data[(yy*W+xx)*4+3] > 40) cnt++;
    if (cnt < 2) continue;
    const u0 = tx/W, v0 = ty/H, u1 = (tx+tw)/W, v1 = (ty+th)/H, uc = (u0+u1)/2, vc = (v0+v1)/2;
    const reg = region(uc, vc);
    const hx = (uc - .5) * WW, hy = (.5 - vc) * HH, w = tw/W*WW, h = th/H*HH;
    let delay, dur, sx, sy, sz;
    const ang = rnd() * Math.PI * 2, dist = 2.2 + rnd() * 2.6;
    if (reg === 0) {          // body rises from below/depth, top first
      delay = .25 + rnd()*1.3 + vc*1.1; dur = 1.25 + rnd()*.6;
      sx = hx*1.6 + Math.cos(ang)*dist*.8; sy = -2.4 - rnd()*1.6; sz = -2.5 + rnd()*3.4;
    } else if (reg === 1) {   // arc sweeps in along its curve direction
      const right = uc > .5, along = right ? (uc - .636)/.364 : (.36 - uc)/.36;
      delay = 1.7 + along*.9 + rnd()*.35; dur = .95 + rnd()*.35;
      sx = hx + (right ? 2.8 : -2.8) + rnd()*.6; sy = hy + (right ? 1.6 : -.6) + (rnd()-.5)*.8; sz = 1.2 + rnd()*1.4;
    } else {                  // letters drop from above, left→right, with bounce
      delay = 2.7 + uc*1.25 + rnd()*.18; dur = .75 + rnd()*.2;
      sx = hx + (rnd()-.5)*.6; sy = hy + 2.6 + rnd()*1.2; sz = .4 + rnd()*1.2;
    }
    const spin = (2.5 + rnd()*5) * (rnd() < .5 ? -1 : 1);
    inst.push(u0, v0, u1, v1,  hx, hy, w, h,  sx, sy, sz, spin,
              rnd()-.5, rnd()-.5, rnd()-.5, delay,  dur, rnd(), reg, 0);
  }
  fragCount = inst.length / 20;
  fragVAO = gl.createVertexArray(); gl.bindVertexArray(fragVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
  for (let k = 0; k < 5; k++) { gl.enableVertexAttribArray(1+k); gl.vertexAttribPointer(1+k, 4, gl.FLOAT, false, 80, k*16); gl.vertexAttribDivisor(1+k, 1); }
  ready = true; tStart = -1;
};

// ---------- render targets ----------
let fbScene, fbA, fbB, rtW = 0, rtH = 0;
function makeRT(w, h) {
  const t = tex(w, h, null), f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, f, w, h };
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (w === rtW && h === rtH) return;
  canvas.width = rtW = w; canvas.height = rtH = h;
  [fbScene, fbA, fbB].forEach(r => r && (gl.deleteTexture(r.t), gl.deleteFramebuffer(r.f)));
  fbScene = makeRT(w, h);
  const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
  fbA = makeRT(bw, bh); fbB = makeRT(bw, bh);
}

// ---------- math ----------
function persp(fov, asp, n, f) { const t = 1/Math.tan(fov/2), nf = 1/(n-f);
  return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; }
function lookAt(e, c, up) {
  const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,e),-dot(y,e),-dot(z,e),1]; }
function mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
  let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+j] * b[i*4+k]; o[i*4+j] = s; } return o; }
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]], dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), sstep = (a, b, x) => { const t = clamp((x-a)/(b-a), 0, 1); return t*t*(3-2*t); };
function project(m, p) { const x = m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], y = m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], w = m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];
  return [(x/w)*.5+.5, (y/w)*.5+.5]; }

// pointer / device-tilt parallax
let px = 0, py = 0, spx = 0, spy = 0;
addEventListener('pointermove', e => { px = e.clientX/innerWidth*2-1; py = e.clientY/innerHeight*2-1; }, { passive: true });
addEventListener('deviceorientation', e => { if (e.gamma != null) { px = clamp(e.gamma/30, -1, 1); py = clamp((e.beta-45)/30, -1, 1); } }, { passive: true });

// ---------- frame ----------
let tStart = -1, last = 0;
function frame(now) {
  if (removed) return;
  requestAnimationFrame(frame);
  if (window.__TL_CLOCK) now = window.__TL_CLOCK();   // deterministic capture hook
  // progress UI (smoothed)
  shown += (target - shown) * Math.min(1, (now - last) / 1000 * 4); last = now;
  if (target - shown < .002) shown = target;
  const pct = Math.round(shown * 100);
  fillEl.style.width = (shown * 100) + '%'; pctEl.textContent = pct + '%'; root.setAttribute('aria-valuenow', pct);

  if (!ready || !bgReady) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
  if (tStart < 0) tStart = now;
  let t = (now - tStart) / 1000;
  if (REDUCED) t = Math.max(t, T_INTRO_END + 1);
  if (t > 1.2) root.classList.add('tl-ui-on');
  if (t > T_INTRO_END) markIntro();

  if (doneRequested && exitStart < 0 && t > T_INTRO_END && shown > .995) { exitStart = t; root.classList.add('tl-exit'); }
  const ex = exitStart < 0 ? 0 : clamp((t - exitStart) / EXIT_DUR, 0, 1);
  if (ex >= 1 && !removed) { finish(); return; }

  resize();
  const asp = rtW / rtH;
  // camera: dolly-out from a low, close angle to a calm hero shot; then idle drift + parallax
  spx += (px - spx) * .04; spy += (py - spy) * .04;
  const intro = sstep(0, T_INTRO_END + .4, t), idle = sstep(T_INTRO_END - 1, T_INTRO_END + 1, t);
  const fitDist = Math.max(3.0, (1.25 / Math.tan(20 * Math.PI/180)) / Math.min(asp, 1.9));
  const dist = fitDist * (0.78 + 0.22*intro) * (1 + ex*.15);
  const yaw = (1-intro)*-.38 + idle*(Math.sin(t*.23)*.10 + spx*.16);
  const pitch = (1-intro)*-.22 + idle*(Math.sin(t*.31)*.05 - spy*.09);
  const eye = [Math.sin(yaw)*Math.cos(pitch)*dist, Math.sin(pitch)*dist + .08, Math.cos(yaw)*Math.cos(pitch)*dist];
  const view = lookAt(eye, [0, .02 + (1-intro)*-.1, 0], [Math.sin(t*.17)*.012*idle, 1, 0]);
  const VP = mul(persp(40 * Math.PI/180, asp, .05, 50), view);

  // sun: sweeps across, then settles into a slow arc
  const sa = -1.1 + 1.6*sstep(.5, T_INTRO_END + 1, t) + Math.sin(t*.25)*.35*idle;
  const sun = [Math.sin(sa)*.9, .75 + Math.cos(t*.2)*.1, .85];
  const lit = sstep(.0, 1.6, t);

  // ---- scene pass ----
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbScene.f); gl.viewport(0, 0, rtW, rtH);
  gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // contact shadow on an invisible ground under the logo
  gl.useProgram(P.shadow.p); gl.uniformMatrix4fv(P.shadow.u.uVP, false, VP);
  gl.uniform4f(P.shadow.u.uRect, 0, -2/logoAspect*.5 - .08, 2.6, 1.1);
  gl.uniform1f(P.shadow.u.uA, .85 * sstep(1.5, T_ASSEMBLED, t) * (1-ex));
  gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // fragments: extrusion layers back→front, then the lit face
  gl.useProgram(P.frag.p); const u = P.frag.u;
  gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uExit, ex);
  gl.uniform3f(u.uSun, ...sun); gl.uniform1f(u.uLit, lit);
  gl.uniform2f(u.uGrow, sstep(T_ASSEMBLED - 1.6, T_ASSEMBLED + 1.0, t), sstep(T_ASSEMBLED - .2, T_INTRO_END - .1, t));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, albTex); gl.uniform1i(u.uAlb, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, nrmTex); gl.uniform1i(u.uNrm, 1);
  gl.bindVertexArray(fragVAO);
  for (const L of [.09, .07, .05, .035, .02, .01]) { gl.uniform1f(u.uLayer, L); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, fragCount); }
  gl.uniform1f(u.uLayer, 0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, fragCount);

  // dust (additive, premultiplied)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(P.dust.p); gl.uniformMatrix4fv(P.dust.u.uVP, false, VP);
  gl.uniform1f(P.dust.u.uTime, t); gl.uniform1f(P.dust.u.uExit, ex); gl.uniform2f(P.dust.u.uRes, rtW, rtH); gl.uniform1f(P.dust.u.uFocus, dist);
  gl.bindVertexArray(dustVAO); gl.drawArrays(gl.POINTS, 0, dustCount);
  gl.disable(gl.BLEND);

  // ---- post ----
  gl.bindVertexArray(quadVAO);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbA.f); gl.viewport(0, 0, fbA.w, fbA.h);
  gl.useProgram(P.bright.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbScene.t); gl.uniform1i(P.bright.u.uSrc, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.uSrc, 0);
  for (let i = 0; i < 2; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbB.f); gl.bindTexture(gl.TEXTURE_2D, fbA.t); gl.uniform2f(P.blur.u.uDir, (1+i)/fbA.w, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbA.f); gl.bindTexture(gl.TEXTURE_2D, fbB.t); gl.uniform2f(P.blur.u.uDir, 0, (1+i)/fbA.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, rtW, rtH);
  const f = P.final; gl.useProgram(f.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbScene.t); gl.uniform1i(f.u.uScene, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbA.t); gl.uniform1i(f.u.uBloom, 1);
  const lp = project(VP, [sun[0]*2.2, 1.9, -1.5]);
  gl.uniform2f(f.u.uLightPos, lp[0], lp[1]); gl.uniform2f(f.u.uRes, rtW, rtH); gl.uniform1f(f.u.uTime, t);
  gl.uniform1f(f.u.uRays, sstep(T_ASSEMBLED - 1.5, T_INTRO_END, t) * (1 - ex*.6));
  gl.uniform1f(f.u.uFade, sstep(0, .6, t) * (1 - sstep(.55, 1, ex)));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
requestAnimationFrame(frame);

function finish() {
  removed = true; root.classList.add('tl-gone'); emit('terria-loader-reveal');
  setTimeout(() => { root.remove(); style.remove(); const ext = gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext();
    emit('terria-loader-done'); }, 850);
}

// ---------- fallback (no WebGL2 / tainted image) ----------
function fallback() {
  if (root.querySelector('.tl-fallback')) return;
  canvas.remove(); root.classList.add('tl-ui-on'); markIntro();
  const im = document.createElement('img'); im.className = 'tl-fallback'; im.src = LOGO_URL; im.alt = 'TERRIA';
  root.prepend(im);
  const tick = () => { if (removed) return;
    shown += (target - shown) * .08; if (target - shown < .002) shown = target;
    fillEl.style.width = shown*100 + '%'; pctEl.textContent = Math.round(shown*100) + '%';
    if (doneRequested && shown >= .995) { removed = true; root.classList.add('tl-gone'); emit('terria-loader-reveal'); setTimeout(() => { root.remove(); emit('terria-loader-done'); }, 850); return; }
    requestAnimationFrame(tick); };
  tick();
}
})();
