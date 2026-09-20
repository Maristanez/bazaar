import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "./settings.ts";

describe("owner settings", () => {
  it("absent settings are today's behaviour", () => {
    expect(resolveSettings(undefined)).toEqual({ discountCapPct: 22, maxRounds: 4, lowballCutoffPct: 40, tone: "friendly", firmPriceProductIds: [] });
  });
  it("keeps values in range and replaces anything else with its default", () => {
    expect(resolveSettings({ discountCapPct: 30, maxRounds: 6, lowballCutoffPct: 0, tone: "playful" })).toMatchObject({ discountCapPct: 30, maxRounds: 6, lowballCutoffPct: 0, tone: "playful" });
    expect(resolveSettings({ discountCapPct: 95, maxRounds: 1, lowballCutoffPct: 12.5, tone: "rude" as never })).toEqual(DEFAULT_SETTINGS);
  });
});
