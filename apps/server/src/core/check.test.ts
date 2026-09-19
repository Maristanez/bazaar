import { expect, it } from "vitest";
import type { ChatEvent, ConsoleEvent, Option } from "@bazaar/contracts";
import { check } from "./check";
import { makeOffer } from "./index";
import { createMemoryDb } from "./memoryDb";
import type { CorePorts } from "./ports";

const now = new Date("2026-09-19T12:00:00Z");
const tr3 = { variantId: "tr3-10", productId: "tr3", title: "Trail Runner 3", size: "10", productType: "shoe", list: 16900, cost: 9500, stockedAt: "2026-09-07T12:00:00Z", inStock: true, isAddOn: false, image: "tr3.jpg" };
const tr2 = { ...tr3, variantId: "tr2-10", productId: "tr2", title: "Trail Runner 2", list: 14900, cost: 7800, stockedAt: "2026-06-17T12:00:00Z" };

async function quote(pick: { optionId: string; line: string }) {
  let next = 0;
  const owner: ConsoleEvent[] = [];
  const emitted: ChatEvent[] = [];
  const ports: CorePorts = {
    db: createMemoryDb({ items: [tr3, tr2], policy: { floorPct: 25, askOwner: false, paused: false, updatedAt: now.toISOString() } }),
    understand: async () => ({ kind: "offer", amount: 12000 }),
    chooseAndSay: async () => pick,
    mint: async () => ({ code: "unused", checkoutUrl: "https://example.test/checkout" }),
    clock: { now: () => now, within: async (work) => ({ timedOut: false, value: await work() }) },
    events: { chat: (_route, event) => emitted.push(event), console: (_route, event) => owner.push(event) },
    newId: () => `check-${++next}`,
  };
  const events = await makeOffer(ports, { shopperId: "shopper", surface: "storefront", productId: "tr3", size: "10", text: "$120" });
  return { events, emitted, owner };
}

function expectFallback(result: Awaited<ReturnType<typeof quote>>) {
  expect(result.events).toEqual([
    expect.objectContaining({ t: "card", card: expect.objectContaining({ option: expect.objectContaining({ id: "A", total: 16900 }), line: "I can hold $169 for 15 minutes." }) }),
    { t: "text", delta: "I can hold $169 for 15 minutes." },
  ]);
  expect(result.emitted).toEqual(result.events);
  expect(result.owner).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "blocked", blockedBy: "check" })]));
  const decision = result.owner.find((event) => event.menu !== undefined)!;
  expect(check({ menu: decision.menu!, pick: { optionId: "A", line: "I can hold $169 for 15 minutes." } })).toEqual({ ok: true });
}

it("blocks an invented option id with option A, template text and a check row", async () => {
  expectFallback(await quote({ optionId: "invented", line: "I can do $120." }));
});

it("blocks an invented dollar figure with option A, template text and a check row", async () => {
  expectFallback(await quote({ optionId: "C1", line: "I can do $119." }));
});

it("blocks private money words case-insensitively with option A, template text and a check row", async () => {
  for (const word of ["cost", "FLOOR", "Margin", "profit", "markup", "wholesale"]) {
    expectFallback(await quote({ optionId: "C1", line: `I can do $120, above ${word}.` }));
  }
});

it("blocks a reason with no supplied fact using option A, template text and a check row", async () => {
  expectFallback(await quote({ optionId: "C1", line: "I can do $120 because this is the last pair." }));
});

it("passes a clean offer and its supplied facts through untouched", async () => {
  const line = "I can do $120 — stocked 94 days ago; list $149.";
  const result = await quote({ optionId: "C1", line });
  expect(result.events).toEqual([
    expect.objectContaining({ t: "card", card: expect.objectContaining({ option: expect.objectContaining({ id: "C1", total: 12000 }), line }) }),
    { t: "text", delta: line },
  ]);
  expect(result.owner.some((event) => event.kind === "blocked")).toBe(false);
});

it("does not let a list figure or item figure masquerade as the agreed total", async () => {
  expectFallback(await quote({ optionId: "C1", line: "I can do $149." }));
});

it("records one blocked fallback decision so the owner feed cannot count the turn twice", async () => {
  const result = await quote({ optionId: "invented", line: "I can do $120." });
  expect(result.owner).toEqual([expect.objectContaining({ kind: "blocked", blockedBy: "check", picked: "A", menu: expect.any(Array), cost: 9500, floor: 11875, profit: 7400 })]);
});

it("rejects extra claims even when a valid fact is present", async () => {
  for (const line of [
    "I can do $120 — stocked 94 days ago and this is the last pair.",
    "I can do $120 — stocked 94 days ago; free shipping.",
    "I can do $120 because not stocked 94 days ago.",
    "I can do $120 for both.",
  ]) expectFallback(await quote({ optionId: "C1", line }));
});

it("rejects malformed dollar syntax rather than matching a valid numeric prefix", async () => {
  for (const figure of ["$120.000", "$120e3", "$1,20", "$$120", "$-120", "$120abc"]) {
    expectFallback(await quote({ optionId: "C1", line: `I can do ${figure}.` }));
  }
});

it("checks total, list and fact figures with exact cents and word boundaries", () => {
  const option: Option = { id: "B1", kind: "bundle", total: 14700, listTotal: 16700, ownerRank: 1,
    items: [{ variantId: "shoe", title: "Costume Runner", qty: 1 }, { variantId: "socks", title: "Socks", qty: 1 }],
    facts: ["list $167 for both", "socks list $18"],
  };
  expect(check({ menu: [option], pick: { optionId: "B1", line: "I can do $147.00 for both — socks list $18; list $167 for both." } })).toEqual({ ok: true });
  expect(check({ menu: [option], pick: { optionId: "B1", line: "I can do $147 for both — socks list $19." } })).toEqual({ ok: false, reason: "unknown_amount" });
  expect(check({ menu: [option], pick: { optionId: "B1", line: "Costume Runner is ready at $147." } })).toEqual({ ok: true });
  const twoSocks: Option = { ...option, id: "S2", kind: "held", total: 3600, listTotal: 3600, items: [{ variantId: "socks", title: "Socks", qty: 2 }], facts: [] };
  expect(check({ menu: [twoSocks], pick: { optionId: "S2", line: "I can do $36 for both." } })).toEqual({ ok: true });
  const large = { ...option, total: 123400, listTotal: 150000, facts: ["list $1500 for both"] };
  expect(check({ menu: [large], pick: { optionId: "B1", line: "I can do $1,234.00 for both — list $1,500 for both." } })).toEqual({ ok: true });
});
