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
/** A shopkeeper LLM that answers every menu with `reply(menu)`. */
async function offerWith(reply: (menu: Array<{ id: string; total: string }>) => string) {
  let menu: Array<{ id: string; total: string }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    menu = JSON.parse(JSON.parse(String(init?.body)).content.split("MENU: ")[1]);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: reply(menu), model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test", BACKBOARD_MEMORY_MODE: "off" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const result = await (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId: "check-shopper", product: catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2"), productContextSource: "current", message: "Could you do $130? Buying today, price match." }) })).json();
  return { result, menu };
}
const dollars = (cents: number) => `$${cents / 100}`;
/** Every dollar figure in the line is one the engine put on the card. */
function expectOnlyCardFigures(result: { card: { line: string; option: { total: number; listTotal: number } } }) {
  const allowed = [dollars(result.card.option.total), dollars(result.card.option.listTotal)];
  for (const figure of result.card.line.match(/\$[\d,.]*\d/g) ?? []) expect(allowed).toContain(figure);
}

test("an invented dollar figure never reaches the shopper: option A and a code-written line go out instead", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do $1.`);
  expect(menu.length).toBeGreaterThan(0);
  expect(dollars(result.card.option.total)).toBe(menu[0]!.total);
  expectOnlyCardFigures(result);
  expect(JSON.stringify(result)).not.toContain("I can do $1.");
});

test("an invented option id falls back to option A", async () => {
  const { result, menu } = await offerWith(() => "OPTION: Z9\nI can do $99.");
  expect(dollars(result.card.option.total)).toBe(menu[0]!.total);
  expectOnlyCardFigures(result);
  expect(result.card.line).not.toContain("$99");
});

test("private money words are replaced before the shopper sees them", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total}, that is above our cost and floor.`);
  expect(dollars(result.card.option.total)).toBe(menu[0]!.total);
  expect(result.card.line).not.toMatch(/cost|floor|margin|profit/i);
});
