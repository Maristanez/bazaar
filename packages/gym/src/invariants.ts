import type { GymResult } from "@bazaar/contracts";

const PERSONAS = ["bargain", "budgeted", "impatient", "loyal", "lowballer"];
const OUTCOMES = ["bought", "walked", "would_ask_owner"];
const TRADES = ["accepted", "held", "bundle", "final"];

// What any GymResult must satisfy, whoever produced it. The chart, the animation and the transcripts all
// read one run (SPEC §9.1), so a headline that disagrees with `shoppers` would draw something that never
// happened. Enums are checked at runtime because a result may arrive as JSON, where the types can't help.
// `cost` and `floor` are the main product's, in cents. Returns one line per problem; [] means sound.
export function gymResultProblems(result: GymResult, { cost, floor }: { cost: number; floor: number }): string[] {
  const problems: string[] = [];
  const { shoppers, bins, counts } = result;
  const bought = shoppers.filter((s) => s.outcome === "bought");
  const expectEqual = (what: string, actual: number, expected: number) => {
    if (actual !== expected) problems.push(`${what} is ${actual}, but the shoppers say ${expected}`);
  };

  expectEqual("n", result.n, shoppers.length);
  expectEqual("bought", result.bought, bought.length);
  expectEqual("wouldAskOwner", result.wouldAskOwner, shoppers.filter((s) => s.outcome === "would_ask_owner").length);
  expectEqual("dealsMissed", result.dealsMissed, shoppers.filter((s) => s.missed).length);
  if (new Set(shoppers.map((s) => s.id)).size !== shoppers.length) problems.push("shopper ids are not unique");

  // A producer may round the mean to whole cents, so half a cent of slack.
  const mean = bought.reduce((sum, s) => sum + (s.agreed ?? 0), 0) / (bought.length || 1);
  if (Math.abs(result.avgAgreed - mean) > 0.5) problems.push(`avgAgreed is ${result.avgAgreed}, but the mean agreed price is ${mean}`);

  for (const s of shoppers) {
    const who = `shopper ${s.id}`;
    if (!PERSONAS.includes(s.persona)) problems.push(`${who}: unknown persona "${s.persona}"`);
    if (!OUTCOMES.includes(s.outcome)) problems.push(`${who}: unknown outcome "${s.outcome}"`);
    if (s.trade !== undefined && !TRADES.includes(s.trade)) problems.push(`${who}: unknown trade "${s.trade}"`);

    if (s.outcome === "bought") {
      if (s.agreed === undefined || s.trade === undefined) problems.push(`${who}: bought without an agreed price and a trade`);
      else {
        if (s.agreed <= cost) problems.push(`${who}: agreed ${s.agreed} is not above cost ${cost}`);
        // A bundle total includes the add-on, which willingness (for the main product alone) doesn't cover.
        if (s.trade !== "bundle" && s.agreed > s.willingness) problems.push(`${who}: agreed ${s.agreed} exceeds willingness ${s.willingness}`);
      }
    } else if (s.agreed !== undefined || s.trade !== undefined) problems.push(`${who}: ${s.outcome} but carries an agreed price or a trade`);

    if (s.rounds.length < 1 || s.rounds.length > 4) problems.push(`${who}: ${s.rounds.length} rounds, expected 1–4`);
    if (s.rounds.some((r, i) => i > 0 && r.ask > s.rounds[i - 1]!.ask)) problems.push(`${who}: the ask went back up`);

    if (s.missed && (s.outcome !== "walked" || s.willingness < floor)) problems.push(`${who}: missed, but did not walk with willingness ≥ floor ${floor}`);
    // Ask-the-owner is for the thin-margin band only (SPEC §6.1): never at or below cost, never at or above the floor.
    const last = s.rounds.at(-1)?.offer ?? 0;
    if (s.outcome === "would_ask_owner" && !(last > cost && last < floor)) problems.push(`${who}: would_ask_owner on a last offer of ${last}, outside cost–floor`);
  }

  if (bins.length !== counts.length) problems.push(`${bins.length} bins but ${counts.length} counts`);
  else if (bins.length < 2) problems.push("fewer than two bins");
  else {
    const width = bins[1]! - bins[0]!;
    if (bins[0] !== cost) problems.push(`bins start at ${bins[0]}, expected cost ${cost}`);
    if (width <= 0 || bins.some((edge, i) => i > 0 && edge - bins[i - 1]! !== width)) problems.push("bins are not evenly spaced lower edges");
    else {
      // The last bin is open-ended: a bundle total can pass list, and a settled dot still needs a bin to drop into.
      const recount = bins.map(() => 0);
      for (const s of bought) {
        const i = Math.min(bins.length - 1, Math.floor(((s.agreed ?? 0) - bins[0]!) / width));
        if (i >= 0) recount[i]! += 1;
      }
      recount.forEach((n, i) => expectEqual(`counts[${i}] (bin ${bins[i]})`, counts[i]!, n));
    }
  }
  expectEqual("sum(counts)", counts.reduce((a, b) => a + b, 0), bought.length);

  return problems;
}
