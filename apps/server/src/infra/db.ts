import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Deal, Policy } from "@bazaar/contracts";

/** The id inserted by infra/schema.sql for the single demo merchant. */
export const SEEDED_MERCHANT_ID = "00000000-0000-4000-8000-000000000001";

export type SupabaseEnvironmentInput = Readonly<Record<string, string | undefined>>;

export type SupabaseEnvironment = {
  url: string;
  secretKey: string;
  /** The browser key is parsed for callers that also configure a client, but is never used by this server client. */
  publishableKey?: string;
};

export type Merchant = {
  id: string;
  ownerUserId: string | null;
  shopDomain: string;
};

export type PolicyInput = Omit<Policy, "updatedAt"> & Partial<Pick<Policy, "updatedAt">>;

export type DealInput = Omit<Deal, "id" | "profit" | "createdAt"> &
  Partial<Pick<Deal, "id" | "createdAt">>;

export type SupabaseClientLike = Pick<SupabaseClient, "from" | "auth">;

type MerchantRow = {
  id: string;
  owner_user_id: string | null;
  shop_domain: string;
};

type PolicyRow = {
  floor_pct: number | string;
  ask_owner: boolean;
  paused: boolean;
  updated_at: string;
};

type DealRow = {
  id: string;
  merchant_id: string;
  offer_id: string;
  surface: Deal["surface"];
  items_json: Deal["items"];
  list_total: number;
  agreed_total: number;
  cost: number;
  floor: number;
  profit: number;
  owner_approved: boolean;
  code: string | null;
  created_at: string;
};

type QueryResult<T> = { data: T | null; error: unknown | null };

function envValue(env: SupabaseEnvironmentInput, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve the current environment names first, while keeping the names used by
 * the original schema and setup notes as backwards-compatible fallbacks.
 */
function runtimeEnvironment(): SupabaseEnvironmentInput {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: SupabaseEnvironmentInput };
  }).process;
  return processLike?.env ?? {};
}

export function readSupabaseEnvironment(env: SupabaseEnvironmentInput = runtimeEnvironment()): SupabaseEnvironment {
  const url = envValue(env, "SUPABASE_URL");
  const secretKey = envValue(env, "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = envValue(env, "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url) throw new Error("SUPABASE_URL is required");
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required for the server");
  }
  return { url, secretKey, ...(publishableKey === undefined ? {} : { publishableKey }) };
}

