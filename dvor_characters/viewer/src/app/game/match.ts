import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hitsCollider, insideCourtyard, type Collider } from './arena';
import { HEROES, type Hero, type HeroId } from '../data';
import { DASH, KITS, MATCH, REGEN, RESPAWN_S, TEAM_SIZE, type Kit } from './kits';

export type Team = 0 | 1;
const R_BODY = 0.35;
const R_HIT = 0.45;
const TEAM_COL = [0x2b9cf0, 0xe2493b];
const r2 = (v: number): number => Math.round(v * 100) / 100;
const left = (v: number): number => (v > 0 ? r2(v) : 0);

const SPAWNS: [number, number][][] = [

  [[-2.88, 6.2], [2.52, 6.2], [-4.48, 5.0]],
  [[2.6, -7.2], [-2.8, -7.2], [4.2, -6.0]],
];
const CLIPS = ['Idle', 'Run', 'Attack', 'Ability', 'Hit', 'Defeat', 'Victory'] as const;
type Clip = (typeof CLIPS)[number];
const KINDS = ['bullet', 'record', 'tracer', 'dart'] as const;
type ProjKind = (typeof KINDS)[number];

export interface PlayerInput {
  move: [number, number];
  attack: null | { dir: [number, number] | null };
  auto: boolean;
  a1: boolean; dash: boolean;
}

export interface MatchOptions {
  blue?: HeroId[]; red?: HeroId[];
  allBots?: boolean;
  skill?: number;
  playerBoost?: Boost;
  net?: 'host' | 'guest';
  rivalBoost?: Boost;
}

export interface Snapshot {
  t: number; s: [number, number]; z: number; e: number;
  u: number[][]; p: number[][]; q: number[][]; v: (string | number)[][];
}
export interface Boost { hp: number; dmg: number; speed: number; cd?: number; immortal?: boolean; noCd?: boolean; dmgFlat?: number }

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
  if (x.pierce) x.pierce.dmg = Math.round(x.pierce.dmg * d);
  if (x.heal) x.heal.amount = Math.round(x.heal.amount * d);
  if (b.dmgFlat) {
    x.attack.dmg = b.dmgFlat;
    for (const f of [x.turret, x.ram, x.spurt, x.pierce]) if (f) f.dmg = b.dmgFlat;
  }
  if (b.noCd) { x.a1.cd = 0; x.dashCd = 0; }
  if (b.immortal) x.immortal = true;
  return x;
}

export function lineup(first?: HeroId): HeroId[] {
  const rest = HEROES.map((h) => h.id).filter((id) => id !== first).sort(() => Math.random() - 0.5);
  return first ? [first, ...rest.slice(0, TEAM_SIZE - 1)] : rest.slice(0, TEAM_SIZE);
}

export interface UnitView {
  id: number; team: Team; hero: Hero; isPlayer: boolean; human: boolean; alive: boolean; hp: number; maxHp: number;
  x: number; z: number; heat: number; overheated: boolean; respawnIn: number; immortal: boolean;
}

interface Unit {
  id: number; team: Team; hero: Hero; kit: Kit; isPlayer: boolean; human: boolean; slot: number;
  root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<Clip, THREE.AnimationAction>;
  mats: THREE.MeshStandardMaterial[]; flashUntil: number;
  cur: THREE.AnimationAction | null; oneShotUntil: number; clip: Clip; seq: number; netSeq: number;
  nx: number; nz: number; nyaw: number;
  ring: THREE.Mesh; stunFx: THREE.Mesh;
  x: number; z: number; yaw: number; kx: number; kz: number;
  hp: number; alive: boolean; respawnAt: number; invulnUntil: number;
  atkReady: number; heat: number; overheatUntil: number; meleeCount: number;
  cd1: number; cdDash: number;
  dash: null | { dx: number; dz: number; left: number; speed: number; hit: Set<number>; dmg: number; stun: number };
  spurtLeft: number; spurtNext: number;
  stunUntil: number; lastHurt: number; lastFight: number; moving: boolean; faceUntil: number;
  ai: { think: number; tx: number; tz: number; target: Unit | null; strafe: number };
  kills: number; deaths: number; dealt: number; healed: number;
  pierceAt: number; pierceDir: [number, number]; healAcc: number; healShowAt: number;
}

