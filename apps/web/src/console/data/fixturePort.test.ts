import { afterEach, expect, test, vi } from "vitest";
import { createFixturePort } from "./fixturePort";
import type { ConsoleEvent } from "@bazaar/contracts";
afterEach(() => vi.useRealTimers());
test("a local decline is final and recorded; later fixture history cannot reopen or approve it", async () => {
  vi.useFakeTimers();
  const port = createFixturePort({ intervalMs: 100 });
  const rows: ConsoleEvent[] = [];
  const stop = port.subscribe(event => rows.push(event));
  await port.resolveApproval("apr_01J8Q4M3ZK", "declined");
  expect(rows.at(-1)?.approval?.status).toBe("declined");
  await port.resolveApproval("apr_01J8Q4M3ZK", "approved");
  await vi.advanceTimersByTimeAsync(1100);
  expect((await port.load()).pendingApprovals).toHaveLength(0);
  expect(rows.filter(event => event.approval?.id === "apr_01J8Q4M3ZK").map(event => event.approval!.status)).toEqual(["declined"]);
  stop();
});
