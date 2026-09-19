import { expect, it } from "vitest";
import { acceptOffer, findProducts, makeOffer } from "./index";
import { createMemoryDb } from "./memoryDb";
import type { CorePorts } from "./ports";

const now = new Date("2026-09-19T12:00:00.000Z");
const tr3 = { variantId: "tr3-10", productId: "tr3", title: "Trail Runner 3", size: "10", productType: "Trail shoes", list: 16900, cost: 9500, stockedAt: "2026-09-07T12:00:00.000Z", inStock: true, isAddOn: false, image: "tr3.jpg" };
const tr2 = { ...tr3, variantId: "tr2-10", productId: "tr2", title: "Trail Runner 2", list: 14900, cost: 7800, stockedAt: "2026-06-17T12:00:00.000Z", image: "tr2.jpg" };
const gaiters = { variantId: "gaiters", productId: "gaiters", title: "Trail gaiters", productType: "Accessories", list: 3500, cost: 1200, stockedAt: null, inStock: true, isAddOn: true, image: "gaiters.jpg" };

function fixture(): CorePorts {
  let next = 1;
  return {
    db: createMemoryDb({
      items: [tr3, { ...tr3, variantId: "tr3-9", size: "9" }, tr2, gaiters],
      policy: { floorPct: 25, askOwner: true, paused: false, updatedAt: now.toISOString() },
    }),
    understand: async () => ({ kind: "offer", amount: 12000 }),
    chooseAndSay: async (options) => ({ optionId: "C1", line: `Trail Runner 2 is ready at $${(options.find((option) => option.id === "C1")?.total ?? 12000) / 100}.` }),
    mint: async () => ({ code: "DEAL120", checkoutUrl: "https://example.test/checkout" }),
    clock: { now: () => now, within: async (work) => ({ timedOut: false, value: await work() }) },
    events: { chat: () => {}, console: () => {} },
    newId: () => `id-${next++}`,
  };
}

it("can understand an available size when the first mirrored variant is sold out", async () => {
  const ports = fixture();
  ports.db = createMemoryDb({
    items: [{ ...tr3, inStock: false }, { ...tr3, variantId: "tr3-9", size: "9" }],
    policy: ports.db.getPolicy(),
  });
  ports.understand = async () => ({ kind: "offer", amount: 12000, size: "9" });
  const events = await makeOffer(ports, { shopperId: "shopper-1", surface: "storefront", productId: "tr3", text: "$120 size 9" });
  expect(events.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { option: { items: [{ variantId: "tr3-9", title: "Trail Runner 3", size: "9", qty: 1 }] } },
  });
});

it("gives Understand the negotiated size when a later message omits it", async () => {
  const ports = fixture();
  await makeOffer(ports, { negotiationId: "size-nine", shopperId: "shopper-1", surface: "storefront", productId: "tr3", understood: { kind: "offer", amount: 12000, size: "9" } });
  ports.understand = async ({ product }) => ({ kind: "offer", amount: 12000, size: product.size });
  const events = await makeOffer(ports, { negotiationId: "size-nine", shopperId: "shopper-1", surface: "storefront", productId: "tr3", text: "$120" });
  expect(events.find((event) => event.t === "card")).toMatchObject({ t: "card", card: { round: 2, option: { items: [expect.objectContaining({ size: "9" })] } } });
});

it("plays an offer through a counter card and a single fake settlement", async () => {
  const ports = fixture();
  expect(findProducts(ports, "runner")).toEqual(expect.arrayContaining([
    expect.objectContaining({ productId: "tr3", openToOffers: true }),
  ]));

  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  const card = events.find((event) => event.t === "card");
  expect(card).toMatchObject({ t: "card", card: { negotiationId: "id-1", option: { id: "C1", total: 12000 } } });
  if (!card || card.t !== "card") throw new Error("Expected counter card");
  expect(events).toEqual(expect.arrayContaining([{ t: "text", delta: "Trail Runner 2 is ready at $120." }]));

  await expect(acceptOffer(ports, card.card.offerId)).resolves.toMatchObject({
    offerId: card.card.offerId, code: "DEAL120", agreedTotal: 12000, checkoutUrl: "https://example.test/checkout",
  });
});

