import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Deal, Policy } from "@bazaar/contracts";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const POLICY: Policy = { floorPct: 25, askOwner: true, paused: false, updatedAt: "2026-09-19T12:00:00.000Z" };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function deal(id: string, productId: string, listTotal: number, agreedTotal: number, cost: number): Deal {
  return {
    id, merchantId: "merchant", offerId: `offer-${id}`, surface: "storefront",
    items: [{ variantId: `${productId}/1`, title: productId, qty: 1 }],
    listTotal, agreedTotal, cost, floor: cost + 100, profit: agreedTotal - cost, ownerApproved: false, code: agreedTotal < listTotal ? "BZR-1" : null,
    createdAt: "2026-09-19T20:00:00.000Z",
  };
}

// Real settled deals, so the owner-only KPIs the shopper surfaces must never see are non-empty.
const DEALS = [
  deal("1", "trail-runner-2", 14_900, 13_300, 7_800),
  deal("2", "race-vest", 12_900, 11_000, 6_000),
];

function database(deals: Deal[]): OwnerDatabase {
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...POLICY }; },
    async appendPolicy(next) { return { ...next, updatedAt: POLICY.updatedAt }; },
    async verifyBearerToken(token) { return token === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; },
    async insertDeal(input) { return { ...input, id: "deal", profit: input.agreedTotal - input.cost, createdAt: new Date().toISOString() }; },
    async listDeals() { return deals; },
  };
}

async function start(ownerDb: OwnerDatabase) {
  const server = await createBazaarServer({ env: {}, ownerDb });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const FORBIDDEN = ["kpis", "customersSaved", "revenueRecovered", "profitRecovered", "agentCostUsd"];

describe("owner KPIs never reach an unauthenticated shopper surface", () => {
  it("keeps GET /api/products and GET /health free of owner KPI fields", async () => {
    const base = await start(database(DEALS));

    const products = await fetch(`${base}/api/products`);
    expect(products.status).toBe(200);
    const productsText = await products.text();
    for (const field of FORBIDDEN) expect(productsText).not.toContain(field);

    const health = await fetch(`${base}/health`);
    const healthText = await health.text();
    for (const field of FORBIDDEN) expect(healthText).not.toContain(field);
  });

  it("refuses GET /api/console/state without a bearer token", async () => {
    const base = await start(database(DEALS));
    const response = await fetch(`${base}/api/console/state`);
    expect(response.status).toBe(401);
  });
});
