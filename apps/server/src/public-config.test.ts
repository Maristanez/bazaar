import { describe, expect, it } from "vitest";
import { publicConfig } from "./public-config";

const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
const anon = `${header}.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.sig`;

describe("publicConfig", () => {
  it("allows only public publishable or anon keys", () => {
    expect(publicConfig({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo" })).toEqual({ supabaseUrl: "https://demo.supabase.co", supabaseAnonKey: "sb_publishable_demo" });
    expect(publicConfig({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_ANON_KEY: anon })).toMatchObject({ supabaseAnonKey: anon });
  });
  it.each(["sb_secret_demo", "service_role_demo", `${header}.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`]) ("rejects privileged key %s", key => {
    expect(publicConfig({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_PUBLISHABLE_KEY: key })).toBeNull();
  });
});

it.each(["https://", "https://user:password@demo.supabase.co", "http://demo.supabase.co"])("rejects malformed or credential-bearing auth URL %s", url => {
  expect(publicConfig({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo" })).toBeNull();
});