/** Create a service-role client. This function must only be called in server code. */
export function createSupabaseServerClient(
  environment: SupabaseEnvironment = readSupabaseEnvironment(),
): SupabaseClientLike {
  return createClient(environment.url, environment.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function throwIfError(error: unknown | null): void {
  if (error) throw error;
}

function requireRow<T>(data: T | null, description: string): T {
  if (data === null || data === undefined) throw new Error(`${description} was not found`);
  return data;
}

function toMerchant(row: MerchantRow): Merchant {
  return { id: row.id, ownerUserId: row.owner_user_id, shopDomain: row.shop_domain };
}

export function policyFromRow(row: PolicyRow): Policy {
  const floorPct = Number(row.floor_pct);
  if (!Number.isFinite(floorPct)) throw new Error("Supabase policy floor_pct is not a number");
  return {
    floorPct,
    askOwner: row.ask_owner,
    paused: row.paused,
    updatedAt: row.updated_at,
  };
}

export function dealFromRow(row: DealRow): Deal {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    offerId: row.offer_id,
    surface: row.surface,
    items: row.items_json,
    listTotal: row.list_total,
    agreedTotal: row.agreed_total,
    cost: row.cost,
    floor: row.floor,
    profit: row.profit,
    ownerApproved: row.owner_approved,
    code: row.code,
    createdAt: row.created_at,
  };
}

/** Read the seeded merchant, used by the health endpoint and the smoke check. */
export async function healthCheck(
  client: SupabaseClientLike,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<Merchant> {
  const { data, error } = await client
    .from("merchants")
    .select("id, owner_user_id, shop_domain")
    .eq("id", merchantId)
    .maybeSingle() as unknown as QueryResult<MerchantRow>;
  throwIfError(error);
  return toMerchant(requireRow(data, `Merchant ${merchantId}`));
}

/** Load the newest policy row, using id as a deterministic tie breaker. */
export async function loadLatestPolicy(
  client: SupabaseClientLike,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<Policy> {
  const { data, error } = await client
    .from("policies")
    .select("floor_pct, ask_owner, paused, updated_at")
    .eq("merchant_id", merchantId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as QueryResult<PolicyRow>;
  throwIfError(error);
  return policyFromRow(requireRow(data, `Policy for merchant ${merchantId}`));
}

function bearerToken(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const match = /^Bearer\s+(.+)$/i.exec(candidate);
  return (match?.[1] ?? candidate).trim() || null;
}

/**
 * Verify a Supabase access token and then check that its user owns the merchant.
 * Invalid or expired tokens resolve to null; database errors still propagate.
 */
export async function verifyBearerToken(
  client: SupabaseClientLike,
  authorization: string | null | undefined,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<Merchant | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData?.user?.id) return null;
  const { data, error } = await client
    .from("merchants")
    .select("id, owner_user_id, shop_domain")
    .eq("id", merchantId)
    .eq("owner_user_id", authData.user.id)
    .maybeSingle() as unknown as QueryResult<MerchantRow>;
  throwIfError(error);
  return data === null ? null : toMerchant(data);
}

export async function isMerchantOwner(
  client: SupabaseClientLike,
  authorization: string | null | undefined,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<boolean> {
  return (await verifyBearerToken(client, authorization, merchantId)) !== null;
}

/** Append a policy row. Policy history is intentionally never updated in place. */
export async function appendPolicy(
  client: SupabaseClientLike,
  policy: PolicyInput,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<Policy> {
  const payload = {
    merchant_id: merchantId,
    floor_pct: policy.floorPct,
    ask_owner: policy.askOwner,
    paused: policy.paused,
    ...(policy.updatedAt === undefined ? {} : { updated_at: policy.updatedAt }),
  };
  const { data, error } = await client
    .from("policies")
    .insert(payload)
    .select("floor_pct, ask_owner, paused, updated_at")
    .single() as unknown as QueryResult<PolicyRow>;
  throwIfError(error);
  return policyFromRow(requireRow(data, "Inserted policy"));
}

/**
 * Persist a settled deal. `profit` is a generated database column and must not
 * be sent in the insert payload; Supabase returns it after Postgres computes it.
 */
export async function insertDeal(
  client: SupabaseClientLike,
  deal: DealInput,
): Promise<Deal> {
  const payload = {
    ...(deal.id === undefined ? {} : { id: deal.id }),
    merchant_id: deal.merchantId,
    offer_id: deal.offerId,
    surface: deal.surface,
    items_json: deal.items,
    list_total: deal.listTotal,
    agreed_total: deal.agreedTotal,
    cost: deal.cost,
    floor: deal.floor,
    owner_approved: deal.ownerApproved,
    code: deal.code,
    ...(deal.createdAt === undefined ? {} : { created_at: deal.createdAt }),
  };
  const { data, error } = await client
    .from("deals")
    .insert(payload)
    .select("id, merchant_id, offer_id, surface, items_json, list_total, agreed_total, cost, floor, profit, owner_approved, code, created_at")
    .single() as unknown as QueryResult<DealRow>;
  throwIfError(error);
  return dealFromRow(requireRow(data, "Inserted deal"));
}

const DEAL_COLUMNS = "id, merchant_id, offer_id, surface, items_json, list_total, agreed_total, cost, floor, profit, owner_approved, code, created_at";

/**
 * Settled deals for the owner's KPIs, newest first. Served by the
 * `deals_merchant_created_idx` index; capped so one state load stays small.
 */
export async function listDeals(
  client: SupabaseClientLike,
  merchantId = SEEDED_MERCHANT_ID,
  limit = 500,
): Promise<Deal[]> {
  const { data, error } = await client
    .from("deals")
    .select(DEAL_COLUMNS)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit) as unknown as QueryResult<DealRow[]>;
  throwIfError(error);
  return (data ?? []).map(dealFromRow);
}

export type SupabaseDb = {
  readonly merchantId: string;
  readonly client: SupabaseClientLike;
  healthCheck(): Promise<Merchant>;
  loadLatestPolicy(): Promise<Policy>;
  verifyBearerToken(authorization: string | null | undefined): Promise<Merchant | null>;
  isMerchantOwner(authorization: string | null | undefined): Promise<boolean>;
  appendPolicy(policy: PolicyInput): Promise<Policy>;
  insertDeal(deal: DealInput): Promise<Deal>;
  listDeals(): Promise<Deal[]>;
};

export function createSupabaseDb(options: {
  client?: SupabaseClientLike;
  environment?: SupabaseEnvironment;
  env?: SupabaseEnvironmentInput;
  merchantId?: string;
} = {}): SupabaseDb {
  const merchantId = options.merchantId ?? SEEDED_MERCHANT_ID;
  const client = options.client ?? createSupabaseServerClient(
    options.environment ?? readSupabaseEnvironment(options.env),
  );
  return {
    merchantId,
    client,
    healthCheck: () => healthCheck(client, merchantId),
    loadLatestPolicy: () => loadLatestPolicy(client, merchantId),
    verifyBearerToken: (authorization) => verifyBearerToken(client, authorization, merchantId),
    isMerchantOwner: (authorization) => isMerchantOwner(client, authorization, merchantId),
    appendPolicy: (policy) => appendPolicy(client, policy, merchantId),
    insertDeal: (deal) => insertDeal(client, deal),
    listDeals: () => listDeals(client, merchantId),
  };
}
