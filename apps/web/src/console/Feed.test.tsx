// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ConsoleEvent } from "@bazaar/contracts";
import { Feed } from "./Feed";

afterEach(cleanup);

function event(id: string, at: string): ConsoleEvent {
  return { at, surface: "storefront", negotiationId: id, shopperId: "shopper", kind: "decision", reasoning: `reasoning ${id}` };
}

const FIVE = [event("a", "2026-09-19T10:00:00.000Z"), event("b", "2026-09-19T10:01:00.000Z"), event("c", "2026-09-19T10:02:00.000Z"),
  event("d", "2026-09-19T10:03:00.000Z"), event("e", "2026-09-19T10:04:00.000Z")];

test("shows only the three newest rows with a Show all toggle", async () => {
  render(<Feed events={FIVE} />);
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getAllByRole("article").map(row => row.textContent)).toEqual(
    expect.arrayContaining(["reasoning a", "reasoning b", "reasoning c"].map(text => expect.stringContaining(text))),
  );
  const toggle = screen.getByRole("button", { name: "Show all 5" });
  await act(async () => toggle.click());
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
});

test("no toggle appears when there are three rows or fewer", () => {
  render(<Feed events={FIVE.slice(0, 3)} />);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});
