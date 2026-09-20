import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mountWidget, type MountOptions } from "./widget.ts";

// A stand-in for Chrome's SpeechRecognition: it records what the feature asks of it and lets the test play the shopper.
type FakeRecognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  calls: string[];
  onstart?: () => void; onresult?: (event: unknown) => void; onend?: () => void; onerror?: (event: unknown) => void;
  hear: (...parts: (string | [string, boolean])[]) => void;
  end: () => void;
  started: () => void;
  fail: (error: string) => void;
};

function fakeSpeech(options: { startThrows?: boolean | (() => boolean) } = {}) {
  const instances: FakeRecognition[] = [];
  function Recognition(this: FakeRecognition) {
    const self = this;
    self.calls = [];
    (self as any).start = () => { self.calls.push("start"); if (typeof options.startThrows === "function" ? options.startThrows() : options.startThrows) throw new Error("not-allowed"); };
    (self as any).stop = () => { self.calls.push("stop"); };
    (self as any).abort = () => { self.calls.push("abort"); };
    // Each part is one SpeechRecognitionResult: a string is interim, [text, true] is final.
    self.hear = (...parts) => {
      const results = parts.map((part) => {
        const [transcript, isFinal] = typeof part === "string" ? [part, false] : part;
        return Object.assign([{ transcript }], { isFinal });
      });
      self.onresult?.({ resultIndex: 0, results });
    };
    self.end = () => self.onend?.();
    self.started = () => self.onstart?.();
    self.fail = (error) => { self.onerror?.({ error }); self.onend?.(); };
    instances.push(self);
  }
  const running = () => instances.filter((instance) => instance.calls.includes("start") && !instance.calls.includes("abort") && !instance.calls.includes("stop"));
  return { Recognition, instances, running, latest: () => instances[instances.length - 1] };
}

function mount(speech: ReturnType<typeof fakeSpeech> | null, options: MountOptions = {}) {
  const captions: { text: string; final: boolean }[] = [];
  const states: { on: boolean; state: string }[] = [];
  // Reply audio cannot play in jsdom, so the speaking tests fire the seam's events at the feature's own listeners.
  const listeners: Record<string, ((detail?: unknown) => void)[]> = {};
  const emit = (name: string, detail?: unknown) => (listeners[name] || []).forEach((fn) => fn(detail));
  const mounted = mountWidget({
    features: ["handsfree"],
    ...options,
    before: (window) => {
      // jsdom keeps its own clock; hand it vitest's so the 1200 ms turn end and the restart back-off can be driven.
      window.setTimeout = (fn: () => void, ms?: number) => setTimeout(fn, ms);
      window.clearTimeout = (id: any) => clearTimeout(id);
      window.Date = Date;
      if (speech) window.webkitSpeechRecognition = speech.Recognition;
      window.document.addEventListener("bazaar-chat:ready", () => {
        const on = window.BazaarChat.on;
        window.BazaarChat.on = (name: string, fn: (detail?: unknown) => void) => { (listeners[name] = listeners[name] || []).push(fn); return on(name, fn); };
      });
      window.document.addEventListener("bazaar-voice:caption", (event: any) => captions.push(event.detail));
      window.document.addEventListener("bazaar-voice:state", (event: any) => states.push(event.detail));
      options.before?.(window);
    },
  });
  const chatRequests = () => mounted.requests.filter((request) => request.path === "/api/chat");
  const button = () => mounted.document.querySelector<HTMLButtonElement>(".juniper-handsfree__toggle");
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  return { ...mounted, captions, states, chatRequests, button, tick, emit };
}