it("supersedes a first counter on round two and settles only the replacement", async () => {
  const ports = fixture();
  const first = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", understood: { kind: "offer", amount: 12000 },
  });
  const firstCard = first.find((event) => event.t === "card");
  if (!firstCard || firstCard.t !== "card") throw new Error("Expected first counter card");
  const second = await makeOffer(ports, {
    negotiationId: firstCard.card.negotiationId, shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 12500 },
  });
  const secondCard = second.find((event) => event.t === "card");
  expect(secondCard).toMatchObject({ t: "card", card: { round: 2, option: { total: 12500 } } });
  if (!secondCard || secondCard.t !== "card") throw new Error("Expected second counter card");
  await expect(acceptOffer(ports, firstCard.card.offerId)).resolves.toEqual({ blocked: "offer_ids" });
  await expect(acceptOffer(ports, secondCard.card.offerId)).resolves.toMatchObject({ agreedTotal: 12500 });
});

it("falls back to option A and a template when choosing times out", async () => {
  const ports = fixture();
  let calls = 0;
  ports.clock.within = async (work) => {
    calls += 1;
    return calls === 2 ? { timedOut: true } : { timedOut: false, value: await work() };
  };

  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
    t: "card", card: expect.objectContaining({ option: expect.objectContaining({ id: "A", total: 16900 }), line: "I can hold $169 for 15 minutes." }),
  })]));
});

it("uses the regex fallback when understanding rejects", async () => {
  const ports = fixture();
  ports.understand = async () => { throw new Error("understand unavailable"); };
  await expect(makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ t: "card", card: expect.objectContaining({ option: expect.objectContaining({ id: "C1" }) }) })]));
});

it("falls back from a rejected chooser within the remaining four-second turn budget", async () => {
  const ports = fixture();
  const caps: number[] = [];
  let current = now;
  ports.clock = {
    now: () => current,
    within: async (work, milliseconds) => {
      caps.push(milliseconds);
      if (caps.length === 1) {
        const value = await work();
        current = new Date(current.getTime() + 2500);
        return { timedOut: false, value };
      }
      throw new Error("chooser unavailable");
    },
  };
  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  expect(caps).toEqual([2500, 1500]);
  expect(events.find((event) => event.t === "card")).toMatchObject({ t: "card", card: { option: { id: "A" } } });
});

it("parses budget and size intent in the understanding fallback without treating a negative amount as positive", async () => {
  const ports = fixture();
  ports.clock.within = async () => ({ timedOut: true });
  const budget = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", text: "my budget is $120, size 9",
  });
  expect(budget.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { round: 1, option: { items: [expect.objectContaining({ size: "9" })] } },
  });
  expect(ports.db.getNegotiation("id-1")?.round).toBe(0);
  const negative = fixture();
  negative.clock.within = async () => ({ timedOut: true });
  await expect(makeOffer(negative, {
    shopperId: "shopper-2", surface: "storefront", productId: "tr3", size: "10", text: "-$120",
  })).resolves.toEqual([{ t: "text", delta: "I can answer product questions or help with a concrete offer." }]);
});

it("rejects malformed understood payloads before they reach the engine", async () => {
  const ports = fixture();
  await expect(makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "unexpected", amount: 12000 } as never,
  })).resolves.toEqual([{ t: "text", delta: "Please send a positive CAD offer for this product." }]);
});

it("falls back safely when the chooser returns malformed output", async () => {
  const ports = fixture();
  ports.chooseAndSay = async () => null as never;
  await expect(makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({
    t: "card", card: expect.objectContaining({ option: expect.objectContaining({ id: "A" }), line: "I can hold $169 for 15 minutes." }),
  })]));
});

