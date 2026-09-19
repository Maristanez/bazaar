import { expect, test } from "vitest";
import { createRuntime } from "./runtime";
test("fixtures are the default and development opens signed in; HTTP requires public auth configuration", async () => {
  const fixture = await createRuntime({ DEV: true });
  expect(await fixture.auth.session()).toBe(true);
  expect((await fixture.port.load()).policy.floorPct).toBe(25);
  const production = await createRuntime({ DEV: false });
  expect(await production.auth.session()).toBe(false);
  await expect(createRuntime({ DEV: true, VITE_CONSOLE_PORT: "http" })).rejects.toThrow("Supabase");
});
