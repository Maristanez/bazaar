import type { OwnerProduct } from "@bazaar/contracts";
import type { NegotiationItem } from "@bazaar/engine";

/** A catalog variant as the Gym takes it: the engine's item plus whether the owner opened it to offers. */
export type GymItem = NegotiationItem & { openToOffers: boolean };

export function items(products: OwnerProduct[]): GymItem[] {
  return products.flatMap((product) => product.variants.map((variant) => ({
    variantId: variant.variantId,
    productId: product.productId,
    title: product.title,
    size: variant.size,
    productType: product.productType,
    list: variant.price,
    cost: variant.unitCost,
    stockedAt: product.stockedAt,
    inStock: variant.inStock,
    isAddOn: /accessor|sock|gaiter|flask|cap|bag|tote/i.test(`${product.productType || ""} ${product.title}`),
    openToOffers: product.openToOffers,
  })));
}

export function invalidReason(main: GymItem | undefined): string | undefined {
  if (!main) return "No main product is available for rehearsal.";
  if (!main.inStock) return "This variant is out of stock, so it cannot enter the Gym.";
  if (main.cost === null) return "This variant is missing cost, so it is not open to offers.";
  if (!main.openToOffers) return "This product is not open to offers.";
  if (!Number.isSafeInteger(main.list) || !Number.isSafeInteger(main.cost) || main.list <= 0 || main.cost <= 0) return "This variant has invalid price data.";
  return undefined;
}
