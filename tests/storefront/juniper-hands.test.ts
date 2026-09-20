import { describe, expect, it } from "vitest";
import { mountWidget, must } from "./widget.ts";

const RUNNER = { productId: 1, title: "Trail Runner 3", handle: "trail-runner-3", url: "/products/trail-runner-3", price: "$169", selectedVariantId: 111 };
const SOCKS = { productId: 2, title: "Trail Socks", handle: "trail-socks", url: "/products/trail-socks", price: "$18", selectedVariantId: 222 };

async function wait(settle: () => Promise<unknown>) { for (let turn = 0; turn < 40; turn += 1) await settle(); }

function mount(options: { onProduct?: boolean } = {}) {
  const calls: { url: string; body: any }[] = [];
  const mounted = mountWidget({
    features: ["hands"],
    products: [RUNNER, SOCKS],
    currentProduct: options.onProduct ? RUNNER : null,
    before: (window) => {
      // The hand's travel is theatre; the test does not sit through it.
      window.setTimeout = (run: () => void) => setTimeout(run, 0); window.clearTimeout = clearTimeout;
      if (options.onProduct) {
        const form = window.document.createElement("form");
        form.className = "product-form";
        form.innerHTML = '<select name="id"><option value="901">9 — $169</option><option value="910">10 — $169</option><option value="911" disabled>11 — $169 · sold out</option></select><input name="quantity" type="number" value="1"><input type="submit" value="Add to cart">';
        form.addEventListener("submit", (event: Event) => event.preventDefault());
        window.document.body.appendChild(form);
      }
    },
    routes: {
      "/cart/add.js": (body: any) => { calls.push({ url: "/cart/add.js", body }); return { items: [{ key: "line-1", quantity: body.items[0].quantity }] }; },
      "/cart/change.js": (body: any) => { calls.push({ url: "/cart/change.js", body }); return { item_count: 0 }; },
      "/cart.js": () => ({ item_count: 1 }),
      "/products/trail-runner-3.js": () => ({ variants: [{ id: 901, title: "9", available: true }, { id: 910, title: "10", available: true }] }),
    },
  });
  const understand = (text: string) => mounted.chat.hands.understand(text, { products: [RUNNER, SOCKS], currentProduct: options.onProduct ? RUNNER : null });
  const steps = () => Array.from(mounted.document.querySelectorAll("[data-juniper-step]")) as HTMLElement[];
  return { ...mounted, calls, understand, steps };
}

describe("V13 — Juniper's hands", () => {
  it("reads a chore out of plain speech", () => {
    const { understand } = mount({ onProduct: true });
    expect(understand("Add it to my cart")).toMatchObject({ kind: "add", product: { handle: "trail-runner-3" } });
    expect(understand("put two trail socks in my bag")).toMatchObject({ kind: "add", product: { handle: "trail-socks" }, quantity: 2 });
    expect(understand("Add the Trail Runner three in size 10 to my cart")).toMatchObject({ kind: "add", size: "10" });
    expect(understand("show me the trail socks")).toMatchObject({ kind: "show", product: { handle: "trail-socks" } });
    expect(understand("Size 10 please")).toMatchObject({ kind: "fit", size: "10" });
    expect(understand("make it two")).toMatchObject({ kind: "fit", quantity: 2 });
    expect(understand("what's in my cart?")).toEqual({ kind: "cart" });
    expect(understand("take me back to the shop")).toEqual({ kind: "browse" });
    expect(understand("undo")).toEqual({ kind: "undo" });
  });

  it("leaves haggling, deals and checkout alone", () => {
    const { understand } = mount({ onProduct: true });
    for (const text of [
      "Could you do $150?",
      "If I buy today, could you add socks as a gift?",
      "could you add two pairs of socks as a gift",
      "I'm buying two pairs. What can you do?",
      "Deal. Take me to checkout.",
      "Click the deal button for me",
      "I'll pay now",
    ]) expect(understand(text), text).toBeNull();
  });

  it("picks the size and quantity on the product form, then adds what the form says, with Undo", async () => {
    const { chat, document, calls, steps, settle } = mount({ onProduct: true });
    chat.open();
    chat.send("add it to my cart in size 10, make it two");
    await wait(settle);
    expect((must(document.querySelector('select[name="id"]')) as HTMLSelectElement).value).toBe("910");
    expect((must(document.querySelector('input[name="quantity"]')) as HTMLInputElement).value).toBe("2");
    expect(calls[0]).toEqual({ url: "/cart/add.js", body: { items: [{ id: 910, quantity: 2 }] } });
    const line = must(steps()[0]);
    expect(line.getAttribute("data-juniper-step")).toBe("done");
    expect(line.textContent).toContain("In your cart: Trail Runner 3, size 10, × 2");
    expect(line.textContent).not.toMatch(/\$/);

    (must(line.querySelector("[data-juniper-undo]")) as HTMLElement).click();
    await wait(settle);
    expect(calls[1]).toEqual({ url: "/cart/change.js", body: { id: "line-1", quantity: 0 } });
    expect(line.textContent).toContain("Taken back out");
  });

  it("a plain chore never reaches the server, so it can never be read as an offer; one with haggling in it does", async () => {
    const { chat, requests, settle } = mount({ onProduct: true });
    chat.open();
    const turns = () => requests.filter((request: any) => request.path === "/api/chat").length;
    const before = turns();
    chat.send("make it two");
    await wait(settle);
    expect(turns()).toBe(before);
    chat.send("add it to my cart, and could you do $150?");
    await wait(settle);
    expect(turns()).toBe(before + 1);
  });

  it("says so when the size is not there, and adds nothing", async () => {
    const { chat, calls, steps, settle } = mount({ onProduct: true });
    chat.open();
    chat.send("add it to my cart in size 11");
    await wait(settle);
    expect(calls).toEqual([]);
    expect(must(steps()[0]).getAttribute("data-juniper-step")).toBe("failed");
  });

  it("adds a product from another page by looking its sizes up", async () => {
    const { chat, calls, settle } = mount();
    chat.open();
    chat.send("put the trail runner 3 in size 10 in my cart");
    await wait(settle);
    expect(calls[0]).toEqual({ url: "/cart/add.js", body: { items: [{ id: 910, quantity: 1 }] } });
  });

  it("never presses Deal, whatever is said", async () => {
    const { chat, document, settle } = mount({ onProduct: true });
    const deal = document.createElement("button");
    deal.setAttribute("data-ai-chat-accept", "");
    let pressed = 0;
    deal.addEventListener("click", () => { pressed += 1; });
    must(chat.elements.messages as HTMLElement).appendChild(deal);
    chat.open();
    chat.send("deal, accept it and add it to my cart and check out");
    await wait(settle);
    expect(pressed).toBe(0);
  });
});
