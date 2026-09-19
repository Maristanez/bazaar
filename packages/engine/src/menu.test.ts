import { expect, it } from "vitest";
import { buildMenu, floorOf, type Item } from "./index";

const now = new Date("2026-09-19T12:00:00.000Z");
const tr2: Item = {
  variantId: "tr2-10", productId: "tr2", title: "Trail Runner 2", size: "10",
  productType: "Trail shoes", list: 14900, cost: 7800,
  stockedAt: "2026-06-17T12:00:00.000Z", inStock: true, isAddOn: false,
};
const tr3: Item = {
  ...tr2, variantId: "tr3-10", productId: "tr3", title: "Trail Runner 3",
  list: 16900, cost: 9500, stockedAt: "2026-09-07T12:00:00.000Z",
};
const ridgeLite: Item = {
  ...tr2, variantId: "ridge-10", productId: "ridge", title: "Ridge Lite",
  list: 9900, cost: 5200, stockedAt: "2026-08-10T12:00:00.000Z",
};
const gaiters: Item = {
  variantId: "gaiters", productId: "gaiters", title: "Trail gaiters",
  productType: "Accessories", list: 3500, cost: 1200,
  stockedAt: null, inStock: true, isAddOn: true,
};
const socks: Item = { ...gaiters, variantId: "socks", productId: "socks", title: "Merino socks", list: 1800, cost: 600 };
const input = {
  product: tr3,
  catalog: [tr3, tr2, gaiters],
  offer: 12000,
  round: 1 as const,
  floorPct: 25,
  now,
};

// SPEC — do not edit
it("offers TR2 at $120 and TR2 with gaiters at $144 for $120 on TR3 in round 1", () => {
  const result = buildMenu(input);
  expect(result.decision).toBe("menu");
  if (result.decision !== "menu") throw new Error("Expected a counter menu");
  expect(result.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "else", total: 12000, items: [expect.objectContaining({ variantId: "tr2-10" })] }),
    expect.objectContaining({ kind: "else", total: 14400, items: [expect.objectContaining({ variantId: "tr2-10" }), expect.objectContaining({ variantId: "gaiters" })] }),
  ]));
  for (const option of result.options) {
    const cart = option.items.map(({ variantId }) => input.catalog.find((item) => item.variantId === variantId)!);
    expect(option.total).toBeGreaterThanOrEqual(floorOf(cart, 25));
  }
  expect(result.audit.C1).toEqual(expect.objectContaining({ cost: 7800, floor: 9750, target: 11982, profit: 4200 }));
});

it("holds TR2 at $135 and offers socks at $147 in round 2", () => {
  const result = buildMenu({
    product: tr2,
    catalog: [tr2, socks],
    offer: 11500,
    round: 2,
    floorPct: 25,
    now,
  });
  expect(result.decision).toBe("menu");
  if (result.decision !== "menu") throw new Error("Expected a counter menu");
  expect(result.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "A", kind: "held", total: 13500, listTotal: 14900 }),
    expect.objectContaining({
      id: "B1", kind: "bundle", total: 14700, listTotal: 16700,
      items: [expect.objectContaining({ variantId: "tr2-10" }), expect.objectContaining({ variantId: "socks", thrownIn: true })],
    }),
  ]));
  const socksOption = result.options.find((option) => option.id === "B1");
  expect(socksOption?.facts).toEqual(expect.arrayContaining(["stocked 94 days ago", "list $167 for both"]));
});

it("accepts an at-ask offer and rounds a higher partial-dollar offer upward", () => {
  const atAsk = buildMenu({ product: tr3, catalog: [tr3], offer: 16900, round: 1, floorPct: 25, now });
  expect(atAsk).toEqual({ decision: "accept", total: 16900 });

  const partialDollar = buildMenu({ product: tr3, catalog: [tr3], offer: 17001, round: 3, floorPct: 25, now });
  expect(partialDollar).toEqual({ decision: "accept", total: 17100 });
});

it.each([1, 2, 3, 4] as const)("does not move a new-stock TR3 shoe in round %i", (round) => {
  const result = buildMenu({ product: tr3, catalog: [tr3], offer: 12000, round, floorPct: 25, now });
  expect(result.decision).toBe("menu");
  if (result.decision !== "menu") throw new Error("Expected a counter menu");
  expect(result.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "A", total: 16900, kind: round === 4 ? "final" : "held" }),
  ]));
});

