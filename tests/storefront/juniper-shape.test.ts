import { describe, expect, it } from "vitest";
import { mountWidget, must } from "./widget.ts";

function mount(saved?: string) {
  const mounted = mountWidget({
    features: ["shape"],
    chat: () => ({ reply: "I can do a little better on those." }),
    before: (window) => {
      window.matchMedia = () => ({ matches: true });
      if (saved) window.localStorage.setItem("bazaar:shape", saved);
    },
  });
  const widget = mounted.chat.elements.widget as HTMLElement;
  const find = (selector: string) => must(widget.querySelector(selector), selector) as HTMLElement;
  return { ...mounted, widget, find };
}

describe("V12 — the chat keeps its shape out of the conversation's way", () => {
  it("resizes from the keyboard, clamps to the window, remembers the size and resets", () => {
    const { chat, widget, find, window } = mount();
    chat.open();
    chat.shape.resize({ w: 500, h: 600 });
    expect(widget.style.getPropertyValue("--juniper-shape-w")).toBe("500px");
    expect(JSON.parse(window.localStorage.getItem("bazaar:shape"))).toEqual({ w: 500, h: 600, x: 0, y: 0 });

    find("[data-juniper-grip]").dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(chat.shape.size().w).toBe(524);

    chat.shape.resize({ w: 50, h: 99999 });
    expect(chat.shape.size().w).toBe(300);
    expect(chat.shape.size().h).toBe(window.innerHeight - 40);

    find("[data-juniper-grip]").dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    expect(chat.shape.size()).toBeNull();
    expect(widget.style.getPropertyValue("--juniper-shape-w")).toBe("");
    expect(window.localStorage.getItem("bazaar:shape")).toBeNull();
  });

  it("never grows wider than a chat should", () => {
    const { chat, window } = mount();
    window.innerWidth = 2400;
    chat.shape.resize({ w: 1800, h: 600 });
    expect(chat.shape.size().w).toBe(560);
  });

  it("moves off the corner but never off the screen, and the launcher's corner is not what moves", () => {
    const { chat, widget, window } = mount();
    chat.open();
    chat.shape.resize({ w: 400, h: 500 });
    chat.shape.move({ x: -200, y: -100 });
    expect(chat.shape.place()).toEqual({ x: -200, y: -100 });
    expect(widget.style.getPropertyValue("--juniper-shape-x")).toBe("-200px");
    expect(JSON.parse(window.localStorage.getItem("bazaar:shape"))).toEqual({ w: 400, h: 500, x: -200, y: -100 });

    chat.shape.move({ x: 300, y: -99999 });
    expect(chat.shape.place()).toEqual({ x: 0, y: -(window.innerHeight - 40 - 500) });

    // The place rides on custom properties the panel reads; the widget itself — and so the launcher — is never moved.
    expect(widget.style.translate || "").toBe("");
    expect(widget.style.right || "").toBe("");
    chat.shape.reset();
    expect(chat.shape.place()).toEqual({ x: 0, y: 0 });
    expect(window.localStorage.getItem("bazaar:shape")).toBeNull();
  });

  it("Juniper reshapes herself for an offer and for listening, says so, and never saves it as the shopper's size", () => {
    const { chat, widget, window } = mount();
    chat.open();
    window.document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: true, state: "listening" } }));
    expect(widget.getAttribute("data-juniper-shape")).toBe("voice");
    expect(chat.shape.shapedBy()).toBe("juniper");
    expect(must(widget.querySelector(".juniper-shape__note")).textContent).toBe("Juniper drew in to listen");
    window.document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: false, state: "off" } }));
    expect(chat.shape.size()).toBeNull();
    expect(window.localStorage.getItem("bazaar:shape")).toBeNull();
  });

  it("the shopper's own size always wins over Juniper's", () => {
    const { chat, widget, window } = mount();
    chat.open();
    chat.shape.resize({ w: 420, h: 500 });
    window.document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: true, state: "listening" } }));
    expect(widget.getAttribute("data-juniper-shape")).toBeNull();
    expect(chat.shape.size()).toEqual({ w: 420, h: 500 });
    expect(chat.shape.shapedBy()).toBe("shopper");
  });

  it("opens at the size this browser remembered", () => {
    const { widget } = mount(JSON.stringify({ w: 480, h: 520 }));
    expect(widget.style.getPropertyValue("--juniper-shape-h")).toBe("520px");
  });

  it("the size button goes roomy and back", () => {
    const { chat, find } = mount();
    const button = find("[data-juniper-size]");
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(chat.shape.size().w).toBeGreaterThan(404);
    button.click();
    expect(chat.shape.size()).toBeNull();
  });

  it("the header's way out minimises: the chat closes and the conversation is kept", () => {
    const { chat, find } = mount();
    chat.open();
    chat.addMessage("Still here.", "bot");
    const out = find("[data-ai-chat-close]");
    expect(out.getAttribute("aria-label")).toMatch(/^Minimise/);
    out.click();
    expect(chat.isOpen()).toBe(false);
    expect(must(chat.elements.messages as HTMLElement).textContent).toContain("Still here.");
  });

  it("a reply that lands while minimised peeks and leaves a dot; opening clears both", async () => {
    const { chat, find, settle } = mount();
    chat.open();
    chat.close();
    chat.send("Can you do better?");
    await settle();
    const peek = find("[data-juniper-peek]");
    expect(peek.hidden).toBe(false);
    expect(peek.textContent).toBe("I can do a little better on those.");
    expect(find("[data-juniper-unread]").hidden).toBe(false);
    peek.click();
    expect(chat.isOpen()).toBe(true);
    expect(peek.hidden).toBe(true);
    expect(find("[data-juniper-unread]").hidden).toBe(true);
  });

  it("closed, the conversation is still read: the shopper's words as they are heard, then her answer", async () => {
    const { chat, find, window, settle } = mount();
    const peek = find("[data-juniper-peek]");
    window.document.dispatchEvent(new window.CustomEvent("bazaar-voice:caption", { detail: { text: "could you do one", final: false } }));
    expect(peek.hidden).toBe(false);
    expect(peek.getAttribute("data-juniper-peek")).toBe("you");
    expect(peek.textContent).toBe("could you do one");
    expect(find("[data-juniper-unread]").hidden).toBe(true);
    chat.send("could you do one twenty");
    expect(peek.textContent).toBe("could you do one twenty");
    await settle();
    expect(peek.getAttribute("data-juniper-peek")).toBe("juniper");
    expect(peek.textContent).toBe("I can do a little better on those.");
    expect(chat.isOpen()).toBe(false);
  });

  it("a reply while the chat is open does not peek", async () => {
    const { chat, find, settle } = mount();
    chat.open();
    chat.send("Can you do better?");
    await settle();
    expect(find("[data-juniper-peek]").hidden).toBe(true);
  });

  it("puts the suggestions on a rail with a more button", () => {
    const { chat, find } = mount();
    const row = must(chat.elements.chips as HTMLElement);
    expect(row.classList.contains("juniper-shape__rail")).toBe(true);
    expect(must(row.parentElement).classList.contains("juniper-shape__rail-host")).toBe(true);
    expect(find("[data-juniper-more]").getAttribute("aria-label")).toBe("More suggestions");
  });
});
