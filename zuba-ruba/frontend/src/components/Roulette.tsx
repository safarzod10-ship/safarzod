import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatNumber } from "../format";
import { Star } from "../stars";
import { haptic } from "../telegram";
import type { PrizeRow } from "../types";

const CARD = 92;
const GAP = 10;
const STEP = CARD + GAP;
const STRIP = 80;
const START_INDEX = 3;
const WIN_INDEX = 72;
const SPIN_MS = 5200;

type Tier = "common" | "rare" | "top";

export function tierOf(amount: string, table: PrizeRow[]): Tier {
  const sorted = table.map((row) => Number(row.amount)).sort((a, b) => a - b);
  const value = Number(amount);
  if (value >= sorted[sorted.length - 1]) return "top";
  if (sorted.length > 2 && value >= sorted[sorted.length - 2]) return "rare";
  return "common";
}

function pick(table: PrizeRow[]): string {
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let roll = Math.random() * total;
  for (const row of table) {
    roll -= row.weight;
    if (roll <= 0) return row.amount;
  }
  return table[table.length - 1].amount;
}

function buildStrip(table: PrizeRow[], winner: string | null): string[] {
  const items = Array.from({ length: STRIP }, () => pick(table));
  if (winner !== null) items[WIN_INDEX] = winner;
  return items;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 5);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export interface RouletteHandle {
  spin: (amount: string) => Promise<void>;
  reset: () => void;
}

export const Roulette = forwardRef<RouletteHandle, { table: PrizeRow[]; label: string; muted?: boolean }>(function Roulette(
  { table, label, muted },
  ref,
) {
  const [strip, setStrip] = useState<string[]>(() => buildStrip(table, null));
  const [won, setWon] = useState(false);
  const [moving, setMoving] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const driftFrame = useRef(0);
  const spinFrame = useRef(0);

  const place = useCallback((value: number) => {
    offset.current = value;
    if (track.current) track.current.style.transform = `translate3d(${value}px,0,0)`;
  }, []);

  const startOffset = useCallback(() => {
    const width = viewport.current?.clientWidth ?? 360;
    return width / 2 - (START_INDEX * STEP + CARD / 2);
  }, []);

  useEffect(() => {
    if (moving || won) return;
    place(startOffset());
    if (reducedMotion() || muted) return;
    let last = performance.now();
    const drift = (time: number) => {
      const delta = time - last;
      last = time;
      let next = offset.current - delta * 0.02;
      if (next < startOffset() - STEP * 8) next = startOffset();
      place(next);
      driftFrame.current = requestAnimationFrame(drift);
    };
    driftFrame.current = requestAnimationFrame(drift);
    return () => cancelAnimationFrame(driftFrame.current);
  }, [moving, won, muted, place, startOffset, strip]);

  useEffect(
    () => () => {
      cancelAnimationFrame(driftFrame.current);
      cancelAnimationFrame(spinFrame.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        setWon(false);
        setMoving(false);
        setStrip(buildStrip(table, null));
      },
      spin: (amount: string) =>
        new Promise<void>((resolve) => {
          cancelAnimationFrame(driftFrame.current);
          cancelAnimationFrame(spinFrame.current);
          setWon(false);
          setMoving(true);
          setStrip(buildStrip(table, amount));
          let finished = false;
          let target = 0;
          const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(guard);
            cancelAnimationFrame(spinFrame.current);
            place(target);
            setMoving(false);
            setWon(true);
            resolve();
          };
          const guard = window.setTimeout(finish, SPIN_MS + 1500);
          spinFrame.current = requestAnimationFrame(() => {
            const width = viewport.current?.clientWidth ?? 360;
            target = width / 2 - (WIN_INDEX * STEP + CARD / 2) + (Math.random() - 0.5) * CARD * 0.6;
            const from = startOffset();
            const duration = reducedMotion() ? 500 : SPIN_MS;
            const started = performance.now();
            let lastIndex = -1;
            let lastHaptic = 0;
            place(from);
            const tick = (time: number) => {
              const progress = Math.min((time - started) / duration, 1);
              const value = from + (target - from) * easeOut(progress);
              place(value);
              const index = Math.floor((width / 2 - value) / STEP);
              if (index !== lastIndex) {
                lastIndex = index;
                if (progress < 0.98 && time - lastHaptic > 70) {
                  lastHaptic = time;
                  haptic("select");
                }
              }
              if (progress < 1) {
                spinFrame.current = requestAnimationFrame(tick);
              } else {
                finish();
              }
            };
            spinFrame.current = requestAnimationFrame(tick);
          });
        }),
    }),
    [place, startOffset, table],
  );

  return (
    <div className={muted ? "roulette-viewport roulette-viewport-muted" : "roulette-viewport"} ref={viewport} role="img" aria-label={label}>
      <div className="roulette-track" ref={track}>
        {strip.map((amount, index) => (
          <div key={index} className={`prize prize-${tierOf(amount, table)}${won && index === WIN_INDEX ? " prize-won" : ""}`}>
            <Star size={48} className="prize-star" />
            <span className="prize-amount">{formatNumber(amount)}</span>
          </div>
        ))}
      </div>
      <span className="roulette-pointer roulette-pointer-top" aria-hidden="true" />
      <span className="roulette-pointer roulette-pointer-bottom" aria-hidden="true" />
      <span className="roulette-line" aria-hidden="true" />
    </div>
  );
});
