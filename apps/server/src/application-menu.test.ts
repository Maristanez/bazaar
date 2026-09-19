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
async function start(fetchImpl?: typeof fetch) {
  const server = await createBazaarServer({ ownerDb: db(), env: fetchImpl ? { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test" } : {}, ...(fetchImpl ? { fetchImpl } : {}) });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function offer(base: string, title: string, message: string) {
  const catalog = await (await fetch(`${base}/api/products`)).json();
  return (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId: "menu-shopper", product: catalog.items.find((p: { title: string }) => p.title === title), productContextSource: "current", message }) })).json();
}
test("an explicit gaiters bundle contains gaiters rather than an arbitrary add-on", async () => {
  const result = await offer(await start(), "Trail Runner 2", "Could you do $150 with gaiters included?");
  expect(result.card.option.items.map((item: { title: string }) => item.title)).toEqual(["Trail Runner 2", "Trail Gaiters"]);
});
test("Backboard can pick a code-priced budget alternative from a private multi-option menu", async () => {
  let seenMenu: Array<{ id: string; total: string; items: Array<{ title: string }> }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); seenMenu = JSON.parse(body.content.split("MENU: ")[1]);
    const choice = seenMenu.find(option => option.items[0]?.title === "Ridge Lite") || seenMenu[0]!;
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "menu-thread", final_content: `OPTION: ${choice.id}\nI can do ${choice.total}.`, model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const result = await offer(await start(fetchImpl), "Trail Runner 3", "My budget is $120. Can you recommend a cheaper alternative?");
  expect(seenMenu.length).toBeGreaterThan(1);
  expect(seenMenu.some(option => option.items[0]?.title === "Trail Runner 3")).toBe(true);
  expect(result.card.option.items[0].title).toBe("Ridge Lite");
  expect(result.card.option.total).toBe(9900);
  expect(JSON.stringify(result)).not.toMatch(/"(?:cost|floor|profit|ownerRank|facts)":/);
});

test("declining an add-on does not bundle it", async () => {
  const result = await offer(await start(), "Trail Runner 2", "Could you do $120 without socks, just the shoes?");
  expect(result.card.option.items.map((item: { title: string }) => item.title)).toEqual(["Trail Runner 2"]);
});
