import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWidget, must } from "./widget.ts";

type Chip = [string, string];

const PRODUCT = {
  productId: "p1", handle: "trail-runner-2", title: "Trail Runner 2", type: "Shoes", url: "/products/trail-runner-2",
  selectedVariantId: "v1", variants: [{ id: "v1", title: "9", price: "$150" }, { id: "v2", title: "10", price: "$150" }]
};
const HOSTILE = "Socks $99 now 50% off 129.99";
const STAGES = ["opening", "offer", "held", "final", "pending_owner", "expired", "deal"];
const FIGURE = /\$\s*\d|%|\d{2,}|\d[.,]\d|\b(?:dollars?|bucks|percent)\b/i;

function card(overrides: Record<string, unknown> = {}) {
  return {
    negotiationId: "n1", offerId: "o1", status: "live", round: 1, maxRounds: 4, line: "Here is my offer.", mood: "tempted", badges: [], trail: [],
    option: { id: "A", kind: "final", items: [{ variantId: "v1", title: "Trail Runner 2", qty: 1 }], listTotal: 15000, total: 13500 },
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), disclosure: ["Deal agent.", "Only this card is binding."],
    ...overrides
  };
}

function mount(options: Parameters<typeof mountWidget>[0] = {}) {
  return mountWidget({ features: ["chips"], currentProduct: PRODUCT, products: [PRODUCT], ...options });
}

function withQuantity(value: string) {
  return (window: any) => {
    const input = window.document.createElement("input");
    input.name = "quantity";
    input.value = value;
    window.document.body.appendChild(input);
  };
}

function withQuantityAndStorage(value: string, chatKey: string | undefined, used: Record<string, boolean> | undefined) {
  return (window: any) => {
    withQuantity(value)(window);
    if (chatKey !== undefined) window.sessionStorage.setItem("bazaar:chat", chatKey);
    if (used) window.sessionStorage.setItem("bazaar:chips-used", JSON.stringify(used));
  };
}

function shown(document: Document) {
  return Array.from(document.querySelectorAll("[data-ai-chat-prompts] > button[data-ai-chat-prompt]")).map((button) => button.textContent || "");
}

function labels(chips: Chip[]) {
  return chips.map((chip) => chip[0]);
}

function context(overrides: Record<string, unknown> = {}) {
  return { stage: "opening", page: { pageType: "product" }, product: { ...PRODUCT, quantity: 1 }, card: null, used: [], turn: 0, voiceOn: false, ...overrides };
}

afterEach(() => { vi.useRealTimers(); });

