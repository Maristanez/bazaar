/** The owner's floor for a cart costing `cost` cents: floorPct over cost, and always at least one cent above cost (invariant 2). */
export function floorOf(cost: number, floorPct: number): number {
  return Math.max(cost + 1, Math.ceil(cost * (1 + floorPct / 100)));
}

/** Whether a product is an add-on (bundled beside a main item). One rule, so the Gym's catalog matches the server's mirror. */
export function isAddOn(product: { productType?: string | null; title?: string | null }): boolean {
  return /accessor|sock|gaiter|flask|cap|bag|tote/i.test(`${product.productType || ""} ${product.title || ""}`);
}
