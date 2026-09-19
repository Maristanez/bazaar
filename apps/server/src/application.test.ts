import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createBazaarServer, type OwnerDatabase } from "./application.js";
import type { Policy } from "@bazaar/contracts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});
function database(): OwnerDatabase {
  let policy: Policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: "2026-09-19T12:00:00Z" };
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...policy }; },
    async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return { ...policy }; },
    async verifyBearerToken(token) { return token === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; },
    async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; },
  };
}
async function start(options: Parameters<typeof createBazaarServer>[0] = {}) {
  const server = await createBazaarServer({ env: {}, ...options });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function ownerRequest(base: string, path: string, body?: unknown) {
  return fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function shopperRequest(base: string, path: string, body: unknown) {
  return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function offerInput(base: string, shopperId = "shopper") {
  const catalog = await (await fetch(base + "/api/products")).json();
  const product = catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2");
  return { shopperId, product, productContextSource: "current", message: "Could you do $110? I am buying today because it is last season." };
}
function shopifyBoundary() {
  let cost: string | null = "78.00";
  let inventory = 5;
  let minted = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.query.includes("BazaarProducts")) return Response.json({ data: { products: { nodes: [{ id: "gid://shopify/Product/2", title: "Trail Runner 2", handle: "trail-runner-2", productType: "Trail Shoes", metafield: { value: "2026-06-17" }, variants: { nodes: [9, 10, 11].map(size => ({ id: `gid://shopify/ProductVariant/${size}`, title: String(size), price: "149.00", inventoryQuantity: inventory, inventoryItem: { tracked: true, unitCost: cost === null ? null : { amount: cost, currencyCode: "CAD" } } })) } }] } } });
    if (request.query.includes("discountCodeBasicCreate")) {
      minted++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: "discount-1" }, userErrors: [] } } });
    }
    throw new Error("Unexpected external request");
  };
  return { fetchImpl, changeCost(value: string | null) { cost = value; }, changeInventory(value: number) { inventory = value; }, minted: () => minted, env: { SHOPIFY_SHOP: "test", SHOPIFY_ADMIN_ACCESS_TOKEN: "test" } };
}
describe("owner and shopper HTTP integration", () => {
  it("refuses private Console state without owner authentication", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/console/state`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
  it("loads real owner state and persists adopted policy through the Console contract", async () => {
    const base = await start({ ownerDb: database() });
    const initial = await ownerRequest(base, "/api/console/state");
    expect(initial.status).toBe(200);
    const state = await initial.json();
    expect(state.policy.floorPct).toBe(25);
    expect(state.products.find((p: { title: string }) => p.title === "Trail Runner 2").variants[1].unitCost).toBe(7800);
    const adopted = await ownerRequest(base, "/api/policy", { floorPct: 60, askOwner: true });
    expect(adopted.status).toBe(200);
    expect((await adopted.json()).floorPct).toBe(60);
    expect((await (await ownerRequest(base, "/api/console/state")).json()).policy).toMatchObject({ floorPct: 60, askOwner: true, paused: false });
  });
  it("PAUSE blocks the next shopper message and an already-issued offer", async () => {
    const base = await start({ ownerDb: database() });
    const input = await offerInput(base);
    const first = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(first.card.status).toBe("live");
    expect((await ownerRequest(base, "/api/pause", { paused: true })).status).toBe(200);
    const paused = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(paused.paused).toBe(true);
    expect(paused.reply).toContain("paused");
    expect(paused.card).toBeUndefined();
    const accept = await shopperRequest(base, "/api/accept", { offerId: first.card.offerId, negotiationId: first.card.negotiationId, shopperId: input.shopperId });
    expect(accept.status).toBe(400);
    expect((await accept.json()).reply).toContain("paused");
    await ownerRequest(base, "/api/pause", { paused: false });
    expect((await (await shopperRequest(base, "/api/chat", input)).json()).card.status).toBe("live");
  });
  it("PAUSE invalidates the hot path and old cards before its database write settles", async () => {
    const db = database();
    let save!: () => void;
    const append = vi.fn((next: { floorPct: number; askOwner: boolean; paused: boolean }) => new Promise<Policy>(resolve => {
      save = () => resolve({ ...next, updatedAt: "2026-09-19T12:01:00.000Z" });
    }));
    db.appendPolicy = append;
    const base = await start({ ownerDb: db });
    const input = await offerInput(base);
    const first = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(first.card.status).toBe("live");

    const pausing = ownerRequest(base, "/api/pause", { paused: true });
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());

    const blocked = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(blocked).toMatchObject({ paused: true });
    const polled = await (await fetch(`${base}/api/offers/${first.card.offerId}?shopperId=${input.shopperId}&negotiationId=${first.card.negotiationId}`)).json();
    expect(polled.card.status).toBe("paused");

    save();
    const response = await pausing;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ policy: { paused: true }, persistence: "saved" });
  });
  it("reports pending persistence without reopening deals when the PAUSE write fails", async () => {
    const db = database();
    const append = db.appendPolicy;
    db.appendPolicy = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockImplementation(append);
    const base = await start({ ownerDb: db });
    const input = await offerInput(base);
    const first = await (await shopperRequest(base, "/api/chat", input)).json();

    const response = await ownerRequest(base, "/api/pause", { paused: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ policy: { paused: true }, persistence: "pending" });
    expect(await (await ownerRequest(base, "/api/console/state")).json()).toMatchObject({ policy: { paused: true }, pausePersistence: "pending" });
    expect((await (await shopperRequest(base, "/api/chat", input)).json()).paused).toBe(true);
    const polled = await (await fetch(`${base}/api/offers/${first.card.offerId}?shopperId=${input.shopperId}&negotiationId=${first.card.negotiationId}`)).json();
    expect(polled.card.status).toBe("paused");
  });
  it("adopted floor changes the next Backboard menu and public offer without exposing owner data", async () => {
    const menus: { total: string }[][] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const menu = JSON.parse(body.content.split("MENU: ")[1]); menus.push(menu);
      return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: `OPTION: ${menu[0].id}\nI can do ${menu[0].total}.`, model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    };
    const base = await start({ ownerDb: database(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "assistant", BACKBOARD_MEMORY_MODE: "off" }, fetchImpl });
    await ownerRequest(base, "/api/policy", { floorPct: 0, askOwner: false });
    const input = await offerInput(base);
    let low;
    for (let i = 0; i < 4; i++) low = await (await shopperRequest(base, "/api/chat", input)).json();
    const lowMenu = menus.at(-1)![0]!.total;
    await ownerRequest(base, "/api/policy", { floorPct: 60, askOwner: false });
    const high = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(high.card.option.total).toBeGreaterThan(low.card.option.total);
    expect(menus.at(-1)![0]!.total).not.toBe(lowMenu);
    expect(high.card.option.total).toBeGreaterThanOrEqual(12500);
    expect(JSON.stringify(high)).not.toMatch(/"(?:cost|floor|profit|ownerRank|facts)":/);
  });
  it("publishes the real shopper decision to the authenticated Console stream", async () => {
    const base = await start({ ownerDb: database() });
    const input = await offerInput(base);
    const offer = await (await shopperRequest(base, "/api/chat", input)).json();
    const controller = new AbortController();
    const stream = await fetch(base + "/api/console/stream", { headers: { Authorization: "Bearer owner" }, signal: controller.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    let text = "";
    const deadline = setTimeout(() => controller.abort(), 500);
    try {
      while (!text.includes("data:")) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
      const event = JSON.parse(text.split("data: ")[1]!.split("\n")[0]!);
      expect(event).toMatchObject({ kind: "decision", shopperId: input.shopperId, negotiationId: offer.card.negotiationId, cost: 7800, floor: 9750 });
      expect(event.menu[0].total).toBe(offer.card.option.total);
    } finally { clearTimeout(deadline); controller.abort(); }
  });
  it("owner approval updates the same shopper's pending card and cannot be resolved twice", async () => {
    const base = await start({ ownerDb: database() });
    await ownerRequest(base, "/api/policy", { floorPct: 60, askOwner: true });
    const input = { ...await offerInput(base), message: "Could you do $90? It is last season and I am buying today." };
    let response;
    for (let i = 0; i < 5; i++) response = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(response.card.status).toBe("pending_owner");
    const snapshot = await (await ownerRequest(base, "/api/console/state")).json();
    expect(snapshot.pendingApprovals).toHaveLength(1);
    expect(snapshot.pendingApprovals[0]).toMatchObject({ offer: 9000, cost: 7800, profit: 1200 });
    const resolved = await ownerRequest(base, `/api/approvals/${snapshot.pendingApprovals[0].id}`, { decision: "approve" });
    expect(resolved.status).toBe(200);
    const pollUrl = `${base}/api/offers/${response.card.offerId}?shopperId=${input.shopperId}&negotiationId=${encodeURIComponent(response.card.negotiationId)}`;
    const updated = await (await fetch(pollUrl)).json();
    expect(updated.card).toMatchObject({ status: "live", option: { total: 9000 }, badges: ["owner approved"] });
    expect((await ownerRequest(base, `/api/approvals/${snapshot.pendingApprovals[0].id}`, { decision: "decline" })).status).toBe(400);
    expect((await fetch(pollUrl.replace("shopperId=shopper", "shopperId=someone-else"))).status).toBe(404);
    expect(JSON.stringify(updated)).not.toMatch(/"(?:cost|floor|profit|ownerRank|facts)":/);
  });
  it("fresh Shopify costs block checkout when an issued offer would lose money", async () => {
    const shopify = shopifyBoundary();
    const base = await start({ ownerDb: database(), env: shopify.env, fetchImpl: shopify.fetchImpl });
    const input = await offerInput(base);
    const { card } = await (await shopperRequest(base, "/api/chat", input)).json();
    shopify.changeCost("150.00");
    const accepted = await shopperRequest(base, "/api/accept", { offerId: card.offerId, negotiationId: card.negotiationId, shopperId: input.shopperId });
    expect(accepted.status).toBe(400);
    expect(shopify.minted()).toBe(0);
  });
  it("does not revive issued cards after pause and resume", async () => {
    const base = await start({ ownerDb: database() });
    const input = await offerInput(base);
    const { card } = await (await shopperRequest(base, "/api/chat", input)).json();
    await ownerRequest(base, "/api/pause", { paused: true });
    await ownerRequest(base, "/api/pause", { paused: false });
    const polled = await (await fetch(`${base}/api/offers/${card.offerId}?shopperId=${input.shopperId}&negotiationId=${card.negotiationId}`)).json();
    expect(polled.card.status).toBe("paused");
  });
  it("fails closed for missing live Shopify costs instead of borrowing fixture costs", async () => {
    const shopify = shopifyBoundary(); shopify.changeCost(null);
    const base = await start({ ownerDb: database(), env: shopify.env, fetchImpl: shopify.fetchImpl });
    const response = await (await shopperRequest(base, "/api/chat", await offerInput(base))).json();
    expect(response.card).toBeUndefined();
    expect(shopify.minted()).toBe(0);
    expect((await (await ownerRequest(base, "/api/console/state")).json()).products[0].variants[0].unitCost).toBeNull();
  });
  it("checks sufficient inventory for the accepted quantity", async () => {
    const shopify = shopifyBoundary();
    const base = await start({ ownerDb: database(), env: shopify.env, fetchImpl: shopify.fetchImpl });
    const input = { ...await offerInput(base), message: "Can I get 2 pairs for $260 total?" };
    const { card } = await (await shopperRequest(base, "/api/chat", input)).json();
    expect(card.option.items[0].qty).toBe(2);
    shopify.changeInventory(1);
    expect((await shopperRequest(base, "/api/accept", { offerId: card.offerId, negotiationId: card.negotiationId, shopperId: input.shopperId })).status).toBe(400);
    expect(shopify.minted()).toBe(0);
  });
  it("settles a discounted offer exactly once under concurrent accepts", async () => {
    const shopify = shopifyBoundary();
    const db = database(); let saves = 0;
    const insert = db.insertDeal;
    db.insertDeal = async deal => { saves++; return insert(deal); };
    const base = await start({ ownerDb: db, env: shopify.env, fetchImpl: shopify.fetchImpl });
    const input = await offerInput(base); let card;
    for (let i = 0; i < 4; i++) ({ card } = await (await shopperRequest(base, "/api/chat", input)).json());
    expect(card.option.total).toBeLessThan(card.option.listTotal);
    const payload = { offerId: card.offerId, negotiationId: card.negotiationId, shopperId: input.shopperId };
    const accepted = await Promise.all([shopperRequest(base, "/api/accept", payload), shopperRequest(base, "/api/accept", payload)]);
    expect(accepted.map(r => r.status)).toEqual([200, 200]);
    expect(shopify.minted()).toBe(1); expect(saves).toBe(1);
    const success = await accepted.find(r => r.status === 200)!.json();
    expect(success.settlement.checkoutUrl).toContain("/cart/");
    expect(success.settlement).not.toHaveProperty("discountId");
  });

});
