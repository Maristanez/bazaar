import { isConsoleEvent } from "./event";
import type { Connection } from "./port";
import type { ConsoleEvent } from "@bazaar/contracts";

// A fetch stream keeps owner credentials in headers. Reconnects get a fresh token.
export function subscribeStream({ request, url, token, onEvent, onConnection }: {
  request: typeof fetch; url: string; token(): Promise<string | null>; onEvent(event: ConsoleEvent): void; onConnection?: (state: Connection) => void;
}): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastId = "";
  let retryMs = 1000;
  async function connect() {
    try {
      const accessToken = await token();
      if (controller.signal.aborted) return;
      if (!accessToken) { onConnection?.("unauthorized"); timer = setTimeout(() => void connect(), retryMs); return; }
      const response = await request(url, { signal: controller.signal, headers: {
        Authorization: `Bearer ${accessToken}`, Accept: "text/event-stream", ...(lastId ? { "Last-Event-ID": lastId } : {}),
      } });
      if (response.status === 401 || response.status === 403) { onConnection?.("unauthorized"); timer = setTimeout(() => void connect(), retryMs); return; }
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Stream unavailable");
      onConnection?.("connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data: string[] = [];
            let id: string | undefined;
            for (const line of frame.split(/\r?\n/)) {
              const colon = line.indexOf(":");
              const field = colon === -1 ? line : line.slice(0, colon);
              const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
              if (field === "data") data.push(value);
              if (field === "id" && !value.includes("\0")) id = value;
              if (field === "retry" && /^\d+$/.test(value)) retryMs = Math.max(250, Math.min(30000, Number(value)));
            }
            if (data.length && !controller.signal.aborted && !(id && id === lastId)) {
              try { const event: unknown = JSON.parse(data.join("\n")); if (isConsoleEvent(event)) onEvent(event); } catch { /* A malformed frame must not kill the next valid event. */ }
            }
            if (id !== undefined) lastId = id;
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* Network loss is retried; unsubscribe aborts without retrying. */ }
    if (!controller.signal.aborted) { onConnection?.("reconnecting"); timer = setTimeout(() => void connect(), retryMs); }
  }
  void connect();
  return () => { controller.abort(); clearTimeout(timer); };
}
