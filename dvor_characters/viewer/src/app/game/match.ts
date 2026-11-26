/**
 * «Царь двора» 2 на 2 — match on the real arena with the real character models.
 * Blue team = the player + 1 bot, red team = 2 bots (how good the red bots are follows the player's rank). A team that is alone in the crown circle scores
 * 2 points per second; first to 100 or the leader after 2:00 wins. Fallen heroes return after 3 s.
 * Logic and visuals live together here (single-player prototype); the numbers are in kits.ts.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hitsCollider, insideCourtyard, type Collider } from '../../arena';
import { HEROES, type Hero, type HeroId } from '../data';
import { DASH, KITS, MATCH, REGEN, RESPAWN_S, TEAM_SIZE, type Kit } from './kits';
import { SmokeSystem } from './smoke';

export type Team = 0 | 1;   // 0 = blue (player), 1 = red
const R_BODY = 0.35;
const R_HIT = 0.45;
const TEAM_COL = [0x2b9cf0, 0xe2493b];
// spawns sit beside the cover blocks in front of each base (not behind them)
const SPAWNS: [number, number][][] = [
  // point-mirrored from the red spawns through the zone centre, so both teams walk the same distance
  [[-2.88, 6.2], [2.52, 6.2], [-4.48, 5.0]],
  [[2.6, -7.2], [-2.8, -7.2], [4.2, -6.0]],
];
const CLIPS = ['Idle', 'Run', 'Attack', 'Ability', 'Hit', 'Defeat', 'Victory'] as const;
type Clip = (typeof CLIPS)[number];

export interface PlayerInput {
  move: [number, number];                   // screen: x right, y up
  attack: null | { dir: [number, number] | null };   // a tap on the arena: shoot that way (null dir = auto-aim)
  auto: boolean;                            // fire by itself at the nearest enemy in range and in sight
  a1: boolean; a2: boolean; dash: boolean;
}

export interface MatchOptions {
  blue?: HeroId[]; red?: HeroId[];
  allBots?: boolean;      // balance simulations: the player slot is a bot too
  skill?: number;         // 0..1, red bots' aim and reactions (player's rank)
  playerBoost?: Boost;    // the player's stat upgrades (progress.ts)
}
export interface Boost { hp: number; dmg: number; speed: number; cd?: number }

/** A kit with health, damage / healing and speed multiplied (upgrades, stronger bots at higher ranks). */
function boostKit(k: Kit, b: Boost): Kit {
  const d = b.dmg;
  const x: Kit = JSON.parse(JSON.stringify(k));
  x.hp = Math.round(k.hp * b.hp);
  x.speed = k.speed * b.speed;
  x.a1.cd = k.a1.cd * (b.cd ?? 1);
  x.attack.dmg = Math.round(k.attack.dmg * d);
  if (x.turret) x.turret.dmg = Math.round(x.turret.dmg * d);
  if (x.ram) x.ram.dmg = Math.round(x.ram.dmg * d);
  if (x.spurt) x.spurt.dmg = Math.round(x.spurt.dmg * d);
  if (x.wave) x.wave.dmg = Math.round(x.wave.dmg * d);
  if (x.mine) x.mine.dmg = Math.round(x.mine.dmg * d);
  if (x.pierce) x.pierce.dmg = Math.round(x.pierce.dmg * d);
  if (x.heal) x.heal.amount = Math.round(x.heal.amount * d);
  if (x.hospital) x.hospital.hps = Math.round(x.hospital.hps * d);
  return x;
}

/** TEAM_SIZE different heroes, the first one given (or random). */
export function lineup(first?: HeroId): HeroId[] {
  const rest = HEROES.map((h) => h.id).filter((id) => id !== first).sort(() => Math.random() - 0.5);
  return first ? [first, ...rest.slice(0, TEAM_SIZE - 1)] : rest.slice(0, TEAM_SIZE);
}

export interface UnitView {
  id: number; team: Team; hero: Hero; isPlayer: boolean; alive: boolean; hp: number; maxHp: number;
  x: number; z: number; heat: number; overheated: boolean; respawnIn: number;
}

interface Unit {
  id: number; team: Team; hero: Hero; kit: Kit; isPlayer: boolean; slot: number;
  root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<Clip, THREE.AnimationAction>;
  mats: THREE.MeshStandardMaterial[]; flashUntil: number;
  cur: THREE.AnimationAction | null; oneShotUntil: number;
  ring: THREE.Mesh; stunFx: THREE.Mesh; door: THREE.Object3D | null;
  x: number; z: number; yaw: number; kx: number; kz: number;
  hp: number; alive: boolean; respawnAt: number; invulnUntil: number;
  atkReady: number; heat: number; overheatUntil: number; meleeCount: number;
  cd1: number; cd2: number; cdDash: number;
  dash: null | { dx: number; dz: number; left: number; speed: number; hit: Set<number>; dmg: number; stun: number };
  spurtLeft: number; spurtNext: number;
  stunUntil: number; doorUntil: number; lastHurt: number; lastFight: number; moving: boolean; faceUntil: number;
  ai: { think: number; tx: number; tz: number; target: Unit | null; strafe: number };
  kills: number; deaths: number; dealt: number; healed: number;
  pierceAt: number; pierceDir: [number, number]; healAcc: number; healShowAt: number;
}

interface Proj {
  team: Team; owner: Unit | null; x: number; z: number; vx: number; vz: number; left: number; dmg: number;
  bounces: number; obj: THREE.Object3D; spin: boolean; fromTurret: boolean; pierced: Set<number> | null;
}
interface Mine { team: Team; owner: Unit; x: number; z: number; armAt: number; until: number; obj: THREE.Object3D; light: THREE.Mesh }
interface HealZone { team: Team; owner: Unit; x: number; z: number; r: number; until: number; hps: number; obj: THREE.Object3D; born: number }
interface Turret { team: Team; owner: Unit; x: number; z: number; hp: number; until: number; next: number; obj: THREE.Object3D; head: THREE.Object3D; born: number }
interface Smoke { team: Team; x: number; z: number; r: number; until: number; slow: number; obj: THREE.Group; born: number }
interface Fx { obj: THREE.Object3D; t: number; dur: number; tick: (k: number) => void }

export interface MatchEvents {
  damage(x: number, y: number, z: number, amount: number, team: Team, heal?: boolean): void;
  kill(killer: UnitView | null, victim: UnitView): void;
  shake?(amount: number): void;   // camera shake request (the player was hit, a blast nearby...)
  end(result: { winner: Team | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number; healed: number } }): void;
}

const TURRET_SCALE = 1.4;   // the mini tank model is 0.6 m long; bigger reads better from the game camera

export class Match {
  readonly units: Unit[] = [];
  readonly score: [number, number] = [0, 0];
  zoneOwner: Team | -1 | -2 = -1;   // -1 nobody, -2 contested
  time = 0;
  ended = false;
  private projs: Proj[] = [];
  private turrets: Turret[] = [];
  private smokes: Smoke[] = [];
  private mines: Mine[] = [];
  private zones: HealZone[] = [];
  private fx: Fx[] = [];
  private zoneTick = 0;
  private zoneRing: THREE.Mesh;
  private zoneFill: THREE.Mesh;
  private mats: Record<string, THREE.Material> = {};
  private geos: Record<string, THREE.BufferGeometry> = {};
  private started = false;
  private smokeFx = new SmokeSystem();
  private fxTime = 0;
  /** Camera used to sort smoke puffs back-to-front (set by the battle screen). */
  camera: THREE.Camera | null = null;

