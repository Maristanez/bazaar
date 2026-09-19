import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Policy } from "@bazaar/contracts";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const servers: Server[] = [];

async function closeServer(server: Server) {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function database(insertDeal?: OwnerDatabase["insertDeal"]): OwnerDatabase {
  let policy: Policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: "2026-09-19T12:00:00Z" };
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...policy }; },
    async appendPolicy(next) {
      policy = { ...next, updatedAt: new Date().toISOString() };
      return { ...policy };
    },
    async verifyBearerToken(token) {
      return token === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null;
    },
    insertDeal: insertDeal ?? (async (deal) => ({
      ...deal,
      id: "deal",
      profit: deal.agreedTotal - deal.cost,
      createdAt: new Date().toISOString(),
    })),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function shopifyBoundary(mintGate?: Promise<void>) {
  let minted = 0;
  let deactivated = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.query.includes("BazaarProducts")) {
      return Response.json({ data: { products: { nodes: [{
        id: "gid://shopify/Product/2",
        title: "Trail Runner 2",
        handle: "trail-runner-2",
        productType: "Trail Shoes",
        metafield: { value: "2026-06-17" },
        variants: { nodes: [9, 10, 11].map((size) => ({
          id: `gid://shopify/ProductVariant/${size}`,
          title: String(size),
          price: "149.00",
          inventoryQuantity: 5,
          inventoryItem: { tracked: true, unitCost: { amount: "78.00", currencyCode: "CAD" } },
        })) },
      }] } } });
    }
    if (request.query.includes("discountCodeBasicCreate")) {
      minted += 1;
      await mintGate;
      return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: "discount-1" }, userErrors: [] } } });
    }
    if (request.query.includes("discountCodeDeactivate")) {
      deactivated += 1;
      return Response.json({ data: { discountCodeDeactivate: { userErrors: [] } } });
    }
    throw new Error("Unexpected Shopify request");
  };
  return {
    fetchImpl,
    minted: () => minted,
    deactivated: () => deactivated,
    env: { SHOPIFY_SHOP: "test", SHOPIFY_ADMIN_ACCESS_TOKEN: "test" },
  };
}

async function start(options: Parameters<typeof createBazaarServer>[0]) {
  const server = await createBazaarServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function shopperRequest(base: string, path: string, body: unknown) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ownerRequest(base: string, path: string, body: unknown) {
  return fetch(base + path, {
    method: "POST",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function discountedOffer(base: string) {
  const catalog = await (await fetch(base + "/api/products")).json();
  const product = catalog.items.find((item: { title: string }) => item.title === "Trail Runner 2");
  const input = {
    shopperId: "settlement-shopper",
    product,
    productContextSource: "current",
    message: "Could you do $110? I am buying today because it is last season.",
  };
  let card;
  for (let round = 0; round < 4; round += 1) {
    ({ card } = await (await shopperRequest(base, "/api/chat", input)).json());
  }
  expect(card.option.total).toBeLessThan(card.option.listTotal);
  return {
    card,
    payload: { offerId: card.offerId, negotiationId: card.negotiationId, shopperId: input.shopperId },
  };
}

describe("settlement idempotency and persistence", () => {
  it("returns the same settlement for concurrent repeats and repeats while paused", async () => {
    const shopify = shopifyBoundary();
    let saves = 0;
    const db = database(async (deal) => {
      saves += 1;
      return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() };
    });
    const { base } = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const { payload } = await discountedOffer(base);

    const responses = await Promise.all([
      shopperRequest(base, "/api/accept", payload),
      shopperRequest(base, "/api/accept", payload),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(bodies[1].settlement).toEqual(bodies[0].settlement);
    expect(shopify.minted()).toBe(1);
    expect(saves).toBe(1);

    expect((await ownerRequest(base, "/api/pause", { paused: true })).status).toBe(200);
    const pausedRepeat = await shopperRequest(base, "/api/accept", payload);
    expect(pausedRepeat.status).toBe(200);
    expect((await pausedRepeat.json()).settlement).toEqual(bodies[0].settlement);
    expect(shopify.minted()).toBe(1);
    expect(saves).toBe(1);
  });

  it("keeps a minted settlement when the first deal write fails and retries the immutable snapshot", async () => {
    const shopify = shopifyBoundary();
    const writes: unknown[] = [];
    const db = database(async (deal) => {
      writes.push(structuredClone(deal));
      if (writes.length === 1) throw new Error("temporary database outage");
      return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() };
    });
    const { base } = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const { payload } = await discountedOffer(base);

    const accepted = await shopperRequest(base, "/api/accept", payload);

    expect(accepted.status).toBe(200);
    const firstSettlement = (await accepted.json()).settlement;
    expect(shopify.minted()).toBe(1);
    await vi.waitFor(() => expect(writes).toHaveLength(2), { timeout: 2_000 });
    expect(writes[1]).toEqual(writes[0]);
    const repeated = await shopperRequest(base, "/api/accept", payload);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).settlement).toEqual(firstSettlement);
    expect(shopify.minted()).toBe(1);
  });

  it("does not hold the shopper response open while the deal write is slow", async () => {
    const shopify = shopifyBoundary();
    const writeGate = deferred();
    let attempts = 0;
    const db = database(async (deal) => {
      attempts += 1;
      await writeGate.promise;
      return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() };
    });
    const { base } = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const { payload } = await discountedOffer(base);

    const accepting = shopperRequest(base, "/api/accept", payload);
    const winner = await Promise.race([
      accepting.then(() => "response"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 300)),
    ]);

    expect(winner).toBe("response");
    expect(attempts).toBe(1);
    writeGate.resolve();
    expect((await accepting).status).toBe(200);
  });

  it("cancels pending persistence retries when the server closes", async () => {
    const shopify = shopifyBoundary();
    let attempts = 0;
    const db = database(async () => {
      attempts += 1;
      throw new Error("database remains unavailable");
    });
    const { base, server } = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const { payload } = await discountedOffer(base);
    expect((await shopperRequest(base, "/api/accept", payload)).status).toBe(200);
    expect(attempts).toBe(1);

    await closeServer(server);
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(attempts).toBe(1);
  });

  it("revokes a just-minted discount if PAUSE wins the post-mint race", async () => {
    const gate = deferred();
    const shopify = shopifyBoundary(gate.promise);
    let saves = 0;
    const db = database(async (deal) => {
      saves += 1;
      return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() };
    });
    const { base } = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const { payload } = await discountedOffer(base);

    const accepting = shopperRequest(base, "/api/accept", payload);
    await vi.waitFor(() => expect(shopify.minted()).toBe(1));
    expect((await ownerRequest(base, "/api/pause", { paused: true })).status).toBe(200);
    gate.resolve();
    const response = await accepting;

    expect(response.status).toBe(400);
    expect(shopify.deactivated()).toBe(1);
    expect(saves).toBe(0);
  });
});