describe("juniper-handsfree — V1 hands-free conversation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("completes a scripted two-turn haggle with no click after the first", async () => {
    const speech = fakeSpeech();
    const { chat, button, chatRequests, states, tick } = mount(speech, { chat: (payload) => ({ reply: `Heard: ${payload.message ?? payload.text ?? ""}` }) });
    const speakEnds: unknown[] = [];
    chat.on("speak:end", (detail: unknown) => speakEnds.push(detail));

    button()!.click();
    const first = speech.latest();
    expect(first.calls).toEqual(["start"]);
    expect([first.continuous, first.interimResults, first.lang]).toEqual([true, true, "en-US"]);
    expect(states[states.length - 1]).toEqual({ on: true, state: "listening" });

    first.hear("could you do");
    expect(states[states.length - 1].state).toBe("hearing");
    await tick(1000);
    first.hear(["Could you do better on two pairs?", true]);
    await tick(1199);
    expect(chatRequests()).toHaveLength(0);
    await tick(1);
    expect(chatRequests()).toHaveLength(1);
    expect(JSON.stringify(chatRequests()[0].body)).toContain("Could you do better on two pairs?");
    expect(first.calls).toContain("abort");
    expect(states.map((entry) => entry.state)).toContain("thinking");

    await tick(0);
    expect(speakEnds).toHaveLength(1);
    const second = speech.latest();
    expect(second).not.toBe(first);
    expect(second.calls).toEqual(["start"]);
    expect(states[states.length - 1]).toEqual({ on: true, state: "listening" });

    second.hear(["What about a student discount?", true]);
    await tick(1200);
    expect(chatRequests()).toHaveLength(2);
    expect(JSON.stringify(chatRequests()[1].body)).toContain("What about a student discount?");
    await tick(0);
    expect(speech.running()).toHaveLength(1);
  });

  it("injects nothing and leaves push-to-talk alone when SpeechRecognition is absent", () => {
    const { document, chat } = mount(null);
    const mic = document.querySelector("[data-ai-chat-mic]")!;
    expect(document.querySelector("[class*='juniper-handsfree']")).toBeNull();
    expect(mic.outerHTML).toContain('aria-label="Talk instead of typing"');
    expect(mic.parentElement).toBe(document.querySelector("[data-ai-chat-form]"));
    expect(chat.handsfree.isOn()).toBe(false);
    expect(chat.handsfree.start()).toBe(false);
  });

  it("shows the shopper's words as a live caption and emits them", () => {
    const speech = fakeSpeech();
    const { document, button, captions } = mount(speech);
    button()!.click();
    speech.latest().hear("two pairs");
    expect(captions[captions.length - 1]).toEqual({ text: "two pairs", final: false });
    speech.latest().hear(["Two pairs.", true], "for sixty");
    expect(captions[captions.length - 1]).toEqual({ text: "Two pairs. for sixty", final: false });
    speech.latest().hear(["Two pairs.", true], ["For sixty?", true]);
    expect(captions[captions.length - 1]).toEqual({ text: "Two pairs. For sixty?", final: true });
    expect(document.querySelector(".juniper-handsfree__caption")!.textContent).toBe("Two pairs. For sixty?");
    expect(document.querySelector(".juniper-handsfree__state")!.textContent).toBe("Hearing you");
  });

  it("ignores a whitespace transcript", async () => {
    const speech = fakeSpeech();
    const { button, chatRequests, tick } = mount(speech);
    button()!.click();
    speech.latest().hear(["   ", true]);
    await tick(3000);
    expect(chatRequests()).toHaveLength(0);
  });

  it("asks for spoken replies once, on start, and does not repeat the ask on every turn", async () => {
    const speech = fakeSpeech();
    const { chat, button, tick, emit } = mount(speech, { chat: () => ({ reply: "Noted." }) });
    const calls: boolean[] = [];
    const real = chat.setSpokenReplies;
    chat.setSpokenReplies = (value: boolean) => { calls.push(value); return real(value); };
    button()!.click();
    expect(calls).toEqual([true]);
    emit("turn:start", { text: "hi" });
    speech.latest().hear(["Any deal?", true]);
    await tick(1200);
    expect(calls).toEqual([true]); // the seam's own wish now sticks; asking again on every turn is dead weight
  });

  it("does not fight chat-demo's own mood reset while it is listening or hearing", () => {
    const speech = fakeSpeech();
    const { chat, button } = mount(speech);
    button()!.click();
    expect(chat.state().mood).toBe("listening");
    // chat-demo.js resets an idle-eligible mood back to idle whenever it re-syncs its voice controls
    // (loadVoiceConfig resolving, the mic/voice buttons, setLoading...). Hands-free must put it back while
    // the mic is open, or Juniper's face goes blank mid-turn for a reason the shopper never caused.
    chat.setMood("idle");
    expect(chat.state().mood).toBe("listening");
    speech.latest().hear("two pairs");
    expect(chat.state().mood).toBe("listening");
    chat.setMood("idle");
    expect(chat.state().mood).toBe("listening");
  });

  it("says once where the audio goes and how to stop", () => {
    const speech = fakeSpeech();
    const { document, button } = mount(speech);
    const lines = () => Array.from(document.querySelectorAll(".ai-chat__message--bot")).filter((node) => /Chrome/.test(node.textContent || ""));
    button()!.click();
    expect(lines()).toHaveLength(1);
    expect(lines()[0].textContent).toMatch(/Esc/);
    button()!.click();
    button()!.click();
    expect(lines()).toHaveLength(1);
  });

  it("keeps a turn that could not be sent and sends it once the chat is free", async () => {
    const speech = fakeSpeech();
    const { chat, button, chatRequests, tick } = mount(speech);
    const send = chat.send;
    let refusals = 1;
    chat.send = (text: string) => (refusals-- > 0 ? false : send(text));
    button()!.click();
    speech.latest().hear(["And free socks?", true]);
    await tick(1200);
    expect(chatRequests()).toHaveLength(0);
    await tick(300);
    expect(chatRequests()).toHaveLength(1);
    expect(JSON.stringify(chatRequests()[0].body)).toContain("And free socks?");
  });

  it("restarts recognition when Chrome ends it, and backs off when it ends at once three times running", async () => {
    const speech = fakeSpeech();
    const { button, tick } = mount(speech);
    button()!.click();
    await tick(5000);
    speech.latest().end();
    expect(speech.instances).toHaveLength(2);
    expect(speech.latest().calls).toEqual(["start"]);

    speech.latest().end();
    speech.latest().end();
    expect(speech.instances).toHaveLength(4);
    speech.latest().end();
    expect(speech.instances).toHaveLength(4);
    await tick(1000);
    expect(speech.instances).toHaveLength(5);
  });

  it("carries the words heard so far across a restart in the middle of a turn", async () => {
    const speech = fakeSpeech();
    const { button, chatRequests, tick } = mount(speech);
    button()!.click();
    await tick(5000);
    speech.latest().hear(["I'm buying two,", true]);
    speech.latest().end();
    speech.latest().hear(["so what can you do?", true]);
    await tick(1200);
    expect(JSON.stringify(chatRequests()[0].body)).toContain("I'm buying two, so what can you do?");
  });

  it("restores hands-free on load when the session flag is set, without a click or a second notice", () => {
    const speech = fakeSpeech();
    const { chat, document, window } = mount(speech, { before: (win) => { win.sessionStorage.setItem("bazaar:handsfree", "1"); win.sessionStorage.setItem("bazaar:handsfree:told", "1"); } });
    expect(chat.handsfree.isOn()).toBe(true);
    expect(speech.latest().calls).toEqual(["start"]);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBe("1");
    expect(Array.from(document.querySelectorAll(".ai-chat__message--bot")).some((node) => /Chrome/.test(node.textContent || ""))).toBe(false);
  });

  it("falls back to off quietly when the restored start is refused", () => {
    const thrown = fakeSpeech({ startThrows: true });
    const first = mount(thrown, { before: (win) => win.sessionStorage.setItem("bazaar:handsfree", "1") });
    expect(first.chat.handsfree.isOn()).toBe(false);
    expect(first.window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();

    const refused = fakeSpeech();
    const second = mount(refused, { before: (win) => win.sessionStorage.setItem("bazaar:handsfree", "1") });
    const before = second.document.querySelectorAll(".ai-chat__message--bot").length;
    refused.latest().fail("not-allowed");
    expect(second.chat.handsfree.isOn()).toBe(false);
    expect(second.document.querySelectorAll(".ai-chat__message--bot").length).toBe(before);
    expect(refused.instances).toHaveLength(1);
  });

  it("turns itself off and says why when the microphone is refused after a click", () => {
    const speech = fakeSpeech();
    const { chat, document, button, states, window } = mount(speech);
    button()!.click();
    speech.latest().fail("not-allowed");
    expect(chat.handsfree.isOn()).toBe(false);
    expect(states[states.length - 1]).toEqual({ on: false, state: "off" });
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();
    expect(speech.instances).toHaveLength(1);
    const lines = Array.from(document.querySelectorAll(".ai-chat__message--bot")).map((node) => node.textContent || "");
    expect(lines[lines.length - 1]).toMatch(/microphone/i);
    expect(button()!.getAttribute("aria-pressed")).toBe("false");
  });

  it("stays on when the panel closes, and turns off on the button or stop()", () => {
    const speech = fakeSpeech();
    const { chat, button, window } = mount(speech);
    button()!.click();
    expect(chat.isOpen()).toBe(true);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBe("1");
    chat.close();
    expect(chat.handsfree.isOn()).toBe(true);
    expect(speech.running()).toHaveLength(1);
    button()!.click();
    expect(chat.handsfree.isOn()).toBe(false);
    expect(speech.running()).toHaveLength(0);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();
  });

  it("opens the panel on start() only when no pill is there to show the state", () => {
    const bare = mount(fakeSpeech());
    bare.chat.handsfree.start();
    expect(bare.chat.isOpen()).toBe(true);

    const withPill = mount(fakeSpeech(), { before: (win) => {
      const pill = win.document.createElement("div");
      pill.setAttribute("data-juniper-pill", "");
      win.document.querySelector(".ai-chat").appendChild(pill);
    } });
    withPill.chat.handsfree.start();
    expect(withPill.chat.isOpen()).toBe(false);
    expect(withPill.chat.handsfree.isOn()).toBe(true);
  });

  describe("with the autoListen flag set to always", () => {
    const always = (extra?: (win: any) => void) => ({ before: (win: any) => { win.BazaarChatFlags = { autoListen: "always" }; extra?.(win); } });
    const addPill = (win: any) => {
      const pill = win.document.createElement("div");
      pill.setAttribute("data-juniper-pill", "");
      win.document.querySelector(".ai-chat").appendChild(pill);
    };
    const notices = (document: Document) => Array.from(document.querySelectorAll(".ai-chat__message--bot")).filter((node) => /Chrome/.test(node.textContent || ""));

    it("starts listening on load with no click, leaves the panel closed beside a pill, and gives the notice once it really starts", () => {
      const speech = fakeSpeech();
      const { chat, document, states, window } = mount(speech, always(addPill));
      expect(chat.handsfree.isOn()).toBe(true);
      expect(speech.latest().calls).toEqual(["start"]);
      expect(chat.isOpen()).toBe(false);
      expect(states[states.length - 1]).toEqual({ on: true, state: "listening" });
      expect(window.sessionStorage.getItem("bazaar:handsfree")).toBe("1");
      expect(notices(document)).toHaveLength(0);
      speech.latest().started();
      expect(notices(document)).toHaveLength(1);
    });

    it("opens the panel when there is no pill to show the state", async () => {
      const { chat, tick } = mount(fakeSpeech(), always());
      await tick(0);
      expect(chat.isOpen()).toBe(true);
    });

    it("waits a tick for a pill from a feature script that has not run yet, so it does not open beside it", async () => {
      // juniper-motion.js is listed after juniper-handsfree.js in theme.liquid: on a real page its pill does not
      // exist the instant our script runs. Simulate that by adding the pill one tick after mount, not before.
      const speech = fakeSpeech();
      const { chat, document, tick } = mount(speech, always());
      expect(chat.isOpen()).toBe(false); // no decision made yet
      const pill = document.createElement("div");
      pill.setAttribute("data-juniper-pill", "");
      document.querySelector(".ai-chat")!.appendChild(pill);
      await tick(0);
      expect(chat.isOpen()).toBe(false);
    });

    it("does nothing by itself for any other flag value", () => {
      for (const value of [undefined, "keyword", "never", true]) {
        const speech = fakeSpeech();
        const { chat } = mount(speech, { before: (win) => { win.BazaarChatFlags = { autoListen: value }; } });
        expect(chat.handsfree.isOn()).toBe(false);
        expect(speech.instances).toHaveLength(0);
      }
    });

    it("falls back without a word when the browser refuses, and tries once more on the first gesture", () => {
      const speech = fakeSpeech();
      const { chat, document, window, button } = mount(speech, always(addPill));
      const bubbles = document.querySelectorAll(".ai-chat__message--bot").length;
      speech.latest().fail("not-allowed");
      expect(chat.handsfree.isOn()).toBe(false);
      expect(document.querySelectorAll(".ai-chat__message--bot").length).toBe(bubbles);
      expect(button()!.getAttribute("aria-pressed")).toBe("false");
      expect(window.sessionStorage.getItem("bazaar:handsfree:off")).toBeNull();
      expect(speech.instances).toHaveLength(1);

      document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      expect(speech.instances).toHaveLength(2);
      expect(chat.handsfree.isOn()).toBe(true);

      // Refused again: no third try, and still not a word about it.
      speech.latest().fail("service-not-allowed");
      document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
      expect(speech.instances).toHaveLength(2);
      expect(document.querySelectorAll(".ai-chat__message--bot").length).toBe(bubbles);
    });

    it("retries on a first key press when start() throws on load", () => {
      let refuse = true;
      const speech = fakeSpeech({ startThrows: () => refuse });
      const { chat, document, window } = mount(speech, always(addPill));
      expect(chat.handsfree.isOn()).toBe(false);
      refuse = false;
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(chat.handsfree.isOn()).toBe(true);
      speech.latest().started();
      expect(notices(document)).toHaveLength(1);
    });

    it("leaves a first gesture on the Talk to Juniper button to the button", () => {
      const speech = fakeSpeech();
      const { chat, window, button } = mount(speech, always(addPill));
      speech.latest().fail("not-allowed");
      button()!.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      button()!.click();
      expect(chat.handsfree.isOn()).toBe(true);
      expect(speech.instances).toHaveLength(2);
    });

    it("remembers for the session that the shopper turned it off", () => {
      const speech = fakeSpeech();
      const first = mount(speech, always(addPill));
      first.button()!.click();
      expect(first.chat.handsfree.isOn()).toBe(false);
      expect(first.window.sessionStorage.getItem("bazaar:handsfree:off")).toBe("1");

      const later = fakeSpeech();
      const next = mount(later, always((win) => { addPill(win); win.sessionStorage.setItem("bazaar:handsfree:off", "1"); }));
      expect(next.chat.handsfree.isOn()).toBe(false);
      expect(later.instances).toHaveLength(0);
      next.document.body.dispatchEvent(new next.window.Event("pointerdown", { bubbles: true }));
      expect(later.instances).toHaveLength(0);

      // Asking for it again lifts the opt-out.
      next.button()!.click();
      expect(next.chat.handsfree.isOn()).toBe(true);
      expect(next.window.sessionStorage.getItem("bazaar:handsfree:off")).toBeNull();
    });

    it("does not send fewer than three words before the conversation has started, and sends anything after", async () => {
      const speech = fakeSpeech();
      const { chat, chatRequests, tick } = mount(speech, always(addPill));
      speech.latest().hear(["Excuse me", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(0);
      expect(chat.handsfree.isOn()).toBe(true);
      expect(speech.running()).toHaveLength(1);

      // The dropped words are gone: they do not pad out the next utterance.
      speech.latest().hear(["Over here", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(0);

      speech.latest().hear(["Any deal on these?", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(1);
      await tick(0);
      speech.latest().hear(["Sixty?", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(2);
    });

    it("sends a short first utterance when hands-free is not in always mode", async () => {
      const speech = fakeSpeech();
      const { button, chatRequests, tick } = mount(speech);
      button()!.click();
      speech.latest().hear(["Sixty?", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(1);
    });
  });

  describe("the push-to-talk record button", () => {
    const withStyles = (win: any) => {
      const style = win.document.createElement("style");
      style.textContent = readFileSync(new URL("../../apps/storefront/assets/juniper-handsfree.css", import.meta.url), "utf8");
      win.document.head.appendChild(style);
    };
    // chat-demo.js hides the button itself until the voice config says recording is available; pretend it has.
    const shown = (document: Document) => { const mic = document.querySelector<HTMLElement>("[data-ai-chat-mic]")!; mic.hidden = false; return mic; };

    it("is hidden while hands-free is supported, and the speaker toggle stays", () => {
      const { chat, document, window } = mount(fakeSpeech(), { before: withStyles });
      expect(chat.elements.widget.classList.contains("juniper-handsfree--supported")).toBe(true);
      expect(window.getComputedStyle(shown(document)).display).toBe("none");
      const speaker = document.querySelector<HTMLElement>("[data-ai-chat-voice-toggle]")!;
      speaker.hidden = false;
      expect(window.getComputedStyle(speaker).display).not.toBe("none");
    });

    it("stays as it is without SpeechRecognition", () => {
      const { chat, document, window } = mount(null, { before: withStyles });
      expect(chat.elements.widget.classList.contains("juniper-handsfree--supported")).toBe(false);
      expect(window.getComputedStyle(shown(document)).display).not.toBe("none");
    });
  });

  describe("while Juniper is speaking", () => {
    function speaking(flags?: Record<string, unknown>) {
      const speech = fakeSpeech();
      const mounted = mount(speech, { before: (win) => { if (flags) win.BazaarChatFlags = flags; } });
      const stopSpeaking = vi.fn(() => mounted.emit("speak:end", { spoken: true }));
      mounted.chat.stopSpeaking = stopSpeaking;
      mounted.button()!.click();
      return { ...mounted, speech, stopSpeaking };
    }

    it("pauses recognition for her turn, and Esc or the bar's stop cuts her off and reopens the mic", () => {
      const { chat, document, window, speech, states, stopSpeaking, emit } = speaking();
      emit("turn:start", { text: "hi" });
      expect(speech.running()).toHaveLength(0);
      emit("speak:start", { text: "Hello." });
      expect(states[states.length - 1]).toEqual({ on: true, state: "speaking" });
      expect(speech.running()).toHaveLength(0);

      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(stopSpeaking).toHaveBeenCalledTimes(1);
      expect(chat.isOpen()).toBe(true);
      expect(chat.handsfree.isOn()).toBe(true);
      expect(states[states.length - 1]).toEqual({ on: true, state: "listening" });
      expect(speech.running()).toHaveLength(1);

      emit("turn:start", { text: "again" });
      emit("speak:start", { text: "Hello again." });
      document.querySelector<HTMLButtonElement>(".juniper-handsfree__stop")!.click();
      expect(stopSpeaking).toHaveBeenCalledTimes(2);
      expect(speech.running()).toHaveLength(1);
    });

    it("keeps the mic shut while she speaks when the spoken-stop flag is off", () => {
      const { speech, emit } = speaking();
      emit("turn:start", { text: "hi" });
      emit("speak:start", { text: "Here is a long answer." });
      expect(speech.running()).toHaveLength(0);
    });

    it("hears a spoken stop behind the flag, and throws that text away", async () => {
      const { speech, stopSpeaking, chatRequests, tick, emit } = speaking({ spokenStop: true });
      emit("turn:start", { text: "hi" });
      emit("speak:start", { text: "Here is a long answer." });
      expect(speech.running()).toHaveLength(1);
      speech.latest().hear("here is a long");
      expect(stopSpeaking).not.toHaveBeenCalled();
      speech.latest().hear("hold on a second");
      expect(stopSpeaking).toHaveBeenCalledTimes(1);
      await tick(3000);
      expect(chatRequests()).toHaveLength(0);
      expect(speech.running()).toHaveLength(1);
    });
  });
});