it("uses a parsed size when the input has none and rejects a conflicting size", async () => {
  const ports = fixture();
  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3",
    understood: { kind: "offer", amount: 12000, size: "9" },
  });
  expect(events.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { option: { items: [expect.objectContaining({ size: "9" })] } },
  });
  const continued = await makeOffer(ports, {
    negotiationId: "id-1", shopperId: "shopper-1", surface: "storefront", productId: "tr3",
    understood: { kind: "offer", amount: 12000 },
  });
  expect(continued.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { round: 2, option: { items: [expect.objectContaining({ size: "9" })] } },
  });
  await expect(makeOffer(ports, {
    shopperId: "shopper-2", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 12000, size: "9" },
  })).resolves.toEqual([{ t: "text", delta: "Please send a positive CAD offer for this product." }]);
});

it("routes public events without private pricing fields or raw shopper text", async () => {
  const ports = fixture();
  const chats: unknown[] = [];
  const consoles: unknown[] = [];
  let chooseInput: unknown;
  let chooseContext: unknown;
  let understandInput: unknown;
  ports.events = { chat: (route, event) => chats.push({ route, event }), console: (route, event) => consoles.push({ route, event }) };
  ports.chooseAndSay = async (options, context) => {
    chooseInput = options;
    chooseContext = context;
    return { optionId: "C1", line: "Trail Runner 2 is ready at $120." };
  };
  ports.understand = async (input) => {
    understandInput = input;
    return { kind: "offer", amount: 12000 };
  };

  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "my private words $120",
  });
  const forbidden = /"(?:cost|floor|profit|target|facts|ownerRank|menu)"/;
  const card = events.find((event) => event.t === "card");
  if (!card || card.t !== "card") throw new Error("Expected counter card");
  await acceptOffer(ports, card.card.offerId);
  for (const event of [...events, ...chats]) expect(JSON.stringify(event)).not.toMatch(forbidden);
  expect(JSON.stringify([chooseInput, chooseContext])).not.toMatch(/"(?:cost|floor|profit|target)"/);
  expect(JSON.stringify(understandInput)).not.toMatch(/"(?:cost|floor|profit|target)"/);
  expect((consoles as { event: unknown }[]).find(({ event }) => (event as { kind?: string }).kind === "decision")?.event).toMatchObject({
    kind: "decision", menu: expect.any(Array), picked: expect.any(String), floor: expect.any(Number), cost: expect.any(Number), profit: expect.any(Number),
  });
  expect(JSON.stringify(events)).not.toContain("my private words");
});

it("does not count questions or budgets as offers, and validates currency", async () => {
  const ports = fixture();
  const question = await makeOffer(ports, {
    negotiationId: "neg-1", shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "question" },
  });
  expect(question).toEqual([{ t: "text", delta: "I can answer product questions or help with a concrete offer." }]);

  const budget = await makeOffer(ports, {
    negotiationId: "neg-1", shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "budget", budget: 12000 },
  });
  expect(budget.find((event) => event.t === "card")).toMatchObject({ t: "card", card: { round: 1 } });

  const invalid = await makeOffer(ports, {
    shopperId: "shopper-2", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 12000, currency: "USD" },
  });
  expect(invalid).toEqual([{ t: "text", delta: "Please send a positive CAD offer for this product." }]);

  const invalidEvents: unknown[] = [];
  ports.events = { chat: () => {}, console: (_route, event) => invalidEvents.push(event) };
  await makeOffer(ports, {
    shopperId: "shopper-4", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 0 },
  });
  expect(invalidEvents).toEqual([expect.objectContaining({ kind: "blocked", blockedBy: "validate" })]);

  const fallbackPorts = fixture();
  fallbackPorts.clock.within = async () => ({ timedOut: true });
  await expect(makeOffer(fallbackPorts, {
    shopperId: "shopper-3", surface: "storefront", productId: "tr3", size: "10", text: "$120 USD",
  })).resolves.toEqual([{ t: "text", delta: "Please send a positive CAD offer for this product." }]);
});

