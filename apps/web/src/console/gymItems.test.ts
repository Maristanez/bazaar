import { expect, it } from "vitest";
import type { OwnerProduct } from "@bazaar/contracts";
import { invalidReason, items } from "./gymItems";

const product: OwnerProduct = { productId: "tr3", title: "Trail Runner 3", image: "", listPrice: 16900, openToOffers: true, productType: "Trail Shoes", stockedAt: "2026-09-07", missingCost: false, missingStockedAt: false,
  variants: [{ variantId: "tr3-10", size: "10", price: 16900, unitCost: 9500, inStock: true }, { variantId: "tr3-11", size: "11", price: 16900, unitCost: null, inStock: true }, { variantId: "tr3-12", size: "12", price: 16900, unitCost: 9500, inStock: false }] };

it("turns every owner variant into a Gym item and flags add-ons by type or title", () => {
  expect(items([product]).map(item => item.variantId)).toEqual(["tr3-10", "tr3-11", "tr3-12"]);
  expect(items([{ ...product, title: "Merino Socks", productType: "Accessories" }])[0]!.isAddOn).toBe(true);
});

it("keeps unavailable inventory out of the simulation", () => {
  const [ready, noCost, soldOut] = items([product]);
  expect(invalidReason(ready)).toBeUndefined();
  expect(invalidReason(noCost)).toMatch(/missing cost/);
  expect(invalidReason(soldOut)).toMatch(/out of stock/);
  expect(invalidReason(items([{ ...product, openToOffers: false }])[0])).toMatch(/not open to offers/);
  expect(invalidReason(undefined)).toMatch(/No main product/);
});
