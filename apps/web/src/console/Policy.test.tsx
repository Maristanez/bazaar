// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Console } from "./Console";
import { createFixturePort } from "./data/fixturePort";
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("S6: preview changes nothing on readback; Adopt commits the slider and ask-me choice exactly once", async () => {
  const port = createFixturePort({ stream: [] });
  const setPolicy = vi.spyOn(port, "setPolicy");
  render(<Console port={port} />);
  const slider = await screen.findByRole("slider", { name: "Floor: cost + 25%" });
  expect(slider.getAttribute("min")).toBe("0"); expect(slider.getAttribute("max")).toBe("60");
  fireEvent.change(slider, { target: { value: "35" } });
  fireEvent.click(screen.getByRole("switch", { name: "Ask me about thin-margin deals" }));
  expect((await port.load()).policy).toMatchObject({ floorPct: 25, askOwner: true });
  expect(setPolicy).not.toHaveBeenCalled();
  expect(screen.getByText("Preview · not adopted")).toBeTruthy();
  await act(async () => screen.getByRole("button", { name: "Adopt" }).click());
  expect(setPolicy).toHaveBeenCalledExactlyOnceWith({ floorPct: 35, askOwner: false });
  expect((await port.load()).policy).toMatchObject({ floorPct: 35, askOwner: false });
  expect(screen.getByText("Saved policy · cost + 35%")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Adopt" })).toHaveProperty("disabled", true);
});

test("missing cost blocks Cap in red; three missing stock dates are dull amber, never decision yellow", async () => {
  render(<Console port={createFixturePort({ stream: [] })} />);
  const cap = await screen.findByRole("listitem", { name: "Cap" });
  expect(cap.textContent).toContain("missing cost — not open to offers");
  expect(getComputedStyle(cap).backgroundColor).toBe("rgb(243, 103, 90)");
  for (const title of ["Merino socks", "Trail gaiters", "Soft flask"]) {
    const row = screen.getByRole("listitem", { name: title });
    expect(row.textContent).toContain("no stock date — treated as new stock");
    expect(getComputedStyle(row).backgroundColor).toBe("rgb(232, 214, 185)");
    expect(getComputedStyle(row).backgroundColor).not.toBe("rgb(246, 216, 9)");
  }
});

test("reconnect updates the saved baseline without discarding an unadopted preview", async () => {
  const port = createFixturePort({ stream: [] });
  let connection!: (value: import("./data/port").Connection) => void;
  port.subscribe = (_event, listener) => { connection = listener!; listener?.("connected"); return () => {}; };
  render(<Console port={port} />);
  fireEvent.change(await screen.findByRole("slider"), { target: { value: "35" } });
  await port.setPolicy({ floorPct: 30, askOwner: false });
  await act(async () => { connection("reconnecting"); connection("connected"); });
  expect(screen.getByRole("slider")).toHaveProperty("value", "35");
  expect(screen.getByText("Saved policy · cost + 30%")).toBeTruthy();
  expect(screen.getByText("Preview · not adopted")).toBeTruthy();
});

test("a stale reconnect response cannot overwrite a policy adopted while it was in flight", async () => {
  const port = createFixturePort({ stream: [] });
  const originalLoad = port.load; const stale = await originalLoad();
  let connection!: (value: import("./data/port").Connection) => void;
  port.subscribe = (_event, listener) => { connection = listener!; listener?.("connected"); return () => {}; };
  render(<Console port={port} />);
  fireEvent.change(await screen.findByRole("slider"), { target: { value: "40" } });
  let finish!: (state: typeof stale) => void;
  port.load = () => new Promise(resolve => { finish = resolve; });
  await act(async () => connection("connected"));
  await act(async () => screen.getByRole("button", { name: "Adopt" }).click());
  await act(async () => screen.getByRole("button", { name: "PAUSE" }).click());
  await act(async () => finish(stale));
  expect(screen.getByText("Saved policy · cost + 40%")).toBeTruthy();
  expect(screen.getByText("Paused")).toBeTruthy();
  expect((await originalLoad()).policy).toMatchObject({ floorPct: 40, paused: true });
});
