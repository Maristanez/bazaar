import type { PolicySettings, TonePreset } from "@bazaar/contracts";

export type ResolvedSettings = Required<PolicySettings>;

/** Defaults reproduce the behaviour before owner settings existed (SPEC §4.4.1). */
export const DEFAULT_SETTINGS: ResolvedSettings = { discountCapPct: 22, maxRounds: 4, lowballCutoffPct: 40, tone: "friendly", firmPriceProductIds: [] };
export const SETTING_RANGES = { discountCapPct: [0, 40], maxRounds: [2, 6], lowballCutoffPct: [0, 80] } as const;
const TONES: readonly TonePreset[] = ["friendly", "brisk", "playful"];

function within(value: unknown, [low, high]: readonly [number, number], fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high ? value : fallback;
}

/** Pure. Anything missing or out of range falls back to its default, so a bad value can never loosen a price. */
export function resolveSettings(settings: PolicySettings | null | undefined): ResolvedSettings {
  const input = settings ?? {};
  return {
    discountCapPct: within(input.discountCapPct, SETTING_RANGES.discountCapPct, DEFAULT_SETTINGS.discountCapPct),
    maxRounds: within(input.maxRounds, SETTING_RANGES.maxRounds, DEFAULT_SETTINGS.maxRounds),
    lowballCutoffPct: within(input.lowballCutoffPct, SETTING_RANGES.lowballCutoffPct, DEFAULT_SETTINGS.lowballCutoffPct),
    tone: TONES.includes(input.tone as TonePreset) ? input.tone as TonePreset : DEFAULT_SETTINGS.tone,
    firmPriceProductIds: Array.isArray(input.firmPriceProductIds) ? input.firmPriceProductIds.filter((id): id is string => typeof id === "string") : [],
  };
}
