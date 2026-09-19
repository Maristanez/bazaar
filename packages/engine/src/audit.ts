import { floorOf, targetOf, urgency } from "./formulas";
import type { Item } from "./types";

export type PriceAudit = { cost: number; floor: number; target: number; profit: number };

/** Owner-only arithmetic for buildMenu's accepted-at-offer branch. Not authorization to mint. */
export function auditAccepted({ main, total, floorPct, now }: { main: Item; total: number; floorPct: number; now: Date }): PriceAudit | null {
  if (main.cost === null) return null;
  return { cost: main.cost, floor: floorOf([main], floorPct), target: targetOf([main], urgency(main.stockedAt, now), floorPct), profit: total - main.cost };
}

/** Unrounded component; only cart totals cross the shopper boundary. */
export function addOnPart(item: Item): number | null {
  return item.cost === null ? null : item.cost + (item.list - item.cost) / 2;
}
