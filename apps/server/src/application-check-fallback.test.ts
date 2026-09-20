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
/** `earlier` are turns sent first in the same negotiation, so the final message lands in a later round. */
async function offerWith(reply: (menu: Array<{ id: string; total: string }>) => string, message = "Could you do $130? Buying today, price match.", earlier: string[] = []) {
  let menu: Array<{ id: string; total: string }> = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    menu = JSON.parse(JSON.parse(String(init?.body)).content.split("MENU: ")[1]);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: reply(menu), model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test", BACKBOARD_MEMORY_MODE: "off" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2");
  let result: any; let negotiationId: string | undefined;
  for (const text of [...earlier, message]) {
    result = await (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId: "check-shopper", negotiationId, product, productContextSource: "current", message: text }) })).json();
    negotiationId = result.negotiationId;
  }
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

test("the model's checked price sentence goes out behind the shopkeeper's answer to the shopper's reason", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total}.`, "Could you do $130? I'm a student on a tight budget.");
  expect(result.reply).toBe(`A tight budget. I've been there. I can do ${menu[0]!.total}.`);
  expect(result.card.line).toBe(result.reply);
  expectOnlyCardFigures(result);
});

test("with no reason given, the model's checked sentence goes out alone", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total}.`, "Could you do $130?");
  expect(result.reply).toBe(`I can do ${menu[0]!.total}.`);
});

test("with the model answering, the last round still sounds like the last round", async () => {
  const fetchImpl: typeof fetch = async (_url, init) => {
    const menu = JSON.parse(JSON.parse(String(init?.body)).content.split("MENU: ")[1]);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: `OPTION: ${menu[0].id}\nI can do ${menu[0].total}.`, model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test", BACKBOARD_MEMORY_MODE: "off" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2");
  let negotiationId: string | undefined;
  const replies: { reply: string; card: { round: number; maxRounds: number } }[] = [];
  for (const message of ["Could you do $130?", "Could you do $131?", "Could you do $132?", "Could you do $133?"]) {
    const result = await (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId: "last-round", negotiationId, product, productContextSource: "current", message }) })).json();
    negotiationId = result.negotiationId;
    replies.push(result);
  }
  const last = replies.at(-1)!;
  expect(last.card.round).toBe(last.card.maxRounds);
  expect(last.reply).toMatch(/last stop on this trail/i);
  for (const earlier of replies.slice(0, -1)) expect(earlier.reply).not.toMatch(/last stop/i);
});

test("a model sentence that arrives without its full stop still goes out as a sentence", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total}`, "Could you do $130? I'm a student on a tight budget.");
  expect(result.reply).toBe(`A tight budget. I've been there. I can do ${menu[0]!.total}.`);
});

test("a reason the engine put on the menu survives the check and reaches the shopper", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total} — ${(options[0] as unknown as { facts: string[] }).facts[0]}.`, "Could you do $132? I'm a returning customer.", ["Could you do $130?", "Could you do $131?"]);
  const facts = (menu[0] as unknown as { facts: string[] }).facts;
  expect(facts).toContain("for a returning customer");
  expect(result.reply).toContain(`I can do ${menu[0]!.total} — for a returning customer.`);
  expectOnlyCardFigures(result);
});

test("a reason the engine did not offer is still cut back to the bare price", async () => {
  const { result, menu } = await offerWith(options => `OPTION: ${options[0]!.id}\nI can do ${options[0]!.total} — it has been sitting for 94 days.`, "Could you do $132? I'm a returning customer.", ["Could you do $130?", "Could you do $131?"]);
  expect(result.reply).toContain(`I can do ${menu[0]!.total}.`);
  expect(result.reply).not.toMatch(/94|sitting/);
});
