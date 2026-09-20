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

for (const phrase of ["Ok what is the best you can do?", "is that your best?", "final price?", "can you go lower?", "meet me in the middle", "What would move it?"]) {
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

for (const phrase of ["can you go lower? 120", "what is the best you can do? 120", "can you go lower 120"]) {
  test(`"${phrase}" with a live offer is a new offer at that number, not a question`, async () => {
    const say = await shop(`off-script-${phrase}`);
    const opening = await say("Could you do $130? Buying today, price match.");
    const next = await say(phrase);
    expect(next.card.offerId).not.toBe(opening.card.offerId);
    expect(next.card.round).toBe(opening.card.round + 1);
    expect(next.card.trail[1].amount).toBe(12000);
  });
}

for (const phrase of ["what's your best price on the size 10?", "is 151 your best?", "can you go any lower for 2 pairs of socks, size 10 to 12?", "can you go lower, I wear a 10?", "can you go lower, I'm a size-10?", "can you go lower, I'm 25?"]) {
  test(`"${phrase}" is still a question: a size or a quoted figure is not a new offer`, async () => {
    const say = await shop(`off-script-${phrase}`);
    const opening = await say("Could you do $130? Buying today, price match.");
    const asked = await say(phrase);
    expect(asked.card.offerId).toBe(opening.card.offerId);
    expect(asked.card.round).toBe(opening.card.round);
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

test("the six-turn walkthrough shows a shopper no engine vocabulary", async () => {
  const say = await shop("walkthrough-words");
  const ENGINE_WORDS = /reason:|\bintent\b|counter|bundle value|use case|seller|\bShop\b|from the server|offer card|\(/i;
  const turns = ["Does this run true to size?", "Could you do $120? I'm buying socks too.", "How about $110? I'm a student on a tight budget.", "$40. Final.", "Ok what is the best you can do?", "One more try: $100 and I will tell all my friends."];
  for (const message of turns) {
    const result = await say(message);
    const shown = [result.reply, result.card?.line, ...(result.card?.badges ?? []), ...(result.card?.trail ?? []).map((step: { label: string }) => step.label)].filter(Boolean);
    for (const text of shown) expect(text).not.toMatch(ENGINE_WORDS);
  }
});

test("the badge names the reason the shopper gave in this message", async () => {
  const say = await shop("walkthrough-reason");
  await say("Could you do $120? I'm buying socks too.");
  const second = await say("How about $110? I'm a student on a tight budget.");
  expect(second.card.badges).toContain("for a tight budget");
  expect(second.card.badges).not.toContain("for a bigger cart");
  expect(second.reply).toContain("A tight budget.");
});

test("the trail reads list price, the shopper's offer, the shopkeeper's price, in every round", async () => {
  const say = await shop("walkthrough-trail");
  const first = await say("Could you do $120? I'm buying socks too.");
  const second = await say("How about $110? I'm a student on a tight budget.");
  for (const card of [first.card, second.card]) expect(card.trail.map((step: { label: string }) => step.label)).toEqual(["List price", "You offered", "My price"]);
});

test("every item on the card carries its own list price, and they add up to the list total", async () => {
  const say = await shop("walkthrough-anchor");
  const { card } = await say("Could you do $120? I'm buying socks too.");
  expect(card.option.items.length).toBeGreaterThan(1);
  const sum = card.option.items.reduce((total: number, item: { listPrice: number; qty: number }) => total + item.listPrice * item.qty, 0);
  expect(sum).toBe(card.option.listTotal);
});

test("a lowball leaves the shopkeeper offended, and a fair offer brings the mood back", async () => {
  const say = await shop("walkthrough-mood");
  const fair = await say("Could you do $120? I'm buying socks too.");
  expect(fair.card.mood).not.toBe("offended");
  const lowball = await say("$40. Final.");
  expect(lowball.card.mood).toBe("offended");
  expect(lowball.reply).toContain("that includes Merino Socks");
  const again = await say("How about $115? I'm a student on a tight budget.");
  expect(again.card.mood).not.toBe("offended");
});
