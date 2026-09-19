import type { Option } from "@bazaar/contracts";
import { ask, costOf, floorOf, targetOf, urgency } from "./formulas";
import { toShopper } from "./money";
import type { Item } from "./types";

export type MenuInput = {
  main: Item;
  addOns: readonly Item[];
  offer: number;
  budget?: number;
  size?: string;
  catalog: readonly Item[];
  round: 1 | 2 | 3 | 4;
  floorPct: number;
  now: Date;
};

type Internals = Record<string, { cost: number; floor: number; target: number; profit: number }>;

export type MenuResult =
  | { outcome: "closed"; reason: "missing_cost" }
  | { outcome: "accept"; total: number }
  | { outcome: "menu"; options: Option[]; internals: Internals };

type Candidate = { option: Option; internals: Internals[string]; age: number };

function ageDays(item: Item, now: Date): number {
  if (item.stockedAt === null) return 0;
  return Math.max(0, (now.getTime() - Date.parse(item.stockedAt)) / (24 * 60 * 60 * 1000));
}

function factsFor(cart: readonly Item[], now: Date, extra: readonly string[] = []): string[] {
  const main = cart[0]!;
  const list = cart.reduce((sum, item) => sum + item.list, 0);
  return [
    ...(main.stockedAt === null ? [] : [`stocked ${Math.floor(ageDays(main, now))} days ago`]),
    `list $${Math.ceil(list / 100)}${cart.length > 1 ? " for both" : ""}`,
    ...extra,
  ];
}

/** Owner-side menu. Only a stripped PublicOption may cross a shopper boundary. */
export function buildMenu(input: MenuInput): MenuResult {
  const { main: product, addOns, catalog, offer, budget, size, floorPct, now, round } = input;
  if (product.cost === null) return { outcome: "closed", reason: "missing_cost" };

  const mainUrgency = urgency(product.stockedAt, now);
  const mainTarget = targetOf([product], mainUrgency, floorPct);
  const mainAsk = ask(product.list, mainTarget, mainUrgency, round);
  const mainFloor = floorOf([product], floorPct);
  if (mainFloor <= product.list && offer >= mainAsk && offer > product.cost && offer >= mainFloor) {
    return { outcome: "accept", total: toShopper(offer) };
  }
  const maxBudget = Math.max(offer, budget ?? offer);
  const desiredSize = size ?? product.size;
  const eligibleAddOns = addOns.filter((item) => item.isAddOn && item.inStock && item.cost !== null);
  const choices: Candidate[] = [];
  let nextId = 1;

  function append(id: string, kind: Option["kind"], cart: readonly Item[], total: number, extraFacts: readonly string[]): void {
    const cost = costOf(cart);
    if (cost === null) return;
    const floor = floorOf(cart, floorPct);
    const shown = toShopper(total);
    if (shown <= cost || shown < floor) return;
    if (kind !== "else" && shown < toShopper(offer)) return;
    const listTotal = cart.reduce((sum, item) => sum + item.list, 0);
    if (floor > listTotal) return;
    choices.push({
      option: {
        id,
        kind,
        items: cart.map((item, index) => ({
          variantId: item.variantId,
          title: item.title,
          ...(item.size === undefined ? {} : { size: item.size }),
          qty: 1,
          ...(index === 0 ? {} : { thrownIn: true }),
        })),
        listTotal: toShopper(listTotal),
        total: shown,
        ownerRank: 0,
        facts: factsFor(cart, now, extraFacts),
      },
      internals: { cost, floor, target: targetOf(cart, urgency(cart[0]!.stockedAt, now), floorPct), profit: shown - cost },
      age: ageDays(cart[0]!, now),
    });
  }

  append("A", round === 4 ? "final" : "held", [product], mainAsk, [round === 4 ? "final offer" : "held 15 min"]);

  let nextBundleId = 1;
  for (const addOn of eligibleAddOns) {
    const addOnPart = addOn.cost! + (addOn.list - addOn.cost!) / 2;
    const nextRound = round === 4 ? 4 : (round + 1) as 2 | 3 | 4;
    const nextAsk = ask(product.list, mainTarget, mainUrgency, nextRound);
    const heldProfit = mainAsk - product.cost;
    const nextRoundProfit = nextAsk + addOnPart - (product.cost + addOn.cost!);
    const shoePart = nextRoundProfit >= heldProfit ? nextAsk : mainAsk;
    if (shoePart < mainTarget) continue;
    append(
      `B${nextBundleId++}`,
      "bundle",
      [product, addOn],
      shoePart + addOnPart,
      [`includes ${addOn.title}`],
    );
  }

  if (offer < mainTarget || round >= 3) {
    const alternatives = catalog
      .filter((item) => !item.isAddOn && item.productId !== product.productId && item.productType === product.productType)
      .filter((item) => item.inStock && item.cost !== null && (desiredSize === undefined || item.size === desiredSize))
      .filter((item) => targetOf([item], urgency(item.stockedAt, now), floorPct) <= maxBudget)
      .sort((left, right) => ageDays(right, now) - ageDays(left, now));

    for (const alternative of alternatives) {
      const alternativeUrgency = urgency(alternative.stockedAt, now);
      const alternativeTarget = targetOf([alternative], alternativeUrgency, floorPct);
      const alternativeAsk = ask(alternative.list, alternativeTarget, alternativeUrgency, round);
      append(`C${nextId++}`, "else", [alternative], Math.max(alternativeTarget, Math.min(alternativeAsk, budget ?? offer)), []);
      for (const addOn of eligibleAddOns) {
        const cart = [alternative, addOn];
        const target = targetOf(cart, alternativeUrgency, floorPct);
        const list = cart.reduce((sum, item) => sum + item.list, 0);
        const cartAsk = ask(list, target, alternativeUrgency, round);
        append(`C${nextId++}`, "else", cart, Math.max(target, Math.min(cartAsk, budget ?? offer)), [`includes ${addOn.title}`]);
      }
    }
  }

  choices.sort((left, right) => right.internals.profit - left.internals.profit || right.age - left.age || left.option.id.localeCompare(right.option.id));
  const internals: Internals = {};
  const options = choices.map(({ option, internals: entry }, index) => {
    const ranked = { ...option, ownerRank: index + 1 };
    internals[ranked.id] = entry;
    return ranked;
  });
  return { outcome: "menu", options, internals };
}
