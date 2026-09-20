import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget, must, type MountOptions } from "./widget.ts";

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
  return { Recognition, instances, running, latest: () => must(instances[instances.length - 1], "recognition instance") };
}

// Draining the microtask queue a handful of times settles the voice-config fetch chain (fetch -> .then -> .json()
// -> .then) without depending on vitest's fake-timer internals, which only fake macrotasks.
async function flush(times = 10) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function mount(speech: ReturnType<typeof fakeSpeech> | null, options: MountOptions = {}) {
  const captions: { text: string; final: boolean }[] = [];
  const states: { on: boolean; state: string }[] = [];
  const getUserMediaCalls: unknown[] = [];
  const mediaRecorderInstances: unknown[] = [];
  // Reply audio cannot play in jsdom, so the speaking tests fire the seam's events at the feature's own listeners.
  const listeners: Record<string, ((detail?: unknown) => void)[]> = {};
  const emit = (name: string, detail?: unknown) => (listeners[name] || []).forEach((fn) => fn(detail));
  const mounted = mountWidget({
    features: ["handsfree"],
    ...options,
    // chat-demo.js only shows and enables the mic once the server says voice is on; the real Chromium check covers
    // the browser's own gating, so these jsdom tests report voice as available, the way the scripted prototype does.
    routes: Object.assign({ "/api/voice/config": () => ({ enabled: true }) }, options.routes),
    before: (window) => {
      // jsdom keeps its own clock; hand it vitest's so the 1200 ms turn end and the restart back-off can be driven.
      window.setTimeout = (fn: () => void, ms?: number) => setTimeout(fn, ms);
      window.clearTimeout = (id: any) => clearTimeout(id);
      window.Date = Date;
      if (speech) window.webkitSpeechRecognition = speech.Recognition;
      function FakeMediaRecorder(this: unknown) { mediaRecorderInstances.push(this); }
      (FakeMediaRecorder as any).isTypeSupported = () => false;
      window.MediaRecorder = FakeMediaRecorder;
      window.navigator.mediaDevices = {
        getUserMedia: (constraints: unknown) => { getUserMediaCalls.push(constraints); return new Promise(() => {}); },
      };
      window.document.addEventListener("bazaar-chat:ready", () => {
        const on = window.BazaarChat.on;
        window.BazaarChat.on = (name: string, fn: (detail?: unknown) => void) => { (listeners[name] = listeners[name] || []).push(fn); return on(name, fn); };
      });
      window.document.addEventListener("bazaar-voice:caption", (event: any) => captions.push(event.detail));
      window.document.addEventListener("bazaar-voice:state", (event: any) => states.push(event.detail));
      options.before?.(window);
    },
  });
  await flush();
  const chatRequests = () => mounted.requests.filter((request) => request.path === "/api/chat");
  const mic = () => mounted.document.querySelector<HTMLButtonElement>("[data-ai-chat-mic]");
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  return { ...mounted, captions, states, chatRequests, mic, tick, emit, getUserMediaCalls, mediaRecorderInstances };
}

