import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import Phaser from 'phaser';
import { MuseumScene } from './scene.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { Audio } from './audio.js';
import type { PublicState } from '../../shared/types.js';
import { previewStates } from './preview.js';

const params = new URLSearchParams(location.search);
const broadcast = params.get('broadcast') === '1';
document.body.classList.toggle('broadcast', broadcast);

function fit(): void {
  const k = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  const stage = document.getElementById('stage')!;
  stage.style.transform = `translate(-50%, -50%) scale(${k})`;
}
window.addEventListener('resize', fit);
fit();

async function boot(): Promise<void> {
  await Promise.race([
    Promise.all([document.fonts.load('700 20px Fredoka'), document.fonts.load('600 20px Fredoka')]),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  const audio = new Audio();
  await audio.init();
  let state: PublicState | null = null;
  let connected = false;
  let net: Net;
  const scene = new MuseumScene();
  const hud = new Hud((lvl) => scene.exhibitDataUrl(lvl));

  new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: '#F3EAD6',
    banner: false,
    audio: { noAudio: true },
    fps: { limit: broadcast ? 30 : 60 },
    render: { antialias: true, roundPixels: false },
    scale: { mode: Phaser.Scale.NONE },
    scene: [],
    callbacks: {
      postBoot: (game) => {
        game.scene.add('museum', scene, true, {
          hooks: {
            now: () => net.now(),
            sfx: (n: string, alert?: boolean) => audio.sfx(n, 1, alert),
            voice: (e: string) => audio.voice(e),
            music: (t: number) => audio.playMusic(t),
          },
        });
      },
    },
  });

  const ready = new Promise<void>((r) => {
    const check = () => (scene.sys?.isActive() && scene.children ? r() : setTimeout(check, 50));
    check();
  });
  await ready;

  const preview = params.get('preview');
  if (preview) {
    // QA preview: ?preview=LEVEL,BEAT[,OPTION] renders a decision (and optionally plays an option) without a server.
    const [lv, bt, opt] = preview.split(',');
    const fakeNet = { now: () => Date.now() } as unknown as Net;
    net = fakeNet;
    const states = previewStates(Number(lv) || 1, Math.max(0, (Number(bt) || 1) - 1), opt);
    connected = true;
    state = states.vote;
    scene.sync(states.vote);
    hud.render(states.vote, Date.now(), true);
    if (states.resolve) {
      setTimeout(() => {
        const r = states.resolve!;
        const now = Date.now();
        r.phaseStartedAt = now;
        r.resolution!.startedAt = now;
        state = r;
        scene.sync(r);
      }, 1500);
    }
    setInterval(() => state && hud.render(state, Date.now(), true), 125);
    return;
  }

  net = new Net(
    (s) => {
      state = s;
      audio.setLevels(s.audio);
      scene.sync(s);
      hud.render(s, net.now(), connected);
    },
    (up) => {
      connected = up;
      if (state) hud.render(state, net.now(), connected);
    },
    broadcast,
  );

  // HUD timers refresh ~8x per second (cheap DOM diffing).
  setInterval(() => {
    if (state) hud.render(state, net.now(), connected);
  }, 125);

  const soundBtn = document.getElementById('sound')!;
  if (broadcast) {
    audio.unlock();
    soundBtn.classList.add('hidden');
  } else {
    soundBtn.addEventListener('click', () => {
      audio.unlock();
      soundBtn.classList.add('hidden');
    });
  }
}

void boot();
