import type { Server } from "node:http";
import type { SupabaseDb } from "./infra/db";
export type OwnerDatabase = Pick<SupabaseDb, "merchantId" | "loadLatestPolicy" | "appendPolicy" | "verifyBearerToken" | "insertDeal"> & Partial<Pick<SupabaseDb, "listDeals">>;
export function createBazaarServer(options?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; ownerDb?: OwnerDatabase }): Promise<Server>;
