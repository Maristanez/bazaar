import type { GymShopper } from "@bazaar/contracts";
import type { Random } from "./rng.ts";
import { wholeDollarBetween } from "./rng.ts";

export type Persona = GymShopper["persona"];

type PersonaRule = {
  persona: Persona;
  share: number;
  willingness: readonly [number, number];
  opening: readonly [number, number];
  patience: 2 | 3 | 4;
  bundleRate: number;
};

// PART-B-BUILD §A. These rule-based shoppers are not LLM agents. Values are pinned and must not be tuned from results.
export const PERSONAS: readonly PersonaRule[] = [
  { persona: "bargain", share: 0.30, willingness: [0.70, 0.90], opening: [0.55, 0.70], patience: 4, bundleRate: 0.30 },
  { persona: "budgeted", share: 0.35, willingness: [0.78, 0.98], opening: [0.70, 0.85], patience: 3, bundleRate: 0.50 },
  { persona: "impatient", share: 0.15, willingness: [0.85, 1.05], opening: [0.80, 0.95], patience: 2, bundleRate: 0.20 },
  { persona: "loyal", share: 0.10, willingness: [0.95, 1.10], opening: [0.88, 1.00], patience: 3, bundleRate: 0.60 },
  { persona: "lowballer", share: 0.10, willingness: [0.50, 0.75], opening: [0.30, 0.50], patience: 4, bundleRate: 0.10 },
];

export type SimulatedPersona = {
  persona: Persona;
  willingness: number;
  opening: number;
  patience: 2 | 3 | 4;
  bundleTempted: boolean;
};

function allocatedPersonas(n: number): Persona[] {
  const allocations = PERSONAS.map((rule, index) => {
    const exact = n * rule.share;
    return { index, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = n - allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  const byRemainder = [...allocations].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) byRemainder[index]!.count += 1;

  return allocations.flatMap((allocation) =>
    Array.from({ length: allocation.count }, () => PERSONAS[allocation.index]!.persona),
  );
}

export function makePopulation(random: Random, n: number, list: number): SimulatedPersona[] {
  const personas = allocatedPersonas(n);
  for (let index = personas.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [personas[index], personas[swap]] = [personas[swap]!, personas[index]!];
  }

  return personas.map((persona) => {
    const rule = PERSONAS.find((candidate) => candidate.persona === persona)!;
    const willingness = wholeDollarBetween(random, rule.willingness[0] * list, rule.willingness[1] * list);
    const opening = Math.min(
      willingness,
      wholeDollarBetween(random, rule.opening[0] * list, rule.opening[1] * list),
    );
    return { persona, willingness, opening, patience: rule.patience, bundleTempted: random() < rule.bundleRate };
  });
}
