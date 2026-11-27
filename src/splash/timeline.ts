/**
 * Choreography of the splash, as GSAP timelines over the plain `state`
 * objects of the scene layers.
 *
 *   intro   0.0  the land wakes: dawn crosses the picture, the camera sinks in
 *           0.9  the first settlement: plot borders, roads, buildings
 *           2.05 TERRIA is born: the world dims, light draws the arc and the
 *                bar, the stem grows, the wordmark follows
 *           3.6  the logo is complete ("settled")
 *   idle    loops for as long as the game still loads: breathing glow, a
 *           sheen now and then, sun over the grass, motes
 *   outro   the picture opens from the centre onto the real map (about 1 s)
 *
 * The timelines are stepped from the PixiJS ticker (gsapDriver.ts).
 */
import { gsap } from 'gsap';
import type { SplashScene } from './SplashScene.ts';

/** Seconds from the start of the intro to the completed logo. */
export const SETTLED_AT = 3.62;

export function buildIntro(scene: SplashScene, onSettled: () => void): gsap.core.Timeline {
  const w = scene.world.state;
  const c = scene.civ.state;
  const l = scene.logo.state;
  const cam = scene.camera;
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });

  // ---- 1. the land wakes ------------------------------------------------------
  tl.addLabel('awake', 0)
    .to(w, { fade: 1, duration: 0.55, ease: 'power1.out' }, 0)
    .to(w, { dawn: 1, duration: 1.3, ease: 'sine.inOut' }, 0.06)
    .to(cam, { zoom: 1.07, duration: 2.15, ease: 'sine.inOut' }, 0)
    // the first band of sun runs over the grass right behind the dawn
    .fromTo(w, { glint: -0.75 }, { glint: 0.8, duration: 1.3, ease: 'none' }, 0.7)
    .to(w, { glintGain: 1, duration: 0.3, ease: 'sine.out' }, 0.7)
    .to(w, { glintGain: 0, duration: 0.5, ease: 'sine.in' }, 1.5);

  // ---- 2. the first settlement -------------------------------------------------
  tl.addLabel('settle', 0.9)
    .to(c, { borders: 1, duration: 0.85, ease: 'power1.inOut' }, 'settle')
    .to(c, { roads: 1, duration: 0.8, ease: 'power1.inOut' }, 'settle+=0.28');
  scene.civ.buildings.forEach((b, i) => {
    const at = 0.9 + 0.4 + i * 0.085;
    const sx = b.sprite.scale.x;
    const sy = b.sprite.scale.y;
    if (b.isField) {
      // a field is laid out on the ground: it spreads from its middle
      tl.fromTo(
        b.sprite,
        { pixi: { alpha: 0, scaleX: sx * 0.35, scaleY: sy * 0.35 } },
        { pixi: { alpha: 1, scaleX: sx, scaleY: sy }, duration: 0.42, ease: 'back.out(1.5)' },
        at,
      );
      return;
    }
    // a building rises from its base, overshoots a little and settles; dust rolls off the site
    tl.fromTo(b.sprite, { pixi: { scaleY: 0 } }, { pixi: { scaleY: sy }, duration: 0.44, ease: 'back.out(2.1)' }, at)
      .fromTo(b.sprite, { pixi: { scaleX: sx * 1.12 } }, { pixi: { scaleX: sx }, duration: 0.44, ease: 'power2.out' }, at)
      .fromTo(b.sprite, { pixi: { alpha: 0 } }, { pixi: { alpha: 1 }, duration: 0.1, ease: 'none' }, at)
      .fromTo(
        b.dust,
        { pixi: { alpha: 0.85, scale: 0.45 } },
        // not rendered ahead of time: the "from" state is a visible puff
        { pixi: { alpha: 0, scale: 1.7 }, duration: 0.55, ease: 'power2.out', immediateRender: false },
        at + 0.04,
      )
      .call(() => scene.glint(b.x, b.y - 34 * b.scale, 3), undefined, at + 0.26);
  });

  // ---- 3. TERRIA is born ---------------------------------------------------------
  tl.addLabel('birth', 2.05)
    .to(cam, { zoom: 1.035, duration: 1.6, ease: 'power2.inOut' }, 'birth')
    .to(w, { dim: 1, duration: 0.8, ease: 'power2.inOut' }, 'birth')
    // the settlement stays, but only as a hint behind the mark
    .to(c, { alpha: 0.3, duration: 0.8, ease: 'power2.inOut' }, 'birth')
    .to(scene.clouds.state, { alpha: 0.55, duration: 0.8, ease: 'power2.inOut' }, 'birth')
    .fromTo(l, { scale: 1.07 }, { scale: 1, duration: 1.55, ease: 'power3.out' }, 'birth+=0.1')
    // light draws the orbit arc and the bar in one stroke
    .to(l, { stroke: 1, duration: 0.95, ease: 'power2.inOut' }, 'birth+=0.12')
    // the stem grows out of the land to meet it
    .to(l, { stem: 1, duration: 0.62, ease: 'power2.out' }, 'birth+=0.42')
    .to(l, { glow: 1, duration: 0.7, ease: 'sine.out' }, 'birth+=0.45')
    .to(l, { word: 1, duration: 0.6, ease: 'power1.inOut' }, 'birth+=0.92')
    // everything is in place: one flash, a sheen across the lockup, the drawing light cools
    .to(l, { head: 0, duration: 0.55, ease: 'sine.inOut' }, 'birth+=1.3')
    .to(l, { flash: 1, duration: 0.14, ease: 'power2.out' }, 'birth+=1.36')
    .to(l, { flash: 0, duration: 0.55, ease: 'power2.out' }, 'birth+=1.5')
    .fromTo(l, { sheen: -0.25 }, { sheen: 1.25, duration: 0.9, ease: 'sine.inOut' }, 'birth+=1.32')
    .call(() => scene.burst(Math.min(18, Math.round(scene.sparks.capacity / 4))), undefined, 'birth+=1.4')
    .to(scene.ambience, { motes: 1, duration: 0.8, ease: 'none' }, 'birth+=1.4')
    .call(onSettled, undefined, SETTLED_AT);
  return tl;
}

