import type { GymResult, GymShopper, Option } from "@bazaar/contracts";
import { addOnPart, auditAccepted, buildMenu, type Item, type MenuResult } from "@bazaar/engine";
import { makePopulation } from "./personas";
import { mulberry32 } from "./rng";

export type RunGymInput = {
  main: Item;
  addOns: readonly Item[];
  floorPct: number;
  askOwner: boolean;
  seed: number;
  n: number;
  now: Date;
};

export type MetricDeltas = {
  boughtPct: number;
  avgAgreed: number;
  profitVsBanner: number;
  aovUplift: number;
  dealsMissed: number;
  wouldAskOwner: number;
};

type Menu = Extract<MenuResult, { outcome: "menu" }>;

function quote(input: RunGymInput, round: 1 | 2 | 3 | 4): Menu {
  const result = buildMenu({
    main: input.main,
    addOns: input.addOns,
    catalog: [input.main, ...input.addOns],
    offer: 0,
    round,
    floorPct: input.floorPct,
    now: input.now,
  });
  if (result.outcome !== "menu") throw new Error("The Gym requires a priced main product with a safe option");
  return result;
}

function optionAddOn(option: Option, addOns: readonly Item[]): Item | undefined {
  const variants = new Set(option.items.slice(1).map((item) => item.variantId));
  return addOns.find((item) => variants.has(item.variantId));
}

/** Runs one policy against a deterministic synthetic population. */
export function runGym(input: RunGymInput): GymResult {
  if (input.main.cost === null) throw new Error("The Gym requires a main product cost");
  const random = mulberry32(input.seed);
  const population = makePopulation(random, input.n, input.main.list);
  const rounds = [1, 2, 3, 4] as const;
  const quotes = rounds.map((round) => quote(input, round));
  const shoppers: GymShopper[] = [];
  let haggleProfit = 0;
  let bannerProfit = 0;
  let addOnParts = 0;
  const floor = quotes[0]!.internals.A!.floor;
  const bannerPrice = input.main.list * 0.8;

  for (const [index, simulated] of population.entries()) {
    if (simulated.willingness >= bannerPrice) bannerProfit += bannerPrice - input.main.cost;
    const history: GymShopper["rounds"] = [];
    let resolved: GymShopper | undefined;

    for (let roundIndex = 0; roundIndex < simulated.patience; roundIndex += 1) {
      const round = rounds[roundIndex]!;
      const menu = quotes[roundIndex]!;
      const held = menu.options.find((option) => option.id === "A");
      if (held === undefined) throw new Error(`The Gym quote has no option A in round ${round}`);
      const offer = Math.round(
        (simulated.opening + (round - 1) / simulated.patience * (simulated.willingness - simulated.opening)) / 100,
      ) * 100;
      history.push({ offer, ask: held.total });

      const decision = buildMenu({
        main: input.main,
        addOns: input.addOns,
        catalog: [input.main, ...input.addOns],
        offer,
        round,
        floorPct: input.floorPct,
        now: input.now,
      });

      if (decision.outcome === "accept") {
        const audit = auditAccepted({ main: input.main, floorPct: input.floorPct, total: decision.total, now: input.now });
        if (audit === null) throw new Error("Accepted Gym offer has no money audit");
        haggleProfit += audit.profit;
        resolved = { id: index + 1, persona: simulated.persona, willingness: simulated.willingness, rounds: history, outcome: "bought", agreed: decision.total, trade: "accepted" };
        break;
      }

      if (held.total <= simulated.willingness) {
        haggleProfit += menu.internals[held.id]!.profit;
        resolved = { id: index + 1, persona: simulated.persona, willingness: simulated.willingness, rounds: history, outcome: "bought", agreed: held.total, trade: round === 4 ? "final" : "held" };
        break;
      }

      if (simulated.bundleTempted) {
        const bestBundle = menu.options.find((option) => {
          if (option.kind !== "bundle") return false;
          const candidateAddOn = optionAddOn(option, input.addOns);
          return candidateAddOn !== undefined && option.total <= simulated.willingness + 0.6 * candidateAddOn.list;
        });
        const addOn = bestBundle === undefined ? undefined : optionAddOn(bestBundle, input.addOns);
        if (bestBundle !== undefined && addOn !== undefined) {
          const part = addOnPart(addOn);
          if (part === null) throw new Error("Gym selected a bundle with missing add-on cost");
          haggleProfit += menu.internals[bestBundle.id]!.profit;
          addOnParts += part;
          resolved = { id: index + 1, persona: simulated.persona, willingness: simulated.willingness, rounds: history, outcome: "bought", agreed: bestBundle.total, trade: "bundle" };
          break;
        }
      }
    }

    if (resolved === undefined) {
      const lastOffer = history.at(-1)!.offer;
      const outcome = input.askOwner && lastOffer > input.main.cost && lastOffer < floor ? "would_ask_owner" : "walked";
      resolved = {
        id: index + 1,
        persona: simulated.persona,
        willingness: simulated.willingness,
        rounds: history,
        outcome,
        ...(outcome === "walked" && simulated.willingness >= floor ? { missed: true } : {}),
      };
    }
    shoppers.push(resolved);
  }

  const bought = shoppers.filter((shopper) => shopper.outcome === "bought");
  const bins = Array.from({ length: Math.max(2, Math.ceil((input.main.list - input.main.cost) / 500)) }, (_, index) => input.main.cost! + index * 500);
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
    aovUplift: Math.round(addOnParts / (bought.length || 1)),
    wouldAskOwner: shoppers.filter((shopper) => shopper.outcome === "would_ask_owner").length,
    dealsMissed: shoppers.filter((shopper) => shopper.missed).length,
    shoppers,
  };
}

/** Metric-card changes from saved policy A to candidate policy B. */
export function compare(a: GymResult, b: GymResult): MetricDeltas {
  return {
    boughtPct: b.bought / (b.n || 1) * 100 - a.bought / (a.n || 1) * 100,
    avgAgreed: b.avgAgreed - a.avgAgreed,
    profitVsBanner: b.profitVsBanner - a.profitVsBanner,
    aovUplift: b.aovUplift - a.aovUplift,
    dealsMissed: b.dealsMissed - a.dealsMissed,
    wouldAskOwner: b.wouldAskOwner - a.wouldAskOwner,
  };
}
