import type { GymResult, GymShopper, PolicySettings } from "@bazaar/contracts";
import { analyzeBuyerReason, buildNegotiationMenu, isLowball, rankNegotiationMenu, resolveSettings, type NegotiationItem, type NegotiationOffer, type ResolvedSettings } from "@bazaar/engine";
import { makePopulation, type SimulatedPersona } from "./personas.ts";
import { mulberry32 } from "./rng.ts";

export type LiveGymInput = {
  main: NegotiationItem;
  catalog: readonly NegotiationItem[];
  floorPct: number;
  askOwner: boolean;
  seed: number;
  n: number;
  now: Date;
  /** Owner settings (SPEC §4.4.1). Absent or out of range = the defaults. */
  settings?: PolicySettings;
};

/** A live run, plus how many simulated shoppers opened below the owner's lowball cutoff. */
export type LiveGymResult = GymResult & { lowballs: number };

/** Shoppers whose opening offer was below cutoffPct% of list. A cutoff of 0 means the rule is off. */
export function countLowballs(result: Pick<GymResult, "shoppers">, list: number, cutoffPct: number): number {
  return result.shoppers.filter((shopper) => isLowball(shopper.rounds[0]?.offer ?? list, list, cutoffPct)).length;
}

function assertInput(input: LiveGymInput): void {
  if (!input.main.inStock || input.main.cost === null) throw new Error("The live Gym requires an in-stock item with cost");
  if (!Number.isSafeInteger(input.main.list) || !Number.isSafeInteger(input.main.cost) || input.main.list <= 0 || input.main.cost <= 0) {
    throw new Error("The live Gym requires valid product money");
  }
  if (!Number.isSafeInteger(input.floorPct) || input.floorPct < 0 || input.floorPct > 60) {
    throw new Error("The live Gym floor must be an integer from 0 to 60");
  }
  if (!Number.isSafeInteger(input.seed)) throw new Error("The live Gym seed must be an integer");
  if (!Number.isSafeInteger(input.n) || input.n < 1 || input.n > 10_000) {
    throw new Error("The live Gym population must be between 1 and 10,000");
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error("The live Gym requires a valid timestamp");
}

/** step: which message of theirs this is (sets the offer). round: the negotiation round it is priced at. */
function quote(input: LiveGymInput, settings: ResolvedSettings, shopper: SimulatedPersona, patience: number, step: number, round: number): { offer: number; priced?: NegotiationOffer } {
  const offer = offerAt(shopper, patience, step);
  const addOn = shopper.bundleTempted ? input.catalog.find(item => item.isAddOn && item.productId !== input.main.productId && item.inStock && item.cost !== null) : undefined;
  const reason = analyzeBuyerReason(addOn ? `I am buying ${addOn.title} too today` : "I am buying today");
  const menuInput = { main: input.main, mirror: { items: input.catalog }, offered: offer, round, reason, quantity: 1, floorPct: input.floorPct, now: input.now, requestedAddOn: addOn?.title, allowAlternatives: false, discountCapPct: settings.discountCapPct, maxRounds: settings.maxRounds };
  const candidates = rankNegotiationMenu(buildNegotiationMenu(menuInput), menuInput);
  return { offer, priced: candidates[0]?.offer };
}

function offerAt(shopper: SimulatedPersona, patience: number, step: number): number {
  return Math.round((shopper.opening + (step - 1) / patience * (shopper.willingness - shopper.opening)) / 100) * 100;
}

function cartCost(offer: NegotiationOffer): number | null {
  let cost = 0;
  for (const item of offer.items) {
    if (item.cost === null || !Number.isSafeInteger(item.cost)) return null;
    cost += item.cost * (item.qty ?? 1);
  }
  return cost;
}

function bundleAllowance(offer: NegotiationOffer): number {
  return offer.items.slice(1).reduce((sum, item) => sum + item.list * (item.qty ?? 1) * 0.6, 0);
}

function addOnPart(offer: NegotiationOffer): number {
  return offer.items.slice(1).reduce((sum, item) => {
    if (item.cost === null) return sum;
    return sum + Math.ceil(item.cost + (item.list - item.cost) / 2) * (item.qty ?? 1);
  }, 0);
}

/** Runs a deterministic population through the live code-priced menu and deterministic option-A selection. No LLM calls are simulated. */
export function runLiveGym(input: LiveGymInput): LiveGymResult {
  assertInput(input);
  const settings = resolveSettings(input.settings);
  const population = makePopulation(mulberry32(input.seed), input.n, input.main.list);
  const floor = Math.max(input.main.cost! + 1, Math.ceil(input.main.cost! * (1 + input.floorPct / 100)));
  const banner = Math.round(input.main.list * 0.8);
  const shoppers: GymShopper[] = [];
  let haggleProfit = 0;
  let bannerProfit = 0;
  let addOnRevenue = 0;

  for (const [index, person] of population.entries()) {
    if (person.willingness >= banner) bannerProfit += banner - input.main.cost!;
    const rounds: GymShopper["rounds"] = [];
    let resolved: GymShopper | undefined;
    let finalCost = input.main.cost!;
    let finalTotal = input.main.list;

    // A lowball is countered with the quote already on the table (round one) and earns nothing: the round does not advance.
    const patience = Math.min(person.patience, settings.maxRounds);
    let round = 0;
    for (let step = 1; step <= patience; step += 1) {
      if (!isLowball(offerAt(person, patience, step), input.main.list, settings.lowballCutoffPct)) round += 1;
      const { offer, priced } = quote(input, settings, person, patience, step, Math.max(1, round));
      rounds.push({ offer, ask: priced?.total ?? input.main.list });

      // Invalid or unavailable live quotes end this synthetic negotiation without an owner escalation.
      if (!priced || priced.kind === "closed") {
        resolved = { id: index + 1, persona: person.persona, willingness: person.willingness, rounds, outcome: "walked" };
        break;
      }

      const cost = cartCost(priced);
      if (cost === null || priced.total <= cost) {
        resolved = { id: index + 1, persona: person.persona, willingness: person.willingness, rounds, outcome: "walked" };
        break;
      }

      finalCost = cost;
      finalTotal = priced.total;
      const affordable = person.willingness + (priced.kind === "bundle" ? bundleAllowance(priced) : 0);
      if (priced.total <= affordable) {
        const trade = priced.kind === "accepted" ? "accepted" : priced.kind === "bundle" ? "bundle" : round === settings.maxRounds ? "final" : "held";
        resolved = { id: index + 1, persona: person.persona, willingness: person.willingness, rounds, outcome: "bought", agreed: priced.total, trade };
        haggleProfit += priced.total - cost;
        if (priced.kind === "bundle") addOnRevenue += addOnPart(priced);
        break;
      }
    }

    if (!resolved) {
      const lastOffer = rounds.at(-1)!.offer;
      const finalFloor = Math.max(finalCost + 1, Math.ceil(finalCost * (1 + input.floorPct / 100)));
      const outcome = input.askOwner && round === settings.maxRounds && lastOffer > finalCost && lastOffer < finalFloor && lastOffer < finalTotal
        ? "would_ask_owner"
        : "walked";
      resolved = {
        id: index + 1,
        persona: person.persona,
        willingness: person.willingness,
        rounds,
        outcome,
        ...(outcome === "walked" && person.willingness >= floor ? { missed: true } : {}),
      };
    }
    shoppers.push(resolved);
  }

  const bought = shoppers.filter((shopper) => shopper.outcome === "bought");
  const highestAgreed = bought.reduce((highest, shopper) => Math.max(highest, shopper.agreed!), input.main.list);
  const bins = Array.from(
    { length: Math.max(2, Math.ceil((highestAgreed - input.main.cost!) / 500) + 1) },
    (_, index) => input.main.cost! + index * 500,
  );
  const counts = bins.map(() => 0);
  for (const shopper of bought) {
    const bin = Math.min(bins.length - 1, Math.max(0, Math.floor((shopper.agreed! - bins[0]!) / 500)));
    counts[bin]! += 1;
  }

  return {
    seed: input.seed,
    n: input.n,
    floorPct: input.floorPct,
    bought: bought.length,
    avgAgreed: Math.round(bought.reduce((sum, shopper) => sum + shopper.agreed!, 0) / (bought.length || 1)),
    bins,
    counts,
    profitVsBanner: haggleProfit - bannerProfit,
    aovUplift: Math.round(addOnRevenue / (bought.length || 1)),
    wouldAskOwner: shoppers.filter((shopper) => shopper.outcome === "would_ask_owner").length,
    dealsMissed: shoppers.filter((shopper) => shopper.missed).length,
    shoppers,
    lowballs: countLowballs({ shoppers }, input.main.list, settings.lowballCutoffPct),
  };
}
