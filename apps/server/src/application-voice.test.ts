import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBazaarServer, type OwnerDatabase } from "./application.js";
import type { Policy } from "@bazaar/contracts";

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

function database(): OwnerDatabase {
  let policy: Policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: "2026-09-19T12:00:00Z" };
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...policy }; },
    async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return { ...policy }; },
    async verifyBearerToken() { return { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" }; },
    async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; },
  };
}

async function start(options: Parameters<typeof createBazaarServer>[0] = {}) {
  const server = await createBazaarServer({ env: {}, ownerDb: database(), ...options });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("ElevenLabs voice API", () => {
  it("reports voice unavailable when the server has no ElevenLabs key", async () => {
    const base = await start();

    const response = await fetch(`${base}/api/voice/config`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, provider: "elevenlabs" });
  });

  it("proxies text to speech without exposing the API key to the browser", async () => {
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toContain("/v1/text-to-speech/voice-test/stream");
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("secret-test-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({ text: "I can do $250.", model_id: "eleven_flash_v2_5" });
      return new Response(Uint8Array.from([1, 2, 3, 4]), { headers: { "Content-Type": "audio/mpeg" } });
    });
    const base = await start({
      env: { ELEVENLABS_API_KEY: "secret-test-key", ELEVENLABS_VOICE_ID: "voice-test" },
      fetchImpl: upstream,
    });

    const response = await fetch(`${base}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "I can do $250." }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(response.headers.get("xi-api-key")).toBeNull();
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("sends recorded audio to Scribe and returns only the transcript", async () => {
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("secret-test-key");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model_id")).toBe("scribe_v2");
      expect(form.get("tag_audio_events")).toBe("false");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return Response.json({ text: "five tees for two hundred fifty" });
    });
    const base = await start({ env: { ELEVENLABS_API_KEY: "secret-test-key" }, fetchImpl: upstream });

    const response = await fetch(`${base}/api/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: Uint8Array.from([9, 8, 7]),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "five tees for two hundred fifty" });
    expect(upstream).toHaveBeenCalledOnce();
  });
});
