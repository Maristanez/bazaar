// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Console } from "./Console";
import { createFixturePort } from "./data/fixturePort";
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("choosing the Max off pill and moving its slider previews without adopting; Adopt sends the setting once", async () => {
  const port = createFixturePort({ stream: [] });
  const setPolicy = vi.spyOn(port, "setPolicy");
  render(<Console port={port} />);
  await screen.findByRole("heading", { name: "Try it on 300 shoppers" });

  await act(async () => screen.getByRole("tab", { name: "Max off" }).click());
  const slider = screen.getByRole("slider", { name: /Max off/ });
  fireEvent.change(slider, { target: { value: "15" } });
  expect(setPolicy).not.toHaveBeenCalled();
  expect(screen.getByText("Preview · not adopted")).toBeTruthy();

  await act(async () => screen.getByRole("button", { name: "Adopt" }).click());
  expect(setPolicy).toHaveBeenCalledTimes(1);
  const [call] = setPolicy.mock.calls;
  expect(call![0]).toMatchObject({ settings: { discountCapPct: 15 } });
});

test("the Floor, Rounds and Lowball pills each show their own slider and value label", async () => {
  render(<Console port={createFixturePort({ stream: [] })} />);
  await screen.findByRole("heading", { name: "Try it on 300 shoppers" });

  expect(screen.getByRole("slider", { name: "Floor: cost + 25%" })).toBeTruthy();

  await act(async () => screen.getByRole("tab", { name: "Rounds" }).click());
  expect(screen.getByRole("slider", { name: "Rounds: 4" })).toBeTruthy();

  await act(async () => screen.getByRole("tab", { name: "Lowball" }).click());
  expect(screen.getByRole("slider", { name: "Lowball cutoff: 40% of list" })).toBeTruthy();
});

test("a setting reaches the real engine: a tighter Max off changes what the 300 shoppers do", async () => {
  render(<Console port={createFixturePort({ stream: [] })} />);
  await screen.findByRole("heading", { name: "Try it on 300 shoppers" });
  const stage = () => screen.getByRole("img", { name: /300 simulated shoppers/ }).getAttribute("aria-label");
  const before = stage();

  await act(async () => screen.getByRole("tab", { name: "Max off" }).click());
  fireEvent.change(screen.getByRole("slider", { name: /Max off/ }), { target: { value: "0" } });

  expect(stage()).not.toBe(before); // customers saved and profit are read from the run itself
});
