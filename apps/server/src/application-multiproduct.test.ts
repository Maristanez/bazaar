import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createBazaarServer, type OwnerDatabase } from "./application.js";
import type { Policy } from "@bazaar/contracts";

type PublicProduct = {
  title: string;
  handle: string;
  selectedVariantId: string;
  variants: Array<{ id: string; title: string; available: boolean }>;
  [key: string]: unknown;
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

function database(): OwnerDatabase {
  let policy: Policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: "2026-09-19T12:00:00Z" };
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...policy }; },
    async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return { ...policy }; },
    async verifyBearerToken() { return { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" }; },
    async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; },
  };
}

async function start() {
  const server = await createBazaarServer({ env: {}, ownerDb: database() });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function products(base: string): Promise<PublicProduct[]> {
  return (await (await fetch(`${base}/api/products`)).json()).items as PublicProduct[];
}

async function chat(base: string, body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function productPayload(product: PublicProduct, shopperId: string, message: string, overrides: Record<string, unknown> = {}) {
  return {
    shopperId,
    product,
    productContextSource: "current",
    pageUrl: `/products/${product.handle}`,
    message,
    ...overrides,
  };
}

describe("multi-product shopper API integration", () => {
  it("keeps products, variants, quantities, and negotiations separate while switching", async () => {
    const base = await start();
    const catalog = await products(base);
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const trail3 = catalog.find(product => product.title === "Trail Runner 3")!;
    const shopperId = "multi-product-shopper";

    const first = await chat(base, productPayload(trail2, shopperId, "Could you do $110?"));
    expect(first.status).toBe(200);
    expect(first.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 1 });
    expect(first.body.card.negotiationId).toBe(first.body.negotiationId);

    const trail3Offer = await chat(base, productPayload(trail3, shopperId, "Could you do $150?"));
    expect(trail3Offer.body.card.option.items[0].title).toBe("Trail Runner 3");
    expect(trail3Offer.body.negotiationId).not.toBe(first.body.negotiationId);

    const size10 = { ...trail2, selectedVariantId: trail2.variants.find(variant => variant.title === "10")!.id };
    const switchedBack = await chat(base, productPayload(size10, shopperId, "Could you do $120?", { negotiationId: first.body.negotiationId }));
    expect(switchedBack.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", size: "10", qty: 1 });
    expect(switchedBack.body.negotiationId).not.toBe(first.body.negotiationId);

    const quantity = await chat(base, productPayload(size10, shopperId, "Could you do 2 pairs for $260 total?", { negotiationId: switchedBack.body.negotiationId }));
    expect(quantity.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", size: "10", qty: 2 });
    expect(quantity.body.card.option.listTotal).toBe(29800);
    expect(quantity.body.negotiationId).not.toBe(switchedBack.body.negotiationId);
  });

  it("supersedes only the prior offer in the same negotiation and isolates shopper identity", async () => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const shopperId = "offer-owner";
    const first = await chat(base, productPayload(trail2, shopperId, "Could you do $110?"));
    const second = await chat(base, productPayload(trail2, shopperId, "Could you do $115?", { negotiationId: first.body.negotiationId }));
    expect(second.body.negotiationId).toBe(first.body.negotiationId);
    expect(second.body.card.offerId).not.toBe(first.body.card.offerId);

    const old = await fetch(`${base}/api/offers/${first.body.card.offerId}?shopperId=${shopperId}&negotiationId=${first.body.negotiationId}`);
    expect((await old.json()).card.status).toBe("superseded");
    const crossShopper = await fetch(`${base}/api/offers/${second.body.card.offerId}?shopperId=someone-else&negotiationId=${second.body.negotiationId}`);
    expect(crossShopper.status).toBe(404);
  });

  it("resolves a named other product inside chat instead of the page product", async () => {
    const base = await start();
    const catalog = await products(base);
    const pageProduct = catalog.find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(pageProduct, "named-product-shopper", "Could you get Trail Runner 3 in size 10?"));
    expect(response.status).toBe(200);
    expect(response.body.reply).toContain("Trail Runner 3");
    expect(response.body.reply).not.toContain("Trail Runner 2");
    expect(response.body.card).toBeUndefined();
  });

  it("does not carry the prior product quantity into a new product", async () => {
    const base = await start();
    const catalog = await products(base);
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const trail3 = catalog.find(product => product.title === "Trail Runner 3")!;
    const shopperId = "quantity-switcher";
    const bulk = await chat(base, productPayload(trail2, shopperId, "Could you do 2 pairs for $260 total?"));
    expect(bulk.body.card.option.items[0].qty).toBe(2);

    const switched = await chat(base, productPayload(trail3, shopperId, "Could you do $169?"));
    expect(switched.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 3", qty: 1 });
  });

  it("parses an explicit word quantity instead of treating every pair phrase as two", async () => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(trail2, "word-quantity-shopper", "Could you do $400 for three pairs?"));
    expect(response.body.card.option.items[0].qty).toBe(3);
  });

  it("resets a socks quantity when the browser switches to the current Trail Runner 2 page", async () => {
    const base = await start();
    const catalog = await products(base);
    const socks = catalog.find(product => product.title === "Merino Socks")!;
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const shopperId = "browser-product-switch";
    const socksOffer = await chat(base, productPayload(socks, shopperId, "Could you do 2 pairs for $30 total?"));
    expect(socksOffer.body.card.option.items[0]).toMatchObject({ title: "Merino Socks", qty: 2 });

    const trailOffer = await chat(base, productPayload(trail2, shopperId, "Can you do $120 for these? I can buy today for a trail race."));
    expect(trailOffer.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 1 });
  });

  it.each([
    ["one pair", 1],
    ["three pairs", 3],
  ])("uses the requested quantity for %s", async (phrase, expectedQuantity) => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(trail2, `word-${expectedQuantity}`, `Could you do $400 for ${phrase}?`));
    expect(response.body.card?.option.items[0]?.qty).toBe(expectedQuantity);
  });

  it("rejects an explicit numeric quantity above the server limit without an offer card", async () => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(trail2, "too-many", "Could you do $100 for 100 pairs?"));
    expect(response.body.card).toBeUndefined();
  });

  it("resolves a text size L/XL to the socks variant", async () => {
    const base = await start();
    const socks = (await products(base)).find(product => product.title === "Merino Socks")!;
    const response = await chat(base, productPayload(socks, "sock-size", "Could you do $15 for size L/XL?"));
    expect(response.body.card?.option.items[0]).toMatchObject({ title: "Merino Socks", size: "L/XL", qty: 1 });
  });

  it("accepts a quantity supplied by the storefront payload", async () => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(trail2, "payload-quantity", "Could you do $260?", { quantity: 2 }));
    expect(response.body.card?.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 2 });
  });

  it("keeps product negotiations independently live and supersedes only the same negotiation", async () => {
    const base = await start();
    const catalog = await products(base);
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const trail3 = catalog.find(product => product.title === "Trail Runner 3")!;
    const a = await chat(base, productPayload(trail2, "shopper-a", "Could you do $110?"));
    const b = await chat(base, productPayload(trail3, "shopper-b", "Could you do $150?"));
    expect(a.body.card.status).toBe("live");
    expect(b.body.card.status).toBe("live");
    expect(a.body.card.negotiationId).not.toBe(b.body.card.negotiationId);

    const aNext = await chat(base, productPayload(trail2, "shopper-a", "Could you do $115?", { negotiationId: a.body.negotiationId }));
    expect(aNext.body.card.status).toBe("live");
    expect((await (await fetch(`${base}/api/offers/${a.body.card.offerId}?shopperId=shopper-a&negotiationId=${a.body.negotiationId}`)).json()).card.status).toBe("superseded");
    expect((await (await fetch(`${base}/api/offers/${b.body.card.offerId}?shopperId=shopper-b&negotiationId=${b.body.negotiationId}`)).json()).card.status).toBe("live");
  });

  it("keeps full-price new stock available while preserving its real variant", async () => {
    const base = await start();
    const trail3 = (await products(base)).find(product => product.title === "Trail Runner 3")!;
    const response = await chat(base, productPayload(trail3, "new-stock-shopper", "Could you do $169?"));
    expect(response.body.card).toMatchObject({ status: "live", option: { total: 16900, listTotal: 16900 } });
    expect(response.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 3", qty: 1 });
  });

  it("adds an in-stock add-on without exposing owner economics or crossing its safe total", async () => {
    const base = await start();
    const trail2 = (await products(base)).find(product => product.title === "Trail Runner 2")!;
    const response = await chat(base, productPayload(trail2, "bundle-shopper", "Could you do $120? I am buying socks too."));
    expect(response.body.card).toBeDefined();
    expect(response.body.card.option.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Trail Runner 2", qty: 1 }),
      expect.objectContaining({ title: "Merino Socks", qty: 1, thrownIn: true }),
    ]));
    expect(response.body.card.option.total).toBeGreaterThan(7800 + 600);
    expect(response.body.card.option.total).toBeLessThanOrEqual(response.body.card.option.listTotal);
    expect(JSON.stringify(response.body)).not.toMatch(/"(?:cost|floor|profit|ownerRank|facts)"/);
  });

  it("resumes negotiation A at its quantity after negotiation B uses the same shopper", async () => {
    const base = await start();
    const catalog = await products(base);
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const socks = catalog.find(product => product.title === "Merino Socks")!;
    const shopperId = "resume-a-after-b";
    const a = await chat(base, productPayload(trail2, shopperId, "Could you do 3 pairs for $390 total? I am training for a trail race."));
    expect(a.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 3 });
    const b = await chat(base, productPayload(socks, shopperId, "Could you do $15? I am buying socks too."));
    expect(b.body.card.option.items[0]).toMatchObject({ title: "Merino Socks", qty: 1 });

    const resumed = await chat(base, productPayload(trail2, shopperId, "Could you do $390 total?", { negotiationId: a.body.negotiationId }));
    expect(resumed.body.negotiationId).toBe(a.body.negotiationId);
    expect(resumed.body.card).toMatchObject({ round: 2 });
    expect(resumed.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 3 });
    expect(resumed.body.card.option.items).toHaveLength(1);
    expect(JSON.stringify(resumed.body.card)).not.toContain("socks");
  });

  it("uses the current Trail Runner 2 page product and quantity one after a socks quantity two turn", async () => {
    const base = await start();
    const catalog = await products(base);
    const socks = catalog.find(product => product.title === "Merino Socks")!;
    const trail2 = catalog.find(product => product.title === "Trail Runner 2")!;
    const shopperId = "plain-these-after-socks";
    const socksOffer = await chat(base, productPayload(socks, shopperId, "Could you do 2 pairs for $30 total?"));
    expect(socksOffer.body.card.option.items[0]).toMatchObject({ title: "Merino Socks", qty: 2 });

    const trailOffer = await chat(base, productPayload(trail2, shopperId, "Can you do $120 for these?"));
    expect(trailOffer.body.card.option.items[0]).toMatchObject({ title: "Trail Runner 2", qty: 1 });
  });
});
