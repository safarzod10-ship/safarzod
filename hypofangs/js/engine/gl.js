// WebGL sprite batcher with a 2D light buffer (URP 2D style: lit sprites are multiplied by the light texture).

const SPRITE_VS = `
attribute vec2 aPos; attribute vec2 aUV; attribute vec4 aCol; attribute float aLit;
uniform vec4 uCam; // cx, cy, 1/halfW, 1/halfH
varying vec2 vUV; varying vec4 vCol; varying float vLit;
void main(){ vUV=aUV; vCol=aCol; vLit=aLit; gl_Position=vec4((aPos.x-uCam.x)*uCam.z,(aPos.y-uCam.y)*uCam.w,0.0,1.0); }`;
const SPRITE_FS = `
precision mediump float;
uniform sampler2D uTex; uniform sampler2D uLight; uniform vec2 uView;
varying vec2 vUV; varying vec4 vCol; varying float vLit;
void main(){
  vec4 c=texture2D(uTex,vUV)*vCol;
  if(c.a<0.004) discard;
  if(vLit>0.5){ c.rgb*=texture2D(uLight,gl_FragCoord.xy/uView).rgb*2.0; }
  gl_FragColor=c;
}`;
const LIGHT_VS = `
attribute vec2 aPos; attribute vec2 aLocal;
uniform vec4 uCam; varying vec2 vLocal;
void main(){ vLocal=aLocal; gl_Position=vec4((aPos.x-uCam.x)*uCam.z,(aPos.y-uCam.y)*uCam.w,0.0,1.0); }`;
const LIGHT_FS = `
precision mediump float;
uniform vec4 uL; uniform vec3 uColor; varying vec2 vLocal;
void main(){
  float d=length(vLocal);
  float t=clamp((uL.y-d)/max(0.0001,uL.y-uL.x),0.0,1.0);
  float a=pow(t,1.0+uL.z*2.0);
  gl_FragColor=vec4(uColor*uL.w*a*0.5,1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const MAXQ = 6000;
const STRIDE = 28; // 2 pos, 2 uv (floats) + 4 color bytes + 1 lit float

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl; this.canvas = canvas;
    this.sp = compile(gl, SPRITE_VS, SPRITE_FS);
    this.lp = compile(gl, LIGHT_VS, LIGHT_FS);
    this.buf = new ArrayBuffer(MAXQ * 4 * STRIDE);
    this.f32 = new Float32Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint16Array(MAXQ * 6);
    for (let i = 0; i < MAXQ; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.loc = {
      aPos: gl.getAttribLocation(this.sp, "aPos"), aUV: gl.getAttribLocation(this.sp, "aUV"), aCol: gl.getAttribLocation(this.sp, "aCol"), aLit: gl.getAttribLocation(this.sp, "aLit"),
      uCam: gl.getUniformLocation(this.sp, "uCam"), uTex: gl.getUniformLocation(this.sp, "uTex"), uLight: gl.getUniformLocation(this.sp, "uLight"), uView: gl.getUniformLocation(this.sp, "uView"),
      lPos: gl.getAttribLocation(this.lp, "aPos"), lLocal: gl.getAttribLocation(this.lp, "aLocal"), lCam: gl.getUniformLocation(this.lp, "uCam"),
      lL: gl.getUniformLocation(this.lp, "uL"), lColor: gl.getUniformLocation(this.lp, "uColor"),
    };
    this.lightVbo = gl.createBuffer();
    this.n = 0; this.tex = null;
    this.white = this.makeTexture(null);
    this.lightTex = null; this.lightFbo = null; this.lw = 0; this.lh = 0;
  }
  makeTexture(img) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  updateTexture(t, img) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  deleteTexture(t) { this.gl.deleteTexture(t); }
  ensureLight(w, h) {
    const gl = this.gl;
    const lw = Math.max(1, w >> 1), lh = Math.max(1, h >> 1);
    if (this.lw === lw && this.lh === lh) return;
    this.lw = lw; this.lh = lh;
    if (this.lightTex) { gl.deleteTexture(this.lightTex); gl.deleteFramebuffer(this.lightFbo); }
    this.lightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lightFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // cam: {x, y, halfW, halfH}; global: [r,g,b] * intensity already applied; lights: [{x,y,inR,outR,falloff,r,g,b,i}]
  lightPass(cam, global, lights) {
    const gl = this.gl, L = this.loc;
    this.ensureLight(this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.viewport(0, 0, this.lw, this.lh);
    gl.clearColor(Math.min(1, global[0] * 0.5), Math.min(1, global[1] * 0.5), Math.min(1, global[2] * 0.5), 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (lights.length) {
      gl.useProgram(this.lp);
      gl.uniform4f(L.lCam, cam.x, cam.y, 1 / cam.halfW, 1 / cam.halfH);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightVbo);
      for (const l of lights) {
        const R = l.outR;
        const v = new Float32Array([l.x - R, l.y - R, -R, -R, l.x + R, l.y - R, R, -R, l.x - R, l.y + R, -R, R, l.x + R, l.y + R, R, R]);
        gl.bufferData(gl.ARRAY_BUFFER, v, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(L.lPos); gl.vertexAttribPointer(L.lPos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(L.lLocal); gl.vertexAttribPointer(L.lLocal, 2, gl.FLOAT, false, 16, 8);
        gl.uniform4f(L.lL, l.inR, l.outR, l.falloff, l.i);
        gl.uniform3f(L.lColor, l.r, l.g, l.b);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.disableVertexAttribArray(L.lPos); gl.disableVertexAttribArray(L.lLocal);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  begin(cam, bg) {
    const gl = this.gl, L = this.loc;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.sp);
    gl.uniform4f(L.uCam, cam.x, cam.y, 1 / cam.halfW, 1 / cam.halfH);
    gl.uniform2f(L.uView, this.canvas.width, this.canvas.height);
    gl.uniform1i(L.uTex, 0); gl.uniform1i(L.uLight, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lightTex || this.white);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(L.aUV); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(L.aCol); gl.vertexAttribPointer(L.aCol, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.enableVertexAttribArray(L.aLit); gl.vertexAttribPointer(L.aLit, 1, gl.FLOAT, false, STRIDE, 20);
    this.n = 0; this.tex = null; this.draws = 0;
  }
  // corners: x0,y0 (u0,v1) bottom-left, x1,y1 bottom-right, x2,y2 top-left, x3,y3 top-right
  quad(tex, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, r, g, b, a, lit) {
    if (tex !== this.tex || this.n >= MAXQ) { this.flush(); this.tex = tex; }
    const f = this.f32, u8 = this.u8;
    let o = this.n * 4 * 7;
    const R = Math.max(0, Math.min(255, r * 255)) | 0, G = Math.max(0, Math.min(255, g * 255)) | 0, B = Math.max(0, Math.min(255, b * 255)) | 0, A = Math.max(0, Math.min(255, a * 255)) | 0;
    const L = lit ? 1 : 0;
    const put = (x, y, u, v) => {
      f[o] = x; f[o + 1] = y; f[o + 2] = u; f[o + 3] = v;
      const bo = (o + 4) * 4; u8[bo] = R; u8[bo + 1] = G; u8[bo + 2] = B; u8[bo + 3] = A;
      f[o + 5] = L; o += 7;
    };
    put(x0, y0, u0, v1); put(x1, y1, u1, v1); put(x2, y2, u0, v0); put(x3, y3, u1, v0);
    this.n++;
  }
  flush() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32.subarray(0, this.n * 4 * 7));
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_SHORT, 0);
    this.n = 0; this.draws++;
  }
  end() { this.flush(); }
}