describe("juniper-handsfree — V1 hands-free conversation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("completes a scripted two-turn haggle with no click after the first", async () => {
    const speech = fakeSpeech();
    const { chat, mic, chatRequests, states, tick } = await mount(speech, { chat: (payload) => ({ reply: `Heard: ${payload.message ?? payload.text ?? ""}` }) });
    const speakEnds: unknown[] = [];
    chat.on("speak:end", (detail: unknown) => speakEnds.push(detail));

    mic()!.click();
    const first = speech.latest();
    expect(first.calls).toEqual(["start"]);
    expect([first.continuous, first.interimResults, first.lang]).toEqual([true, true, "en-US"]);
    expect(states[states.length - 1]).toEqual({ on: true, state: "listening" });

    first.hear("could you do");
    expect(must(states[states.length - 1], "state").state).toBe("hearing");
    await tick(1000);
    first.hear(["Could you do better on two pairs?", true]);
    await tick(1199);
    expect(chatRequests()).toHaveLength(0);
    await tick(1);
    expect(chatRequests()).toHaveLength(1);
    expect(JSON.stringify(must(chatRequests()[0], "chat request").body)).toContain("Could you do better on two pairs?");
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
    expect(JSON.stringify(must(chatRequests()[1], "chat request").body)).toContain("What about a student discount?");
    await tick(0);
    expect(speech.running()).toHaveLength(1);
  });

  it("leaves push-to-talk exactly as it is when SpeechRecognition is absent", async () => {
    const { document, chat, mic, getUserMediaCalls } = await mount(null);
    expect(document.querySelector("[class*='juniper-handsfree']")).toBeNull();
    const button = mic()!;
    expect(button.getAttribute("aria-label")).toBe("Talk instead of typing");
    expect(button.parentElement).toBe(document.querySelector("[data-ai-chat-form]"));
    expect(chat.handsfree.isOn()).toBe(false);
    expect(chat.handsfree.start()).toBe(false);
    // Untouched: a real click still runs chat-demo's own push-to-talk recorder.
    button.click();
    expect(getUserMediaCalls.length).toBeGreaterThan(0);
  });

  it("shows the shopper's words as a live caption and emits them", async () => {
    const speech = fakeSpeech();
    const { document, mic, captions } = await mount(speech);
    mic()!.click();
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
    const { mic, chatRequests, tick } = await mount(speech);
    mic()!.click();
    speech.latest().hear(["   ", true]);
    await tick(3000);
    expect(chatRequests()).toHaveLength(0);
  });

  it("asks for spoken replies once, on start, and does not repeat the ask on every turn", async () => {
    const speech = fakeSpeech();
    const { chat, mic, tick, emit } = await mount(speech, { chat: () => ({ reply: "Noted." }) });
    const calls: boolean[] = [];
    const real = chat.setSpokenReplies;
    chat.setSpokenReplies = (value: boolean) => { calls.push(value); return real(value); };
    mic()!.click();
    expect(calls).toEqual([true]);
    emit("turn:start", { text: "hi" });
    speech.latest().hear(["Any deal?", true]);
    await tick(1200);
    expect(calls).toEqual([true]); // the seam's own wish now sticks; asking again on every turn is dead weight
  });

  it("does not fight chat-demo's own mood reset while it is listening or hearing", async () => {
    const speech = fakeSpeech();
    const { chat, mic } = await mount(speech);
    mic()!.click();
    expect(chat.state().mood).toBe("listening");
    // chat-demo.js resets an idle-eligible mood back to idle whenever it re-syncs its voice controls
    // (loadVoiceConfig resolving, the mic/voice buttons, setLoading...). Hands-free must put it back while
    // the mic is open, or Jarvis's face goes blank mid-turn for a reason the shopper never caused.
    chat.setMood("idle");
    expect(chat.state().mood).toBe("listening");
    speech.latest().hear("two pairs");
    expect(chat.state().mood).toBe("listening");
    chat.setMood("idle");
    expect(chat.state().mood).toBe("listening");
  });

  it("says once where the audio goes and how to stop", async () => {
    const speech = fakeSpeech();
    const { document, mic } = await mount(speech);
    const lines = () => Array.from(document.querySelectorAll(".ai-chat__message--bot")).filter((node) => /Chrome/.test(node.textContent || ""));
    mic()!.click();
    expect(lines()).toHaveLength(1);
    expect(must(lines()[0], "notice line").textContent).toMatch(/Esc/);
    mic()!.click();
    mic()!.click();
    expect(lines()).toHaveLength(1);
  });

  it("keeps a turn that could not be sent and sends it once the chat is free", async () => {
    const speech = fakeSpeech();
    const { chat, mic, chatRequests, tick } = await mount(speech);
    const send = chat.send;
    let refusals = 1;
    chat.send = (text: string) => (refusals-- > 0 ? false : send(text));
    mic()!.click();
    speech.latest().hear(["And free socks?", true]);
    await tick(1200);
    expect(chatRequests()).toHaveLength(0);
    await tick(300);
    expect(chatRequests()).toHaveLength(1);
    expect(JSON.stringify(must(chatRequests()[0], "chat request").body)).toContain("And free socks?");
  });

  it("restarts recognition when Chrome ends it, and backs off when it ends at once three times running", async () => {
    const speech = fakeSpeech();
    const { mic, tick } = await mount(speech);
    mic()!.click();
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
    const { mic, chatRequests, tick } = await mount(speech);
    mic()!.click();
    await tick(5000);
    speech.latest().hear(["I'm buying two,", true]);
    speech.latest().end();
    speech.latest().hear(["so what can you do?", true]);
    await tick(1200);
    expect(JSON.stringify(must(chatRequests()[0], "chat request").body)).toContain("I'm buying two, so what can you do?");
  });

  it("restores hands-free on load when the session flag is set, without a click or a second notice", async () => {
    const speech = fakeSpeech();
    const { chat, document, window } = await mount(speech, { before: (win) => { win.sessionStorage.setItem("bazaar:handsfree", "1"); win.sessionStorage.setItem("bazaar:handsfree:told", "1"); } });
    expect(chat.handsfree.isOn()).toBe(true);
    expect(speech.latest().calls).toEqual(["start"]);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBe("1");
    expect(Array.from(document.querySelectorAll(".ai-chat__message--bot")).some((node) => /Chrome/.test(node.textContent || ""))).toBe(false);
  });

  it("falls back to off quietly when the restored start is refused", async () => {
    const thrown = fakeSpeech({ startThrows: true });
    const first = await mount(thrown, { before: (win) => win.sessionStorage.setItem("bazaar:handsfree", "1") });
    expect(first.chat.handsfree.isOn()).toBe(false);
    expect(first.window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();

    const refused = fakeSpeech();
    const second = await mount(refused, { before: (win) => win.sessionStorage.setItem("bazaar:handsfree", "1") });
    const before = second.document.querySelectorAll(".ai-chat__message--bot").length;
    refused.latest().fail("not-allowed");
    expect(second.chat.handsfree.isOn()).toBe(false);
    expect(second.document.querySelectorAll(".ai-chat__message--bot").length).toBe(before);
    expect(refused.instances).toHaveLength(1);
  });

  it("turns itself off and says why when the microphone is refused after a click", async () => {
    const speech = fakeSpeech();
    const { chat, document, mic, states, window } = await mount(speech);
    mic()!.click();
    speech.latest().fail("not-allowed");
    expect(chat.handsfree.isOn()).toBe(false);
    expect(states[states.length - 1]).toEqual({ on: false, state: "off" });
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();
    expect(speech.instances).toHaveLength(1);
    const lines = Array.from(document.querySelectorAll(".ai-chat__message--bot")).map((node) => node.textContent || "");
    expect(lines[lines.length - 1]).toMatch(/microphone/i);
    expect(mic()!.getAttribute("aria-pressed")).toBe("false");
  });

  it("stays on when the panel closes, and turns off on the mic or stop()", async () => {
    const speech = fakeSpeech();
    const { chat, mic, window } = await mount(speech);
    mic()!.click();
    expect(chat.isOpen()).toBe(true);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBe("1");
    chat.close();
    expect(chat.handsfree.isOn()).toBe(true);
    expect(speech.running()).toHaveLength(1);
    mic()!.click();
    expect(chat.handsfree.isOn()).toBe(false);
    expect(speech.running()).toHaveLength(0);
    expect(window.sessionStorage.getItem("bazaar:handsfree")).toBeNull();
  });

  it("opens the panel on start() only when no pill is there to show the state", async () => {
    const bare = await mount(fakeSpeech());
    bare.chat.handsfree.start();
    expect(bare.chat.isOpen()).toBe(true);

    const withPill = await mount(fakeSpeech(), { before: (win) => {
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

    it("starts listening on load with no click, leaves the panel closed beside a pill, and gives the notice once it really starts", async () => {
      const speech = fakeSpeech();
      const { chat, document, states, window } = await mount(speech, always(addPill));
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
      const { chat, tick } = await mount(fakeSpeech(), always());
      await tick(0);
      expect(chat.isOpen()).toBe(true);
    });

    it("waits a tick for a pill from a feature script that has not run yet, so it does not open beside it", async () => {
      // juniper-motion.js is listed after juniper-handsfree.js in theme.liquid: on a real page its pill does not
      // exist the instant our script runs. Simulate that by adding the pill one tick after mount, not before.
      const speech = fakeSpeech();
      const { chat, document, tick } = await mount(speech, always());
      expect(chat.isOpen()).toBe(false); // no decision made yet
      const pill = document.createElement("div");
      pill.setAttribute("data-juniper-pill", "");
      document.querySelector(".ai-chat")!.appendChild(pill);
      await tick(0);
      expect(chat.isOpen()).toBe(false);
    });

    it("does nothing by itself for any other flag value", async () => {
      for (const value of [undefined, "keyword", "never", true]) {
        const speech = fakeSpeech();
        const { chat } = await mount(speech, { before: (win) => { win.BazaarChatFlags = { autoListen: value }; } });
        expect(chat.handsfree.isOn()).toBe(false);
        expect(speech.instances).toHaveLength(0);
      }
    });

    it("falls back without a word when the browser refuses, and tries once more on the first gesture", async () => {
      const speech = fakeSpeech();
      const { chat, document, window, mic } = await mount(speech, always(addPill));
      const bubbles = document.querySelectorAll(".ai-chat__message--bot").length;
      speech.latest().fail("not-allowed");
      expect(chat.handsfree.isOn()).toBe(false);
      expect(document.querySelectorAll(".ai-chat__message--bot").length).toBe(bubbles);
      expect(mic()!.getAttribute("aria-pressed")).toBe("false");
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

    it("retries on a first key press when start() throws on load", async () => {
      let refuse = true;
      const speech = fakeSpeech({ startThrows: () => refuse });
      const { chat, document, window } = await mount(speech, always(addPill));
      expect(chat.handsfree.isOn()).toBe(false);
      refuse = false;
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(chat.handsfree.isOn()).toBe(true);
      speech.latest().started();
      expect(notices(document)).toHaveLength(1);
    });

    it("leaves a first gesture on the mic to the mic", async () => {
      const speech = fakeSpeech();
      const { chat, window, mic } = await mount(speech, always(addPill));
      speech.latest().fail("not-allowed");
      mic()!.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      mic()!.click();
      expect(chat.handsfree.isOn()).toBe(true);
      expect(speech.instances).toHaveLength(2);
    });

    it("remembers for the session that the shopper turned it off", async () => {
      const speech = fakeSpeech();
      const first = await mount(speech, always(addPill));
      first.mic()!.click();
      expect(first.chat.handsfree.isOn()).toBe(false);
      expect(first.window.sessionStorage.getItem("bazaar:handsfree:off")).toBe("1");

      const later = fakeSpeech();
      const next = await mount(later, always((win) => { addPill(win); win.sessionStorage.setItem("bazaar:handsfree:off", "1"); }));
      expect(next.chat.handsfree.isOn()).toBe(false);
      expect(later.instances).toHaveLength(0);
      next.document.body.dispatchEvent(new next.window.Event("pointerdown", { bubbles: true }));
      expect(later.instances).toHaveLength(0);

      // Asking for it again lifts the opt-out.
      next.mic()!.click();
      expect(next.chat.handsfree.isOn()).toBe(true);
      expect(next.window.sessionStorage.getItem("bazaar:handsfree:off")).toBeNull();
    });

    it("does not send fewer than three words before the conversation has started, and sends anything after", async () => {
      const speech = fakeSpeech();
      const { chat, chatRequests, tick } = await mount(speech, always(addPill));
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
      const { mic, chatRequests, tick } = await mount(speech);
      mic()!.click();
      speech.latest().hear(["Sixty?", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(1);
    });
  });

  describe("the theme's own mic button, taken over as the hands-free control", () => {
    it("injects no separate 'Talk to Jarvis' control — the mic itself is the only control", async () => {
      const { document } = await mount(fakeSpeech());
      expect(document.querySelector(".juniper-handsfree__toggle")).toBeNull();
      const bigControl = Array.from(document.querySelectorAll("button")).find((node) => /Talk to Jarvis/i.test(node.textContent || ""));
      expect(bigControl).toBeUndefined();
      // Only the listening bar (hidden while off) lives in hands-free's own root; no toggle button of its own.
      expect(document.querySelectorAll(".juniper-handsfree > button")).toHaveLength(0);
    });

    it("starts and stops hands-free on click, and chat-demo's own recorder never starts", async () => {
      const speech = fakeSpeech();
      const { chat, mic, getUserMediaCalls, mediaRecorderInstances } = await mount(speech);
      mic()!.click();
      expect(chat.handsfree.isOn()).toBe(true);
      expect(getUserMediaCalls).toHaveLength(0);
      expect(mediaRecorderInstances).toHaveLength(0);
      mic()!.click();
      expect(chat.handsfree.isOn()).toBe(false);
      expect(getUserMediaCalls).toHaveLength(0);
      expect(mediaRecorderInstances).toHaveLength(0);
    });

    it("shows an active state and swaps the aria label while it is on", async () => {
      const speech = fakeSpeech();
      const { mic } = await mount(speech);
      const button = mic()!;
      expect(button.classList.contains("is-recording")).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-label")).toBe("Talk to Jarvis");

      button.click();
      expect(button.classList.contains("is-recording")).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.getAttribute("aria-label")).toBe("Stop talking to Jarvis");

      button.click();
      expect(button.classList.contains("is-recording")).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-label")).toBe("Talk to Jarvis");
    });

    it("is never left disabled while a turn is in flight, though chat-demo's own sync would disable it", async () => {
      const speech = fakeSpeech();
      let resolveReply: (value: unknown) => void = () => {};
      const stuck = new Promise((resolve) => { resolveReply = resolve; });
      const { chat, mic, chatRequests, tick } = await mount(speech, { chat: () => stuck as any });
      mic()!.click();
      speech.latest().hear(["Any deal on these?", true]);
      await tick(1200);
      expect(chatRequests()).toHaveLength(1);
      expect(chat.state().sending).toBe(true); // the turn is genuinely still in flight
      expect(mic()!.disabled).toBe(false);      // yet the shopper can still stop
      expect(mic()!.getAttribute("aria-pressed")).toBe("true");
      resolveReply({ reply: "Noted." });
      await tick(0);
    });
  });

  describe("while Jarvis is speaking", () => {
    async function speaking(flags?: Record<string, unknown>) {
      const speech = fakeSpeech();
      const mounted = await mount(speech, { before: (win) => { if (flags) win.BazaarChatFlags = flags; } });
      const stopSpeaking = vi.fn(() => mounted.emit("speak:end", { spoken: true }));
      mounted.chat.stopSpeaking = stopSpeaking;
      mounted.mic()!.click();
      return { ...mounted, speech, stopSpeaking };
    }

    it("pauses recognition for her turn, and Esc or the bar's stop cuts her off and reopens the mic", async () => {
      const { chat, document, window, speech, states, stopSpeaking, emit } = await speaking();
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

    it("keeps the mic shut while she speaks when the spoken-stop flag is off", async () => {
      const { speech, emit } = await speaking();
      emit("turn:start", { text: "hi" });
      emit("speak:start", { text: "Here is a long answer." });
      expect(speech.running()).toHaveLength(0);
    });

    it("hears a spoken stop behind the flag, and throws that text away", async () => {
      const { speech, stopSpeaking, chatRequests, tick, emit } = await speaking({ spokenStop: true });
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
