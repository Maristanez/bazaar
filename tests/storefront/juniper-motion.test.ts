import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { mountWidget } from "./widget.ts";

const css = readFileSync(fileURLToPath(new URL("../../apps/storefront/assets/juniper-motion.css", import.meta.url)), "utf8");

function mount(before?: (window: any) => void) {
  const mounted = mountWidget({ features: ["motion"], before });
  const { window, document, chat } = mounted;
  const voice = (on: boolean, state: string) => document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on, state } }));
  const caption = (text: string, final = false) => document.dispatchEvent(new window.CustomEvent("bazaar-voice:caption", { detail: { text, final } }));
  const pill = () => document.querySelector("[data-juniper-pill]") as HTMLElement;
  const text = () => (document.querySelector("[data-juniper-pill-text]") as HTMLElement).textContent;
  return { ...mounted, voice, caption, pill, text, launcher: chat.elements.launcher as HTMLElement };
}

describe("juniper-motion — the voice pill", () => {
  it("shows the pill only while the chat is closed and hands-free is on", () => {
    const { chat, voice, pill, launcher } = mount();
    expect(pill().hidden).toBe(true);
    expect(launcher.hidden).toBe(false);

    chat.open();
    voice(true, "listening");
    expect(pill().hidden).toBe(true);

    chat.close();
    expect(pill().hidden).toBe(false);
    expect(launcher.hidden).toBe(true);

    chat.open();
    expect(pill().hidden).toBe(true);

    chat.close();
    voice(false, "off");
    expect(pill().hidden).toBe(true);
    expect(launcher.hidden).toBe(false);
  });

  it("keeps Juniper talking through a close only while hands-free is on", () => {
    const { chat, voice } = mount();
    expect(chat.flags.voiceStaysOnClose).toBe(false);
    voice(true, "listening");
    expect(chat.flags.voiceStaysOnClose).toBe(true);
    voice(false, "off");
    expect(chat.flags.voiceStaysOnClose).toBe(false);
  });

  it("picks up hands-free that was already on before this file loaded", () => {
    const { pill, chat } = mount((window) => {
      window.document.addEventListener("bazaar-chat:ready", () => { window.BazaarChat.handsfree = { start() {}, stop() {}, isOn: () => true }; });
    });
    expect(pill().hidden).toBe(false);
    expect(chat.flags.voiceStaysOnClose).toBe(true);
  });

  it("says the state, and the shopper's latest words while they speak", () => {
    const { voice, caption, text, pill } = mount();
    voice(true, "listening");
    expect(text()).toBe("Listening");
    expect(pill().getAttribute("data-state")).toBe("listening");

    voice(true, "hearing");
    caption("would you take");
    expect(text()).toBe("would you take");
    caption("would you take less for two pairs", true);
    expect(text()).toBe("would you take less for two pairs");

    voice(true, "thinking");
    expect(text()).toBe("Thinking");
    voice(true, "speaking");
    expect(text()).toBe("Juniper is speaking");
    voice(true, "listening");
    expect(text()).toBe("Listening");
  });

  it("hands a normal-length caption to the text box whole, so the CSS ellipsis — not a character guess — decides what's visible", () => {
    const { voice, caption, text } = mount();
    voice(true, "hearing");
    const said = "I have been looking at these shoes for a long while now and I wondered about the gaiters";
    caption(said);
    expect(text()).toBe(said);
  });

  it("bounds an extreme caption, but still keeps its true final words", () => {
    const { voice, caption, text } = mount();
    voice(true, "hearing");
    caption("word ".repeat(200) + "and that is the real end of it");
    expect(text()!.length).toBeLessThanOrEqual(400);
    expect(text()!.endsWith("and that is the real end of it")).toBe(true);
  });

  it("is labelled and focusable, and leaves announcements to the panel", () => {
    const { voice, pill, document } = mount();
    voice(true, "listening");
    const open = pill().querySelector("[data-juniper-pill-open]") as HTMLButtonElement;
    const stop = pill().querySelector("[data-juniper-pill-stop]") as HTMLButtonElement;
    expect(open.tagName).toBe("BUTTON");
    expect(open.getAttribute("aria-label")).toMatch(/open the chat/i);
    expect(stop.getAttribute("aria-label")).toBeTruthy();
    expect(pill().getAttribute("aria-label")).toBeTruthy();
    expect(document.querySelector("[data-juniper-pill-text]")!.getAttribute("aria-live")).toBe("off");
    expect(pill().querySelector("svg")).not.toBeNull();
  });

  it("follows Juniper's mood", () => {
    const { chat, voice, pill, document } = mount();
    voice(true, "listening");
    const idle = pill().querySelector("[data-juniper-pill-head]")!.innerHTML;
    chat.setMood("pleased");
    const pleased = pill().querySelector("[data-juniper-pill-head]")!.innerHTML;
    expect(pleased).not.toBe(idle);
    expect(pleased).toBe(document.querySelector('[data-ai-chat-sticker="head"]')!.innerHTML);
  });

  it("stops hands-free from the stop control without opening the chat", () => {
    const stop = vi.fn();
    const { chat, voice, pill } = mount();
    chat.handsfree = { start() {}, stop, isOn: () => true };
    voice(true, "listening");
    (pill().querySelector("[data-juniper-pill-stop]") as HTMLElement).click();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(chat.isOpen()).toBe(false);
  });

  it("returns the launcher when stop is pressed and nobody owns hands-free", () => {
    const { voice, pill, launcher } = mount();
    voice(true, "listening");
    (pill().querySelector("[data-juniper-pill-stop]") as HTMLElement).click();
    expect(pill().hidden).toBe(true);
    expect(launcher.hidden).toBe(false);
  });

  it("opens the chat when the pill is clicked", () => {
    const { chat, voice, pill, launcher } = mount();
    voice(true, "listening");
    pill().click();
    expect(chat.isOpen()).toBe(true);
    expect(pill().hidden).toBe(true);
    expect(launcher.hidden).toBe(false);
  });

  it("does nothing, and breaks nothing, without the seam", () => {
    const { window } = mountWidget();
    delete window.BazaarChat;
    expect(() => window.eval(readFileSync(fileURLToPath(new URL("../../apps/storefront/assets/juniper-motion.js", import.meta.url)), "utf8"))).not.toThrow();
  });
});

describe("juniper-motion — the stylesheet", () => {
  it("animates display with @starting-style and allow-discrete", () => {
    expect(css).toContain("@starting-style");
    expect(css).toContain("allow-discrete");
  });

  it("switches instantly under reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("writes no gradient and no glass", () => {
    expect(css).not.toMatch(/gradient\(|backdrop-filter/);
  });

  it("shows the true end of a caption by clipping the front of the line, not by trusting a character count", () => {
    // direction: rtl (with text-align: left) makes the browser's own ellipsis eat the start of the line instead
    // of the end — verified in a real page: at 13rem/0.9rem/500 the box fits ~33 characters, well under the
    // 48-character budget the old code guessed, which silently hid the shopper's last few words.
    const textRule = css.slice(css.indexOf(".juniper-motion__text {"), css.indexOf(".juniper-motion__text {") + 300);
    expect(textRule).toMatch(/direction:\s*rtl/);
    expect(textRule).toMatch(/text-align:\s*left/);
  });

  it("keeps the phone panel above the launcher and pill it slides past, so a mid-transition frame never floats a launcher ghost over the panel's own footer", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
    expect(phone).toMatch(/\.ai-chat__panel\[hidden\],\s*\n\s*\.ai-chat__panel:not\(\[hidden\]\)\s*{\s*\n\s*z-index:\s*1;/);
  });
});
