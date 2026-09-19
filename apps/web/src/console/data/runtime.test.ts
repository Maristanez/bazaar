import { expect, test } from "vitest";
import { createRuntime } from "./runtime";
test("development defaults to fixtures; production requires public HTTP auth configuration", async () => {
  const fixture = await createRuntime({ DEV: true });
  expect(await fixture.auth.session()).toBe(true);
  expect((await fixture.port.load()).policy.floorPct).toBe(25);
  await expect(createRuntime({ DEV: false }, async () => new Response(null, { status: 503 }))).rejects.toThrow("public Supabase");
  const preview = await createRuntime({ DEV: false, VITE_CONSOLE_PORT: "fixture" });
  expect(await preview.auth.session()).toBe(false);
  await expect(createRuntime({ DEV: true, VITE_CONSOLE_PORT: "http" }, async () => new Response(JSON.stringify({ supabaseUrl: "https://demo.supabase.co", supabaseAnonKey: "sb_publishable_demo" }), { status: 200 }))).resolves.toMatchObject({ fixture: false });
  await expect(createRuntime({ DEV: true, VITE_CONSOLE_PORT: "http" }, async () => new Response(JSON.stringify({ supabaseUrl: "https://demo.supabase.co", supabaseAnonKey: "sb_secret_demo" }), { status: 200 }))).rejects.toThrow("invalid public auth");
});

test("invalid runtime responses fail with an actionable auth error", async () => {
  for (const body of [null, [], { supabaseUrl: "https://", supabaseAnonKey: "sb_publishable_demo" }]) {
    await expect(createRuntime({ DEV: false }, async () => new Response(JSON.stringify(body)))).rejects.toThrow("invalid public auth");
  }
});

test("build-time credentials must also be public", async () => {
  await expect(createRuntime({ DEV: false, VITE_SUPABASE_URL: "https://demo.supabase.co", VITE_SUPABASE_ANON_KEY: "sb_secret_demo" })).rejects.toThrow("invalid public auth");
});
