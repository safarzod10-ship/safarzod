// Рендер 3D-ядер в headless Chromium (WebGL2 = GLES 3.0) для проверки дизайна.
// node jarvis/tools/shader_preview/render.js <out_dir> [mode] [state] [time]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SH = path.resolve(__dirname, '../../android/app/src/main/assets/shaders');
const read = (f) => fs.readFileSync(path.join(SH, f), 'utf8');

const STATES = {
  idle:      { colA: [0.33, 0.85, 1.0], colB: [0.10, 0.32, 0.95], energy: 0.15, level: 0.0, think: 0.0 },
  listening: { colA: [0.40, 0.95, 1.0], colB: [0.12, 0.45, 1.0], energy: 0.7, level: 0.45, think: 0.0 },
  thinking:  { colA: [0.70, 0.55, 1.0], colB: [0.25, 0.20, 0.95], energy: 0.6, level: 0.0, think: 1.0 },
  speaking:  { colA: [0.45, 0.92, 1.0], colB: [0.15, 0.40, 1.0], energy: 1.0, level: 0.8, think: 0.0 },
  error:     { colA: [1.0, 0.36, 0.30], colB: [0.75, 0.10, 0.18], energy: 0.5, level: 0.2, think: 0.0 },
};

function page(mode, state, time, W, H) {
  const s = STATES[state];
  return `<!doctype html><html><body style="margin:0;background:#000">
<canvas id=c width=${W} height=${H} style="width:${W}px;height:${H}px"></canvas>
<script>
const MODE=${JSON.stringify(mode)};
const S=${JSON.stringify(s)};
const T=${time};const CY=${process.env.CY||'(W===H?0.5:0.40)'};const RAD=${process.env.RAD||'(W===H?0.30:0.21)'};
const common=${JSON.stringify(read('common.glsl'))};
const fr={plasma:${JSON.stringify(read('core_plasma.frag'))},gyro:${JSON.stringify(read('core_gyro.frag'))},glow:${JSON.stringify(read('core_glow.frag'))}};
const pv=${JSON.stringify(read('particles.vert'))};
const pf=${JSON.stringify(read('particles.frag'))};
const head='#version 300 es\\nprecision highp float;\\nprecision highp int;\\n';
const c=document.getElementById('c');
const gl=c.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){throw new Error(gl.getShaderInfoLog(s)+'\\n');}return s;}
function prog(vs,fs){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
const fsq='#version 300 es\\nlayout(location=0) in vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}';
const W=c.width,H=c.height;
function setU(p,steps){
  gl.useProgram(p);
  const u=(n)=>gl.getUniformLocation(p,n);
  gl.uniform2f(u('uRes'),W,H);gl.uniform1f(u('uTime'),T);gl.uniform1f(u('uLevel'),S.level);
  gl.uniform1f(u('uEnergy'),S.energy);gl.uniform1f(u('uThink'),S.think);
  gl.uniform3fv(u('uColA'),S.colA);gl.uniform3fv(u('uColB'),S.colB);gl.uniform2f(u('uRot'),0.0,0.0);
  gl.uniform3f(u('uFrame'),W*0.5,H*(1-CY),Math.min(W,H)*RAD);gl.uniform1f(u('uIntro'),1.0);
  gl.uniform1i(u('uSteps'),steps);gl.uniform1f(u('uPointScale'),W/1080*2.6);
}
try{
const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
const fname=MODE==='particles'?'glow':MODE;
const p=prog(fsq,head+common+'\\n'+fr[fname]);
setU(p,MODE==='gyro'?96:28);
gl.viewport(0,0,W,H);gl.enable(gl.SCISSOR_TEST);
for(let y=0;y<H;y+=16){for(let x=0;x<W;x+=W/2){gl.scissor(x,y,W/2,16);gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();}}
gl.disable(gl.SCISSOR_TEST);
if(MODE==='particles'){
  const N=9000;const d=new Float32Array(N*4);const ga=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<N;i++){const y=1-(i+0.5)/N*2;const r=Math.sqrt(1-y*y);const th=ga*i;d[i*4]=Math.cos(th)*r;d[i*4+1]=y;d[i*4+2]=Math.sin(th)*r;let h=Math.sin(i*12.9898)*43758.5453;d[i*4+3]=h-Math.floor(h);}
  const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW);
  const pvao=gl.createVertexArray();gl.bindVertexArray(pvao);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);
  const pp=prog(head+pv,head+pf);setU(pp,0);
  gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.POINTS,0,N);
}
gl.finish();document.body.setAttribute('data-img',c.toDataURL('image/png'));document.title='OK';
}catch(e){document.title='ERR';document.body.setAttribute('data-err',String(e.message||e));}
</script></body></html>`;
}

(async () => {
  const out = process.argv[2];
  const modes = process.argv[3] ? process.argv[3].split(',') : ['plasma', 'gyro', 'particles'];
  const states = process.argv[4] ? process.argv[4].split(',') : ['idle'];
  const time = parseFloat(process.argv[5] || '7.3');
  const W = parseInt(process.argv[6] || '540'), H = parseInt(process.argv[7] || '960');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const m of modes) for (const s of states) {
    const pg = await browser.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(page(m, s, time, W, H));
    await pg.waitForFunction(() => document.title === 'OK' || document.title === 'ERR', null, { timeout: 1200000, polling: 1000 });
    const title = await pg.title();
    if (title === 'ERR') {
      console.log(m, s, 'ERROR:', await pg.evaluate(() => document.body.getAttribute('data-err')));
      continue;
    }
    const f = path.join(out, `${m}_${s}.png`);
    const durl = await pg.evaluate(() => document.body.getAttribute('data-img'));
    fs.writeFileSync(f, Buffer.from(durl.split(',')[1], 'base64'));
    console.log('saved', f);
    await pg.close();
  }
  await browser.close();
})();
