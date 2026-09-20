import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget } from "./widget.ts";

const NUDGE = "Too steep? Name a price.";
const PRODUCT = { id: 1, title: "Trail Runner 2", handle: "trail-runner-2", price: "$140" };

type Observer = { callback: (entries: any[]) => void; targets: Element[] };

function mount(options: { nudged?: string | null; product?: boolean; form?: boolean } = {}) {
  const observers: Observer[] = [];
  const mounted = mountWidget({
    features: ["nudge"],
    currentProduct: options.product === false ? null : PRODUCT,
    before: (window) => {
      window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
      window.setInterval = setInterval; window.clearInterval = clearInterval;
      if (options.nudged) window.sessionStorage.setItem("bazaar:nudged", options.nudged);
      if (options.form !== false) {
        const form = window.document.createElement("div");
        form.className = "product-form";
        window.document.body.appendChild(form);
      }
      window.IntersectionObserver = function (callback: (entries: any[]) => void) {
        const record: Observer = { callback, targets: [] };
        observers.push(record);
        return { observe: (target: Element) => record.targets.push(target), disconnect() {}, unobserve() {} };
      };
    },
  });
  const launcher = mounted.chat.elements.launcher as HTMLElement;
  const label = () => launcher.querySelectorAll("span")[1].textContent;
  const seePrice = () => observers.forEach((observer) => observer.callback(observer.targets.map((target) => ({ target, isIntersecting: true }))));
  return { ...mounted, launcher, label, seePrice };
}

describe("V9 — one silent nudge per session", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows once after the dwell, restores the label, and never shows again in that session", () => {
    const first = mount();
    const original = first.label();
    const name = first.launcher.getAttribute("aria-label");
    first.seePrice();
    vi.advanceTimersByTime(19000);
    expect(first.label()).toBe(original);
    vi.advanceTimersByTime(2000);
    expect(first.label()).toBe(NUDGE);
    expect(first.launcher.hasAttribute("aria-live")).toBe(false);
    expect(first.launcher.getAttribute("aria-label")).toContain(NUDGE);
    vi.advanceTimersByTime(13000);
    expect(first.label()).toBe(original);
    expect(first.launcher.getAttribute("aria-label")).toBe(name);
    vi.advanceTimersByTime(60000);
    expect(first.label()).toBe(original);

    const second = mount({ nudged: first.window.sessionStorage.getItem("bazaar:nudged") });
    expect(second.window.sessionStorage.getItem("bazaar:nudged")).toBeTruthy();
    second.seePrice();
    vi.advanceTimersByTime(60000);
    expect(second.label()).toBe(original);
  });

  it("never shows while the chat is open, and an opened chat spends the nudge", () => {
    const { chat, label, seePrice, window } = mount();
    const original = label();
    seePrice();
    chat.open();
    vi.advanceTimersByTime(60000);
    expect(label()).toBe(original);
    chat.close();
    vi.advanceTimersByTime(60000);
    expect(label()).toBe(original);
    expect(window.sessionStorage.getItem("bazaar:nudged")).toBeTruthy();
  });

  it("goes back to the original label the moment the chat opens", () => {
    const { chat, label, seePrice } = mount();
    const original = label();
    seePrice();
    vi.advanceTimersByTime(21000);
    expect(label()).toBe(NUDGE);
    chat.open();
    expect(label()).toBe(original);
  });

  it("waits for the price to have been in view, and for the tab to be visible", () => {
    const { label, seePrice, document } = mount();
    const original = label();
    vi.advanceTimersByTime(40000);
    expect(label()).toBe(original);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    seePrice();
    vi.advanceTimersByTime(40000);
    expect(label()).toBe(original);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    vi.advanceTimersByTime(2000);
    expect(label()).toBe(NUDGE);
  });

  it("falls back to the timer alone when there is no price element to watch", () => {
    const { label } = mount({ form: false });
    vi.advanceTimersByTime(21000);
    expect(label()).toBe(NUDGE);
  });

  it("stays quiet off the product page and while hands-free is on, and never names a figure", () => {
    const off = mount({ product: false });
    const original = off.label();
    off.seePrice();
    vi.advanceTimersByTime(60000);
    expect(off.label()).toBe(original);

    const voice = mount();
    voice.seePrice();
    voice.document.dispatchEvent(new voice.window.CustomEvent("bazaar-voice:state", { detail: { on: true, state: "listening" } }));
    vi.advanceTimersByTime(60000);
    expect(voice.label()).toBe(original);
    expect(NUDGE).not.toMatch(/\d|\$/);
  });
});
