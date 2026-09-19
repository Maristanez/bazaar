// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Console } from "./Console";
import { createFixturePort } from "./data/fixturePort";
import { events } from "./fixtures/events";

afterEach(() => { cleanup(); vi.useRealTimers(); });

test("S5: fixture events reach the feed in under a second, newest first, with red named blocks", async () => {
  vi.useFakeTimers();
  render(<Console port={createFixturePort({ stream: events, intervalMs: 100 })} />);
  await act(async () => {});
  expect(screen.getByText("Waiting for the first offer.")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const first = screen.getByRole("article", { name: "blocked · validate" });
  expect(within(first).getByText(events[0]!.reasoning)).toBeTruthy();
  expect(getComputedStyle(first).backgroundColor).toBe("rgb(243, 103, 90)");
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getAllByRole("article")[0]!.textContent).toContain(events[1]!.reasoning);
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(screen.getAllByRole("article")).toHaveLength(events.length);
  for (const layer of ["validate", "engine", "check", "auditor"]) {
    expect(screen.getByRole("article", { name: `blocked · ${layer}` })).toBeTruthy();
  }
});

test("PAUSE and Resume persist policy and render live, paused and empty states", async () => {
  const port = createFixturePort({ stream: [] });
  render(<Console port={port} />);
  const pause = await screen.findByRole("button", { name: "PAUSE" });
  expect(screen.getByText("Deals live")).toBeTruthy();
  await act(async () => pause.click());
  expect(screen.getByText("Paused")).toBeTruthy();
  expect((await port.load()).policy.paused).toBe(true);
  await act(async () => screen.getByRole("button", { name: "Resume" }).click());
  expect(screen.getByText("Deals live")).toBeTruthy();
  expect((await port.load()).policy.paused).toBe(false);
  expect(screen.getByText("Waiting for the first offer.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "The Gym" })).toBeTruthy();
});

test("a failed state load can be retried without leaving an owner on an endless loading screen", async () => {
  const port = createFixturePort({ stream: [] });
  const load = port.load;
  port.load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(load);
  render(<Console port={port} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not load Console. Please try again.");
  await act(async () => screen.getByRole("button", { name: "Retry" }).click());
  expect(await screen.findByText("Deals live")).toBeTruthy();
});

test("reconnecting reloads owner state and reports disconnected or unauthorized streams", async () => {
  const port = createFixturePort({ stream: [] });
  let connection: ((state: import("./data/port").Connection) => void) | undefined;
  port.subscribe = (_event, listener) => { connection = listener; listener?.("connected"); return () => {}; };
  render(<Console port={port} />);
  await screen.findByText("Deals live");
  await port.setPaused(true);
  await act(async () => connection?.("reconnecting"));
  expect(screen.getByText("Feed disconnected. Reconnecting…")).toBeTruthy();
  await act(async () => connection?.("connected"));
  expect(screen.getByText("Paused")).toBeTruthy();
  await act(async () => connection?.("unauthorized"));
  expect(screen.getByText("Feed authorization expired. Sign in again or wait for session refresh.")).toBeTruthy();
});

test("a delayed older event cannot displace the newest event at the top", async () => {
  vi.useFakeTimers();
  const port = createFixturePort({ stream: [events[10]!, events[0]!], intervalMs: 100 });
  render(<Console port={port} />); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getAllByRole("article")[0]!.textContent).toContain(events[10]!.reasoning);
});
