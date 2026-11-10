import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatNumber } from "../format";
import { haptic } from "../telegram";
import type { PrizeRow } from "../types";
import { tierOf, type RouletteHandle } from "./Roulette";

const SEGMENTS = 12;
const SLICE = 360 / SEGMENTS;
const SPIN_MS = 5200;
const TURNS = 6;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function layout(table: PrizeRow[]): string[] {
  const sorted = [...table].sort((a, b) => Number(a.amount) - Number(b.amount)).map((row) => row.amount);
  const result: string[] = [];
  let low = 0;
  let high = sorted.length - 1;
  while (result.length < SEGMENTS) {
    result.push(sorted[low % sorted.length]!);
    if (result.length < SEGMENTS) result.push(sorted[high >= 0 ? high : sorted.length - 1]!);
    low += 1;
    high -= 1;
    if (low > high) {
      low = 0;
      high = sorted.length - 1;
    }
  }
  return result;
}

function point(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [Math.cos(rad) * radius, Math.sin(rad) * radius];
}

function slicePath(index: number, radius: number): string {
  const [x0, y0] = point(index * SLICE, radius);
  const [x1, y1] = point((index + 1) * SLICE, radius);
  return `M0 0 L${x0.toFixed(3)} ${y0.toFixed(3)} A${radius} ${radius} 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
}

export const Wheel = forwardRef<RouletteHandle, { table: PrizeRow[]; label: string; muted?: boolean }>(function Wheel({ table, label, muted }, ref) {
  const segments = useMemo(() => layout(table), [table]);
  const [won, setWon] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const group = useRef<SVGGElement>(null);
  const labels = useRef<(SVGGElement | null)[]>([]);
  const angle = useRef(0);
  const frame = useRef(0);

  const place = (value: number) => {
    angle.current = value;
    group.current?.setAttribute("transform", `rotate(${value.toFixed(3)})`);
    labels.current.forEach((node, index) => {
      if (!node) return;
      const [x, y] = point(index * SLICE + SLICE / 2, 64);
      node.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(-value).toFixed(3)})`);
    });
  };

  useEffect(() => {
    if (moving || won !== null || muted || reducedMotion()) return;
    let last = performance.now();
    const drift = (time: number) => {
      place((angle.current + (time - last) * 0.012) % 360);
      last = time;
      frame.current = requestAnimationFrame(drift);
    };
    frame.current = requestAnimationFrame(drift);
    return () => cancelAnimationFrame(frame.current);
  }, [moving, won, muted]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        setWon(null);
        setMoving(false);
      },
      spin: (amount: string) =>
        new Promise<void>((resolve) => {
          cancelAnimationFrame(frame.current);
          setWon(null);
          setMoving(true);
          const matches = segments.map((value, index) => (value === amount ? index : -1)).filter((index) => index >= 0);
          const index = matches.length ? matches[Math.floor(Math.random() * matches.length)]! : 0;
          const jitter = (Math.random() - 0.5) * SLICE * 0.6;
          const from = angle.current;
          const landing = 360 - (index * SLICE + SLICE / 2) + jitter;
          const base = from - (from % 360);
          const target = base + TURNS * 360 + ((landing % 360) + 360) % 360;
          const duration = reducedMotion() ? 500 : SPIN_MS;
          const started = performance.now();
          let lastSlice = Math.floor(from / SLICE);
          let lastHaptic = 0;
          const tick = (time: number) => {
            const progress = Math.min((time - started) / duration, 1);
            const value = from + (target - from) * easeOut(progress);
            place(value);
            const slice = Math.floor(value / SLICE);
            if (slice !== lastSlice) {
              lastSlice = slice;
              if (progress < 0.98 && time - lastHaptic > 70) {
                lastHaptic = time;
                haptic("select");
              }
            }
            if (progress < 1) {
              frame.current = requestAnimationFrame(tick);
            } else {
              place(target % 360);
              setMoving(false);
              setWon(index);
              resolve();
            }
          };
          frame.current = requestAnimationFrame(tick);
        }),
    }),
    [segments],
  );

  return (
    <div className={muted ? "wheel wheel-muted" : "wheel"} role="img" aria-label={label} data-result={won !== null ? segments[won] : undefined}>
      <svg className="wheel-svg" viewBox="-100 -100 200 200">
        <g ref={group}>
          {segments.map((amount, index) => {
            const tier = tierOf(amount, table);
            const [x, y] = point(index * SLICE + SLICE / 2, 64);
            return (
              <g key={index} className={`wheel-seg wheel-seg-${tier}${won === index ? " wheel-seg-won" : ""}`}>
                <path d={slicePath(index, 96)} />
                <g
                  ref={(node) => {
                    labels.current[index] = node;
                  }}
                  transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(-angle.current).toFixed(3)})`}
                >
                  <image href="/img/star.png" x={-9} y={-20} width={18} height={18} />
                  <text className="wheel-label" y={11} textAnchor="middle">
                    {formatNumber(amount)}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
        <circle className="wheel-rim" r={96} />
        <circle className="wheel-hub" r={20} />
        <image href="/img/star.png" x={-13} y={-13} width={26} height={26} />
      </svg>
      <span className="wheel-pointer" aria-hidden="true" />
    </div>
  );
});
