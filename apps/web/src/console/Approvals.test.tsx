// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Console } from "./Console";
import { createFixturePort } from "./data/fixturePort";
afterEach(() => { cleanup(); vi.useRealTimers(); });

test.each(["Approve", "Decline"])("%s resolves the yellow approval once through the port", async action => {
  const port = createFixturePort({ stream: [] });
  const resolve = vi.spyOn(port, "resolveApproval");
  render(<Console port={port} />);
  const card = await screen.findByRole("region", { name: "Your decision" });
  expect(getComputedStyle(card).backgroundColor).toBe("rgb(246, 216, 9)");
  expect(within(card).getByText("Trail Runner 2 · size 10 × 1")).toBeTruthy();
  expect(within(card).getByText("$85.00")).toBeTruthy();
  expect(within(card).getByText("Profit $7.00 · 9% over cost")).toBeTruthy();
  await act(async () => screen.getByRole("button", { name: action }).click());
  expect(resolve).toHaveBeenCalledExactlyOnceWith("apr_01J8Q4M3ZK", action === "Approve" ? "approved" : "declined");
  expect((await port.load()).pendingApprovals).toHaveLength(0);
  expect(screen.getByText(action === "Approve" ? "Approved" : "Declined")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});

test("the fixture approval has 45 seconds, reaches zero, and resolves once as a timeout", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-20T01:00:00Z"));
  const port = createFixturePort({ stream: [] });
  const resolve = vi.spyOn(port, "resolveApproval");
  render(<Console port={port} />);
  await act(async () => {});
  const bar = screen.getByRole("progressbar", { name: "Decision time remaining" });
  expect(bar.getAttribute("aria-valuenow")).toBe("45");
  await act(async () => { await vi.advanceTimersByTimeAsync(44000); });
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(resolve).toHaveBeenCalledExactlyOnceWith("apr_01J8Q4M3ZK", "declined");
  expect((await port.load()).pendingApprovals).toHaveLength(0);
  expect(screen.getByText("Timed out · declined")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(resolve).toHaveBeenCalledTimes(1);
});

test("streamed requests and resolutions update the card and fixture readback", async () => {
  vi.useFakeTimers();
  const { state } = await import("./fixtures/state");
  const { events } = await import("./fixtures/events");
  const port = createFixturePort({ initialState: { ...state, pendingApprovals: [] }, stream: [events[7]!, events[8]!], intervalMs: 100 });
  render(<Console port={port} />);
  await act(async () => {});
  expect(screen.getByText("No approvals pending.")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("region", { name: "Your decision" })).toBeTruthy();
  expect((await port.load()).pendingApprovals).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.queryByRole("region", { name: "Your decision" })).toBeNull();
  expect((await port.load()).pendingApprovals).toHaveLength(0);
});

test("the default interactive fixture lets its approval reach the full timeout", async () => {
  vi.useFakeTimers();
  const port = createFixturePort();
  render(<Console port={port} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(44000); });
  expect(screen.getByRole("progressbar", { name: "Decision time remaining" }).getAttribute("aria-valuenow")).toBe("1");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText("Timed out · declined")).toBeTruthy();
});

test("a late Approve click is ignored before the next timer tick handles timeout", async () => {
  vi.useFakeTimers(); const start = Date.now();
  const port = createFixturePort({ stream: [] }); const resolve = vi.spyOn(port, "resolveApproval");
  render(<Console port={port} />); await act(async () => {});
  vi.setSystemTime(start + 45001);
  await act(async () => screen.getByRole("button", { name: "Approve" }).click());
  expect(resolve).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(resolve).toHaveBeenCalledExactlyOnceWith("apr_01J8Q4M3ZK", "declined");
});

test("an approval arriving while the state snapshot loads is not overwritten by that stale snapshot", async () => {
  const { state } = await import("./fixtures/state");
  const { events } = await import("./fixtures/events");
  const stale = { ...state, pendingApprovals: [] };
  let finish!: (value: typeof stale) => void;
  const port = createFixturePort({ stream: [] });
  port.load = () => new Promise(resolve => { finish = resolve; });
  let receive!: (event: import("@bazaar/contracts").ConsoleEvent) => void;
  port.subscribe = callback => { receive = callback; return () => {}; };
  render(<Console port={port} />);
  await act(async () => {
    receive({ ...events[7]!, approval: { ...state.pendingApprovals[0]!, deadline: new Date(Date.now() + 45000).toISOString() } });
    finish(stale);
  });
  expect(screen.getByRole("region", { name: "Your decision" })).toBeTruthy();
});
