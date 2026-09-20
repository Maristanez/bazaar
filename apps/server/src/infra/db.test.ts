import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SEEDED_MERCHANT_ID,
  appendPolicy,
  createSupabaseDb,
  dealFromRow,
  healthCheck,
  insertDeal,
  listDeals,
  loadLatestPolicy,
  readSupabaseEnvironment,
  verifyBearerToken,
} from "./db";

type Result = { data: unknown; error: unknown };

function queryBuilder(result: Result) {
  const builder = {
    eq: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => result),
  };
  return builder;
}

function clientFor(result: Result, authUser?: { id: string } | null) {
  const builder = queryBuilder(result);
  return {
    from: vi.fn(() => builder),
    auth: { getUser: vi.fn(async () => ({ data: { user: authUser ?? null }, error: null })) },
    builder,
  } as unknown as SupabaseClient;
}

const merchantRow = {
  id: SEEDED_MERCHANT_ID,
  owner_user_id: "owner-1",
  shop_domain: "trailhead-co.myshopify.com",
};

describe("Supabase environment", () => {
  it("prefers current names and accepts legacy fallbacks", () => {
    expect(readSupabaseEnvironment({
      SUPABASE_URL: "https://current.supabase.co",
      SUPABASE_SECRET_KEY: "current-secret",
      SUPABASE_PUBLISHABLE_KEY: "current-publishable",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
      SUPABASE_ANON_KEY: "legacy-publishable",
    })).toEqual({
      url: "https://current.supabase.co",
      secretKey: "current-secret",
      publishableKey: "current-publishable",
    });
    expect(readSupabaseEnvironment({
      SUPABASE_URL: "https://legacy.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
      SUPABASE_ANON_KEY: "legacy-publishable",
    })).toEqual({
      url: "https://legacy.supabase.co",
      secretKey: "legacy-secret",
      publishableKey: "legacy-publishable",
    });
  });

  it("fails closed when the server secret is absent", () => {
    expect(() => readSupabaseEnvironment({ SUPABASE_URL: "https://example.supabase.co" }))
      .toThrow("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("Supabase queries", () => {
  it("reads the seeded merchant and maps snake case", async () => {
    const client = clientFor({ data: merchantRow, error: null });
    await expect(healthCheck(client, SEEDED_MERCHANT_ID)).resolves.toEqual({
      id: SEEDED_MERCHANT_ID,
      ownerUserId: "owner-1",
      shopDomain: "trailhead-co.myshopify.com",
    });
    expect((client as any).from).toHaveBeenCalledWith("merchants");
  });

  it("loads and maps the latest policy", async () => {
    const client = clientFor({
      data: { floor_pct: "25.00", ask_owner: true, paused: false, updated_at: "2026-09-19T12:00:00Z" },
      error: null,
    });
    await expect(loadLatestPolicy(client, SEEDED_MERCHANT_ID)).resolves.toEqual({
      floorPct: 25,
      askOwner: true,
      paused: false,
      updatedAt: "2026-09-19T12:00:00Z",
    });
    expect((client as any).from).toHaveBeenCalledWith("policies");
  });

  it("checks the bearer token user against merchant ownership", async () => {
    const client = clientFor({ data: merchantRow, error: null }, { id: "owner-1" });
    await expect(verifyBearerToken(client, "Bearer access-token", SEEDED_MERCHANT_ID)).resolves.toEqual({
      id: SEEDED_MERCHANT_ID,
      ownerUserId: "owner-1",
      shopDomain: "trailhead-co.myshopify.com",
    });
    const auth = (client as any).auth.getUser;
    expect(auth).toHaveBeenCalledWith("access-token");
  });

  it("returns null for invalid tokens and non owners", async () => {
    const invalidClient = clientFor({ data: merchantRow, error: null }, null);
    await expect(verifyBearerToken(invalidClient, "Bearer expired", SEEDED_MERCHANT_ID)).resolves.toBeNull();
    const otherClient = clientFor({ data: null, error: null }, { id: "other-user" });
    await expect(verifyBearerToken(otherClient, "access-token", SEEDED_MERCHANT_ID)).resolves.toBeNull();
  });

  it("appends a policy with schema column names", async () => {
    const client = clientFor({
      data: { floor_pct: 30, ask_owner: false, paused: true, updated_at: "2026-09-19T13:00:00Z" },
      error: null,
    });
    await expect(appendPolicy(client, {
      floorPct: 30,
      askOwner: false,
      paused: true,
      updatedAt: "2026-09-19T13:00:00Z",
    })).resolves.toMatchObject({ floorPct: 30, askOwner: false, paused: true });
    expect((client as any).from).toHaveBeenCalledWith("policies");
    expect((client as any).builder.insert).toHaveBeenCalledWith({
      merchant_id: SEEDED_MERCHANT_ID,
      floor_pct: 30,
      ask_owner: false,
      paused: true,
      updated_at: "2026-09-19T13:00:00Z",
    });
  });

  it("inserts a deal without writing generated profit", async () => {
    const client = clientFor({
      data: {
        id: "deal-1",
        merchant_id: SEEDED_MERCHANT_ID,
        offer_id: "offer-1",
        surface: "storefront",
        items_json: [{ variantId: "tr3-10", title: "Trail Runner 3", qty: 1 }],
        list_total: 16900,
        agreed_total: 12000,
        cost: 9500,
        floor: 11875,
        profit: 2500,
        owner_approved: false,
        code: "BAZAAR-1",
        created_at: "2026-09-19T13:00:00Z",
      },
      error: null,
    });
    const result = await insertDeal(client, {
      merchantId: SEEDED_MERCHANT_ID,
      offerId: "offer-1",
      surface: "storefront",
      items: [{ variantId: "tr3-10", title: "Trail Runner 3", qty: 1 }],
      listTotal: 16900,
      agreedTotal: 12000,
      cost: 9500,
      floor: 11875,
      ownerApproved: false,
      code: "BAZAAR-1",
    });
    expect(result).toEqual(dealFromRow({
      id: "deal-1",
      merchant_id: SEEDED_MERCHANT_ID,
      offer_id: "offer-1",
      surface: "storefront",
      items_json: [{ variantId: "tr3-10", title: "Trail Runner 3", qty: 1 }],
      list_total: 16900,
      agreed_total: 12000,
      cost: 9500,
      floor: 11875,
      profit: 2500,
      owner_approved: false,
      code: "BAZAAR-1",
      created_at: "2026-09-19T13:00:00Z",
    }));
    expect((client as any).builder.insert).toHaveBeenCalledWith(expect.not.objectContaining({ profit: expect.anything() }));
  });

  it("round-trips a list-price deal with no discount code", async () => {
    const client = clientFor({
      data: {
        id: "deal-list",
        merchant_id: SEEDED_MERCHANT_ID,
        offer_id: "offer-list",
        surface: "storefront",
        items_json: [{ variantId: "tr3-10", title: "Trail Runner 3", qty: 1 }],
        list_total: 16900,
        agreed_total: 16900,
        cost: 9500,
        floor: 11875,
        profit: 7400,
        owner_approved: false,
        code: null,
        created_at: "2026-09-19T13:00:00Z",
      },
      error: null,
    });
    const result = await insertDeal(client, {
      merchantId: SEEDED_MERCHANT_ID,
      offerId: "offer-list",
      surface: "storefront",
      items: [{ variantId: "tr3-10", title: "Trail Runner 3", qty: 1 }],
      listTotal: 16900,
      agreedTotal: 16900,
      cost: 9500,
      floor: 11875,
      ownerApproved: false,
      code: null,
    });
    expect(result.code).toBeNull();
    expect((client as any).builder.insert).toHaveBeenCalledWith(expect.objectContaining({ code: null }));
  });

  it("exposes the same query layer through the configured db facade", async () => {
    const client = clientFor({ data: merchantRow, error: null });
    const db = createSupabaseDb({ client, merchantId: SEEDED_MERCHANT_ID });
    await expect(db.healthCheck()).resolves.toMatchObject({ id: SEEDED_MERCHANT_ID });
  });
});

describe("settled deals for the owner's KPIs", () => {
  it("lists one merchant's deals newest first, in the contract's shape", async () => {
    const row = {
      id: "deal-1", merchant_id: SEEDED_MERCHANT_ID, offer_id: "offer-1", surface: "storefront",
      items_json: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      list_total: 14900, agreed_total: 13300, cost: 7800, floor: 9750, profit: 5500,
      owner_approved: false, code: "BAZAAR-1", created_at: "2026-09-19T20:09:00Z",
    };
    const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), order: vi.fn(() => builder), limit: vi.fn(async () => ({ data: [row], error: null })) };
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const deals = await listDeals(client);

    expect(deals).toEqual([{
      id: "deal-1", merchantId: SEEDED_MERCHANT_ID, offerId: "offer-1", surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      listTotal: 14900, agreedTotal: 13300, cost: 7800, floor: 9750, profit: 5500,
      ownerApproved: false, code: "BAZAAR-1", createdAt: "2026-09-19T20:09:00Z",
    }]);
    expect(client.from).toHaveBeenCalledWith("deals");
    expect(builder.eq).toHaveBeenCalledWith("merchant_id", SEEDED_MERCHANT_ID);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});

describe("owner settings on the policy row", () => {
  /** Like clientFor, but each awaited query takes the next result in turn. */
  function clientForSequence(results: Result[]) {
    const queue = [...results];
    const next = async () => queue.shift()!;
    const builder = { eq: vi.fn(() => builder), insert: vi.fn((_payload: unknown) => builder), limit: vi.fn(() => builder), maybeSingle: vi.fn(next), order: vi.fn(() => builder), select: vi.fn((_columns: string) => builder), single: vi.fn(next) };
    return { from: vi.fn(() => builder), auth: { getUser: vi.fn() }, builder } as unknown as SupabaseClient & { builder: typeof builder };
  }
  const settings = { discountCapPct: 15, maxRounds: 3, lowballCutoffPct: 50, tone: "brisk" as const, firmPriceProductIds: ["tr3"] };
  const row = { floor_pct: 30, ask_owner: false, paused: false, updated_at: "2026-09-19T13:00:00Z" };
  const missingColumn = { code: "PGRST204", message: "Could not find the 'settings' column of 'policies' in the schema cache" };

  it("writes the settings column and reads it back", async () => {
    const client = clientForSequence([{ data: { ...row, settings }, error: null }, { data: { ...row, settings }, error: null }]);
    await expect(appendPolicy(client, { floorPct: 30, askOwner: false, paused: false, settings })).resolves.toMatchObject({ floorPct: 30, settings });
    expect(client.builder.insert).toHaveBeenCalledWith({ merchant_id: SEEDED_MERCHANT_ID, floor_pct: 30, ask_owner: false, paused: false, settings });
    await expect(loadLatestPolicy(client, SEEDED_MERCHANT_ID)).resolves.toMatchObject({ floorPct: 30, settings });
    expect(client.builder.select).toHaveBeenLastCalledWith("floor_pct, ask_owner, paused, updated_at, settings");
  });

  it("retries without the column when the database does not have it yet, keeps the settings on the returned policy, and logs once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = clientForSequence([{ data: null, error: missingColumn }, { data: row, error: null }, { data: row, error: null }]);
      await expect(appendPolicy(client, { floorPct: 30, askOwner: false, paused: false, settings })).resolves.toMatchObject({ floorPct: 30, settings });
      expect(client.builder.insert).toHaveBeenLastCalledWith({ merchant_id: SEEDED_MERCHANT_ID, floor_pct: 30, ask_owner: false, paused: false });
      // The client is now known to lack the column: no failed attempt the second time.
      await appendPolicy(client, { floorPct: 30, askOwner: false, paused: false, settings });
      expect(client.builder.insert).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });

  it("loads the policy without settings when the select fails on the missing column", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = clientForSequence([{ data: null, error: { code: "42703", message: "column policies.settings does not exist" } }, { data: row, error: null }]);
      await expect(loadLatestPolicy(client, SEEDED_MERCHANT_ID)).resolves.toEqual({ floorPct: 30, askOwner: false, paused: false, updatedAt: "2026-09-19T13:00:00Z" });
      expect(client.builder.select).toHaveBeenLastCalledWith("floor_pct, ask_owner, paused, updated_at");
    } finally { warn.mockRestore(); }
  });

  it("still throws any other database error", async () => {
    const client = clientForSequence([{ data: null, error: { code: "42501", message: "permission denied" } }]);
    await expect(appendPolicy(client, { floorPct: 30, askOwner: false, paused: false, settings })).rejects.toMatchObject({ code: "42501" });
  });
});
