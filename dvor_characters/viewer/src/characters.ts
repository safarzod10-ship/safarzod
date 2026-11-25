/**
 * DVOR character runtime: loading (Meshopt + optional KTX2), per-instance cloning,
 * animation state (7 shared clip names), LOD0/LOD1 switching.
 * Drop-in module for the game: depends only on three.js r187 addons.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const CLIP_NAMES = ['Idle', 'Run', 'Attack', 'Ability', 'Hit', 'Defeat', 'Victory'] as const;
export type ClipName = (typeof CLIP_NAMES)[number];
/**
 * Ground speed (m/s) at which each character's Run clip keeps the planted foot still (measured in
 * Blender, export/raw/*.build.json -> clips.Run.speed_mps). To move at another speed without foot
 * sliding, play Run with timeScale = speed / RUN_SPEED[id] (quicker steps).
 */
export const RUN_SPEED: Readonly<Record<string, number>> = {
  USER_CH_Technik: 2.35, USER_CH_Sprinter: 2.73, USER_CH_Tank: 1.75,   // CMU mocap runs
  CH_Technik: 4.5, CH_Sprinter: 5.6, CH_Tank: 3.8,                      // procedural set (approx.)
};
export const LOOPING: ReadonlySet<ClipName> = new Set<ClipName>(['Idle', 'Run', 'Victory']);
export const CHARACTER_IDS = ['CH_Technik', 'CH_Tank', 'CH_Sprinter'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export interface CharacterAsset {
  id: string;
  gltf: GLTF;
  clips: Map<ClipName, THREE.AnimationClip>;
  bytes: number;
  loadMs: number;
  usedKtx2: boolean;
}

export interface LoaderOptions {
  /** Base URL of the models folder, e.g. '/models/'. */
  baseUrl: string;
  /** Folder with basis_transcoder.js/.wasm. When omitted, KTX2 is never used. */
  transcoderPath?: string;
  /** 'auto' picks KTX2 when the transcoder path is given and the GPU exposes a compressed format. */
  textures?: 'png' | 'ktx2' | 'auto';
}

export class CharacterLibrary {
  private loader: GLTFLoader;
  private ktx2: KTX2Loader | null = null;
  private useKtx2: boolean;
  private cache = new Map<string, Promise<CharacterAsset>>();

  constructor(renderer: THREE.WebGLRenderer, private opts: LoaderOptions) {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    const mode = opts.textures ?? 'auto';
    let gpuHasCompressed = false;
    if (opts.transcoderPath && mode !== 'png') {
      this.ktx2 = new KTX2Loader().setTranscoderPath(opts.transcoderPath).detectSupport(renderer);
      this.loader.setKTX2Loader(this.ktx2);
      const gl = renderer.getContext();
      gpuHasCompressed = ['WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_s3tc',
        'EXT_texture_compression_bptc', 'WEBGL_compressed_texture_etc1', 'WEBGL_compressed_texture_pvrtc']
        .some((e) => gl.getExtension(e) !== null);
    }
    this.useKtx2 = mode === 'ktx2' ? this.ktx2 !== null : mode === 'auto' && this.ktx2 !== null && gpuHasCompressed;
  }

  get ktx2Enabled(): boolean {
    return this.useKtx2;
  }

  load(id: string, onProgress?: (loaded: number, total: number) => void): Promise<CharacterAsset> {
    const key = id + (this.useKtx2 ? '.ktx2' : '');
    let p = this.cache.get(key);
    if (!p) {
      const url = `${this.opts.baseUrl}${id}${this.useKtx2 ? '.ktx2' : ''}.glb`;
      const t0 = performance.now();
      let bytes = 0;
      p = this.loader
        .loadAsync(url, (e) => {
          bytes = e.loaded;
          onProgress?.(e.loaded, e.total);
        })
        .then((gltf) => {
          const clips = new Map<ClipName, THREE.AnimationClip>();
          for (const c of gltf.animations) {
            if (!(CLIP_NAMES as readonly string[]).includes(c.name)) continue;
            // Blender keys start at frame 1 (t = 1/30 s). Shift every clip to t = 0, otherwise a loop
            // holds its first pose for one extra frame at each repeat (a visible hitch in Run).
            const t0 = Math.min(...c.tracks.map((t) => t.times[0]));
            if (t0 > 0) {
              for (const t of c.tracks) {
                t.times = t.times.slice();   // GLTFLoader shares time arrays between tracks/clips
                t.shift(-t0);
              }
              c.resetDuration();
            }
            clips.set(c.name as ClipName, c);
          }
          for (const n of CLIP_NAMES) if (!clips.has(n)) console.warn(`[dvor] ${id}: clip ${n} missing`);
          return { id, gltf, clips, bytes, loadMs: performance.now() - t0, usedKtx2: this.useKtx2 };
        });
      this.cache.set(key, p);
    }
    return p;
  }

  /** Static scenery (the arena map) through the same Meshopt / KTX2 setup. */
  loadStatic(id: string): Promise<{ gltf: GLTF; bytes: number; loadMs: number; usedKtx2: boolean }> {
    const url = `${this.opts.baseUrl}${id}${this.useKtx2 ? '.ktx2' : ''}.glb`;
    const t0 = performance.now();
    let bytes = 0;
    return this.loader
      .loadAsync(url, (e) => (bytes = e.loaded))
      .then((gltf) => ({ gltf, bytes, loadMs: performance.now() - t0, usedKtx2: this.useKtx2 }));
  }

  dispose(): void {
    this.ktx2?.dispose();
  }
}

export interface InstanceOptions {
  /** Projected height in CSS px below which LOD1 is shown (default 150). */
  lodSwitchPx?: number;
  /** Replace MeshStandardMaterial by MeshLambertMaterial (cheaper on weak Android GPUs). */
  lambert?: boolean;
  castShadow?: boolean;
}

export class CharacterInstance {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly lods: THREE.SkinnedMesh[] = [];
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private lodLevel = -1;
  private lodForced: number | null = null;
  private onFinish: ((name: ClipName) => void) | null = null;
  readonly height: number;

  constructor(readonly asset: CharacterAsset, private opts: InstanceOptions = {}) {
    this.root = cloneSkinned(asset.gltf.scene);
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!(m as THREE.Mesh).isMesh) return; // skinned or static (unrigged review meshes)
      // animated poses (Defeat lies on the ground) leave the bind-pose bounds: skip culling,
      // the arena camera always sees the characters anyway.
      m.frustumCulled = false;
      m.castShadow = !!opts.castShadow;
      if (opts.lambert) {
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({ map: src.map, name: src.name });
      }
      this.lods.push(m);
    });
    this.lods.sort((a, b) => a.name.localeCompare(b.name)); // *_LOD0, *_LOD1
    this.setLod(0);
    const box = new THREE.Box3().setFromObject(this.lods[0]);
    this.height = box.max.y - box.min.y;

    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [name, clip] of asset.clips) {
      const a = this.mixer.clipAction(clip);
      if (!LOOPING.has(name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
    }
    this.mixer.addEventListener('finished', (e) => {
      const name = (e.action as THREE.AnimationAction).getClip().name as ClipName;
      this.onFinish?.(name);
    });
    this.play('Idle', 0);
  }

  get clip(): ClipName | null {
    return this.currentName;
  }

  get lod(): number {
    return Math.max(0, this.lodLevel);
  }

  /** Cross-fade to a clip. One-shots stop on their last frame and fire onFinished. */
  play(name: ClipName, fade = 0.15, timeScale = 1): THREE.AnimationAction | null {
    const next = this.actions.get(name);
    if (!next) return null;
    if (next === this.current && LOOPING.has(name)) return next;
    next.reset();
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else if (this.current && this.current !== next) this.current.stop();
    this.current = next;
    this.currentName = name;
    return next;
  }

  onFinished(cb: (name: ClipName) => void): void {
    this.onFinish = cb;
  }

  /** Jump to a fixed time of a clip (used for previews and tests). */
  pose(name: ClipName, time: number): void {
    this.mixer.stopAllAction();
    const a = this.actions.get(name)!;
    a.reset().play();
    a.paused = false;
    this.mixer.setTime(Math.min(time, a.getClip().duration));
    this.current = a;
    this.currentName = name;
  }

  setLod(level: number | null): void {
    this.lodForced = level;
    if (level !== null) this.applyLod(level);
  }

  private applyLod(level: number): void {
    const l = Math.min(level, this.lods.length - 1);
    if (l === this.lodLevel) return;
    this.lodLevel = l;
    this.lods.forEach((m, i) => (m.visible = i === l));
  }

  /** Screen-height based LOD: call once per frame with the active camera. */
  updateLod(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    if (this.lodForced !== null) return;
    const dist = camera.position.distanceTo(this.root.position);
    const px = (this.height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * viewportHeightPx;
    const threshold = this.opts.lodSwitchPx ?? 150;
    // hysteresis avoids popping at the boundary
    if (this.lodLevel === 0 && px < threshold * 0.9) this.applyLod(1);
    else if (this.lodLevel === 1 && px > threshold * 1.1) this.applyLod(0);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }
}
