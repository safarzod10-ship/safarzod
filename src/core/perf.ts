/** Lightweight frame-time statistics and an optional WebGL draw-call counter. */

const WINDOW = 240;

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  /** 99th percentile frame time over the window, ms. */
  p99Ms: number;
  worstMs: number;
  /** Frames longer than 50 ms since the last reset. */
  longFrames: number;
  drawCalls: number;
  frames: number;
  /** Main-thread time of one tick (input + update + render submission), ms. */
  cpuMs: number;
  cpuMaxMs: number;
}

export class PerfMonitor {
  private readonly samples = new Float32Array(WINDOW);
  private count = 0;
  private index = 0;
  private worst = 0;
  private long = 0;
  private frames = 0;
  private drawCallsThisFrame = 0;
  private drawCallsLastFrame = 0;
  private hooked = false;
  private cpuSum = 0;
  private cpuCount = 0;
  private cpuMax = 0;

  /** Record the main-thread cost of one tick. */
  cpu(ms: number): void {
    this.cpuSum += ms;
    this.cpuCount++;
    if (ms > this.cpuMax) this.cpuMax = ms;
  }

  /** Call once per rendered frame with the time since the previous one. */
  frame(deltaMs: number): void {
    this.drawCallsLastFrame = this.drawCallsThisFrame;
    this.drawCallsThisFrame = 0;
    if (deltaMs <= 0 || deltaMs > 1000) return; // tab was in the background
    this.samples[this.index] = deltaMs;
    this.index = (this.index + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
    if (deltaMs > this.worst) this.worst = deltaMs;
    if (deltaMs > 50) this.long++;
    this.frames++;
  }

  reset(): void {
    this.count = 0;
    this.index = 0;
    this.worst = 0;
    this.long = 0;
    this.frames = 0;
    this.cpuSum = 0;
    this.cpuCount = 0;
    this.cpuMax = 0;
  }

  snapshot(): PerfSnapshot {
    const n = this.count;
    if (n === 0) {
      return {
        fps: 0,
        frameMs: 0,
        p99Ms: 0,
        worstMs: 0,
        longFrames: 0,
        drawCalls: this.drawCallsLastFrame,
        frames: 0,
        cpuMs: 0,
        cpuMaxMs: 0,
      };
    }
    let sum = 0;
    const sorted = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sum += this.samples[i];
      sorted[i] = this.samples[i];
    }
    sorted.sort();
    const avg = sum / n;
    return {
      fps: 1000 / avg,
      frameMs: avg,
      p99Ms: sorted[Math.min(n - 1, Math.floor(n * 0.99))],
      worstMs: this.worst,
      longFrames: this.long,
      drawCalls: this.drawCallsLastFrame,
      frames: this.frames,
      cpuMs: this.cpuCount ? this.cpuSum / this.cpuCount : 0,
      cpuMaxMs: this.cpuMax,
    };
  }

  /** Count draw calls by wrapping the context's draw functions. */
  hookDrawCalls(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.hooked) return;
    this.hooked = true;
    const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const;
    const target = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = target[name];
      if (typeof original !== 'function') continue;
      target[name] = (...args: unknown[]) => {
        this.drawCallsThisFrame++;
        return original.apply(gl, args);
      };
    }
  }
}
