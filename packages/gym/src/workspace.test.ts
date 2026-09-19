import { describe, expect, it } from "vitest";
import { PACKAGE as ENGINE } from "@bazaar/engine";
import { PACKAGE as GYM } from "./index";

// Scaffold tracer: proves a workspace package resolves from source, with no build step.
// Delete once B11 gives the gym a real test that imports the engine.
describe("workspace wiring", () => {
  it("gym imports engine through the pnpm workspace", () => {
    expect(ENGINE).toBe("@bazaar/engine");
    expect(GYM).toBe("@bazaar/gym");
  });
});
