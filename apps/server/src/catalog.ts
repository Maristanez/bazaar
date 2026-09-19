export type NegotiationItem = {
  variantId: string;
  variantNumericId?: string;
  productId: string;
  productNumericId?: string;
  handle?: string;
  title: string;
  size?: string;
  productType?: string;
  list: number;
  cost: number | null;
  stockedAt?: string | null;
  inStock: boolean;
  isAddOn?: boolean;
  [key: string]: unknown;
};

export type CatalogPayload = {
  product?: Record<string, unknown> | null;
  productContextSource?: string;
  pageUrl?: string;
  message?: string;
  text?: string;
  variantSelectionChanged?: boolean;
  negotiationId?: string;
};

/** Resolve the shopper's product and variant without falling through to a different model. */
export function selectCatalogItem(
  payload: CatalogPayload,
  items: readonly NegotiationItem[],
  contextItem?: NegotiationItem,
  allowFallback = true,
): NegotiationItem | null {
  const product = payload.product && typeof payload.product === "object" ? payload.product : {};
  const rawMessage = payload.message || payload.text || "";
  const message = normalize(rawMessage);
  const usable = items.filter((item) => item.inStock && item.cost !== null);
  // Match named products against the whole catalog first. If the named
  // product is unavailable, the later usable-item checks return null instead
  // of silently falling through to the page product or a fallback model.
  const pageContext = hasAuthoritativeProduct(product, payload) ? items.find(item => productMatches(item, product)) : undefined;
  const accessoryContext = !payload.negotiationId && pageContext ? pageContext : contextItem ?? pageContext;
  const explicit = explicitProduct(message, items, accessoryContext);
  const sameProduct = (a: NegotiationItem | undefined, b: NegotiationItem | undefined): boolean => Boolean(a && b && (a.productId === b.productId || (!!a.handle && a.handle === b.handle)));

  let productItems: NegotiationItem[] = [];
  if (explicit) {
    productItems = items.filter((item) => item.productId === explicit.productId);
  } else if (hasAuthoritativeProduct(product, payload) && !payload.negotiationId && contextItem && !productMatches(contextItem, product)) {
    // A new product-page chat starts with that page's item, even when the
    // same shopper previously called another product "these".
    productItems = items.filter((item) => productMatches(item, product));
  } else if (contextItem && isGenericFollowup(message)) {
    productItems = items.filter((item) => item.productId === contextItem.productId);
  } else if (hasAuthoritativeProduct(product, payload)) {
    productItems = items.filter((item) => productMatches(item, product));
  }

  if (!productItems.length && contextItem && !explicit && (isGenericFollowup(message) || !hasAuthoritativeProduct(product, payload))) {
    productItems = items.filter((item) => item.productId === contextItem.productId);
  }
  if (!productItems.length && allowFallback && !explicit) {
    const fallback = usable.find((item) => !item.isAddOn) || usable[0];
    if (fallback) productItems = items.filter((item) => item.productId === fallback.productId);
  }
  if (!productItems.length) return null;

  const requestedSize = requestedSizeFrom(rawMessage);
  if (requestedSize !== null) {
    const sized = productItems.find((item) => normalize(item.size || "") === normalize(requestedSize));
    if (!sized) return null;
    return sized.inStock && sized.cost !== null ? sized : null;
  }

  const wantedVariant = stringId(product.selectedVariantId || product.variantId);
  const payloadSelectsThisProduct = productItems.some((item) => productMatches(item, product));
  const preserveContextVariant = contextItem && productItems.some(item => item.variantId === contextItem.variantId) && (isContextPreservingFollowup(message) || isAccessoryContextMessage(message)) && !payload.variantSelectionChanged;
  if (wantedVariant && payloadSelectsThisProduct && !preserveContextVariant) {
    const selected = productItems.find((item) => item.variantId === wantedVariant || item.variantNumericId === wantedVariant);
    if (!selected) return null;
    return selected.inStock && selected.cost !== null ? selected : null;
  }

  const contextVariant = contextItem && productItems.find((item) => item.variantId === contextItem.variantId);
  if (contextVariant && sameProduct(contextVariant, contextItem)) return contextVariant.inStock && contextVariant.cost !== null ? contextVariant : null;

  const first = productItems.find((item) => item.inStock && item.cost !== null);
  return first || null;
}