interface Proj {
  id: number; kind: ProjKind; team: Team; owner: Unit | null; x: number; z: number; vx: number; vz: number; left: number; dmg: number;
  bounces: number; obj: THREE.Object3D; spin: boolean; fromTurret: boolean; pierced: Set<number> | null;
}
interface Turret { id: number; team: Team; owner: Unit; x: number; z: number; hp: number; until: number; next: number; obj: THREE.Object3D; head: THREE.Object3D; born: number }
interface Fx { obj: THREE.Object3D; t: number; dur: number; tick: (k: number) => void }

export interface MatchEvents {
  damage(x: number, y: number, z: number, amount: number, team: Team, heal?: boolean): void;
  kill(killer: UnitView | null, victim: UnitView): void;
  shake?(amount: number): void;
  end(result: { winner: Team | -1; score: [number, number]; you: { kills: number; deaths: number; dealt: number; healed: number } }): void;
}

const TURRET_SCALE = 1.4;

export class Match {
  readonly units: Unit[] = [];
  readonly score: [number, number] = [0, 0];
  zoneOwner: Team | -1 | -2 = -1;
  time = 0;
  ended = false;
  private projs: Proj[] = [];
  private turrets: Turret[] = [];
  private fx: Fx[] = [];
  private zoneTick = 0;
  private zoneRing: THREE.Mesh;
  private zoneFill: THREE.Mesh;
  private mats: Record<string, THREE.Material> = {};
  private geos: Record<string, THREE.BufferGeometry> = {};
  private started = false;
  readonly me: Team;
  private remote: PlayerInput | null = null;
  private log: (string | number)[][] = [];
  private nextId = 1;

