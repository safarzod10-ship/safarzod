/**
 * 3D city field (three.js): orthographic camera at the Clash-of-Clans-like
 * angle, grass ground, tufts and flowers in the wind, warm sun with soft
 * shadows, touch controls (one finger pans, two fingers pinch and pan,
 * mouse wheel zooms at the cursor, inertia).
 *
 * World units: 1 = one build tile, y up, the field centred on the origin.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  OrthographicCamera,
  PCFShadowMap,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { createNoise2D } from 'simplex-noise';
import { createGrassMaterial, type GrassUniforms } from './grass.ts';
import { createTufts, type Tufts } from './tufts.ts';

export interface FieldOptions {
  /** buildable field side, tiles */
  size: number;
  /** camera pitch above the ground, degrees */
  pitch?: number;
  /** camera yaw, degrees (45 = diamond tiles) */
  yaw?: number;
}

export class FieldView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  readonly sun: DirectionalLight;
  readonly grass: GrassUniforms;
  readonly tufts: Tufts;
  readonly ground: Mesh;
  readonly target = new Vector3();
  private readonly el: HTMLElement;
  private readonly clock = new Timer();
  private readonly half: number;
  private pitch: number;
  private yaw: number;
  /** world units visible vertically at zoom 1 */
  private readonly viewH = 18;
  private readonly minZoom: number;
  private readonly maxZoom = 2.6;
  private readonly ray = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private velocity = new Vector3();
  private lastMove = 0;
  private pinchDist = 0;
  onFrame: ((dt: number, t: number) => void) | null = null;

  constructor(el: HTMLElement, opts: FieldOptions) {
    this.el = el;
    this.half = opts.size / 2;
    this.pitch = ((opts.pitch ?? 42) * Math.PI) / 180;
    this.yaw = ((opts.yaw ?? 45) * Math.PI) / 180;
    this.minZoom = 0.32;

    const r = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    el.appendChild(r.domElement);
    this.renderer = r;

    this.scene.background = new Color('#3d7a2a');
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.camera.zoom = 0.75;

    // light: blue sky / warm ground bounce and a low warm sun from the upper left
    this.scene.add(new HemisphereLight('#dff1ff', '#5a7a2a', 1.55));
    const sun = new DirectionalLight('#fff1d6', 2.4);
    sun.position.set(-30, 46, -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -this.half - 8;
    sc.right = sc.top = this.half + 8;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    const span = opts.size + 160;
    const { material, uniforms } = createGrassMaterial(this.half);
    uniforms.uSun2.value.set(sun.position.x, sun.position.z).normalize();
    this.grass = uniforms;
    const ground = new Mesh(new PlaneGeometry(span, span), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const noise = createNoise2D(() => 0.37);
    const area = opts.size + 40;
    this.tufts = createTufts({
      area,
      count: Math.round(area * area * 1.4),
      flowers: Math.round(area * area * 0.12),
      density: (x, z) => {
        const n = noise(x * 0.045, z * 0.045) * 0.5 + noise(x * 0.2, z * 0.2) * 0.3;
        const wild = Math.max(Math.abs(x), Math.abs(z)) > this.half ? 0.35 : 0;
        return Math.min(1, Math.max(0.04, 0.35 + n * 0.8 + wild));
      },
    });
    for (const m of this.tufts.meshes) this.scene.add(m);

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  /** Camera direction (from target to eye). */
  private eyeDir(): Vector3 {
    return new Vector3(
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    );
  }

  setAngles(pitchDeg: number, yawDeg = 45): void {
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.updateCamera();
  }

  private resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    const a = w / h;
    this.camera.left = (-this.viewH * a) / 2;
    this.camera.right = (this.viewH * a) / 2;
    this.camera.top = this.viewH / 2;
    this.camera.bottom = -this.viewH / 2;
    this.updateCamera();
  }

  private updateCamera(): void {
    const lim = this.half + 4;
    this.target.x = Math.max(-lim, Math.min(lim, this.target.x));
    this.target.z = Math.max(-lim, Math.min(lim, this.target.z));
    this.camera.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.camera.zoom));
    this.camera.position.copy(this.target).addScaledVector(this.eyeDir(), 120);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** Ground point under a client (CSS px) position. */
  groundAt(cx: number, cy: number): Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new Vector3();
    return this.ray.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  /** Zoom keeping the ground point under (cx, cy) in place. */
  zoomAt(factor: number, cx: number, cy: number): void {
    const before = this.groundAt(cx, cy);
    this.camera.zoom *= factor;
    this.updateCamera();
    const after = this.groundAt(cx, cy);
    if (before && after) {
      this.target.add(before.sub(after));
      this.updateCamera();
    }
  }

  /** Pointer handlers may be taken over (placing a building). */
  dragHook: ((phase: 'down' | 'move' | 'up', cx: number, cy: number) => boolean) | null = null;
  private dragging = false;

  private bindInput(): void {
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.velocity.set(0, 0, 0);
      if (this.pointers.size === 1 && this.dragHook?.('down', e.clientX, e.clientY)) this.dragging = true;
      if (this.pointers.size === 2) {
        this.dragging = false;
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (this.dragging) {
        this.pointers.set(e.pointerId, cur);
        this.dragHook?.('move', cur.x, cur.y);
        return;
      }
      if (this.pointers.size === 1) {
        const a = this.groundAt(prev.x, prev.y);
        const b = this.groundAt(cur.x, cur.y);
        if (a && b) {
          const d = a.sub(b);
          this.target.add(d);
          const now = performance.now();
          const dt = Math.max(1, now - this.lastMove);
          this.velocity.copy(d).multiplyScalar(1000 / dt);
          this.lastMove = now;
          this.updateCamera();
        }
      } else if (this.pointers.size === 2) {
        const others = [...this.pointers.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
        const o = others[0];
        const midPrev = { x: (prev.x + o.x) / 2, y: (prev.y + o.y) / 2 };
        const midCur = { x: (cur.x + o.x) / 2, y: (cur.y + o.y) / 2 };
        const dist = Math.hypot(cur.x - o.x, cur.y - o.y);
        if (this.pinchDist > 0) this.zoomAt(dist / this.pinchDist, midCur.x, midCur.y);
        this.pinchDist = dist;
        const a = this.groundAt(midPrev.x, midPrev.y);
        const b = this.groundAt(midCur.x, midCur.y);
        if (a && b) {
          this.target.add(a.sub(b));
          this.updateCamera();
        }
      }
      this.pointers.set(e.pointerId, cur);
    });
    const up = (e: PointerEvent): void => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.dragging && this.pointers.size === 0) {
        this.dragging = false;
        this.dragHook?.('up', e.clientX, e.clientY);
        this.velocity.set(0, 0, 0);
      }
      if (performance.now() - this.lastMove > 80) this.velocity.set(0, 0, 0);
      this.pinchDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  private frame(): void {
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    if (this.pointers.size === 0 && this.velocity.lengthSq() > 1e-4) {
      this.target.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(Math.exp(-dt * 5));
      this.updateCamera();
    }
    this.grass.uTime.value = t;
    this.tufts.uniforms.uTime.value = t;
    // keep the shadow camera on the visible part of the field
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).add(new Vector3(-30, 46, -18));
    this.onFrame?.(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
}