it("serializes concurrent acceptance so a live offer mints once", async () => {
  const ports = fixture();
  let mints = 0;
  ports.mint = async () => {
    mints += 1;
    return { code: "ONE", checkoutUrl: "https://example.test/checkout" };
  };
  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  const card = events.find((event) => event.t === "card");
  if (!card || card.t !== "card") throw new Error("Expected counter card");
  const [first, second] = await Promise.all([acceptOffer(ports, card.card.offerId), acceptOffer(ports, card.card.offerId)]);
  expect([first, second]).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "ONE" }),
    { blocked: "offer_ids" },
  ]));
  expect(mints).toBe(1);
});

it("releases an acceptance claim when minting fails", async () => {
  const ports = fixture();
  let fail = true;
  ports.mint = async () => {
    if (fail) throw new Error("temporary mint failure");
    return { code: "RETRY", checkoutUrl: "https://example.test/checkout" };
  };
  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  const card = events.find((event) => event.t === "card");
  if (!card || card.t !== "card") throw new Error("Expected counter card");
  await expect(acceptOffer(ports, card.card.offerId)).resolves.toEqual({ blocked: "mint" });
  fail = false;
  await expect(acceptOffer(ports, card.card.offerId)).resolves.toMatchObject({ code: "RETRY" });
});

it("uses the refreshed Auditor audit for minting and the settled owner event", async () => {
  const ports = fixture();
  let mintedProfit: number | undefined;
  const consoleEvents: unknown[] = [];
  ports.events = { chat: () => {}, console: (_route, event) => consoleEvents.push(event) };
  ports.hooks = {
    pause: async () => true,
    approval: async () => true,
    auditor: async (_offer, audit) => ({ ...audit, profit: audit.profit + 123 }),
  };
  ports.mint = async (_offer, audit) => {
    mintedProfit = audit.profit;
    return { code: "FRESH", checkoutUrl: "https://example.test/checkout" };
  };
  const events = await makeOffer(ports, {
    shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10", text: "$120",
  });
  const card = events.find((event) => event.t === "card");
  if (!card || card.t !== "card") throw new Error("Expected counter card");
  await acceptOffer(ports, card.card.offerId);
  expect(mintedProfit).toBe(4323);
  expect(consoleEvents.at(-1)).toMatchObject({ kind: "settled", profit: 4323 });
});

it("supersedes each counter, keeps questions off the round count, and restates only the final price after round four", async () => {
  const ports = fixture();
  ports.chooseAndSay = async () => ({ optionId: "A", line: "I can hold this price." });
  let negotiationId: string | undefined;
  let fourthOfferId = "";
  for (const round of [1, 2, 3, 4]) {
    const events = await makeOffer(ports, {
      ...(negotiationId === undefined ? {} : { negotiationId }),
      shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
      understood: { kind: "offer", amount: 10000 },
    });
    const card = events.find((event) => event.t === "card");
    if (!card || card.t !== "card") throw new Error("Expected counter card");
    negotiationId = card.card.negotiationId;
    expect(card.card.round).toBe(round);
    if (round === 4) fourthOfferId = card.card.offerId;
  }
  await makeOffer(ports, {
    negotiationId: negotiationId!, shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "question" },
  });
  const finalRestatement = await makeOffer(ports, {
    negotiationId: negotiationId!, shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 10000 },
  });
  expect(finalRestatement.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { round: 4, option: { id: "A", kind: "final", total: 16900 } },
  });
  await expect(acceptOffer(ports, fourthOfferId)).resolves.toEqual({ blocked: "offer_ids" });
  const highFifth = await makeOffer(ports, {
    negotiationId: negotiationId!, shopperId: "shopper-1", surface: "storefront", productId: "tr3", size: "10",
    understood: { kind: "offer", amount: 17000 },
  });
  expect(highFifth.find((event) => event.t === "card")).toMatchObject({
    t: "card", card: { round: 4, option: { id: "accepted", total: 17000 } },
  });
});
