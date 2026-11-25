/* =========================================================
   Hero WebGL — liquid chrome that follows the cursor.
   Plain WebGL1, one fullscreen triangle, no dependencies.
   ========================================================= */
(function () {
  "use strict";

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2  uRes;
    uniform float uTime;
    uniform vec2  uMouse;     // -1..1-ish, aspect corrected
    uniform float uPower;     // cursor energy 0..1
    uniform float uIntro;     // 0 -> 1 on load
    uniform float uScroll;    // 0..1 hero scroll progress

    // --- noise (iq) ---
    vec2 hash(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }
    float noise(vec2 p) {
      const float K1 = 0.366025404;
      const float K2 = 0.211324865;
      vec2 i = floor(p + (p.x + p.y) * K1);
      vec2 a = p - i + (i.x + i.y) * K2;
      float m = step(a.y, a.x);
      vec2 o = vec2(m, 1.0 - m);
      vec2 b = a - o + K2;
      vec2 c = a - 1.0 + 2.0 * K2;
      vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
      vec3 n = h * h * h * h * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
      return dot(n, vec3(70.0));
    }
    float fbm(vec2 p) {
      float f = 0.0, a = 0.5;
      mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 4; i++) { f += a * noise(p); p = r * p; a *= 0.5; }
      return f;
    }

    float field(vec2 p, float t) {
      vec2 q = vec2(fbm(p + t * 0.05), fbm(p + vec2(5.2, 1.3) - t * 0.04));
      vec2 r = vec2(fbm(p + 1.3 * q + vec2(1.7, 9.2) + t * 0.07), fbm(p + 1.3 * q + vec2(8.3, 2.8) - t * 0.06));
      return fbm(p + 1.2 * r);
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      float t = uTime;

      // cursor: push the liquid away and swirl it
      vec2 d = uv - uMouse;
      float dl = length(d);
      float infl = exp(-dl * dl * 6.0) * (0.25 + uPower * 0.9);
      float ang = infl * 1.6;
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 p = uMouse + rot * d;
      p += normalize(d + 1e-4) * infl * 0.12;

      // intro: liquid "pours in" from a dense state
      float scale = mix(1.5, 0.62, uIntro) + uScroll * 0.4;
      p *= scale;
      p.y += uScroll * 1.0;

      float e = 0.03;
      float h  = field(p, t);
      float hx = field(p + vec2(e, 0.0), t);
      float hy = field(p + vec2(0.0, e), t);
      vec3 n = normalize(vec3((h - hx) / e * 0.32, (h - hy) / e * 0.32, 1.0));

      // fake environment: soft studio strips for chrome
      vec3 v = vec3(0.0, 0.0, 1.0);
      vec3 r = reflect(-v, n);
      float strip = r.y * 1.1 + r.x * 0.35 + h * 0.9;
      float env = 0.5 + 0.5 * sin(strip * 3.1415);
      env = smoothstep(0.45, 1.0, env);
      env = pow(env, 2.6);

      // iridescent tint: ultramarine / violet / cyan
      vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.60, 0.67, 0.77) + h * 0.6 + r.x * 0.25 + t * 0.015));
      vec3 base = mix(vec3(0.010, 0.010, 0.018), vec3(0.055, 0.04, 0.19), smoothstep(-0.2, 0.8, h));
      vec3 col = base + env * mix(vec3(0.80, 0.82, 0.95), iri, 0.45) * 0.62;

      // specular highlight
      vec3 L = normalize(vec3(-0.4 + uMouse.x * 0.3, 0.6, 0.9));
      float spec = pow(max(dot(reflect(-L, n), v), 0.0), 80.0);
      col += spec * vec3(1.0, 0.98, 1.0) * 0.6;

      // fresnel rim in signal blue
      float fr = pow(1.0 - n.z, 2.0);
      col += fr * vec3(0.23, 0.17, 1.0) * 1.1;

      // glow around cursor
      col += vec3(0.25, 0.2, 1.0) * exp(-dl * dl * 18.0) * 0.18 * (0.4 + uPower);

      // vignette + intro fade
      vec2 q = gl_FragCoord.xy / uRes;
      float vig = smoothstep(1.25, 0.25, length((q - 0.5) * vec2(1.1, 1.3)));
      col *= mix(0.3, 0.88, vig);
      col *= uIntro;
      col *= 1.0 - uScroll * 0.6;

      // dither to kill banding
      col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function HeroGL(canvas) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    if (!gl) { canvas.classList.add("no-gl"); this.ok = false; return; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { this.ok = false; return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.ok = false; return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    ["uRes", "uTime", "uMouse", "uPower", "uIntro", "uScroll"].forEach((n) => { this.u[n] = gl.getUniformLocation(prog, n); });

    this.ok = true;
    this.gl = gl;
    this.canvas = canvas;
    this.intro = 0;
    this.scroll = 0;
    this.time = Math.random() * 50;
    this.mouse = { x: 0.25, y: 0.05, tx: 0.25, ty: 0.05 };
    this.power = 0; this.targetPower = 0;
    this.visible = true;
    this.running = false;
    // Render the fluid at reduced resolution: it is soft by nature and this keeps mobiles cool.
    this.quality = Math.min(window.devicePixelRatio || 1, 2) * (window.innerWidth < 800 ? 0.5 : 0.6);

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();

    const onMove = (x, y) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (x - rect.left - rect.width / 2) / rect.height;
      const ny = -(y - rect.top - rect.height / 2) / rect.height;
      const dx = nx - this.mouse.tx, dy = ny - this.mouse.ty;
      this.targetPower = Math.min(1, this.targetPower + Math.sqrt(dx * dx + dy * dy) * 4);
      this.mouse.tx = nx; this.mouse.ty = ny;
    };
    window.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY), { passive: true });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        this.visible = entries[0].isIntersecting;
        if (this.visible) this.start();
      }).observe(canvas);
    }
  }

  HeroGL.prototype.resize = function () {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.quality));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.quality));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
    if (!this.running) this.draw();
  };

  HeroGL.prototype.draw = function () {
    const gl = this.gl, u = this.u;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform2f(u.uMouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(u.uPower, this.power);
    gl.uniform1f(u.uIntro, this.intro);
    gl.uniform1f(u.uScroll, this.scroll);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  HeroGL.prototype.frame = function (now) {
    if (!this.visible || this.paused) { this.running = false; return; }
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    this.mouse.x += (this.mouse.tx - this.mouse.x) * 0.06;
    this.mouse.y += (this.mouse.ty - this.mouse.y) * 0.06;
    this.targetPower *= 0.94;
    this.power += (this.targetPower - this.power) * 0.08;
    // idle drift when nobody moves the mouse (phones)
    if (this.power < 0.02) {
      this.mouse.tx = Math.sin(this.time * 0.35) * 0.45;
      this.mouse.ty = Math.cos(this.time * 0.27) * 0.22;
    }
    this.draw();
    requestAnimationFrame(this.frame);
  };

  HeroGL.prototype.start = function () {
    if (this.running || !this.ok) return;
    this.running = true;
    this.last = 0;
    requestAnimationFrame(this.frame);
  };

  window.HeroGL = HeroGL;
})();
