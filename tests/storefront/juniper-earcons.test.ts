import { describe, expect, it } from "vitest";
import { mountWidget, must } from "./widget.ts";

type Tone = { type: string; start: number; stop: number; peak: number };

function mount() {
  const tones: Tone[] = [];
  let contexts = 0;
  const mounted = mountWidget({
    features: ["earcons"],
    chat: () => ({ reply: "Here is what I can do." }),
    before: (window) => {
      window.AudioContext = function () {
        contexts += 1;
        return {
          currentTime: 0,
          state: "running",
          destination: {},
          resume() {},
          createOscillator() {
            const tone: Tone = { type: "sine", start: -1, stop: -1, peak: 0 };
            tones.push(tone);
            const node: any = {
              frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
              connect() {},
              start(at: number) { tone.start = at; tone.type = node.type; },
              stop(at: number) { tone.stop = at; },
              type: "sine",
            };
            node.tone = tone;
            return node;
          },
          createGain() {
            const record = (value: number) => { const tone = tones[tones.length - 1]; if (tone) tone.peak = Math.max(tone.peak, value); };
            return { gain: { setValueAtTime(value: number) { record(value); }, linearRampToValueAtTime(value: number) { record(value); } }, connect() {} };
          },
        };
      };
    },
  });
  const { window, document } = mounted;
  const voice = (on: boolean, state: string) => document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on, state } }));
  const gesture = () => document.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  const status = () => document.querySelector('[role="status"].juniper-earcons__status') as HTMLElement;
  const said: string[] = [];
  new window.MutationObserver(() => { if (status().textContent) said.push(status().textContent as string); }).observe(status(), { childList: true, characterData: true, subtree: true });
  return { ...mounted, tones, voice, gesture, status, said, contexts: () => contexts };
}

describe("V10 — earcons and the spoken voice status", () => {
  it("marks the messages as a polite log and puts one hidden status line in the widget", () => {
    const { chat, document } = mount();
    expect(chat.elements.messages.getAttribute("role")).toBe("log");
    expect(chat.elements.messages.getAttribute("aria-live")).toBe("polite");
    const lines = document.querySelectorAll('[role="status"].juniper-earcons__status');
    expect(lines.length).toBe(1);
    const line = must(lines[0], "status line");
    expect(chat.elements.widget.contains(line)).toBe(true);
    expect(line.classList.contains("visually-hidden")).toBe(true);
  });

  it('announces "Listening", "Thinking", "Jarvis is speaking" and "Voice off" in words', () => {
    const { voice, status } = mount();
    voice(true, "listening");
    expect(status().textContent).toBe("Listening");
    voice(true, "hearing");
    expect(status().textContent).toBe("Listening");
    voice(true, "thinking");
    expect(status().textContent).toBe("Thinking");
    voice(true, "speaking");
    expect(status().textContent).toBe("Jarvis is speaking");
    voice(false, "off");
    expect(status().textContent).toBe("Voice off");
  });

  it("does not repeat an announcement when hands-free and the mood say the same thing", async () => {
    const { chat, voice, said, settle } = mount();
    voice(true, "listening");
    chat.setMood("listening");
    voice(true, "hearing");
    voice(true, "listening");
    await settle();
    expect(said).toEqual(["Listening"]);
    chat.setMood("speaking");
    voice(true, "speaking");
    await settle();
    expect(said).toEqual(["Listening", "Jarvis is speaking"]);
  });

  it("announces the push-to-talk moods when hands-free is not there at all", () => {
    const { chat, status } = mount();
    chat.setMood("listening");
    expect(status().textContent).toBe("Listening");
    chat.setMood("thinking");
    expect(status().textContent).toBe("Thinking");
    chat.setMood("speaking");
    expect(status().textContent).toBe("Jarvis is speaking");
  });

  it("plays the rising two notes when listening starts, quietly, and only after a gesture", () => {
    const { voice, gesture, tones, contexts } = mount();
    voice(true, "listening");
    expect(contexts()).toBe(0);
    voice(true, "thinking");
    gesture();
    voice(true, "listening");
    expect(tones.length).toBe(2);
    expect(tones.every((tone) => tone.peak > 0 && tone.peak <= 0.06)).toBe(true);
    expect(tones.every((tone) => tone.type === "sine" || tone.type === "triangle")).toBe(true);
    expect(Math.max(...tones.map((tone) => tone.stop)) - Math.min(...tones.map((tone) => tone.start))).toBeLessThanOrEqual(0.2);
    voice(true, "hearing");
    voice(true, "listening");
    expect(tones.length).toBe(2);
  });

  it("plays one low note when a reply lands with voice on, and nothing at all with voice off", async () => {
    const { chat, voice, gesture, tones, settle } = mount();
    gesture();
    chat.send("Could you do better?");
    await settle(); await settle();
    expect(tones.length).toBe(0);

    voice(true, "thinking");
    chat.send("Any better for two?");
    await settle(); await settle();
    expect(tones.length).toBe(1);

    voice(false, "off");
    chat.send("And for three?");
    await settle(); await settle();
    expect(tones.length).toBe(1);
  });
});
