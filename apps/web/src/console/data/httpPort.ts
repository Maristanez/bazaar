import { subscribeStream } from "./stream";
import type { ConsolePort } from "./port";
type HttpOptions = { token(): Promise<string | null>; fetch?: typeof fetch; baseUrl?: string };
export function createHttpPort({ token, fetch: request = globalThis.fetch, baseUrl = "" }: HttpOptions): ConsolePort {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const accessToken = await token();
    if (!accessToken) throw new Error("Sign in to access the Console.");
    const response = await request(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Owner request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
  return {
    load: () => call("/api/console/state"),
    setPolicy: next => call("/api/policy", next),
    setPaused: paused => call("/api/pause", { paused }),
    async resolveApproval(id, decision) { await call(`/api/approvals/${encodeURIComponent(id)}`, { decision: decision === "approved" ? "approve" : "decline" }); },
    subscribe: (onEvent, onConnection) => subscribeStream({ request, url: `${baseUrl}/api/console/stream`, token, onEvent, onConnection }),
  };
}