function hasAuthoritativeProduct(product: Record<string, unknown>, payload: CatalogPayload): boolean {
  if (!hasConcreteProduct(product)) return false;
  const source = String(payload.productContextSource || "").toLowerCase();
  if (source === "none" || source === "default") return false;
  return source === "current" || source === "active" || /\/products\//i.test(String(payload.pageUrl || "")) || !source;
}

function hasConcreteProduct(product: Record<string, unknown>): boolean {
  return ["selectedVariantId", "variantId", "productId", "id", "handle", "title"].some((key) => Boolean(product[key]));
}

function productMatches(item: NegotiationItem, product: Record<string, unknown>): boolean {
  const ids = [product.productId, product.id].filter(Boolean).map((value) => stripGid(String(value)));
  const variants = [product.selectedVariantId, product.variantId].filter(Boolean).map((value) => stripGid(String(value)));
  const handle = String(product.handle || "").toLowerCase();
  const title = normalize(String(product.title || ""));
  if (ids.length) return ids.includes(stripGid(item.productId)) || ids.includes(String(item.productNumericId || ""));
  if (handle) return handle === String(item.handle || "").toLowerCase();
  if (title) return title === normalize(item.title);
  return variants.includes(stripGid(item.variantId)) || variants.includes(String(item.variantNumericId || ""));
}

function explicitProduct(message: string, items: readonly NegotiationItem[], contextItem?: NegotiationItem): NegotiationItem | null {
  const candidates = items
    .map((item) => ({ item, score: productScore(message, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  if (contextItem) {
    const direct = candidates.filter(({ item }) => !isIncludedAccessory(message, item, contextItem));
    if (direct.length) return direct[0]!.item;
    if (candidates.length) return contextItem;
  }
  return candidates[0]?.item || null;
}

function isIncludedAccessory(message: string, item: NegotiationItem, context: NegotiationItem): boolean {
  if (!item.isAddOn || item.productId === context.productId) return false;
  const name = normalize(item.title);
  const position = message.indexOf(name);
  if (position < 0) return false;
  const before = message.slice(0, position).trim();
  const after = message.slice(position + name.length).trim();
  return /\b(?:with|including|plus|and|without|no|skip|exclude|excluding|don t want|do not want)(?: the)?$/.test(before)
    || /^(?:included|thrown in)\b/.test(after);
}

function isAccessoryContextMessage(message: string): boolean {
  return /\b(?:with|including|included|plus|and|without|no|skip|exclude|excluding|don't want|do not want)\b/.test(message);
}

function productScore(message: string, item: NegotiationItem): number {
  const haystack = ` ${message} `;
  const title = normalize(item.title);
  const handle = normalize(item.handle || "");
  let score = 0;
  if (title.length > 3 && haystack.includes(` ${title} `)) score += 100;
  if (handle.length > 3 && haystack.includes(` ${handle} `)) score += 90;
  return score;
}

function isGenericFollowup(message: string): boolean {
  return /\b(same|these|those|them|they|it|this|that|shoes?|runner|pair)\b/.test(message) && !explicitModelWords(message);
}

function isContextPreservingFollowup(message: string): boolean {
  return /\b(same|these|those|them|they|it|that)\b/.test(message);
}

function explicitModelWords(message: string): boolean {
  return /\b(?:trail|runner|merino|socks?|gaiters?|cap|flask|vest|shirt|tee)\b/.test(message);
}

function requestedSizeFrom(message: string): string | null {
  const match = /\b(?:size|sz)\s*(one\s+size|[a-z0-9]+(?:\s*[/\.]\s*[a-z0-9]+)?)\b/i.exec(message);
  return match?.[1] || null;
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? "" : stripGid(String(value));
}

function stripGid(value: string): string {
  return value.replace(/^gid:\/\/shopify\/(?:ProductVariant|Product)\//, "");
}
