import { describe, expect, it } from "vitest";
import { selectCatalogItem, type CatalogItem } from "./catalog";

const items: CatalogItem[] = [
  { variantId: "tr2-9", variantNumericId: "201", productId: "tr2", productNumericId: "20", handle: "trail-runner-2", title: "Trail Runner 2", size: "9", productType: "Shoes", list: 14900, cost: 7800, stockedAt: "2026-06-17", inStock: true, isAddOn: false },
  { variantId: "tr2-10", variantNumericId: "202", productId: "tr2", productNumericId: "20", handle: "trail-runner-2", title: "Trail Runner 2", size: "10", productType: "Shoes", list: 14900, cost: 7800, stockedAt: "2026-06-17", inStock: true, isAddOn: false },
  { variantId: "tr3-9", variantNumericId: "301", productId: "tr3", productNumericId: "30", handle: "trail-runner-3", title: "Trail Runner 3", size: "9", productType: "Shoes", list: 16900, cost: 9500, stockedAt: "2026-09-07", inStock: true, isAddOn: false },
  { variantId: "sock-default", variantNumericId: "401", productId: "socks", productNumericId: "40", handle: "merino-socks", title: "Merino Socks", size: "One Size", productType: "Accessories", list: 1800, cost: 700, stockedAt: "2026-06-17", inStock: true, isAddOn: true },
  { variantId: "tr3-10", variantNumericId: "302", productId: "tr3", productNumericId: "30", handle: "trail-runner-3", title: "Trail Runner 3", size: "10", productType: "Shoes", list: 16900, cost: 9500, stockedAt: "2026-09-07", inStock: true, isAddOn: false },
];

const page = { productId: "tr2", handle: "trail-runner-2", title: "Trail Runner 2", selectedVariantId: "201" };

describe("catalog selection", () => {
  it("uses an explicit product and requested size over a stale selected variant", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Trail Runner 2 size 10" }, items)).toBe(items[1]);
  });

  it("accepts hyphenated explicit sizes and still refuses an unavailable size", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Trail Runner 2 size-10" }, items)).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Trail Runner 2 size-99" }, items)).toBeNull();
  });

  it("uses an affirmative corrected size and ignores the negated size", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "not size 9; I meant size 10" }, items)).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "size10 not size9" }, items)).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "not size 9; I meant size 99" }, items)).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "I don't want size 9" }, items)).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "I don’t want size 9" }, items)).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "I don’t want the size 9" }, items)).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "I do not want size9" }, items)).toBeNull();
  });

  it("keeps the active product and prior variant for generic follow-ups", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "same shoes" }, items, items[1])).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "what about those?" }, items, items[1])).toBe(items[1]);
  });

  it("keeps a typed size across ordinary offer follow-ups until the selector changes", () => {
    const payload = { product: page, productContextSource: "current", negotiationId: "active-size-ten", variantSelectionChanged: false, message: "I can stretch to $130. Trail Runner 2" };
    expect(selectCatalogItem(payload, items, items[1])).toBe(items[1]);
    expect(selectCatalogItem({ ...payload, variantSelectionChanged: true }, items, items[1])).toBe(items[0]);
  });

  it("prefers the current selected variant over a prior context variant", () => {
    expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "what about this one?" }, items, items[0])).toBe(items[1]);
  });

  it("uses a newly selected variant for a generic follow-up when the widget marks the selector change", () => {
    expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "same shoes", variantSelectionChanged: true }, items, items[0])).toBe(items[1]);
  });

  it("lets an explicitly named new product override the page product", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $16 for the Merino Socks?" }, items, items[1])).toBe(items[3]);
  });

  it("preserves size when explicitly switching to another footwear product", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $140 for Trail Runner 3?" }, items, items[1])).toBe(items[4]);
    expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "Could you do $140 for Trail Runner 3?" }, items)).toBe(items[4]);
  });

  it("honors the authoritative selected variant when it already names the explicit product", () => {
    const trailThreePage = { productId: "tr3", handle: "trail-runner-3", title: "Trail Runner 3", selectedVariantId: "301" };
    expect(selectCatalogItem({ product: trailThreePage, productContextSource: "current", message: "Could you do $140 for Trail Runner 3?" }, items, items[1])).toBe(items[2]);
  });

  it("requires a size when an explicit footwear switch has no matching size", () => {
    const withoutSizeTen = items.filter((item) => item.variantId !== "tr3-10");
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $140 for Trail Runner 3?" }, withoutSizeTen, items[1])).toBeNull();
  });

  it("returns null for an unknown requested size instead of substituting a variant", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Trail Runner 2 size 11" }, items)).toBeNull();
  });

  it("rejects a known out-of-stock selected variant", () => {
    const soldOut = items.map((item) => item.variantId === "tr2-10" ? { ...item, inStock: false } : item);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Trail Runner 2", }, soldOut)).toBe(soldOut[0]);
    expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "Trail Runner 2" }, soldOut)).toBeNull();
  });

  it("does not fall back to another product when an explicitly named product is unusable", () => {
    const unavailableTrail3 = items.map((item) => item.productId === "tr3" ? { ...item, cost: null, inStock: false } : item);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Can I get the Trail Runner 3?" }, unavailableTrail3)).toBeNull();
  });

  it("rejects a clearly named product that is absent from the catalog", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $100 for Pegasus 41?" }, items, items[1])).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $100 for the Moon Boot?" }, items, items[1])).toBeNull();
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $100 for Trail Runner 99?" }, items, items[1])).toBeNull();
  });

  it("keeps page context for a generic product reference and a shopper reason", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $120 for these shoes for a trail race?" }, items, items[1])).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $120 for a 50k race?" }, items, items[1])).toBe(items[0]);
  });

  it("keeps the page product when an add-on is mentioned as included or excluded", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $150 with Merino Socks included?" }, items, items[1])).toBe(items[1]);
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do $120 without Merino Socks?" }, items, items[1])).toBe(items[1]);
  });

  it("switches to an add-on when it is the direct product request", () => {
    expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Could you do Merino Socks for $15?" }, items, items[1])).toBe(items[3]);
  });
});

it("uses the selected size on a new product page after another product's generic follow-up", () => {
  expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "Can you do $120 for these?" }, items, items[3])).toBe(items[1]);
});
it("recognizes included named accessories on the first product-page request", () => {
  expect(selectCatalogItem({ product: { ...page, selectedVariantId: "202" }, productContextSource: "current", message: "Could you do $150 with Merino Socks included?" }, items)).toBe(items[1]);
});
it("does not mistake incidental conjunctions for a request to keep the previous product", () => {
  expect(selectCatalogItem({ product: page, productContextSource: "current", message: "Can I get Trail Runner 3 and buy today?" }, items, items[1])).toBe(items[4]);
});
