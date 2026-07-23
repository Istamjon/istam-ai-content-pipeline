/**
 * Daily multi-key rotation helpers for soft free-tier image APIs.
 * - Prefer keys with most remaining soft budget (load balance)
 * - Daily start offset so key #1 is not always first after midnight reset
 */
import { utcToday } from "../db.js";

export type RotatableSlot = {
  label: string;
  providerKey: string;
  apiKey: string;
};

/** Stable 0..n-1 start index from UTC day + salt (changes every UTC day). */
export function dailyRotationOffset(slotCount: number, salt = "img"): number {
  if (slotCount <= 1) return 0;
  const day = utcToday();
  let h = 2166136261;
  const s = `${day}|${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % slotCount;
}

/**
 * Order slots for a generate attempt:
 * 1) rotate array by daily offset (fair daily loop)
 * 2) sort by remaining soft budget desc (burn spare quota first)
 */
export function orderSlotsForDailyRotation<T extends RotatableSlot>(
  slots: T[],
  getRemaining: (slot: T) => number,
  salt = "img",
): T[] {
  if (slots.length <= 1) return [...slots];
  const offset = dailyRotationOffset(slots.length, salt);
  const rotated = [
    ...slots.slice(offset),
    ...slots.slice(0, offset),
  ];
  // Stable secondary: preserve rotated order when remaining equal
  return rotated
    .map((s, i) => ({ s, i, rem: getRemaining(s) }))
    .sort((a, b) => {
      if (b.rem !== a.rem) return b.rem - a.rem;
      return a.i - b.i;
    })
    .map((x) => x.s);
}

export function formatRotationOrder(
  slots: Array<{ label: string }>,
  remainingOf?: (label: string) => number,
): string {
  if (!slots.length) return "none";
  return slots
    .map((s) => {
      const r = remainingOf?.(s.label);
      return r === undefined ? s.label : `${s.label}(r${r})`;
    })
    .join("→");
}
