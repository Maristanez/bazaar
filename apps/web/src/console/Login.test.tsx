// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ConsoleApp } from "./ConsoleApp";
import { createFixturePort } from "./data/fixturePort";
import { createFixtureAuth } from "./data/auth";
afterEach(cleanup);
test("signed-out owner can log in through the auth seam and sign out", async () => {
  render(<ConsoleApp port={createFixturePort({ stream: [] })} auth={createFixtureAuth(false)} />);
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "maya@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Deals live")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByLabelText("Email")).toBeTruthy();
});
