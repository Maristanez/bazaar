import type { Deal, DealKpis } from "@bazaar/contracts";

/** The Gym's banner comparator: a plain 20%-off sale for everyone (SPEC §9.1). */
const BANNER_SHARE_OF_LIST = 0.8;

/**
 * Owner KPIs over settled deals (SPEC §4.4.2). A deal below list is a customer
 * saved: a shopper who asked for less and would have left a no-agent store.
 * Pure — money in cents, agent cost in dollars.
 */
export function dealKpis(deals: readonly Deal[], agentCostUsd = 0): DealKpis {
  const saved = deals.filter((deal) => deal.agreedTotal < deal.listTotal);
  return {
    deals: deals.length,
    customersSaved: saved.length,
    revenueRecovered: saved.reduce((sum, deal) => sum + deal.agreedTotal, 0),
    profitRecovered: saved.reduce((sum, deal) => sum + deal.profit, 0),
    vsBanner: Math.round(deals.reduce((sum, deal) => sum + deal.agreedTotal - BANNER_SHARE_OF_LIST * deal.listTotal, 0)),
    agentCostUsd,
  };
}
