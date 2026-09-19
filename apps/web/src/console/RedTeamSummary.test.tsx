// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { RedTeamResult } from "@bazaar/contracts";
import { RedTeamSummary } from "./RedTeamSummary";

afterEach(cleanup);

const result: RedTeamResult = {
  ranAt: "2026-09-19T22:00:00.000Z",
  attacks: [
    { name: "prompt injection", blockedBy: "check", passed: true, outcome: "unchecked price did not reach the card" },
    { name: "expired replay", blockedBy: "auditor", passed: true, outcome: "expired offer was refused" },
    { name: "cost question", blockedBy: null, passed: true, outcome: "public catalog answer needed no block" },
  ],
  breaches: 0,
  scope: {
    mode: "isolated",
    server: "current createBazaarServer over loopback HTTP",
    backboard: "adversarial SSE double through the real parser, check, and fallback",
    shopify: "dry-run GraphQL double; generated mutation input inspected",
    database: "in-memory deal log",
    liveShopifyValidated: false,
    productionRequests: 0,
    productionDatabaseWrites: 0,
    dryRunDiscounts: 1,
    settlementRows: 1,
  },
};

test("summarizes the isolated run without pretending every harmless input was blocked", () => {
  render(<RedTeamSummary result={result} />);

  expect(screen.getByRole("heading", { name: "Red-team replay" })).toBeTruthy();
  expect(screen.getByText("3 attacks · 0 economic breaches")).toBeTruthy();
  expect(screen.getByText(/3 passed/)).toBeTruthy();
  expect(screen.getByText(/1 safe outcome; no blocking layer claimed/i)).toBeTruthy();
  expect(screen.getByText(/isolated test doubles/i)).toBeTruthy();
  expect(screen.getByText(/not live Shopify checkout enforcement/i)).toBeTruthy();
  expect(screen.queryByText(/all attacks blocked/i)).toBeNull();
});

test("shows real failures and does not turn a failed artifact green", () => {
  const failed: RedTeamResult = {
    ...result,
    breaches: 1,
    attacks: [{ name: "unsafe settlement", blockedBy: "auditor", passed: false, outcome: "verifier found a row at cost" }],
  };
  render(<RedTeamSummary result={failed} />);

  expect(screen.getByText("1 attack · 1 economic breach")).toBeTruthy();
  expect(screen.getByText(/1 failed/)).toBeTruthy();
  expect(screen.getByText(/verifier found a row at cost/i)).toBeTruthy();
});