describe("V6 suggestion chips that change", () => {
  it("shows different chips on the same product page at quantity 1, at quantity 2 and after a final offer", () => {
    const one = mount({ before: withQuantity("1") });
    const two = mount({ before: withQuantity("2") });
    const atOne = shown(one.document);
    const atTwo = shown(two.document);
    expect(atOne).toHaveLength(3);
    expect(atTwo[0]).toBe("I'm buying two");
    expect(atOne).not.toContain("I'm buying two");
    expect(atOne).not.toEqual(atTwo);

    one.chat.addOfferCard(card({ round: 4 }), []);
    const atFinal = shown(one.document);
    expect(atFinal).toHaveLength(2);
    expect(atFinal).toContain("Is that your best?");
    expect(atFinal).not.toEqual(atOne);
    expect(atFinal).not.toEqual(atTwo);
  });

  it("re-renders when the shopper changes the quantity", () => {
    const { document, window } = mount({ before: withQuantity("1") });
    expect(shown(document)).not.toContain("I'm buying two");
    const input = document.querySelector('input[name="quantity"]') as HTMLInputElement;
    input.value = "2";
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(shown(document)[0]).toBe("I'm buying two");
  });

  it("never writes a figure: every candidate, at every stage, with hostile product and cart titles", () => {
    const { chat } = mount();
    const hostileProduct = { ...PRODUCT, title: HOSTILE, type: HOSTILE, selectedVariantTitle: HOSTILE };
    const pages = [undefined, { pageType: "product" }, { pageType: "collection", collection: { title: HOSTILE } }, { pageType: "index" }, { pageType: "cart" }, { pageType: "search" }]
      .map((page) => page && { ...page, cart: { itemCount: 2, items: [{ title: HOSTILE }] } });
    const cards = [null, card(), card({ round: 4 }), card({ badges: [HOSTILE], option: { id: "B", kind: "bundle", items: [{ title: HOSTILE, qty: 1 }, { title: HOSTILE, qty: 1, thrownIn: true }], listTotal: 1, total: 1 } }), card({ option: { id: "C", kind: "else", items: [{ title: HOSTILE, qty: 1 }], listTotal: 1, total: 1 } })];
    let checked = 0;
    for (const stage of STAGES) for (const page of pages) for (const offer of cards) for (const quantity of [1, 2, 3, 40]) for (const product of [hostileProduct, null]) {
      const base = context({ stage, page, card: offer, product: product && { ...product, quantity }, suggestions: ["Take $5 off", "Could you do 20% off?", "Knock 15 off", "What goes with these?"] });
      const candidates: Chip[] = chat.chips.candidates(base).map((candidate: any) => [candidate.label, candidate.text]);
      const rendered: Chip[] = [0, 1, 2, 3, 4, 5, 6].flatMap((turn) => chat.chips.build({ ...base, turn }));
      for (const chip of candidates.concat(rendered)) {
        expect(chip[0]).not.toMatch(FIGURE);
        expect(chip[1]).not.toMatch(FIGURE);
        expect(chip[0].length).toBeLessThanOrEqual(32);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // The pool is actually exercised: every stage that should offer chips has candidates.
    for (const stage of STAGES.filter((name) => name !== "pending_owner")) expect(chat.chips.candidates(context({ stage, card: card() })).length).toBeGreaterThan(1);
  });

  it("uses the real cart item title, and a plain line when the title carries a figure", () => {
    const { chat } = mount();
    const real = chat.chips.build(context({ page: { pageType: "product", cart: { itemCount: 1, items: [{ title: "Trail Socks" }] } } }));
    expect(real.map((chip: Chip) => chip[1]).join(" ")).toContain("Trail Socks");
    const hostile = chat.chips.build(context({ page: { pageType: "product", cart: { itemCount: 1, items: [{ title: HOSTILE }] } } }));
    expect(hostile.map((chip: Chip) => chip[1]).join(" ")).toContain("in my cart");
    expect(hostile.map((chip: Chip) => chip[1]).join(" ")).not.toContain("Socks");
  });

  it("fits the page: discovery on a collection, the whole cart on the cart page", () => {
    const { chat } = mount();
    const collection = labels(chat.chips.build(context({ page: { pageType: "collection" }, product: null })));
    expect(collection).toHaveLength(3);
    expect(collection).toContain("What's good for muddy trails?");
    const cart = chat.chips.build(context({ page: { pageType: "cart", cart: { itemCount: 2 } }, product: null }));
    expect(cart[0][1]).toBe("Can you do something on my whole cart?");
  });

  it("never brings a used chip back, and rotates between turns", () => {
    const { chat } = mount();
    const seen: string[] = [];
    const used: string[] = [];
    for (let turn = 0; turn < 12; turn += 1) {
      const candidates = chat.chips.candidates(context({ stage: "offer", card: card(), used, turn }));
      const chips: Chip[] = chat.chips.build(context({ stage: "offer", card: card(), used, turn }));
      if (!chips.length) break;
      const top = must(chips[0], "chip");
      expect(seen).not.toContain(top[0]);
      seen.push(top[0]);
      used.push(must(candidates.find((candidate: any) => candidate.label === top[0]), "candidate").id);
    }
    expect(seen.length).toBeGreaterThan(4);

    const first = labels(chat.chips.build(context({ stage: "offer", card: card(), turn: 1 })));
    const second = labels(chat.chips.build(context({ stage: "offer", card: card(), turn: 2 })));
    expect(first).not.toEqual(second);
    expect(labels(chat.chips.build(context({ stage: "offer", card: card(), turn: 2 })))).toEqual(second);
  });

  it("drops a tapped chip for the rest of the conversation", async () => {
    const { document, settle } = mount({ chat: () => ({ reply: "Tell me more." }) });
    const tapped = document.querySelector("[data-ai-chat-prompts] > button") as HTMLButtonElement;
    const label = tapped.textContent;
    tapped.click();
    expect(shown(document)).not.toContain(label);
    expect(document.querySelector(".ai-chat__message--user")?.textContent).toBe(tapped.getAttribute("data-ai-chat-prompt"));
    expect(document.querySelector(".juniper-chips__ghost--sent")?.textContent).toBe(label);
    for (let turn = 0; turn < 3; turn += 1) { await settle(); expect(shown(document)).not.toContain(label); }
  });

  it("offers nothing while the owner decides, a restart when the offer ran out, and questions after a deal", () => {
    const { chat, document } = mount();
    chat.addOfferCard(card({ status: "pending_owner", round: 4 }), []);
    expect(shown(document)).toEqual([]);
    expect(chat.chips.build(context({ stage: "pending_owner", card: card() }))).toEqual([]);
    expect(labels(chat.chips.build(context({ stage: "expired", card: card() })))[0]).toBe("Can we start again?");
    chat.addOfferCard(card({ offerId: "o2", status: "expired" }), []);
    expect(shown(document)[0]).toBe("Can we start again?");
    expect(chat.chips.build(context({ stage: "deal", card: card() })).length).toBeLessThanOrEqual(2);
  });

  it("offers to skip the add-on only when the card has one", () => {
    const { chat } = mount();
    const bundle = card({ option: { id: "B", kind: "bundle", items: [{ title: "Trail Runner 2", qty: 1 }, { title: "Trail Socks", qty: 1, thrownIn: true }], listTotal: 17000, total: 15000 } });
    for (let turn = 0; turn < 5; turn += 1) {
      expect(labels(chat.chips.build(context({ stage: "offer", card: bundle, turn })))).toContain("Skip the add-on");
      expect(labels(chat.chips.build(context({ stage: "offer", card: card(), turn })))).not.toContain("Skip the add-on");
      expect(chat.chips.build(context({ stage: "offer", card: bundle, turn })).length).toBeLessThanOrEqual(4);
    }
  });

  it("leaves out a reason the card already credits", () => {
    const { chat } = mount();
    const all = (badges: string[]) => [0, 1, 2, 3, 4, 5].flatMap((turn) => labels(chat.chips.build(context({ stage: "offer", card: card({ badges }), turn }))));
    expect(all([])).toContain("It's still over my budget");
    expect(all(["for a tight budget"])).not.toContain("It's still over my budget");
  });

  it("prefers the server's suggestions once they pass the no-figure filter", async () => {
    const { document, chat, settle } = mount({ chat: () => ({ reply: "Hm.", suggestions: ["Add the gaiters", "Take $5 off", "Could you do 20% off?", 7] }) });
    chat.send("hello there");
    await settle();
    await settle();
    const now = shown(document);
    expect(now[0]).toBe("Add the gaiters");
    expect(now.join(" ")).not.toMatch(FIGURE);
    expect(now).toHaveLength(3);
  });

  it("lands new chips one by one, lets the old ones leave, and stays still when nothing changed", () => {
    vi.useFakeTimers();
    const { document, chat } = mount();
    const buttons = Array.from(document.querySelectorAll("[data-ai-chat-prompts] > button")) as HTMLElement[];
    expect(buttons.map((button) => button.style.getPropertyValue("--juniper-chip-i"))).toEqual(["0", "1", "2"]);
    expect(buttons.every((button) => button.classList.contains("juniper-chips__chip--landing"))).toBe(true);
    const before = shown(document);

    chat.addOfferCard(card(), []);
    expect(Array.from(document.querySelectorAll(".juniper-chips__ghost")).map((ghost) => ghost.textContent)).toEqual(before);
    expect(document.querySelector(".juniper-chips__ghosts")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll(".juniper-chips__ghosts button").length).toBe(0);
    vi.advanceTimersByTime(400);
    expect(document.querySelector(".juniper-chips__ghosts")).toBeNull();

    // An offer poll re-renders the same set every two seconds: nothing lands again, and focus is kept.
    const focused = document.querySelector("[data-ai-chat-prompts] > button") as HTMLElement;
    focused.focus();
    chat.renderChips([], "offer");
    const again = Array.from(document.querySelectorAll("[data-ai-chat-prompts] > button")) as HTMLElement[];
    expect(again.some((button) => button.classList.contains("juniper-chips__chip--landing"))).toBe(false);
    expect(document.querySelector(".juniper-chips__ghosts")).toBeNull();
    expect(document.activeElement?.textContent).toBe(focused.textContent);
  });

  it("reads 'Try saying' in hands-free and lights the chip being spoken", () => {
    const { document, window, chat } = mount();
    const row = document.querySelector("[data-ai-chat-prompts]") as HTMLElement;
    expect(row.hasAttribute("data-juniper-lead")).toBe(false);
    document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: true, state: "listening" } }));
    expect(row.getAttribute("data-juniper-lead")).toBe("Try saying");

    chat.addOfferCard(card(), []);
    const expected = shown(document);
    const target = expected.indexOf("I can buy right now");
    expect(target).toBeGreaterThan(-1);
    document.dispatchEvent(new window.CustomEvent("bazaar-voice:caption", { detail: { text: "um okay I can buy right", final: false } }));
    const lit = Array.from(document.querySelectorAll("[data-ai-chat-prompts] > button.is-spoken"));
    expect(lit.map((button) => button.textContent)).toEqual(["I can buy right now"]);

    document.dispatchEvent(new window.CustomEvent("bazaar-voice:caption", { detail: { text: "the weather is nice", final: false } }));
    expect(document.querySelectorAll("[data-ai-chat-prompts] > button.is-spoken").length).toBe(0);
    document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: false, state: "off" } }));
    expect(row.hasAttribute("data-juniper-lead")).toBe(false);

    expect(chat.chips.match("i can buy it right now", [["What if I add something?", "x"], ["I can buy right now", "y"]])).toBe(1);
    expect(chat.chips.match("hello", [["I can buy right now", "y"]])).toBe(-1);
  });

  it("keeps the chat working when the page object is odd", () => {
    const { chat } = mount();
    for (const page of [null, 7, "cart", { pageType: 9, cart: "full" }, { cart: { items: [null, 4, { title: null }] } }]) {
      expect(() => chat.chips.build(context({ page }))).not.toThrow();
      expect(chat.chips.build(context({ page })).length).toBeGreaterThan(0);
    }
    expect(Array.isArray(chat.chips.build({}))).toBe(true);
    expect(Array.isArray(chat.chips.build(undefined))).toBe(true);
  });

  it("does not resurrect a used chip on a carried conversation, but forgets it on a clean visit", () => {
    const carried = mount({ before: withQuantityAndStorage("2", "{\"v\":1,\"entries\":[]}", { "qty-buying": true }) });
    expect(shown(carried.document)).not.toContain("I'm buying two");

    const clean = mount({ before: withQuantityAndStorage("2", undefined, { "qty-buying": true }) });
    expect(shown(clean.document)).toContain("I'm buying two");
    // A clean visit (no bazaar:chat) drops whatever an earlier tab left in bazaar:chips-used.
    expect(clean.window.sessionStorage.getItem("bazaar:chips-used")).toBeNull();
  });

  it("writes a tapped chip's id to sessionStorage, so a full page reload cannot bring it back", () => {
    const { document, window } = mount({ chat: () => ({ reply: "Tell me more." }) });
    const tapped = document.querySelector("[data-ai-chat-prompts] > button[data-ai-chat-prompt]") as HTMLButtonElement;
    tapped.click();
    const stored = JSON.parse(window.sessionStorage.getItem("bazaar:chips-used") || "{}");
    expect(Object.keys(stored).length).toBeGreaterThan(0);
  });

  it("re-renders shortly after the chat opens, to pick up the cart once V5 fetches it asynchronously", async () => {
    vi.useFakeTimers();
    const { chat, document } = mount({ page: { pageType: "product" } });
    // Simulate V5's page object gaining a cart after the panel opens, with no event to say so.
    (chat as any).page = { pageType: "product", cart: { itemCount: 1, items: [{ title: "Trail Socks" }] } };
    (document.querySelector(".ai-chat__launcher") as HTMLButtonElement)?.click();
    await vi.advanceTimersByTimeAsync(1000);
    const texts = shown(document).join(" ");
    expect(texts).toContain("Trail Socks");
  });
});
