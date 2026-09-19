import type { Item } from "@bazaar/engine";

export const now = new Date("2026-09-19T12:00:00.000Z");
export const main: Item = {
  variantId: "tr2-10",
  productId: "tr2",
  title: "Trail Runner 2",
  size: "10",
  productType: "shoe",
  list: 14900,
  cost: 7800,
  stockedAt: "2026-06-17T12:00:00.000Z",
  inStock: true,
  isAddOn: false,
};
export const addOns: Item[] = [
  { variantId: "socks", productId: "socks", title: "Merino socks", productType: "Add-on", list: 1800, cost: 600, stockedAt: null, inStock: true, isAddOn: true },
  { variantId: "gaiters", productId: "gaiters", title: "Trail gaiters", productType: "Add-on", list: 3500, cost: 1200, stockedAt: null, inStock: true, isAddOn: true },
  { variantId: "flask", productId: "flask", title: "Soft flask", productType: "Add-on", list: 2500, cost: 900, stockedAt: null, inStock: true, isAddOn: true },
];
export const input = { main, addOns, floorPct: 25, askOwner: true, seed: 42, n: 300, now };