  constructor(
    private scene: THREE.Scene,
    heroes: Record<HeroId, GLTF>,
    private colliders: Collider[],
    playerHero: HeroId,
    private ev: MatchEvents,
    props: GLTF,
    private opts: MatchOptions = {},
  ) {
    this.me = opts.net === 'guest' ? 1 : 0;
    this.buildShared();
    this.setupProps(props);

    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(MATCH.zone.r - 0.18, MATCH.zone.r, 56).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.zoneFill = new THREE.Mesh(new THREE.CircleGeometry(MATCH.zone.r - 0.18, 56).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
    this.zoneRing.position.set(MATCH.zone.x, 0.03, MATCH.zone.z);
    this.zoneFill.position.set(MATCH.zone.x, 0.025, MATCH.zone.z);
    scene.add(this.zoneRing, this.zoneFill);

    const blue = opts.blue ?? lineup(playerHero);
    const red: HeroId[] = opts.red ?? lineup();
    let id = 0;
    for (const [team, list] of [[0, blue], [1, red]] as [Team, HeroId[]][]) {
      list.forEach((hid, slot) => {
        this.units.push(this.makeUnit(id++, team, HEROES.find((h) => h.id === hid)!, heroes[hid], team === this.me && slot === 0, slot));
      });
    }
  }

  get player(): Unit { return this.units.find((u) => u.isPlayer) ?? this.units[0]; }
  stats(): { kills: number; deaths: number; dealt: number; healed: number } {
    const p = this.player;
    return { kills: p.kills, deaths: p.deaths, dealt: Math.round(p.dealt), healed: Math.round(p.healed) };
  }
  private side(team: Team): 0 | 1 { return team === this.me ? 0 : 1; }
  start(): void { this.started = true; }

  view(u: Unit): UnitView {
    return { id: u.id, team: u.team, hero: u.hero, isPlayer: u.isPlayer, human: u.human, alive: u.alive, hp: Math.round(u.hp), maxHp: u.kit.hp,
      x: u.x, z: u.z, heat: u.heat, overheated: this.time < u.overheatUntil, respawnIn: Math.max(0, u.respawnAt - this.time), immortal: !!u.kit.immortal };
  }
  views(): UnitView[] { return this.units.map((u) => this.view(u)); }
  cooldowns(): { a1: number; dash: number; a1Max: number; dashMax: number } {
    const p = this.player;
    return { a1: Math.max(0, p.cd1 - this.time), dash: Math.max(0, p.cdDash - this.time), a1Max: p.kit.a1.cd, dashMax: p.kit.dashCd ?? DASH.cd };
  }

  private buildShared(): void {
    const M = (c: number, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
    this.mats = {
      bullet: M(0xffd36a), bulletRed: M(0xff8a6a), record: new THREE.MeshLambertMaterial({ color: 0x151417 }),
      label: M(0xe23a54), arc: M(0xffffff, 0.55), heal: M(0x5be37d, 0.6),
      stun: M(0xffd23f), ringBlue: M(TEAM_COL[0], 0.9), ringRed: M(TEAM_COL[1], 0.9),
      tracer: M(0xfff1c2), tracerRed: M(0xffb39a), dart: new THREE.MeshLambertMaterial({ color: 0xf4f1ea }), dartTip: M(0xd8382c),
    };
    this.geos = {
      bullet: new THREE.BoxGeometry(0.07, 0.07, 0.42),
      record: new THREE.CylinderGeometry(0.17, 0.17, 0.03, 14),
      label: new THREE.CylinderGeometry(0.07, 0.07, 0.035, 10),
      ring: new THREE.RingGeometry(0.42, 0.5, 36).rotateX(-Math.PI / 2),
      wave: new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      stun: new THREE.TorusGeometry(0.22, 0.03, 6, 16).rotateX(Math.PI / 2),
      tracer: new THREE.BoxGeometry(0.06, 0.06, 0.9),
      dart: new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6).rotateX(Math.PI / 2),
      dartTip: new THREE.ConeGeometry(0.03, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.2),
    };
  }

  private turretTpl!: THREE.Object3D;
  private teamMats!: [THREE.Material, THREE.Material];
  private setupProps(g: GLTF): void {
    this.turretTpl = g.scene.getObjectByName('PROP_Turret')!;
    let team!: THREE.MeshStandardMaterial;
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const mt of ([] as THREE.Material[]).concat(m.material)) if (mt.name === 'Team') team = mt as THREE.MeshStandardMaterial;
    });
    const paint = (c: number) => {
      const t = team.clone();
      t.color.setHex(c);
      t.emissive.setHex(c).multiplyScalar(0.25);
      return t;
    };
    this.teamMats = [paint(TEAM_COL[this.me]), paint(TEAM_COL[1 - this.me])];
  }
  private propClone(team: Team): THREE.Object3D {
    const o = this.turretTpl.clone(true);
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && m.material.name === 'Team') m.material = this.teamMats[this.side(team)];
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
    const ring = new THREE.Mesh(this.geos.ring, this.side(team) === 0 ? this.mats.ringBlue : this.mats.ringRed);
    const stunFx = new THREE.Mesh(this.geos.stun, this.mats.stun);
    stunFx.visible = false;
    this.scene.add(root, ring, stunFx);
    const [sx, sz] = SPAWNS[team][slot];

    const s = this.opts.skill ?? 0;
    const human = slot === 0 && (isPlayer || !!this.opts.net);
    const boost = isPlayer ? this.opts.playerBoost : human ? this.opts.rivalBoost : undefined;
    const kit = boost ? boostKit(KITS[hero.id], boost)
      : team === 1 && !this.opts.allBots && !this.opts.net && s > 0 ? boostKit(KITS[hero.id], { hp: 1 + 0.15 * s, dmg: 1 + 0.15 * s, speed: 1 })
      : KITS[hero.id];
    const u: Unit = {
      id, team, hero, kit, isPlayer, human, slot, root, mixer, actions, mats, flashUntil: 0, cur: null, oneShotUntil: 0, ring, stunFx,
      clip: 'Idle', seq: 0, netSeq: -1, nx: sx, nz: sz, nyaw: team === 0 ? Math.PI : 0,
      x: sx, z: sz, yaw: team === 0 ? Math.PI : 0, kx: 0, kz: 0,
      hp: kit.hp, alive: true, respawnAt: 0, invulnUntil: 0,
      atkReady: 0, heat: 0, overheatUntil: 0, meleeCount: 0, cd1: 0, cdDash: 0,
      dash: null, spurtLeft: 0, spurtNext: 0, stunUntil: 0, lastHurt: -99, lastFight: -99, moving: false, faceUntil: 0,
      ai: { think: 0, tx: sx, tz: sz, target: null, strafe: Math.random() < 0.5 ? 1 : -1 },
      kills: 0, deaths: 0, dealt: 0, healed: 0, pierceAt: 0, pierceDir: [0, 1], healAcc: 0, healShowAt: 0,
    };
    this.play(u, 'Idle', 0);
    return u;
  }

  private play(u: Unit, name: Clip, fade = 0.12, oneShotFor = 0): void {
    const next = u.actions.get(name);
    if (!next) return;
    if (oneShotFor > 0) u.oneShotUntil = this.time + oneShotFor;
    if (next === u.cur && name !== 'Attack' && name !== 'Ability' && name !== 'Hit') return;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    u.clip = name;
    u.seq++;
    if (u.cur && u.cur !== next && fade > 0) next.crossFadeFrom(u.cur, fade, false);
    else if (u.cur && u.cur !== next) u.cur.stop();
    u.cur = next;
  }

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
    return s;
  }
  private inZone(u: Unit): boolean { return Math.hypot(u.x - MATCH.zone.x, u.z - MATCH.zone.z) < MATCH.zone.r; }
  private los(ax: number, az: number, bx: number, bz: number): boolean {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3);
    for (let i = 1; i < n; i++) if (this.blocksShot(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
    return true;
  }

  private hurt(target: Unit, amount: number, by: Unit | null): void {
    if (!target.alive || this.time < target.invulnUntil || this.ended || target.kit.immortal) return;
    const dmg = Math.round(amount * (1 - target.kit.armor));
    target.hp -= dmg;
    target.lastHurt = this.time;
    target.flashUntil = this.time + 0.1;
    if (target.isPlayer) this.ev.shake?.(Math.min(0.45, 0.12 + dmg / 4000));
    else if (target.human) this.rec('h', target.id, dmg);
    target.lastFight = this.time;
    if (by) { by.dealt += dmg; by.lastFight = this.time; }
    this.damage(target.x, 2.0, target.z, dmg, target.team);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      target.respawnAt = this.time + RESPAWN_S;
      target.dash = null;
      target.spurtLeft = 0;
      if (by) by.kills++;
      this.play(target, 'Defeat', 0.1, 99);
      this.ev.kill(by ? this.view(by) : null, this.view(target));
      this.rec('k', by ? by.id : -1, target.id);
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
    target.healAcc += got;
    if (this.time >= target.healShowAt) {
      this.damage(target.x, 2.1, target.z, Math.round(target.healAcc), target.team, true);
      target.healAcc = 0;
      target.healShowAt = this.time + 0.5;
    }
  }
  private hurtTurret(t: Turret, amount: number): void {
    t.hp -= amount;
    this.damage(t.x, 1.3, t.z, Math.round(amount), t.team);
    if (t.hp <= 0) t.until = 0;
  }
  private rec(...e: (string | number)[]): void { if (this.opts.net === 'host') this.log.push(e); }
  private damage(x: number, y: number, z: number, n: number, team: Team, heal = false): void {
    this.ev.damage(x, y, z, n, team, heal);
    this.rec('d', r2(x), r2(y), r2(z), n, team, heal ? 1 : 0);
  }

  private knock(target: Unit, fromX: number, fromZ: number, dist: number): void {
    const d = Math.hypot(target.x - fromX, target.z - fromZ) || 1;
    target.kx += ((target.x - fromX) / d) * dist * 6;
    target.kz += ((target.z - fromZ) / d) * dist * 6;
  }

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
    u.faceUntil = this.time + 0.35;
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
      this.fxArc(u.x, u.z, Math.atan2(dx, dz) - Math.PI / 2, a.range, half);
    }
  }

  private ability(u: Unit, dir: [number, number] | null): boolean {
    if (!u.alive || this.time < u.stunUntil || u.dash || this.time < u.cd1) return false;
    const k = u.kit;
    const [dx, dz] = this.aimAt(u, dir, 7);
    this.face(u, dx, dz);
    u.lastFight = this.time;
    if (k.turret) {
      let px = u.x + dx * k.turret.place, pz = u.z + dz * k.turret.place;
      if (!this.free(px, pz)) { px = u.x + dx * 0.9; pz = u.z + dz * 0.9; }
      if (!this.free(px, pz)) { px = u.x; pz = u.z; }
      for (const t of this.turrets.filter((t) => t.owner === u)) t.until = 0;
      this.spawnTurret(u, px, pz);
    } else if (k.ram) {
      u.dash = { dx, dz, left: k.ram.dist, speed: k.ram.dist / 0.3, hit: new Set(), dmg: k.ram.dmg, stun: k.ram.stun };
    } else if (k.spurt) {
      u.spurtLeft = k.spurt.dashes;
      u.spurtNext = this.time;
    } else if (k.pierce) {
      u.pierceAt = this.time + k.pierce.delay;
      u.pierceDir = [dx, dz];
      u.faceUntil = this.time + k.pierce.delay + 0.2;
    } else if (k.heal) {
      for (const o of this.units) if (o.team === u.team && Math.hypot(o.x - u.x, o.z - u.z) < k.heal.r) this.healUnit(o, k.heal.amount, u);
      this.fxWave(u.x, u.z, k.heal.r);
    }
    u.cd1 = this.time + k.a1.cd;
    this.play(u, 'Ability', 0.06, 0.45);
    return true;
  }

  private doDash(u: Unit, dir: [number, number] | null): void {
    if (!u.alive || this.time < u.cdDash || this.time < u.stunUntil || u.dash) return;
    const [dx, dz] = dir ?? [Math.sin(u.yaw), Math.cos(u.yaw)];
    u.dash = { dx, dz, left: DASH.dist, speed: DASH.dist / DASH.time, hit: new Set(), dmg: 0, stun: 0 };
    u.cdDash = this.time + (u.kit.dashCd ?? DASH.cd);
    this.face(u, dx, dz);
  }

  private spawnProj(u: Unit | null, x: number, z: number, vx: number, vz: number, range: number, dmg: number, bounces: number,
    kind: ProjKind, fromTurret: boolean, team: Team = u?.team ?? 0, pierce = false, id = this.nextId++): Proj {
    const ours = this.side(team) === 0;
    let obj: THREE.Object3D;
    if (kind === 'tracer') {
      obj = new THREE.Mesh(this.geos.tracer, ours ? this.mats.tracer : this.mats.tracerRed);
      if (pierce) obj.scale.set(2.2, 2.2, 1.6);
    } else if (kind === 'dart') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geos.dart, this.mats.dart), new THREE.Mesh(this.geos.dartTip, this.mats.dartTip));
      obj = g;
    } else if (kind === 'bullet') {
      obj = new THREE.Mesh(this.geos.bullet, ours ? this.mats.bullet : this.mats.bulletRed);
      obj.rotation.y = Math.atan2(vx, vz);
      if (fromTurret) obj.scale.setScalar(0.75);
    } else {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geos.record, this.mats.record));
      const l = new THREE.Mesh(this.geos.label, this.mats.label);
      g.add(l);
      obj = g;
    }
    obj.position.set(x, fromTurret ? 0.38 * TURRET_SCALE : 1.0, z);
    this.scene.add(obj);
    const p: Proj = { id, kind, team, owner: u, x, z, vx, vz, left: range, dmg, bounces, obj, spin: kind === 'record', fromTurret, pierced: pierce ? new Set() : null };
    this.projs.push(p);
    return p;
  }

  private spawnTurret(u: Unit, x: number, z: number): void {
    const k = u.kit.turret!;
    this.turrets.push({ ...this.turretObj(u.team, x, z, u.yaw), id: this.nextId++, team: u.team, owner: u, x, z, hp: k.hp, until: this.time + k.dur, next: this.time + 0.4, born: this.time });
  }
  private turretObj(team: Team, x: number, z: number, yaw: number): { obj: THREE.Object3D; head: THREE.Object3D } {
    const obj = this.propClone(team);
    const head = obj.children.find((c) => c.name.startsWith('PROP_TurretHead'))!;
    obj.position.set(x, 0, z);
    obj.rotation.y = yaw;
    this.scene.add(obj);
    return { obj, head };
  }

  private fxArc(x: number, z: number, rot: number, range: number, half: number): void {
    this.rec('a', r2(x), r2(z), r2(rot), range, r2(half));
    const geo = new THREE.RingGeometry(0.5, range, 12, 1, -half, half * 2).rotateX(-Math.PI / 2);
    const mat = (this.mats.arc as THREE.MeshBasicMaterial).clone();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.5, z);
    m.rotation.y = rot;
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.18, tick: (k) => { mat.opacity = 0.55 * (1 - k); if (k >= 1) { geo.dispose(); mat.dispose(); } } });
  }
  private fxWave(x: number, z: number, r: number): void {
    this.rec('w', r2(x), r2(z), r);
    const mat = (this.mats.heal as THREE.MeshBasicMaterial).clone();
    const m = new THREE.Mesh(this.geos.wave, mat);
    m.position.set(x, 0.4, z);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.35, tick: (k) => { m.scale.setScalar(0.3 + k * r); mat.opacity = 0.7 * (1 - k); if (k >= 1) mat.dispose(); } });
  }

  private think(u: Unit): { move: [number, number]; atk: boolean; dir: [number, number] | null } {
    const k = u.kit;
    const e = this.nearestEnemy(u, 12);
    const d = e ? Math.hypot(e.x - u.x, e.z - u.z) : 99;
    const zx = MATCH.zone.x, zz = MATCH.zone.z;
    const range = k.attack.range;
    const want = { tank: 1.3, sprinter: 3.8, technik: 5.2, sniper: 5.0, medic: 4.4 }[u.hero.id];

    const skill = this.opts.allBots ? 0.5 : this.opts.net ? 0.45 : u.team === 1 ? this.opts.skill ?? 0.3 : 0.55;
    const pf = 0.5 + skill;
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

    if (u.hero.id === 'medic' && (!e || d > range + 2)) {
      let hurt: Unit | null = null, worst = 0.85;
      for (const o of this.units) if (o !== u && o.alive && o.team === u.team && o.hp / o.kit.hp < worst) { worst = o.hp / o.kit.hp; hurt = o; }
      if (hurt && Math.hypot(hurt.x - u.x, hurt.z - u.z) > 1.5) { u.ai.tx = hurt.x; u.ai.tz = hurt.z; }
    }
    if (u.hero.id === 'medic' && k.heal && Math.random() < 0.08 * pf) {
      const need = this.units.some((o) => o.alive && o.team === u.team && o.hp / o.kit.hp < 0.6 && Math.hypot(o.x - u.x, o.z - u.z) < k.heal!.r);
      if (need) this.ability(u, null);
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

      const id = u.hero.id;

      if (id === 'technik') {
        if (d < 6.5 && Math.random() < 0.03 * pf) this.ability(u, [ux, uz]);
      } else if (id === 'tank') {
        if (d > 2.2 && d < 4.2 && Math.random() < 0.05 * pf) this.ability(u, [ux, uz]);
      } else if (id === 'sprinter') {
        if (d > 2 && d < 7 && Math.random() < 0.03 * pf) this.ability(u, [ux, uz]);
      } else if (id === 'sniper') {
        if (d < 11 && Math.random() < 0.03 * pf) this.ability(u, dir ?? [ux, uz]);
      }
    } else if (e && d < 9) {
      [mx, mz] = this.steer(u, e.x, e.z);
    } else {
      if (Math.hypot(u.ai.tx - u.x, u.ai.tz - u.z) < 0.4) { mx = 0; mz = 0; } else [mx, mz] = this.steer(u, u.ai.tx, u.ai.tz);
      const t = this.nearestTurret(u, range + 0.5);
      if (t) { const td = Math.hypot(t.x - u.x, t.z - u.z) || 1; atk = true; dir = [(t.x - u.x) / td, (t.z - u.z) / td]; }
    }
    const l = Math.hypot(mx, mz);
    return { move: l > 0.01 ? [mx / l, mz / l] : [0, 0], atk, dir };
  }

  setRemote(inp: PlayerInput): void {
    const r = this.remote;
    this.remote = { move: inp.move, auto: true, attack: inp.attack ?? r?.attack ?? null, a1: inp.a1 || !!r?.a1, dash: inp.dash || !!r?.dash };
  }
  dropRemote(): void {
    for (const u of this.units) if (u.human && !u.isPlayer) u.human = false;
    this.remote = null;
  }

  private control(u: Unit, input: PlayerInput): [number, number] {
    const [ix, iy] = input.move;
    const m = Math.hypot(ix, iy);
    const move: [number, number] = m > 0.15 ? [ix / m, -iy / m] : [0, 0];
    if (input.attack) this.attack(u, input.attack.dir);
    else if (input.auto) { const t = this.autoTarget(u); if (t) this.attack(u, t); }
    if (input.a1) this.ability(u, null);
    if (input.dash) this.doDash(u, move[0] || move[1] ? move : null);
    return move;
  }

  update(dt: number, input: PlayerInput): void {
    if (this.opts.net === 'guest') return this.puppet(dt);
    if (this.started && !this.ended) this.time += dt;
    const now = this.time;
    const running = this.started && !this.ended;

    for (const u of this.units) {

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
        if (u.isPlayer && !this.opts.allBots) move = this.control(u, input);
        else if (u.human && this.remote) move = this.control(u, this.remote);
        else {
          const t = this.think(u);
          move = t.move;
          if (t.atk) this.attack(u, t.dir);
        }
      }

      if (u.pierceAt && now >= u.pierceAt && u.kit.pierce) {
        const k = u.kit.pierce, [dx, dz] = u.pierceDir;
        u.pierceAt = 0;
        if (now >= u.stunUntil) this.spawnProj(u, u.x + dx * 0.5, u.z + dz * 0.5, dx * k.speed, dz * k.speed, k.range, k.dmg, 0, 'tracer', false, u.team, true);
      }

      if (running && now - u.lastHurt > REGEN.delay && u.hp < u.kit.hp) u.hp = Math.min(u.kit.hp, u.hp + u.kit.hp * REGEN.perSec * dt);
      if (u.kit.attack.kind === 'gun' && now - u.atkReady > 0.8 && u.heat > 0) u.heat = Math.max(0, u.heat - dt * 3);

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
        if (!moved && !u.human) {

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

      if (u.kx || u.kz) {
        this.moveUnit(u, u.kx * dt, u.kz * dt);
        const f = Math.exp(-dt * 9);
        u.kx *= f; u.kz *= f;
        if (Math.hypot(u.kx, u.kz) < 0.05) { u.kx = 0; u.kz = 0; }
      }
      u.moving = moved && !u.dash;

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

    if (this.remote) { this.remote.a1 = this.remote.dash = false; this.remote.attack = null; }
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
      this.stepZone(dt);
    }
    this.stepFx(dt);
    this.zoneVisual();
    if (running && (this.score[0] >= MATCH.target || this.score[1] >= MATCH.target || now >= MATCH.seconds)) this.finish();
  }

  snapshot(): Snapshot {
    const t = this.time;
    return {
      t: r2(t), s: [r2(this.score[0]), r2(this.score[1])], z: this.zoneOwner, e: this.ended ? 1 : 0,
      u: this.units.map((u) => [r2(u.x), r2(u.z), r2(u.yaw), Math.round(u.hp), u.alive ? 1 : 0, CLIPS.indexOf(u.clip), u.seq,
        r2(u.cur?.getEffectiveTimeScale() ?? 1), t < u.flashUntil ? 1 : 0, t < u.stunUntil ? 1 : 0, left(u.invulnUntil - t),
        left(u.respawnAt - t), r2(u.heat), t < u.overheatUntil ? 1 : 0, left(u.cd1 - t), left(u.cdDash - t),
        u.kills, u.deaths, Math.round(u.dealt), Math.round(u.healed)]),
      p: this.projs.map((p) => [p.id, KINDS.indexOf(p.kind), p.team, p.fromTurret ? 1 : 0, p.pierced ? 1 : 0, r2(p.x), r2(p.z), r2(p.vx), r2(p.vz)]),
      q: this.turrets.map((q) => [q.id, q.team, r2(q.x), r2(q.z), r2(q.obj.rotation.y), r2(q.head.rotation.y), r2(q.obj.scale.x)]),
      v: this.log.splice(0),
    };
  }

  applySnapshot(n: Snapshot): void {
    this.time = n.t;
    this.score[0] = n.s[0];
    this.score[1] = n.s[1];
    this.zoneOwner = n.z as Team | -1 | -2;
    this.ended = !!n.e;
    const t = this.time;
    n.u.forEach((a, i) => {
      const u = this.units[i];
      if (!u) return;
      const [x, z, yaw, hp, alive, clip, seq, ts, flash, stun, inv, resp, heat, hot, cd1, cdd, kills, deaths, dealt, healed] = a;
      if ((!u.alive && alive) || Math.hypot(x - u.x, z - u.z) > 3) { u.x = x; u.z = z; u.yaw = yaw; }
      Object.assign(u, { nx: x, nz: z, nyaw: yaw, hp, alive: !!alive, heat, kills, deaths, dealt, healed,
        stunUntil: stun ? t + 0.2 : 0, invulnUntil: t + inv, respawnAt: t + resp, overheatUntil: hot ? t + 0.2 : 0, cd1: t + cd1, cdDash: t + cdd });
      if (flash) u.flashUntil = t + 0.1;
      if (seq !== u.netSeq) { u.netSeq = seq; this.play(u, CLIPS[clip] ?? 'Idle', 0.1); }
      u.cur?.setEffectiveTimeScale(ts);
    });
    const seen = new Set<number>();
    for (const [id, kind, team, turret, pierce, x, z, vx, vz] of n.p) {
      seen.add(id);
      const p = this.projs.find((o) => o.id === id)
        ?? this.spawnProj(null, x, z, vx, vz, 0, 0, 0, KINDS[kind] ?? 'bullet', !!turret, team as Team, !!pierce, id);
      Object.assign(p, { x, z, vx, vz });
    }
    this.projs = this.projs.filter((p) => seen.has(p.id) || (this.scene.remove(p.obj), false));
    seen.clear();
    for (const [id, team, x, z, rot, head, scale] of n.q) {
      seen.add(id);
      let q = this.turrets.find((o) => o.id === id);
      if (!q) {
        q = { ...this.turretObj(team as Team, x, z, rot), id, team: team as Team, owner: this.units.find((u) => u.team === team)!, x, z, hp: 0, until: 0, next: 0, born: t };
        this.turrets.push(q);
      }
      q.obj.rotation.y = rot;
      q.head.rotation.y = head;
      q.obj.scale.setScalar(scale);
    }
    this.turrets = this.turrets.filter((q) => seen.has(q.id) || (this.scene.remove(q.obj), false));
    for (const e of n.v) {
      const [k, a, b, c, d, f, g] = e as [string, number, number, number, number, number, number];
      if (k === 'd') this.ev.damage(a, b, c, d, f as Team, !!g);
      else if (k === 'k') this.ev.kill(a >= 0 ? this.view(this.units[a]) : null, this.view(this.units[b]));
      else if (k === 'h' && this.units[a]?.isPlayer) this.ev.shake?.(Math.min(0.45, 0.12 + b / 4000));
      else if (k === 'a') this.fxArc(a, b, c, d, f);
      else if (k === 'w') this.fxWave(a, b, c);
    }
  }

  private puppet(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 14);
    for (const u of this.units) {
      u.x += (u.nx - u.x) * k;
      u.z += (u.nz - u.z) * k;
      const d = Math.atan2(Math.sin(u.nyaw - u.yaw), Math.cos(u.nyaw - u.yaw));
      u.yaw += d * k;
      u.stunFx.visible = u.alive && this.time < u.stunUntil;
      u.mixer.update(dt);
      this.syncUnit(u);
    }
    for (const p of this.projs) {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.obj.position.x = p.x;
      p.obj.position.z = p.z;
      if (p.spin) p.obj.rotation.y += dt * 25;
      else p.obj.rotation.y = Math.atan2(p.vx, p.vz);
    }
    this.stepFx(dt);
    this.zoneVisual();
  }

  private syncUnit(u: Unit): void {
    const flash = this.time < u.flashUntil ? 0.55 : 0;
    for (const m of u.mats) if (m.emissiveIntensity !== flash) { m.emissive.setRGB(1, 0.92, 0.85); m.emissiveIntensity = flash; }
    u.root.position.set(u.x, 0, u.z);
    u.root.rotation.y = u.yaw;
    u.ring.position.set(u.x, 0.02, u.z);
    u.ring.visible = u.alive;
    u.stunFx.position.set(u.x, 1.75, u.z);
    u.stunFx.rotation.y += 0.2;

    u.root.visible = u.alive ? !(this.time < u.invulnUntil && Math.floor(this.time * 10) % 2 === 0) : this.time < u.respawnAt - RESPAWN_S + 1.6;
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
      const age = this.time - t.born;
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
    const zo = this.zoneOwner;
    const col = zo === 0 || zo === 1 ? TEAM_COL[this.side(zo)] : zo === -2 ? 0xffc94a : 0xffffff;
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
    for (const u of this.units) for (const m of u.mats) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
