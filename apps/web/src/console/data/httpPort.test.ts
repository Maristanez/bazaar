import { expect, test, vi } from "vitest";
import { createHttpPort } from "./httpPort";
import { state } from "../fixtures/state";
test("owner requests use fresh bearer tokens and the documented R15 wire shapes", async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(state))
    .mockResolvedValueOnce(Response.json({ ...state.policy, floorPct: 40, askOwner: false }))
    .mockResolvedValueOnce(Response.json({ ...state.policy, paused: true }))
    .mockResolvedValueOnce(Response.json({ ...state.pendingApprovals[0], status: "approved" }));
  const token = vi.fn().mockResolvedValueOnce("first").mockResolvedValue("refreshed");
  const port = createHttpPort({ token, fetch: request });
  expect(await port.load()).toEqual(state);
  expect((await port.setPolicy({ floorPct: 40, askOwner: false })).floorPct).toBe(40);
  expect((await port.setPaused(true)).paused).toBe(true);
  await port.resolveApproval("approval/1", "approved");
  expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/console/state", "/api/policy", "/api/pause", "/api/approvals/approval%2F1"]);
  expect(new Headers(request.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer first");
  expect(new Headers(request.mock.calls[1]![1]!.headers).get("Authorization")).toBe("Bearer refreshed");
  expect(JSON.parse(String(request.mock.calls[1]![1]!.body))).toEqual({ floorPct: 40, askOwner: false });
  expect(JSON.parse(String(request.mock.calls[2]![1]!.body))).toEqual({ paused: true });
  expect(JSON.parse(String(request.mock.calls[3]![1]!.body))).toEqual({ decision: "approve" });
});

test("fetch SSE handles split UTF-8 frames and heartbeats, reconnects with cursor, and aborts on unsubscribe", async () => {
  vi.useFakeTimers();
  try {
    const event = { at: "2026-09-19T15:00:00Z", surface: "storefront", negotiationId: "n", shopperId: "s", kind: "blocked", blockedBy: "check", reasoning: "Blocked café price" };
    const bytes = new TextEncoder().encode(`: heartbeat\r\n\r\nid: row-1\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const receive = vi.fn();
    const port = createHttpPort({ token: async () => "owner", fetch: request });
    const unsubscribe = port.subscribe(receive);
    await vi.advanceTimersByTimeAsync(0);
    expect(receive).toHaveBeenCalledExactlyOnceWith(event);
    expect(request.mock.calls[0]![0]).toBe("/api/console/stream");
    expect(new Headers(request.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer owner");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(new Headers(request.mock.calls[1]![1]!.headers).get("Last-Event-ID")).toBe("row-1");
    unsubscribe();
    expect(request.mock.calls[1]![1]!.signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

test("bad frames are skipped and auth loss is visible and retried with a new token", async () => {
  vi.useFakeTimers();
  try {
    const valid = { at: "2026-09-19T15:00:00Z", surface: "chatgpt", negotiationId: "n", shopperId: "s", kind: "recalled", reasoning: "Memory", memory: "muddy 50k" };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(`data: null\n\ndata: {"menu":{}}\n\ndata: ${JSON.stringify(valid)}\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    const receive = vi.fn(); const connection = vi.fn();
    const stop = createHttpPort({ token: vi.fn().mockResolvedValueOnce("expired").mockResolvedValue("new-token"), fetch: request }).subscribe(receive, connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(connection).toHaveBeenCalledWith("unauthorized");
    await vi.advanceTimersByTimeAsync(1000);
    expect(receive).toHaveBeenCalledExactlyOnceWith(valid);
    expect(new Headers(request.mock.calls[1]![1]!.headers).get("Authorization")).toBe("Bearer new-token");
    stop();
  } finally { vi.useRealTimers(); }
});
