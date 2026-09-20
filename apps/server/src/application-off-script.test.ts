import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBazaarServer, type OwnerDatabase } from "./application.js";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
function db(): OwnerDatabase {
  let policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: new Date().toISOString() };
  return { merchantId: "merchant", async loadLatestPolicy() { return policy; }, async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return policy; }, async verifyBearerToken(value) { return value === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; }, async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; } };
}
/** A shop whose LLM is down, so every line is the code fallback, and a shopper who chats with it. */
async function shop(shopperId: string) {
  const fetchImpl: typeof fetch = async () => { throw new Error("llm down"); };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test", BACKBOARD_MEMORY_MODE: "off" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2");
  let negotiationId: string | undefined;
  return async (message: string) => {
    const result = await (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId, negotiationId, product, productContextSource: "current", message }) })).json();
    negotiationId = result.negotiationId || negotiationId;
    return result;
  };
}
const dollars = (cents: number) => `$${cents / 100}`;

for (const phrase of ["Ok what is the best you can do?", "is that your best?", "final price?", "can you go lower?", "meet me in the middle"]) {
  test(`"${phrase}" with a live offer restates the current card and spends no round`, async () => {
    const say = await shop(`off-script-${phrase}`);
    const opening = await say("Could you do $130? Buying today, price match.");
    expect(opening.card.status).toBe("live");
    const asked = await say(phrase);
    expect(asked.card.offerId).toBe(opening.card.offerId);
    expect(asked.card.round).toBe(opening.card.round);
    expect(asked.card.option).toEqual(opening.card.option);
    expect(asked.reply).toContain(dollars(opening.card.option.total));
    for (const figure of asked.reply.match(/\$[\d,.]*\d/g) ?? []) expect(figure).toBe(dollars(opening.card.option.total));
    expect(asked.reply).toMatch(/reason/i);
    expect(asked.reply).toMatch(/bundle|add-on|second/i);
    expect(asked.reply).toMatch(/number/i);
    expect(asked.reply).not.toMatch(/outfit/i);
    const next = await say("Could you do $135?");
    expect(next.card.round).toBe(opening.card.round + 1);
  });
}

test("a sizing question during a live negotiation still gets the sizing answer", async () => {
  const say = await shop("off-script-sizing");
  await say("Could you do $130? Buying today, price match.");
  const asked = await say("Do these run small? What size should I get?");
  expect(asked.card).toBeUndefined();
  expect(asked.reply).toMatch(/size/i);
});

test("a shipping question during a live negotiation still gets the shipping answer", async () => {
  const say = await shop("off-script-shipping");
  await say("Could you do $130? Buying today, price match.");
  const asked = await say("How long is shipping?");
  expect(asked.card).toBeUndefined();
  expect(asked.reply).toMatch(/shipping/i);
});

for (const question of ["What are your best trail shoes?", "Which has the lowest heel drop?"]) {
  test(`"${question}" during a live negotiation is a product question, not a price one`, async () => {
    const say = await shop(`off-script-${question}`);
    await say("Could you do $130? Buying today, price match.");
    const asked = await say(question);
    expect(asked.card).toBeUndefined();
  });
}

test("with no negotiation, asking for the best price invites a number and a reason, not an outfit", async () => {
  const say = await shop("off-script-cold");
  const asked = await say("what's the best you can do?");
  expect(asked.card).toBeUndefined();
  expect(asked.reply).not.toMatch(/outfit/i);
  expect(asked.reply).toMatch(/number/i);
  expect(asked.reply).toMatch(/reason/i);
});
