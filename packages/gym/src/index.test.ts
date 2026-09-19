import { expect, it } from "vitest";
import { compare, frame, runGym, settle } from "./index";

it("exports the Gym run, comparison, and layout seams", () => {
  expect([runGym, compare, settle, frame].every((entry) => typeof entry === "function")).toBe(true);
});