  constructor(
    private scene: THREE.Scene,
    heroes: Record<HeroId, GLTF>,
    private colliders: Collider[],
    playerHero: HeroId,
    private ev: MatchEvents,
    props?: GLTF,
    private opts: MatchOptions = {},
  ) {
    this.buildShared();
    if (props) this.setupProps(props);
    scene.add(this.smokeFx.mesh);
    // zone
    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(MATCH.zone.r - 0.18, MATCH.zone.r, 56).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.zoneFill = new THREE.Mesh(new THREE.CircleGeometry(MATCH.zone.r - 0.18, 56).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
    this.zoneRing.position.set(MATCH.zone.x, 0.03, MATCH.zone.z);
    this.zoneFill.position.set(MATCH.zone.x, 0.025, MATCH.zone.z);
    scene.add(this.zoneRing, this.zoneFill);
    // teams: blue = player's hero first and two others; red = three heroes
    const blue = opts.blue ?? lineup(playerHero);
    const red: HeroId[] = opts.red ?? lineup();
    let id = 0;
    for (const [team, list] of [[0, blue], [1, red]] as [Team, HeroId[]][]) {
      list.forEach((hid, slot) => {
        this.units.push(this.makeUnit(id++, team, HEROES.find((h) => h.id === hid)!, heroes[hid], team === 0 && slot === 0, slot));
      });
    }
  }

  get player(): Unit { return this.units[0]; }
  start(): void { this.started = true; }

  view(u: Unit): UnitView {
    return { id: u.id, team: u.team, hero: u.hero, isPlayer: u.isPlayer, alive: u.alive, hp: Math.round(u.hp), maxHp: u.kit.hp,
      x: u.x, z: u.z, heat: u.heat, overheated: this.time < u.overheatUntil, respawnIn: Math.max(0, u.respawnAt - this.time) };
  }
  views(): UnitView[] { return this.units.map((u) => this.view(u)); }
  cooldowns(): { a1: number; a2: number; dash: number; a1Max: number; a2Max: number; dashMax: number } {
    const p = this.player;
    return { a1: Math.max(0, p.cd1 - this.time), a2: Math.max(0, p.cd2 - this.time), dash: Math.max(0, p.cdDash - this.time),
      a1Max: p.kit.a1.cd, a2Max: p.kit.a2?.cd ?? 0, dashMax: DASH.cd };
  }

  // ------------------------------------------------------------------ setup
  private buildShared(): void {
    const M = (c: number, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
    this.mats = {
      bullet: M(0xffd36a), bulletRed: M(0xff8a6a), record: new THREE.MeshLambertMaterial({ color: 0x151417 }),
      label: M(0xe23a54), arc: M(0xffffff, 0.55), wave: M(0xc7a6ff, 0.6), 
      metal: new THREE.MeshLambertMaterial({ color: 0x7d8088 }), dark: new THREE.MeshLambertMaterial({ color: 0x2c2d31 }),
      stun: M(0xffd23f), ringBlue: M(TEAM_COL[0], 0.9), ringRed: M(TEAM_COL[1], 0.9),
      teamBlue: new THREE.MeshLambertMaterial({ color: TEAM_COL[0] }), teamRed: new THREE.MeshLambertMaterial({ color: TEAM_COL[1] }),
      tracer: M(0xfff1c2), tracerRed: M(0xffb39a), dart: new THREE.MeshLambertMaterial({ color: 0xf4f1ea }), dartTip: M(0xd8382c),
      heal: M(0x5be37d, 0.6), healFill: M(0x5be37d, 0.18), cross: M(0xffffff, 0.9), mine: new THREE.MeshLambertMaterial({ color: 0x3b3a34 }),
      mineLight: M(0xff4a2a), blast: M(0xffb347, 0.7),
    };
    this.geos = {
      bullet: new THREE.BoxGeometry(0.07, 0.07, 0.42),
      record: new THREE.CylinderGeometry(0.17, 0.17, 0.03, 14),
      label: new THREE.CylinderGeometry(0.07, 0.07, 0.035, 10),
      ring: new THREE.RingGeometry(0.42, 0.5, 36).rotateX(-Math.PI / 2),
      arc: new THREE.RingGeometry(0.5, 2.0, 12, 1, 0, 1).rotateX(-Math.PI / 2),
      wave: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      can: new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10),
      canBand: new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10),
      stun: new THREE.TorusGeometry(0.22, 0.03, 6, 16).rotateX(Math.PI / 2),
      leg: new THREE.CylinderGeometry(0.035, 0.035, 0.75, 5),
      head: new THREE.BoxGeometry(0.36, 0.24, 0.42),
      barrel: new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6).rotateX(Math.PI / 2),
      stripe: new THREE.BoxGeometry(0.38, 0.06, 0.44),
      door: new THREE.BoxGeometry(1.5, 1.45, 0.07),
      rib: new THREE.BoxGeometry(1.52, 0.06, 0.1),
      tracer: new THREE.BoxGeometry(0.06, 0.06, 0.9),
      dart: new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6).rotateX(Math.PI / 2),
      dartTip: new THREE.ConeGeometry(0.03, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.2),
      disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      crossA: new THREE.PlaneGeometry(0.9, 0.3).rotateX(-Math.PI / 2),
      crossB: new THREE.PlaneGeometry(0.3, 0.9).rotateX(-Math.PI / 2),
      mine: new THREE.CylinderGeometry(0.2, 0.24, 0.08, 12),
      mineLight: new THREE.SphereGeometry(0.05, 8, 6),
    };
  }

  /** Mini tank (turret) and garage door from PROPS.glb; the "Team" material gets the team colour. */
  private propTpl: { turret: THREE.Object3D; door: THREE.Object3D } | null = null;
  private teamMats: [THREE.Material, THREE.Material] | null = null;
  private setupProps(g: GLTF): void {
    const turret = g.scene.getObjectByName('PROP_Turret'), door = g.scene.getObjectByName('PROP_Door');
    if (!turret || !door) return;
    let team: THREE.MeshStandardMaterial | null = null;
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mt of ([] as THREE.Material[]).concat(m.material)) if (mt.name === 'Team') team = mt as THREE.MeshStandardMaterial;
    });
    if (team) {
      const t = team as THREE.MeshStandardMaterial;
      const a = t.clone(), b = t.clone();
      a.color.setHex(TEAM_COL[0]); b.color.setHex(TEAM_COL[1]);
      a.emissive.setHex(TEAM_COL[0]).multiplyScalar(0.25); b.emissive.setHex(TEAM_COL[1]).multiplyScalar(0.25);
      this.teamMats = [a, b];
    }
    this.propTpl = { turret, door };
  }
  private propClone(which: 'turret' | 'door', team: Team): THREE.Object3D {
    const o = this.propTpl![which].clone(true);
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !this.teamMats) return;
      m.material = Array.isArray(m.material)
        ? m.material.map((mt) => (mt.name === 'Team' ? this.teamMats![team] : mt))
        : m.material.name === 'Team' ? this.teamMats[team] : m.material;
    });
    return o;
  }

  private makeUnit(id: number, team: Team, hero: Hero, gltf: GLTF, isPlayer: boolean, slot: number): Unit {
    const root = cloneSkinned(gltf.scene);
    const meshes: THREE.Mesh[] = [];
    const mats: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      meshes.push(m);
      // own material per hero so a hit flash lights only this one
      m.material = (m.material as THREE.MeshStandardMaterial).clone();
      mats.push(m.material as THREE.MeshStandardMaterial);
    });
    meshes.sort((a, b) => a.name.localeCompare(b.name)).forEach((m, i) => (m.visible = i === 0));
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<Clip, THREE.AnimationAction>();
    for (const c of gltf.animations) {
      if (!(CLIPS as readonly string[]).includes(c.name)) continue;
      if (!c.userData.shifted) {
        const t0 = Math.min(...c.tracks.map((t) => t.times[0]));
        if (t0 > 0) { for (const t of c.tracks) { t.times = t.times.slice(); t.shift(-t0); } c.resetDuration(); }
        c.userData.shifted = true;
      }
      const a = mixer.clipAction(c);
      if (c.name !== 'Idle' && c.name !== 'Run' && c.name !== 'Victory') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions.set(c.name as Clip, a);
    }
    const ring = new THREE.Mesh(this.geos.ring, team === 0 ? this.mats.ringBlue : this.mats.ringRed);
    const stunFx = new THREE.Mesh(this.geos.stun, this.mats.stun);
    stunFx.visible = false;
    this.scene.add(root, ring, stunFx);
    const [sx, sz] = SPAWNS[team][slot];
    // the player's upgrades; red bots get a little stronger with the player's rank
    const s = this.opts.skill ?? 0;
    const kit = isPlayer && this.opts.playerBoost ? boostKit(KITS[hero.id], this.opts.playerBoost)
      : team === 1 && !this.opts.allBots && s > 0 ? boostKit(KITS[hero.id], { hp: 1 + 0.15 * s, dmg: 1 + 0.15 * s, speed: 1 })
      : KITS[hero.id];
    const u: Unit = {
      id, team, hero, kit, isPlayer, slot, root, mixer, actions, mats, flashUntil: 0, cur: null, oneShotUntil: 0, ring, stunFx, door: null,
      x: sx, z: sz, yaw: team === 0 ? Math.PI : 0, kx: 0, kz: 0,
      hp: kit.hp, alive: true, respawnAt: 0, invulnUntil: 0,
      atkReady: 0, heat: 0, overheatUntil: 0, meleeCount: 0, cd1: 0, cd2: 0, cdDash: 0,
      dash: null, spurtLeft: 0, spurtNext: 0, stunUntil: 0, doorUntil: 0, lastHurt: -99, lastFight: -99, moving: false, faceUntil: 0,
      ai: { think: 0, tx: sx, tz: sz, target: null, strafe: Math.random() < 0.5 ? 1 : -1 },
      kills: 0, deaths: 0, dealt: 0, healed: 0, pierceAt: 0, pierceDir: [0, 1], healAcc: 0, healShowAt: 0,
    };
    this.play(u, 'Idle', 0);
    return u;
  }

  // ------------------------------------------------------------------ animation
  private play(u: Unit, name: Clip, fade = 0.12, oneShotFor = 0): void {
    const next = u.actions.get(name);
    if (!next) return;
    if (oneShotFor > 0) u.oneShotUntil = this.time + oneShotFor;
    if (next === u.cur && name !== 'Attack' && name !== 'Ability' && name !== 'Hit') return;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (u.cur && u.cur !== next && fade > 0) next.crossFadeFrom(u.cur, fade, false);
    else if (u.cur && u.cur !== next) u.cur.stop();
    u.cur = next;
  }

  // ------------------------------------------------------------------ helpers
  private free(x: number, z: number): boolean {
    return insideCourtyard(x, z, 0.45) && !hitsCollider(this.colliders, x, z, R_BODY);
  }
  private blocksShot(x: number, z: number): Collider | null {
    for (const c of this.colliders) if (c.h >= 0.7 && x > c.x[0] && x < c.x[1] && z > c.z[0] && z < c.z[1]) return c;
    return null;
  }
  private moveUnit(u: Unit, dx: number, dz: number): boolean {
    const nx = u.x + dx, nz = u.z + dz;
    if (this.free(nx, nz)) { u.x = nx; u.z = nz; return true; }
    if (this.free(nx, u.z)) { u.x = nx; return true; }
    if (this.free(u.x, nz)) { u.z = nz; return true; }
    return false;
  }
  /** First collider crossed walking the straight line a -> b (body radius included), or null. */
  private blockerOnLine(ax: number, az: number, bx: number, bz: number): Collider | null {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
    for (let i = 1; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      for (const c of this.colliders) {
        if (x > c.x[0] - R_BODY && x < c.x[1] + R_BODY && z > c.z[0] - R_BODY && z < c.z[1] + R_BODY) return c;
      }
    }
    return null;
  }
  /** Direction to walk toward (tx, tz): straight, or via the best corner of the blocking prop. */
  private steer(u: Unit, tx: number, tz: number): [number, number] {
    let gx = tx, gz = tz;
    const c = this.blockerOnLine(u.x, u.z, tx, tz);
    if (c) {
      const m = R_BODY + 0.35;
      const corners: [number, number][] = [[c.x[0] - m, c.z[0] - m], [c.x[1] + m, c.z[0] - m], [c.x[0] - m, c.z[1] + m], [c.x[1] + m, c.z[1] + m]];
      let best = Infinity;
      for (const [cx, cz] of corners) {
        if (!this.free(cx, cz) || Math.hypot(cx - u.x, cz - u.z) < 0.15) continue;
        const cost = Math.hypot(cx - u.x, cz - u.z) + Math.hypot(tx - cx, tz - cz) + (this.blockerOnLine(u.x, u.z, cx, cz) ? 4 : 0);
        if (cost < best) { best = cost; gx = cx; gz = cz; }
      }
    }
    const dx = gx - u.x, dz = gz - u.z, l = Math.hypot(dx, dz);
    return l > 0.01 ? [dx / l, dz / l] : [0, 0];
  }
  private enemiesOf(u: { team: Team }): Unit[] { return this.units.filter((o) => o.alive && o.team !== u.team); }
  private nearestEnemy(u: Unit, maxD = 99): Unit | null {
    let best: Unit | null = null, bd = maxD;
    for (const o of this.enemiesOf(u)) { const d = Math.hypot(o.x - u.x, o.z - u.z); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  private speedOf(u: Unit): number {
    let s = u.kit.speed;
    if (u.kit.outOfCombatBoost && this.time - u.lastFight > 2) s *= 1 + u.kit.outOfCombatBoost;
    for (const sm of this.smokes) if (sm.team !== u.team && Math.hypot(u.x - sm.x, u.z - sm.z) < sm.r) s *= 1 - sm.slow;
    return s;
  }
  private inZone(u: Unit): boolean { return Math.hypot(u.x - MATCH.zone.x, u.z - MATCH.zone.z) < MATCH.zone.r; }
  private los(ax: number, az: number, bx: number, bz: number): boolean {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3);
    for (let i = 1; i < n; i++) if (this.blocksShot(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
    return true;
  }

  // ------------------------------------------------------------------ damage
  private hurt(target: Unit, amount: number, by: Unit | null): void {
    if (!target.alive || this.time < target.invulnUntil || this.ended) return;
    const dmg = Math.round(amount * (1 - target.kit.armor));
    target.hp -= dmg;
    target.lastHurt = this.time;
    target.flashUntil = this.time + 0.1;
    if (target.isPlayer) this.ev.shake?.(Math.min(0.45, 0.12 + dmg / 4000));
    target.lastFight = this.time;
    if (by) { by.dealt += dmg; by.lastFight = this.time; }
    this.ev.damage(target.x, 2.0, target.z, dmg, target.team);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      target.respawnAt = this.time + RESPAWN_S;
      target.dash = null;
      target.spurtLeft = 0;
      target.doorUntil = 0;
      if (by) by.kills++;
      this.play(target, 'Defeat', 0.1, 99);
      this.ev.kill(by ? this.view(by) : null, this.view(target));
    } else if (!target.moving && this.time > target.oneShotUntil) {
      this.play(target, 'Hit', 0.08, 0.35);
    }
  }
  private healUnit(target: Unit, amount: number, by: Unit | null): void {
    if (!target.alive || this.ended) return;
    const got = Math.min(amount, target.kit.hp - target.hp);
    if (got <= 0) return;
    target.hp += got;
    if (by) by.healed += got;
    target.healAcc += got;   // shown as one green number every 0.5 s, not every frame
    if (this.time >= target.healShowAt) {
      this.ev.damage(target.x, 2.1, target.z, Math.round(target.healAcc), target.team, true);
      target.healAcc = 0;
      target.healShowAt = this.time + 0.5;
    }
  }
  private hurtTurret(t: Turret, amount: number): void {
    t.hp -= amount;
    this.ev.damage(t.x, 1.3, t.z, Math.round(amount), t.team);
    if (t.hp <= 0) t.until = 0;
  }
  private knock(target: Unit, fromX: number, fromZ: number, dist: number): void {
    const d = Math.hypot(target.x - fromX, target.z - fromZ) || 1;
    target.kx += ((target.x - fromX) / d) * dist * 6;
    target.kz += ((target.z - fromZ) / d) * dist * 6;
  }

  // ------------------------------------------------------------------ actions
  private face(u: Unit, dx: number, dz: number): void { if (dx || dz) u.yaw = Math.atan2(dx, dz); }
  private aimAt(u: Unit, dir: [number, number] | null, range: number): [number, number] {
    if (dir) return dir;
    const e = this.nearestEnemy(u, range + 1.5);
    const t = e ?? this.nearestTurret(u, range + 1.5);
    if (t) { const d = Math.hypot(t.x - u.x, t.z - u.z) || 1; return [(t.x - u.x) / d, (t.z - u.z) / d]; }
    return [Math.sin(u.yaw), Math.cos(u.yaw)];
  }
  private nearestTurret(u: Unit, maxD: number): Turret | null {
    let best: Turret | null = null, bd = maxD;
    for (const t of this.turrets) if (t.team !== u.team) { const d = Math.hypot(t.x - u.x, t.z - u.z); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  /** Auto-attack: direction to the nearest enemy (or turret) in range and in sight, else null. */
  private autoTarget(u: Unit): [number, number] | null {
    const range = u.kit.attack.range + 0.3;
    let best: { x: number; z: number } | null = null, bd = range;
    for (const e of this.enemiesOf(u)) { const d = Math.hypot(e.x - u.x, e.z - u.z); if (d < bd && this.los(u.x, u.z, e.x, e.z)) { bd = d; best = e; } }
    if (!best) for (const t of this.turrets) if (t.team !== u.team) { const d = Math.hypot(t.x - u.x, t.z - u.z); if (d < bd && this.los(u.x, u.z, t.x, t.z)) { bd = d; best = t; } }
    if (!best) return null;
    const d = Math.hypot(best.x - u.x, best.z - u.z) || 1;
    return [(best.x - u.x) / d, (best.z - u.z) / d];
  }

  private attack(u: Unit, dir: [number, number] | null): void {
    if (!u.alive || this.time < u.atkReady || this.time < u.stunUntil || u.dash) return;
    const a = u.kit.attack;
    const [dx, dz] = this.aimAt(u, dir, a.range);
    this.face(u, dx, dz);
    u.faceUntil = this.time + 0.35;   // keep facing the target while running and shooting
    u.lastFight = this.time;
    if (!u.moving) this.play(u, 'Attack', 0.06, 0.3);
    if (a.kind === 'rifle' || a.kind === 'darts') {
      u.atkReady = this.time + a.cd;
      this.spawnProj(u, u.x + dx * 0.5, u.z + dz * 0.5, dx * a.speed, dz * a.speed, a.range, a.dmg, 0, a.kind === 'rifle' ? 'tracer' : 'dart', false);
    } else if (a.kind === 'gun') {
      if (this.time < u.overheatUntil) return;
      u.atkReady = this.time + a.cd;
      u.heat += 1;
      if (u.heat >= a.heatMax) { u.overheatUntil = this.time + a.cool; u.heat = 0; }
      this.spawnProj(u, u.x + dx * 0.5, u.z + dz * 0.5, dx * a.speed, dz * a.speed, a.range, a.dmg, 0, 'bullet', false);
    } else if (a.kind === 'records') {
      u.atkReady = this.time + a.cd;
      for (let i = 0; i < a.count; i++) {
        const off = ((i - (a.count - 1) / 2) * a.spreadDeg * Math.PI) / 180;
        const c = Math.cos(off), s = Math.sin(off);
        const rx = dx * c - dz * s, rz = dx * s + dz * c;
        this.spawnProj(u, u.x + rx * 0.5, u.z + rz * 0.5, rx * a.speed, rz * a.speed, a.range, a.dmg, a.bounces, 'record', false);
      }
    } else {
      u.atkReady = this.time + a.cd;
      u.meleeCount++;
      const knock = u.meleeCount % a.knockEvery === 0;
      const half = ((a.arcDeg / 2) * Math.PI) / 180;
      for (const e of this.enemiesOf(u)) {
        const ex = e.x - u.x, ez = e.z - u.z, d = Math.hypot(ex, ez);
        if (d > a.range + R_HIT * 0.5) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (ex * dx + ez * dz) / (d || 1))));
        if (ang <= half || d < 0.6) { this.hurt(e, a.dmg, u); if (knock && e.alive) this.knock(e, u.x, u.z, a.knock); }
      }
      for (const t of this.turrets) if (t.team !== u.team && Math.hypot(t.x - u.x, t.z - u.z) < a.range) this.hurtTurret(t, a.dmg);
      this.fxArc(u, dx, dz, a.range, half);
    }
  }

  private ability(u: Unit, which: 1 | 2, dir: [number, number] | null): boolean {
    if (!u.alive || this.time < u.stunUntil || u.dash) return false;
    const cdKey = which === 1 ? 'cd1' : 'cd2';
    if (this.time < u[cdKey]) return false;
    const k = u.kit;
    const act = which === 1 ? k.a1.key : k.a2?.key;
    if (!act) return false;
    const [dx, dz] = this.aimAt(u, dir, 7);
    this.face(u, dx, dz);
    u.lastFight = this.time;
    let ok = false;
    if (act === 'turret' && k.turret) {
      let px = u.x + dx * k.turret.place, pz = u.z + dz * k.turret.place;
      if (!this.free(px, pz)) { px = u.x + dx * 0.9; pz = u.z + dz * 0.9; }
      if (!this.free(px, pz)) { px = u.x; pz = u.z; }
      for (const t of this.turrets.filter((t) => t.owner === u)) t.until = 0;   // one turret per Technik
      this.spawnTurret(u, px, pz);
      ok = true;
    } else if (act === 'smoke' && k.smoke) {
      const e = this.nearestEnemy(u, k.smoke.throw + 1);
      const d = e ? Math.min(k.smoke.throw, Math.hypot(e.x - u.x, e.z - u.z)) : k.smoke.throw;
      this.spawnSmoke(u.team, u.x + dx * d, u.z + dz * d, k.smoke.r, k.smoke.dur, k.smoke.slow);
      ok = true;
    } else if (act === 'door' && k.door) {
      u.doorUntil = this.time + k.door.dur;
      ok = true;
    } else if (act === 'ram' && k.ram) {
      u.dash = { dx, dz, left: k.ram.dist, speed: k.ram.dist / 0.3, hit: new Set(), dmg: k.ram.dmg, stun: k.ram.stun };
      ok = true;
    } else if (act === 'spurt' && k.spurt) {
      u.spurtLeft = k.spurt.dashes;
      u.spurtNext = this.time;
      ok = true;
    } else if (act === 'wave' && k.wave) {
      for (const e of this.enemiesOf(u)) {
        if (Math.hypot(e.x - u.x, e.z - u.z) < k.wave.r) { this.hurt(e, k.wave.dmg, u); if (e.alive) this.knock(e, u.x, u.z, k.wave.push); }
      }
      this.fxWave(u.x, u.z, k.wave.r);
      ok = true;
    }
    else if (act === 'mine' && k.mine) {
      let px = u.x + dx * k.mine.place, pz = u.z + dz * k.mine.place;
      if (!this.free(px, pz)) { px = u.x; pz = u.z; }
      const mine = this.mines.filter((m) => m.owner === u);
      if (mine.length >= 2) mine[0].until = 0;   // two traps per Sniper at most
      this.spawnMine(u, px, pz);
      ok = true;
    } else if (act === 'pierce' && k.pierce) {
      u.pierceAt = this.time + k.pierce.delay;   // aims for a moment, then fires (stepPierce)
      u.pierceDir = [dx, dz];
      u.faceUntil = this.time + k.pierce.delay + 0.2;
      ok = true;
    } else if (act === 'heal' && k.heal) {
      for (const o of this.units) if (o.team === u.team && Math.hypot(o.x - u.x, o.z - u.z) < k.heal.r) this.healUnit(o, k.heal.amount, u);
      this.fxWave(u.x, u.z, k.heal.r, this.mats.heal as THREE.MeshBasicMaterial);
      ok = true;
    } else if (act === 'hospital' && k.hospital) {
      const d = dir ? k.hospital.throw : 0;
      let px = u.x + dx * d, pz = u.z + dz * d;
      if (!this.free(px, pz)) { px = u.x; pz = u.z; }
      this.spawnHealZone(u, px, pz);
      ok = true;
    }
    if (ok) {
      u[cdKey] = this.time + (which === 1 ? k.a1.cd : k.a2?.cd ?? 0);
      this.play(u, 'Ability', 0.06, 0.45);
    }
    return ok;
  }

  private doDash(u: Unit, dir: [number, number] | null): void {
    if (!u.alive || this.time < u.cdDash || this.time < u.stunUntil || u.dash) return;
    const [dx, dz] = dir ?? [Math.sin(u.yaw), Math.cos(u.yaw)];
    u.dash = { dx, dz, left: DASH.dist, speed: DASH.dist / DASH.time, hit: new Set(), dmg: 0, stun: 0 };
    u.cdDash = this.time + DASH.cd;
    this.face(u, dx, dz);
  }

  // ------------------------------------------------------------------ spawners
  private spawnProj(u: Unit | null, x: number, z: number, vx: number, vz: number, range: number, dmg: number, bounces: number,
    kind: 'bullet' | 'record' | 'tracer' | 'dart', fromTurret: boolean, team: Team = u?.team ?? 0, pierce = false): void {
    let obj: THREE.Object3D;
    if (kind === 'tracer') {
      obj = new THREE.Mesh(this.geos.tracer, team === 0 ? this.mats.tracer : this.mats.tracerRed);
      if (pierce) obj.scale.set(2.2, 2.2, 1.6);
    } else if (kind === 'dart') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geos.dart, this.mats.dart), new THREE.Mesh(this.geos.dartTip, this.mats.dartTip));
      obj = g;
    } else if (kind === 'bullet') {
      obj = new THREE.Mesh(this.geos.bullet, team === 0 ? this.mats.bullet : this.mats.bulletRed);
      obj.rotation.y = Math.atan2(vx, vz);
      if (fromTurret) obj.scale.setScalar(0.75);
    } else {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geos.record, this.mats.record));
      const l = new THREE.Mesh(this.geos.label, this.mats.label);
      g.add(l);
      obj = g;
    }
    obj.position.set(x, fromTurret ? (this.propTpl ? 0.38 * TURRET_SCALE : 0.75) : 1.0, z);
    this.scene.add(obj);
    this.projs.push({ team, owner: u, x, z, vx, vz, left: range, dmg, bounces, obj, spin: kind === 'record', fromTurret, pierced: pierce ? new Set() : null });
  }

  private spawnTurret(u: Unit, x: number, z: number): void {
    const k = u.kit.turret!;
    if (this.propTpl) {
      const g = this.propClone('turret', u.team);
      const head = g.getObjectByName('PROP_TurretHead')!;
      g.position.set(x, 0, z);
      g.rotation.y = u.yaw;
      head.rotation.y = 0;
      this.scene.add(g);
      this.turrets.push({ team: u.team, owner: u, x, z, hp: k.hp, until: this.time + k.dur, next: this.time + 0.4, obj: g, head, born: this.time });
      return;
    }
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(this.geos.leg, this.mats.dark);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.18, 0.33, Math.sin(a) * 0.18);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(leg);
    }
    const head = new THREE.Group();
    head.position.y = 0.75;
    head.add(new THREE.Mesh(this.geos.head, this.mats.metal));
    const stripe = new THREE.Mesh(this.geos.stripe, u.team === 0 ? this.mats.teamBlue : this.mats.teamRed);
    stripe.position.y = 0.1;
    head.add(stripe);
    const barrel = new THREE.Mesh(this.geos.barrel, this.mats.dark);
    barrel.position.set(0, 0, 0.32);
    head.add(barrel);
    g.add(head);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.turrets.push({ team: u.team, owner: u, x, z, hp: k.hp, until: this.time + k.dur, next: this.time + 0.4, obj: g, head, born: this.time });
  }

  private spawnSmoke(team: Team, x: number, z: number, r: number, dur: number, slow: number): void {
    // the canister on the ground; the cloud itself is particles (smoke.ts)
    const g = new THREE.Group();
    const can = new THREE.Mesh(this.geos.can, this.mats.dark);
    can.rotation.z = Math.PI / 2;
    can.position.y = 0.07;
    const band = new THREE.Mesh(this.geos.canBand, team === 0 ? this.mats.teamBlue : this.mats.teamRed);
    band.rotation.z = Math.PI / 2;
    band.position.y = 0.07;
    g.add(can, band);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * Math.PI;
    this.scene.add(g);
    this.smokeFx.emit(x, z, r, this.fxTime, this.fxTime + Math.max(0.5, dur - 1.6));
    this.smokes.push({ team, x, z, r, until: this.time + dur, slow, obj: g, born: this.time });
  }

  private spawnMine(u: Unit, x: number, z: number): void {
    const k = u.kit.mine!;
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geos.mine, this.mats.mine);
    body.position.y = 0.04;
    const band = new THREE.Mesh(this.geos.canBand, u.team === 0 ? this.mats.teamBlue : this.mats.teamRed);
    band.scale.set(2.9, 0.5, 2.9);
    band.position.y = 0.07;
    const light = new THREE.Mesh(this.geos.mineLight, this.mats.mineLight);
    light.position.y = 0.11;
    g.add(body, band, light);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.mines.push({ team: u.team, owner: u, x, z, armAt: this.time + k.arm, until: this.time + k.dur, obj: g, light });
  }

  private spawnHealZone(u: Unit, x: number, z: number): void {
    const k = u.kit.hospital!;
    const g = new THREE.Group();
    const fill = new THREE.Mesh(this.geos.disc, (this.mats.healFill as THREE.MeshBasicMaterial).clone());
    fill.scale.setScalar(k.r);
    fill.position.y = 0.035;
    const ring = new THREE.Mesh(this.geos.wave, (this.mats.heal as THREE.MeshBasicMaterial).clone());
    ring.scale.setScalar(k.r);
    ring.position.y = 0.04;
    const a = new THREE.Mesh(this.geos.crossA, this.mats.cross), b = new THREE.Mesh(this.geos.crossB, this.mats.cross);
    a.position.y = b.position.y = 0.045;
    g.add(fill, ring, a, b);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.zones.push({ team: u.team, owner: u, x, z, r: k.r, until: this.time + k.dur, hps: k.hps, obj: g, born: this.time });
  }

  private fxBlast(x: number, z: number, r: number): void {
    const mat = (this.mats.blast as THREE.MeshBasicMaterial).clone();
    const m = new THREE.Mesh(this.geos.disc, mat);
    m.position.set(x, 0.3, z);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.35, tick: (k) => { m.scale.setScalar(0.2 + k * r); mat.opacity = 0.75 * (1 - k); if (k >= 1) mat.dispose(); } });
  }

  private fxArc(u: Unit, dx: number, dz: number, range: number, half: number): void {
    const geo = new THREE.RingGeometry(0.5, range, 12, 1, -half, half * 2).rotateX(-Math.PI / 2);
    const mat = (this.mats.arc as THREE.MeshBasicMaterial).clone();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(u.x, 0.5, u.z);
    m.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.18, tick: (k) => { mat.opacity = 0.55 * (1 - k); if (k >= 1) { geo.dispose(); mat.dispose(); } } });
  }
  private fxWave(x: number, z: number, r: number, base = this.mats.wave as THREE.MeshBasicMaterial): void {
    const mat = base.clone();
    const m = new THREE.Mesh(this.geos.wave, mat);
    m.position.set(x, 0.4, z);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.35, tick: (k) => { m.scale.setScalar(0.3 + k * r); mat.opacity = 0.7 * (1 - k); if (k >= 1) mat.dispose(); } });
  }

  // ------------------------------------------------------------------ AI
  private think(u: Unit): { move: [number, number]; atk: boolean; dir: [number, number] | null } {
    const k = u.kit;
    const e = this.nearestEnemy(u, 12);
    const d = e ? Math.hypot(e.x - u.x, e.z - u.z) : 99;
    const zx = MATCH.zone.x, zz = MATCH.zone.z;
    const range = k.attack.range;
    const want = { tank: 1.3, sprinter: 3.8, technik: 5.2, sniper: 5.0, medic: 4.4 }[u.hero.id];
    // red bots get better with the player's rank; the player's own bots play at a steady level
    const skill = this.opts.allBots ? 0.5 : u.team === 1 ? this.opts.skill ?? 0.3 : 0.55;
    const pf = 0.5 + skill;   // how often abilities are used
    let mx = 0, mz = 0, atk = false;
    let dir: [number, number] | null = null;
    const low = u.hp < k.hp * 0.3;
    if (this.time > u.ai.think) {
      u.ai.think = this.time + 0.6 + Math.random() * 0.6;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * MATCH.zone.r * 0.6;
      u.ai.tx = zx + Math.cos(a) * rr;
      u.ai.tz = zz + Math.sin(a) * rr;
      if (Math.random() < 0.3) u.ai.strafe *= -1;
    }
    // the medic keeps close to a hurt ally when no enemy is in reach
    if (u.hero.id === 'medic' && (!e || d > range + 2)) {
      let hurt: Unit | null = null, worst = 0.85;
      for (const o of this.units) if (o !== u && o.alive && o.team === u.team && o.hp / o.kit.hp < worst) { worst = o.hp / o.kit.hp; hurt = o; }
      if (hurt && Math.hypot(hurt.x - u.x, hurt.z - u.z) > 1.5) { u.ai.tx = hurt.x; u.ai.tz = hurt.z; }
    }
    if (u.hero.id === 'medic' && k.heal && Math.random() < 0.08 * pf) {
      const need = this.units.some((o) => o.alive && o.team === u.team && o.hp / o.kit.hp < 0.6 && Math.hypot(o.x - u.x, o.z - u.z) < k.heal!.r);
      if (need) this.ability(u, 1, null);
    }
    if (e && low && d < 6 && !this.inZone(u)) {
      const [sx, sz] = SPAWNS[u.team][u.slot];
      [mx, mz] = this.steer(u, sx, sz);
      if (d < 3) this.doDash(u, [-(e.x - u.x) / d, -(e.z - u.z) / d]);
    } else if (e && d < range + 3 && this.los(u.x, u.z, e.x, e.z)) {
      const ux = (e.x - u.x) / d, uz = (e.z - u.z) / d;
      if (d > want + 0.4) { [mx, mz] = this.steer(u, e.x, e.z); } else if (d < want - 0.8) { mx = -ux; mz = -uz; }
      mx += -uz * u.ai.strafe * 0.6; mz += ux * u.ai.strafe * 0.6;
      if (!this.inZone(u) && Math.random() < 0.02) { mx += (zx - u.x) * 0.2; mz += (zz - u.z) * 0.2; }
      if (d <= range + 0.2) {
        atk = true;
        const err = ((Math.random() - 0.5) * (this.opts.allBots ? 12 : 22 - 14 * skill) * Math.PI) / 180;
        const c = Math.cos(err), s = Math.sin(err);
        dir = [ux * c - uz * s, ux * s + uz * c];
      }
      // abilities
      const id = u.hero.id;
      // one ability per hero (the medic's heal is handled above)
      if (id === 'technik') {
        if (d < 6.5 && Math.random() < 0.03 * pf) this.ability(u, 1, [ux, uz]);
      } else if (id === 'tank') {
        if (d > 2.2 && d < 4.2 && Math.random() < 0.05 * pf) this.ability(u, 1, [ux, uz]);
      } else if (id === 'sprinter') {
        if (d > 2 && d < 7 && Math.random() < 0.03 * pf) this.ability(u, 1, [ux, uz]);
      } else if (id === 'sniper') {
        if (d < 11 && Math.random() < 0.03 * pf) this.ability(u, 1, dir ?? [ux, uz]);
      }
    } else if (e && d < 9) {
      [mx, mz] = this.steer(u, e.x, e.z);   // seen but not in line of fire: go around the cover
    } else {
      if (Math.hypot(u.ai.tx - u.x, u.ai.tz - u.z) < 0.4) { mx = 0; mz = 0; } else [mx, mz] = this.steer(u, u.ai.tx, u.ai.tz);
      const t = this.nearestTurret(u, range + 0.5);
      if (t) { const td = Math.hypot(t.x - u.x, t.z - u.z) || 1; atk = true; dir = [(t.x - u.x) / td, (t.z - u.z) / td]; }
    }
    const l = Math.hypot(mx, mz);
    return { move: l > 0.01 ? [mx / l, mz / l] : [0, 0], atk, dir };
  }

  // ------------------------------------------------------------------ step
  update(dt: number, input: PlayerInput): void {
    if (this.started && !this.ended) this.time += dt;
    const now = this.time;
    const running = this.started && !this.ended;

    for (const u of this.units) {
      // respawn
      if (!u.alive) {
        if (running && now >= u.respawnAt) {
          const [sx, sz] = SPAWNS[u.team][u.slot];
          Object.assign(u, { x: sx, z: sz, hp: u.kit.hp, alive: true, invulnUntil: now + 1.5, heat: 0, overheatUntil: 0, kx: 0, kz: 0, stunUntil: 0 });
          u.oneShotUntil = 0;
          this.play(u, 'Idle', 0);
        }
        u.mixer.update(dt);
        this.syncUnit(u);
        continue;
      }
      let move: [number, number] = [0, 0];
      if (running) {
        if (u.isPlayer && !this.opts.allBots) {
          const [ix, iy] = input.move;
          const m = Math.hypot(ix, iy);
          move = m > 0.15 ? [ix / m, -iy / m] : [0, 0];
          if (input.attack) this.attack(u, input.attack.dir);
          else if (input.auto) { const t = this.autoTarget(u); if (t) this.attack(u, t); }
          if (input.a1) this.ability(u, 1, null);
          if (input.a2) this.ability(u, 2, null);
          if (input.dash) this.doDash(u, move[0] || move[1] ? move : null);
        } else {
          const t = this.think(u);
          move = t.move;
          if (t.atk) this.attack(u, t.dir);
        }
      }
      // sniper's armour-piercing shot leaves after its short aim
      if (u.pierceAt && now >= u.pierceAt && u.kit.pierce) {
        const k = u.kit.pierce, [dx, dz] = u.pierceDir;
        u.pierceAt = 0;
        if (now >= u.stunUntil) this.spawnProj(u, u.x + dx * 0.5, u.z + dz * 0.5, dx * k.speed, dz * k.speed, k.range, k.dmg, 0, 'tracer', false, u.team, true);
      }
      // regen
      if (running && now - u.lastHurt > REGEN.delay && u.hp < u.kit.hp) u.hp = Math.min(u.kit.hp, u.hp + u.kit.hp * REGEN.perSec * dt);
      if (u.kit.attack.kind === 'gun' && now - u.atkReady > 0.8 && u.heat > 0) u.heat = Math.max(0, u.heat - dt * 3);
      // sprinter spurt: chained dashes toward the nearest enemy / facing
      if (u.spurtLeft > 0 && !u.dash && now >= u.spurtNext && u.kit.spurt) {
        const e = this.nearestEnemy(u, 7);
        const dir: [number, number] = e ? [(e.x - u.x) / (Math.hypot(e.x - u.x, e.z - u.z) || 1), (e.z - u.z) / (Math.hypot(e.x - u.x, e.z - u.z) || 1)]
          : (move[0] || move[1]) ? move : [Math.sin(u.yaw), Math.cos(u.yaw)];
        u.dash = { dx: dir[0], dz: dir[1], left: u.kit.spurt.dist, speed: u.kit.spurt.dist / 0.18, hit: new Set(), dmg: u.kit.spurt.dmg, stun: 0 };
        this.face(u, dir[0], dir[1]);
        u.spurtLeft--;
        u.spurtNext = now + u.kit.spurt.gap;
      }
      const stunned = now < u.stunUntil;
      u.stunFx.visible = stunned;
      let moved = false;
      if (u.dash) {
        const step = Math.min(u.dash.left, u.dash.speed * dt);
        const ok = this.moveUnit(u, u.dash.dx * step, u.dash.dz * step);
        u.dash.left -= step;
        if (u.dash.dmg > 0) {
          for (const e of this.enemiesOf(u)) {
            if (!u.dash.hit.has(e.id) && Math.hypot(e.x - u.x, e.z - u.z) < 0.8) {
              u.dash.hit.add(e.id);
              this.hurt(e, u.dash.dmg, u);
              if (u.dash.stun && e.alive) { e.stunUntil = now + u.dash.stun; this.knock(e, u.x, u.z, 0.8); }
            }
          }
        }
        if (u.dash.left <= 0.001 || !ok) u.dash = null;
        moved = true;
      } else if (!stunned && (move[0] || move[1])) {
        const sp = this.speedOf(u);
        moved = this.moveUnit(u, move[0] * sp * dt, move[1] * sp * dt);
        if (!moved && !u.isPlayer) {
          // steer around the obstacle: try turning the wanted direction by +-50 / +-95 degrees
          for (const deg of [50 * u.ai.strafe, -50 * u.ai.strafe, 95 * u.ai.strafe, -95 * u.ai.strafe]) {
            const a = (deg * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
            const tx = move[0] * c - move[1] * s2, tz = move[0] * s2 + move[1] * c;
            if (this.moveUnit(u, tx * sp * dt, tz * sp * dt)) { moved = true; move = [tx, tz]; break; }
          }
          if (!moved) u.ai.think = 0;
        }
        if (now > u.faceUntil && now > u.oneShotUntil) {
          let diff = Math.atan2(move[0], move[1]) - u.yaw;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          u.yaw += diff * Math.min(1, dt * 14);
        }
      }
      // knockback
      if (u.kx || u.kz) {
        this.moveUnit(u, u.kx * dt, u.kz * dt);
        const f = Math.exp(-dt * 9);
        u.kx *= f; u.kz *= f;
        if (Math.hypot(u.kx, u.kz) < 0.05) { u.kx = 0; u.kz = 0; }
      }
      u.moving = moved && !u.dash;
      // locomotion animation
      if (u.alive && now >= u.oneShotUntil) {
        if (u.moving || u.dash) {
          this.play(u, 'Run', 0.12);
          u.cur?.setEffectiveTimeScale(u.dash ? 1.6 : this.speedOf(u) / u.hero.runSpeed);
        } else this.play(u, 'Idle', 0.18);
      } else if (u.moving && u.cur && u.cur !== u.actions.get('Defeat')) {
        this.play(u, 'Run', 0.08);
        u.oneShotUntil = 0;
      }
      u.mixer.update(dt);
      this.syncUnit(u);
    }
    // soft separation between units
    for (let i = 0; i < this.units.length; i++) for (let j = i + 1; j < this.units.length; j++) {
      const a = this.units[i], b = this.units[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < R_BODY * 2) {
        const push = (R_BODY * 2 - d) / 2;
        this.moveUnit(a, (-dx / d) * push, (-dz / d) * push);
        this.moveUnit(b, (dx / d) * push, (dz / d) * push);
      }
    }
    if (running) {
      this.stepProjectiles(dt);
      this.stepTurrets();
      this.stepMines();
      this.stepHealZones(dt);
      this.stepZone(dt);
    }
    this.stepSmokes(dt);
    this.stepFx(dt);
    this.zoneVisual();
    if (running && (this.score[0] >= MATCH.target || this.score[1] >= MATCH.target || now >= MATCH.seconds)) this.finish();
  }

  private syncUnit(u: Unit): void {
    const flash = this.time < u.flashUntil ? 0.55 : 0;   // white hit flash
    for (const m of u.mats) if (m.emissiveIntensity !== flash) { m.emissive.setRGB(1, 0.92, 0.85); m.emissiveIntensity = flash; }
    u.root.position.set(u.x, 0, u.z);
    u.root.rotation.y = u.yaw;
    u.ring.position.set(u.x, 0.02, u.z);
    u.ring.visible = u.alive;
    u.stunFx.position.set(u.x, 1.75, u.z);
    u.stunFx.rotation.y += 0.2;
    // invulnerability blink after respawn
    u.root.visible = u.alive ? !(this.time < u.invulnUntil && Math.floor(this.time * 10) % 2 === 0) : this.time < u.respawnAt - RESPAWN_S + 1.6;
    // tank door
    const doorOn = u.alive && this.time < u.doorUntil;
    if (doorOn && !u.door) {
      let g: THREE.Object3D;
      if (this.propTpl) g = this.propClone('door', u.team);
      else {
        g = new THREE.Group();
        const d = new THREE.Mesh(this.geos.door, this.mats.metal);
        d.position.y = 0.78;
        g.add(d);
        for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(this.geos.rib, this.mats.dark); r.position.y = 0.18 + i * 0.3; g.add(r); }
      }
      g.userData.born = this.time;
      this.scene.add(g);
      u.door = g;
    }
    if (!doorOn && u.door) { this.scene.remove(u.door); u.door = null; }
    if (u.door) {
      u.door.position.set(u.x + Math.sin(u.yaw) * 0.6, 0, u.z + Math.cos(u.yaw) * 0.6);
      u.door.rotation.y = u.yaw;
      // pops up out of the ground
      const k = Math.min(1, (this.time - (u.door.userData.born ?? 0)) / 0.18);
      u.door.scale.set(1, 0.3 + 0.7 * (1 - (1 - k) ** 3), 1);
    }
  }

  private stepProjectiles(dt: number): void {
    const keep: Proj[] = [];
    for (const p of this.projs) {
      const sp = Math.hypot(p.vx, p.vz);
      const step = sp * dt;
      const n = Math.max(1, Math.ceil(step / 0.15));
      let dead = false;
      for (let i = 0; i < n && !dead; i++) {
        const ox = p.x, oz = p.z;
        p.x += (p.vx * dt) / n;
        p.z += (p.vz * dt) / n;
        p.left -= step / n;
        if (p.left <= 0 || !insideCourtyard(p.x, p.z, 0.05)) { dead = true; break; }
        const c = this.blocksShot(p.x, p.z);
        if (c) {
          if (p.bounces > 0) {
            p.bounces--;
            const inX = !(ox > c.x[0] && ox < c.x[1]);
            if (inX) p.vx = -p.vx; else p.vz = -p.vz;
            p.x = ox; p.z = oz;
            continue;
          }
          dead = true; break;
        }
        // doors block enemy shots
        for (const u of this.units) {
          if (u.team === p.team || !u.door) continue;
          const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
          const rx = p.x - (u.x + fx * 0.6), rz = p.z - (u.z + fz * 0.6);
          const along = rx * fx + rz * fz, lat = rx * fz - rz * fx;
          if (Math.abs(along) < 0.18 && Math.abs(lat) < (u.kit.door?.width ?? 1.5) / 2) { dead = true; break; }
        }
        if (dead) break;
        for (const u of this.units) {
          if (u.team === p.team || !u.alive) continue;
          if (Math.hypot(u.x - p.x, u.z - p.z) < R_HIT) {
            if (p.pierced) { if (!p.pierced.has(u.id)) { p.pierced.add(u.id); this.hurt(u, p.dmg, p.owner); } continue; }
            this.hurt(u, p.dmg, p.owner); dead = true; break;
          }
        }
        if (dead) break;
        for (const t of this.turrets) {
          if (t.team === p.team) continue;
          if (Math.hypot(t.x - p.x, t.z - p.z) < 0.4) { this.hurtTurret(t, p.dmg); dead = true; break; }
        }
      }
      p.obj.position.x = p.x;
      p.obj.position.z = p.z;
      if (p.spin) p.obj.rotation.y += dt * 25;
      else p.obj.rotation.y = Math.atan2(p.vx, p.vz);
      if (dead) this.scene.remove(p.obj); else keep.push(p);
    }
    this.projs = keep;
  }

  private stepTurrets(): void {
    const keep: Turret[] = [];
    for (const t of this.turrets) {
      if (this.time >= t.until || !t.owner) { this.scene.remove(t.obj); continue; }
      const k = t.owner.kit.turret!;
      const age = this.time - t.born;   // drops in with a small bounce
      t.obj.scale.setScalar(TURRET_SCALE * (age >= 0.3 ? 1 : Math.max(0.01, 1 + 0.25 * Math.sin((age / 0.3) * Math.PI) - (1 - age / 0.3) ** 2)));
      let best: Unit | null = null, bd = k.range;
      for (const e of this.units) if (e.alive && e.team !== t.team) { const d = Math.hypot(e.x - t.x, e.z - t.z); if (d < bd && this.los(t.x, t.z, e.x, e.z)) { bd = d; best = e; } }
      if (best) {
        const dx = (best.x - t.x) / bd, dz = (best.z - t.z) / bd;
        t.head.rotation.y = Math.atan2(dx, dz) - t.obj.rotation.y;
        if (this.time >= t.next) {
          t.next = this.time + 1 / k.rate;
          this.spawnProj(t.owner, t.x + dx * 0.5 * TURRET_SCALE, t.z + dz * 0.5 * TURRET_SCALE, dx * 16, dz * 16, k.range + 0.5, k.dmg, 0, 'bullet', true, t.team);
        }
      } else t.head.rotation.y += 0.01;
      keep.push(t);
    }
    this.turrets = keep;
  }

  private stepMines(): void {
    const keep: Mine[] = [];
    for (const m of this.mines) {
      if (this.time >= m.until) { this.scene.remove(m.obj); continue; }
      const armed = this.time >= m.armAt;
      m.light.visible = armed ? Math.floor(this.time * 3) % 2 === 0 : true;
      const k = m.owner.kit.mine!;
      if (armed && this.units.some((e) => e.alive && e.team !== m.team && Math.hypot(e.x - m.x, e.z - m.z) < k.r)) {
        for (const e of this.units) {
          if (!e.alive || e.team === m.team || Math.hypot(e.x - m.x, e.z - m.z) > k.r * 1.25) continue;
          this.hurt(e, k.dmg, m.owner);
          if (e.alive) { e.stunUntil = this.time + k.stun; e.dash = null; }
        }
        this.fxBlast(m.x, m.z, k.r * 1.25);
        this.ev.shake?.(0.5);
        this.scene.remove(m.obj);
        continue;
      }
      keep.push(m);
    }
    this.mines = keep;
  }

  private stepHealZones(dt: number): void {
    const keep: HealZone[] = [];
    for (const z of this.zones) {
      if (this.time >= z.until) { this.scene.remove(z.obj); continue; }
      for (const u of this.units) if (u.alive && u.team === z.team && Math.hypot(u.x - z.x, u.z - z.z) < z.r) this.healUnit(u, z.hps * dt, z.owner);
      const age = this.time - z.born;
      z.obj.scale.setScalar(Math.min(1, age / 0.25));
      const ring = z.obj.children[1] as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.25 * Math.sin(this.time * 6);
      keep.push(z);
    }
    this.zones = keep;
  }

  private stepSmokes(dt: number): void {
    this.fxTime += dt;
    this.smokeFx.update(dt, this.fxTime, this.camera ?? this.scene.children[0]);
    const keep: Smoke[] = [];
    for (const s of this.smokes) {
      const age = this.time - s.born, left = s.until - this.time;
      if (left <= 0) { this.scene.remove(s.obj); continue; }
      if (age < 0.25) s.obj.position.y = 0.4 * Math.sin((age / 0.25) * Math.PI);   // lands with a small hop
      else s.obj.position.y = 0;
      keep.push(s);
    }
    this.smokes = keep;
  }

  private stepFx(dt: number): void {
    const keep: Fx[] = [];
    for (const f of this.fx) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.tick(k);
      if (k >= 1) this.scene.remove(f.obj); else keep.push(f);
    }
    this.fx = keep;
  }

  private stepZone(dt: number): void {
    const inside = [0, 0];
    for (const u of this.units) if (u.alive && this.inZone(u)) inside[u.team]++;
    this.zoneOwner = inside[0] && inside[1] ? -2 : inside[0] ? 0 : inside[1] ? 1 : -1;
    this.zoneTick += dt;
    if (this.zoneTick >= 0.5) {
      this.zoneTick -= 0.5;
      if (this.zoneOwner === 0 || this.zoneOwner === 1) {
        this.score[this.zoneOwner] = Math.min(MATCH.target, this.score[this.zoneOwner] + MATCH.pointsPerSec / 2);
      }
    }
  }

  private zoneVisual(): void {
    const ring = this.zoneRing.material as THREE.MeshBasicMaterial;
    const fill = this.zoneFill.material as THREE.MeshBasicMaterial;
    const col = this.zoneOwner === 0 ? TEAM_COL[0] : this.zoneOwner === 1 ? TEAM_COL[1] : this.zoneOwner === -2 ? 0xffc94a : 0xffffff;
    ring.color.setHex(col);
    fill.color.setHex(col);
    ring.opacity = this.zoneOwner === -1 ? 0.35 : 0.85;
    fill.opacity = this.zoneOwner === -1 ? 0 : 0.14 + 0.06 * Math.sin(this.time * 6);
  }

  private finish(): void {
    this.ended = true;
    const winner: Team | -1 = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1;
    for (const u of this.units) {
      u.dash = null;
      if (!u.alive) continue;
      if (u.team === winner) { u.oneShotUntil = 99999; this.play(u, 'Victory', 0.2); }
      else { u.oneShotUntil = 0; this.play(u, 'Idle', 0.2); }
    }
    const p = this.player;
    this.ev.end({ winner, score: [Math.round(this.score[0]), Math.round(this.score[1])], you: { kills: p.kills, deaths: p.deaths, dealt: p.dealt, healed: Math.round(p.healed) } });
  }

  dispose(): void {
    for (const p of this.projs) this.scene.remove(p.obj);
    for (const t of this.turrets) this.scene.remove(t.obj);
    for (const s of this.smokes) this.scene.remove(s.obj);
    for (const m of this.mines) this.scene.remove(m.obj);
    for (const z of this.zones) this.scene.remove(z.obj);
    this.smokeFx.dispose();
    for (const u of this.units) for (const m of u.mats) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