it("accepts a TR2 round-3 offer above its ask but counters below the ask", () => {
  expect(buildMenu({ product: tr2, catalog: [tr2], offer: 14000, round: 3, floorPct: 25, now }))
    .toEqual({ decision: "accept", total: 14000 });

  const belowAsk = buildMenu({ product: tr2, catalog: [tr2, ridgeLite], offer: 12500, round: 3, floorPct: 25, now });
  expect(belowAsk.decision).toBe("menu");
  if (belowAsk.decision !== "menu") throw new Error("Expected a counter menu");
  expect(belowAsk.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "A", total: 12700 }),
    expect.objectContaining({ kind: "else", items: [expect.objectContaining({ variantId: "ridge-10" })] }),
  ]));
});

it("labels the held price final in round 4", () => {
  const result = buildMenu({ product: tr2, catalog: [tr2], offer: 11500, round: 4, floorPct: 25, now });
  expect(result.decision).toBe("menu");
  if (result.decision !== "menu") throw new Error("Expected a counter menu");
  expect(result.options).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "A", kind: "final", total: 12000 }),
  ]));
});

it("closes when the requested product has no cost and omits unavailable alternatives", () => {
  expect(buildMenu({ product: { ...tr3, cost: null }, catalog: [tr3], offer: 12000, round: 1, floorPct: 25, now }))
    .toEqual({ decision: "closed", reason: "missing_cost" });

  const result = buildMenu({
    product: tr3,
    catalog: [tr3, { ...tr2, inStock: false }, gaiters],
    offer: 12000,
    size: "10",
    round: 1,
    floorPct: 25,
    now,
  });
  expect(result.decision).toBe("menu");
  if (result.decision !== "menu") throw new Error("Expected a counter menu");
  expect(result.options.flatMap((option) => option.items.map((item) => item.variantId))).not.toContain("tr2-10");
});

it("only states catalog-backed facts, including unknown stock age", () => {
  const result = buildMenu({ ...input, product: { ...tr3, stockedAt: null }, catalog: [tr3, ridgeLite, socks] });
  if (result.decision !== "menu") throw new Error("Expected menu");
  const main = result.options.find((o) => o.id === "A")!;
  expect(main.facts.join(" ")).not.toMatch(/stocked \d+ days/);
  expect(result.options.flatMap((o) => o.facts).join(" ")).not.toMatch(/same fit|pairs with/);
});

it("rounds every displayed amount, including the list total, upward", () => {
  const product = { ...tr3, list: 16901 };
  const result = buildMenu({ ...input, product });
  if (result.decision !== "menu") throw new Error("Expected menu");
  expect(result.options.find((o) => o.id === "A")).toMatchObject({ listTotal: 17000, total: 17000 });
});

it("offers no alternatives for $140 on TR2 round 1", () => {
  const result = buildMenu({ ...input, product: tr2, catalog: [tr2, ridgeLite, socks], offer: 14000 });
  if (result.decision !== "menu") throw new Error("Expected menu");
  expect(result.options.some((o) => o.kind === "else")).toBe(false);
});

it("filters unusable variants and ranks safe options by profit then age", () => {
  const catalog = [tr3, tr2, ridgeLite, socks, gaiters,
    { ...tr2, variantId: "wrong-size", size: "9" },
    { ...tr2, variantId: "no-cost", cost: null },
    { ...socks, variantId: "no-addon-cost", cost: null },
    { ...socks, variantId: "sold-addon", inStock: false }];
  const result = buildMenu({ ...input, catalog, size: "10" });
  if (result.decision !== "menu") throw new Error("Expected menu");
  expect(result.options.flatMap((o) => o.items.map((i) => i.variantId)))
    .not.toEqual(expect.arrayContaining(["wrong-size", "no-cost", "no-addon-cost", "sold-addon"]));
  for (const [i, option] of result.options.entries()) {
    expect(option.ownerRank).toBe(i + 1);
    expect(option.total).toBeGreaterThan(result.audit[option.id]!.cost);
    expect(option.total).toBeGreaterThanOrEqual(result.audit[option.id]!.floor);
    if (i > 0) expect(result.audit[option.id]!.profit).toBeLessThanOrEqual(result.audit[result.options[i - 1]!.id]!.profit);
    expect(option.items.some((item) => /wrong-size|no-cost|no-addon-cost|sold-addon/.test(item.variantId))).toBe(false);
  }
  const older = { ...ridgeLite, productId: "older", variantId: "older", stockedAt: "2026-07-21T12:00:00Z" };
  const tied = buildMenu({ ...input, catalog: [ridgeLite, older], size: "10" });
  if (tied.decision !== "menu") throw new Error("Expected menu");
  expect(tied.options.filter((o) => o.kind === "else").map((o) => o.items[0]!.variantId)).toEqual(["older", "ridge-10"]);
});