/** Quiet loop under the finished logo; continues the values the intro ends on. */
export function buildIdle(scene: SplashScene): gsap.core.Timeline {
  const w = scene.world.state;
  const l = scene.logo.state;
  const cam = scene.camera;
  const tl = gsap.timeline({ paused: true, repeat: -1 });
  tl.to(l, { glow: 0.7, duration: 1.7, ease: 'sine.inOut' }, 0)
    .to(l, { glow: 1, duration: 1.7, ease: 'sine.inOut' }, 1.7)
    .to(cam, { zoom: 1.05, duration: 3.4, ease: 'sine.inOut' }, 0)
    .to(cam, { zoom: 1.035, duration: 3.4, ease: 'sine.inOut' }, 3.4)
    .fromTo(w, { glint: -0.75 }, { glint: 0.8, duration: 2.4, ease: 'none', immediateRender: false }, 1.2)
    .to(w, { glintGain: 0.5, duration: 0.5, ease: 'sine.out' }, 1.2)
    .to(w, { glintGain: 0, duration: 0.8, ease: 'sine.in' }, 2.8)
    .fromTo(l, { sheen: -0.25 }, { sheen: 1.25, duration: 1.15, ease: 'sine.inOut', immediateRender: false }, 3.9);
  return tl;
}

/** The splash opens onto the map. Built at the moment it is needed, from wherever the scene is. */
export function buildOutro(scene: SplashScene, onComplete: () => void): gsap.core.Timeline {
  const w = scene.world.state;
  const c = scene.civ.state;
  const l = scene.logo.state;
  const cam = scene.camera;
  scene.sparks.hurry();
  const tl = gsap.timeline({ onComplete });
  tl.to(scene.clouds.state, { alpha: 0, duration: 0.45, ease: 'power1.in' }, 0)
    .to(c, { alpha: 0, duration: 0.4, ease: 'power1.in' }, 0)
    .to(scene.ambience, { motes: 0, duration: 0.1 }, 0)
    // daylight comes back while the camera dives towards the land
    .to(w, { dim: 0.2, duration: 0.6, ease: 'power2.out' }, 0)
    .to(w, { glintGain: 0, duration: 0.2 }, 0)
    .to(cam, { zoom: cam.zoom + 0.12, duration: 1.02, ease: 'power2.in' }, 0)
    .to(w, { reveal: 1, duration: 0.95, ease: 'power2.inOut' }, 0.07)
    // the logo flares, lifts towards the viewer and is gone
    .to(l, { flash: 0.32, glow: 1.3, duration: 0.2, ease: 'power2.out' }, 0)
    .to(l, { shadow: 0, duration: 0.25, ease: 'none' }, 0)
    .to(l, { scale: l.scale * 1.1, duration: 0.72, ease: 'power2.in' }, 0.04)
    .to(l, { alpha: 0, flash: 0, duration: 0.42, ease: 'power1.in' }, 0.3);
  return tl;
}
