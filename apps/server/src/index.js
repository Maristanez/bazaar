import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackboardShopkeeper } from "@bazaar/llm";
import { check as checkShopkeeperPick } from "./core/check.ts";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://b8wzw0-h3.myshopify.com",
  "http://127.0.0.1:9293",
  "http://localhost:9293",
];
const MAX_ROUNDS = 4;
const MAX_OFFER_QUANTITY = 10;
const MIRROR_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const backboardProvider = process.env.BACKBOARD_MODEL_PROVIDER || "openai";
const backboardModel = process.env.BACKBOARD_MODEL_NAME || "gpt-4.1-mini";
const backboardAssistantId = process.env.BACKBOARD_ASSISTANT_ID || "16072e36-597a-4720-94c3-1d4cf2f520f9";
const backboard = process.env.BACKBOARD_API_KEY
  ? createBackboardShopkeeper({
    apiKey: process.env.BACKBOARD_API_KEY,
    assistantId: backboardAssistantId,
    provider: backboardProvider,
    model: backboardModel,
    memory: process.env.BACKBOARD_MEMORY_MODE || "Readonly",
  })
  : null;
const FLOOR_PCT = Number(process.env.BAZAAR_FLOOR_PCT || 25);
const allowedOrigins = getAllowedOrigins();
const seedProducts = loadSeedProducts();
const state = {
  token: null,
  tokenExpiresAt: 0,
  mirror: { loadedAt: 0, products: [], items: [], warnings: [], source: "empty" },
  offers: new Map(),
  negotiations: new Map(),
  shopperContexts: new Map(),
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    sendCors(response, request);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const mirror = await safeSyncMirror();
    sendJson(response, request, 200, {
      ok: true,
      service: "bazaar-chat",
      model: `${backboardProvider}/${backboardModel}`,
      hasBackboardKey: Boolean(process.env.BACKBOARD_API_KEY),
      backboardAssistantConfigured: Boolean(backboardAssistantId),
      shopifyConfigured: hasShopifyCredentials(),
      products: mirror.products.length,
      mirrorSource: mirror.source,
      mirrorLoadedAt: mirror.loadedAt ? new Date(mirror.loadedAt).toISOString() : null,
      warnings: mirror.warnings,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, request, 200, {
      ok: true,
      service: "bazaar-chat",
      routes: ["GET /api/products", "POST /api/chat", "POST /api/offers", "POST /api/accept", "GET /api/stream", "GET /health"],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/products") {
    try {
      const mirror = await syncMirror({ force: url.searchParams.get("sync") === "1" });
      sendJson(response, request, 200, {
        items: publicProducts(mirror),
        loadedAt: new Date(mirror.loadedAt).toISOString(),
        source: mirror.source,
        warnings: mirror.warnings,
      });
    } catch (error) {
      console.error("[api/products]", error);
      sendJson(response, request, 503, { error: "shopify_unavailable", items: publicProducts(state.mirror), warnings: [error.message] });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stream") {
    sendCors(response, request);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`);
    const heartbeat = setInterval(() => {
      response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, 15_000);
    request.on("close", () => clearInterval(heartbeat));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    try {
      const payload = await readJson(request);
      const message = String(payload.message || "").trim();
      if (!message) {
        sendJson(response, request, 400, { error: "message is required" });
        return;
      }
      if (isOfferIntent(message)) {
        sendJson(response, request, 200, await makeOfferFromPayload(payload, message));
        return;
      }
      const mirror = await safeSyncMirror();
      const shopperId = stringOrNull(payload.shopperId) || "anonymous-shopper";
      const matched = findProductFromPayload({ ...payload, text: message }, mirror);
      const negotiationId = stringOrNull(payload.negotiationId)
        || `${shopperId}:${matched?.item.productId || "catalog"}:${matched?.item.size || "default"}`;
      const context = {
        message,
        shopperId,
        negotiationId,
        pageUrl: stringOrNull(payload.pageUrl),
        product: enrichPublicProduct(publicObjectOrNull(payload.product), mirror),
        products: publicProducts(mirror).slice(0, 8),
        lastProducts: resolveShopperProducts(payload.shopperId, mirror),
      };
      const deterministic = deterministicReply(context);
      const sizingQuestion = /\b(?:size|sizing|shoe|fit)\b/i.test(message);
      const useLocalReply = Boolean(deterministic?.memoryProducts?.length) && !sizingQuestion;
      if (useLocalReply) rememberShopperProducts(shopperId, deterministic.memoryProducts);
      const reply = useLocalReply ? deterministic.reply : await answerWithBackboard(context, deterministic?.reply);
      sendJson(response, request, 200, { reply, products: publicProducts(mirror).slice(0, 8) });
    } catch (error) {
      console.error("[api/chat]", error);
      sendJson(response, request, 500, { reply: fallbackReply(), error: "chat_failed" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/offers") {
    try {
      const payload = await readJson(request);
      sendJson(response, request, 200, await makeOfferFromPayload(payload, String(payload.message || payload.text || "")));
    } catch (error) {
      console.error("[api/offers]", error);
      sendJson(response, request, 400, { error: "offer_failed", reply: "I could not make a safe offer for that product yet." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/accept") {
    try {
      const payload = await readJson(request);
      const settlement = await acceptOffer(String(payload.offerId || "").trim());
      const reply = settlement.code
        ? `Deal. Use ${settlement.code} at checkout — I opened it with the code already applied.`
        : "Deal. I opened Shopify Checkout with the accepted items.";
      sendJson(response, request, 200, { settlement, reply });
    } catch (error) {
      console.error("[api/accept]", error);
      sendJson(response, request, 400, { error: "accept_failed", reply: error.message || "That offer cannot be accepted anymore." });
    }
    return;
  }

  sendJson(response, request, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`Bazaar server listening on :${port}`);
});

function loadLocalEnv() {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(startDir, "../../../.env"), join(startDir, "../../.env"), join(process.cwd(), ".env")];
  for (const candidate of candidates) {
    try {
      const envText = readFileSync(resolve(candidate), "utf8");
      for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const index = trimmed.indexOf("=");
        const key = trimmed.slice(0, index).trim();
        const rawValue = trimmed.slice(index + 1).trim();
        const value = rawValue.replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      return;
    } catch {
      // Try the next likely repo/app location.
    }
  }
}

function loadSeedProducts() {
  const candidates = [
    resolve(process.cwd(), "infra/seed/products.json"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../infra/seed/products.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      // Try the next likely repo/app location.
    }
  }
  return [];
}

function getAllowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function sendCors(response, request) {
  const origin = request.headers.origin;
  const isShopifyPreview = origin && /^https:\/\/[a-z0-9-]+\.shopifypreview\.com$/i.test(origin);
  const allowed = origin && (allowedOrigins.includes(origin) || isShopifyPreview);
  if (allowed) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(response, request, status, body) {
  sendCors(response, request);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 128_000) request.destroy(new Error("Request body too large"));
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hasShopifyCredentials() {
  return Boolean(shopName() && ((process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN));
}

function shopName() {
  const configured = String(process.env.SHOPIFY_SHOP || "b8wzw0-h3").trim();
  return configured.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\.myshopify\.com$/, "");
}

function shopBaseUrl() {
  return `https://${shopName()}.myshopify.com`;
}

async function safeSyncMirror() {
  try {
    return await syncMirror();
  } catch (error) {
    if (state.mirror.products.length) return state.mirror;
    console.error("[mirror]", error);
    state.mirror = seedMirror(error.message);
    return state.mirror;
  }
}

async function syncMirror({ force = false } = {}) {
  const now = Date.now();
  if (!force && state.mirror.loadedAt && now - state.mirror.loadedAt < MIRROR_TTL_MS) return state.mirror;
  if (!hasShopifyCredentials()) {
    state.mirror = seedMirror("Shopify credentials are not configured; using seed catalog.");
    return state.mirror;
  }
  const data = await shopifyGraphql(PRODUCTS_QUERY, {});
  const products = data.products.nodes.map(mapShopifyProduct).filter(Boolean);
  const items = products.flatMap((product) => product.variants.map((variant) => ({
    variantId: variant.gid,
    variantNumericId: variant.numericId,
    productId: product.gid,
    productNumericId: product.numericId,
    handle: product.handle,
    title: product.title,
    size: variant.title === "Default Title" ? undefined : variant.title,
    productType: product.productType || "Apparel",
    list: variant.price,
    cost: variant.unitCost,
    stockedAt: product.stockedAt,
    inStock: variant.inStock,
    isAddOn: isAddOn(product),
    image: product.image,
    url: `/products/${product.handle}`,
  })));
  const warnings = [];
  if (items.some((item) => item.cost === null)) warnings.push("Some Shopify variants did not expose unit cost; those variants are not open to real offers.");
  if (!products.length) warnings.push("No active Shopify products were returned.");
  state.mirror = { loadedAt: now, products, items, warnings, source: "shopify-admin" };
  return state.mirror;
}

const PRODUCTS_QUERY = `#graphql
  query BazaarProducts {
    products(first: 50, query: "status:active") {
      nodes {
        id
        title
        handle
        productType
        featuredImage { url }
        metafield(namespace: "bazaar", key: "stocked_at") { value }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
            inventoryItem {
              tracked
              unitCost { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

function mapShopifyProduct(product) {
  if (!product) return null;
  const seed = seedProducts.find((entry) => entry.handle === product.handle || entry.title === product.title);
  const variants = (product.variants?.nodes || []).map((variant) => {
    const seedVariant = seed?.variants?.find((entry) => entry.sku === variant.sku || entry.size === variant.title);
    const unitCost = variant.inventoryItem?.unitCost?.amount ? dollarsToCents(variant.inventoryItem.unitCost.amount) : seed?.unitCost ?? null;
    return {
      gid: variant.id,
      numericId: gidTail(variant.id),
      title: variant.title,
      sku: variant.sku,
      price: dollarsToCents(variant.price),
      unitCost,
      inStock: Number(variant.inventoryQuantity ?? seedVariant?.inventory ?? 0) > 0,
    };
  });
  return {
    gid: product.id,
    numericId: gidTail(product.id),
    handle: product.handle,
    title: product.title,
    productType: product.productType || seed?.productType || "",
    image: product.featuredImage?.url || "",
    stockedAt: product.metafield?.value || seed?.stockedAt || null,
    variants,
  };
}

function seedMirror(reason) {
  const products = seedProducts.map((seed) => ({
    gid: `seed://${seed.handle}`,
    numericId: seed.handle,
    handle: seed.handle,
    title: seed.title,
    productType: seed.productType,
    image: "",
    stockedAt: seed.stockedAt,
    variants: seed.variants.map((variant, index) => ({
      gid: `seed://${seed.handle}/${variant.sku}`,
      numericId: String(index + 1),
      title: variant.size,
      sku: variant.sku,
      price: seed.listPrice,
      unitCost: seed.unitCost,
      inStock: variant.inventory > 0,
    })),
  }));
  const items = products.flatMap((product) => product.variants.map((variant) => ({
    variantId: variant.gid,
    variantNumericId: variant.numericId,
    productId: product.gid,
    productNumericId: product.numericId,
    handle: product.handle,
    title: product.title,
    size: variant.title,
    productType: product.productType,
    list: variant.price,
    cost: variant.unitCost,
    stockedAt: product.stockedAt,
    inStock: variant.inStock,
    isAddOn: isAddOn(product),
    image: product.image,
    url: `/products/${product.handle}`,
  })));
  return { loadedAt: Date.now(), products, items, warnings: [reason].filter(Boolean), source: "seed-fallback" };
}

async function getShopifyToken({ force = false } = {}) {
  if (!force && state.token && Date.now() < state.tokenExpiresAt - 60_000) return state.token;
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    state.token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    state.tokenExpiresAt = Date.now() + DAY_MS;
    return state.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SHOPIFY_CLIENT_ID || "",
    client_secret: process.env.SHOPIFY_CLIENT_SECRET || "",
  });
  const response = await fetch(`${shopBaseUrl()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify token ${response.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token");
  state.token = data.access_token;
  state.tokenExpiresAt = Date.now() + Number(data.expires_in || 86_399) * 1000;
  return state.token;
}

async function shopifyGraphql(query, variables, retried = false) {
  const token = await getShopifyToken({ force: retried });
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
  const response = await fetch(`${shopBaseUrl()}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (response.status === 401 && !retried) {
    state.token = null;
    state.tokenExpiresAt = 0;
    return shopifyGraphql(query, variables, true);
  }
  if (!response.ok) throw new Error(`Shopify GraphQL ${response.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  if (data.errors?.length) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors).slice(0, 500)}`);
  return data.data;
}

function publicProducts(mirror) {
  return mirror.products.map((product) => {
    const purchasable = product.variants.filter((variant) => variant.inStock);
    const first = purchasable[0] || product.variants[0];
    return {
      productId: product.gid,
      productNumericId: product.numericId,
      handle: product.handle,
      title: product.title,
      image: product.image,
      url: `/products/${product.handle}`,
      type: product.productType,
      listPrice: first ? roundToShopper(first.price) : 0,
      price: first ? formatMoney(roundToShopper(first.price)) : "",
      sizes: purchasable.map((variant) => variant.title).filter((title) => title && title !== "Default Title"),
      selectedVariantId: first?.gid,
      selectedVariantNumericId: first?.numericId,
      openToOffers: purchasable.some((variant) => variant.unitCost !== null),
    };
  });
}

function enrichPublicProduct(product, mirror) {
  if (!product) return null;
  return findProductFromPayload({ product }, mirror)?.publicProduct || product;
}

async function makeOfferFromPayload(payload, message) {
  const mirror = await syncMirror();
  const shopperContext = resolveShopperContext(payload.shopperId, mirror);
  const understanding = await understandOffer(message, payload, mirror);
  const matchText = [message, understanding.productHint].filter(Boolean).join(" ");
  const match = findProductFromPayload({ ...payload, text: matchText }, mirror, { contextItem: shopperContext?.item, allowFallback: false });
  if (!match) return { reply: "Pick a published product first, then send me a number like “Could you do $120?”", products: publicProducts(mirror).slice(0, 8) };
  const terms = parseOfferTerms(message, payload, understanding, { fallbackQuantity: shopperContext?.quantity || 1 });
  const sameContextItem = shopperContext?.item && shopperContext.item.productId === match.item.productId;
  const reasonText = [
    message,
    understanding.reasonText,
    ...(understanding.reasonTags || []),
    ...(sameContextItem ? [shopperContext?.reasonText, ...(shopperContext?.reasonTags || [])] : []),
  ].filter(Boolean).join(" ");
  const reason = applyNegotiationContext(analyzeBuyerReason(reasonText), { quantity: terms.quantity });
  if (terms.dollars === null) {
    rememberShopperContext(payload.shopperId, match.item, terms.quantity || shopperContext?.quantity || 1, shopperContext?.negotiationId || null, { reasonText, reasonTags: reason.labels });
    return {
      reply: `I can talk about ${match.item.title}, but I need your number first. Try “Could you do ${formatMoney(roundToShopper(match.item.list * (terms.quantity || 1) * 0.85))}${(terms.quantity || 1) > 1 ? " total" : ""}?” and give me a reason.`,
      products: prioritizePublicProducts(mirror, match.item).slice(0, 8),
    };
  }
  const quantity = terms.quantity;
  const offered = dollarsToCents(terms.perUnit ? terms.dollars * quantity : terms.dollars);
  const negotiationId = String(payload.negotiationId || `${payload.shopperId || "shopper"}:${match.item.productId}:${match.item.size || "default"}:${quantity}`);
  const previousRound = state.negotiations.get(negotiationId)?.round || 0;
  const round = Math.min(MAX_ROUNDS, previousRound + 1);
  state.negotiations.set(negotiationId, { round, productId: match.item.productId, quantity });
  rememberShopperContext(payload.shopperId, match.item, quantity, negotiationId, { reasonText, reasonTags: reason.labels });
  const offer = priceOffer(match.item, offered, round, mirror, reason, quantity);
  const shopperId = String(payload.shopperId || "anonymous-shopper");
  const phrased = await phraseOfferWithBackboard({ offer, shopperId, negotiationId, message, round, main: match.item });
  const replyLine = phrased.line;
  const offerId = randomId("offer");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const card = {
    negotiationId,
    offerId,
    status: "live",
    round,
    maxRounds: MAX_ROUNDS,
    option: {
      id: offer.kind === "accepted" ? "accepted" : "A",
      kind: offer.kind === "bundle" ? "bundle" : round === MAX_ROUNDS ? "final" : "held",
      items: offer.items.map((item, index) => ({
        variantId: item.variantNumericId,
        title: item.title,
        ...(item.size ? { size: item.size } : {}),
        qty: item.qty || 1,
        ...(index > 0 ? { thrownIn: true } : {}),
      })),
      listTotal: offer.listTotal,
      total: offer.total,
    },
    line: replyLine,
    mood: offer.kind === "accepted" ? "deal" : offer.kind === "bundle" ? "tempted" : "idle",
    badges: offer.badges,
    trail: [
      { label: "List", amount: offer.listTotal, by: "shop" },
      { label: round === 1 ? "Your offer" : `Round ${round}`, amount: roundToShopper(offered), by: "shopper" },
      { label: "Shop", amount: offer.total, by: "shop" },
    ],
    expiresAt: expiresAt.toISOString(),
    disclosure: ["Priced from private cost data on the server.", "Only this card is binding; chat text is not."],
  };
  state.offers.set(offerId, { ...offer, line: replyLine, offerId, negotiationId, expiresAt, status: "live", backboard: phrased.trace });
  return { reply: replyLine, card, products: prioritizePublicProducts(mirror, match.item).slice(0, 8) };
}

function priceOffer(main, offered, round, mirror, reason = { score: 0, label: null }, quantity = 1) {
  const mainQty = withQuantity(main, quantity);
  if (main.cost === null) {
    return { kind: "closed", items: [mainQty], listTotal: roundToShopper(main.list * quantity), total: roundToShopper(main.list * quantity), line: "I cannot safely haggle this item because the store cost is missing.", badges: ["missing cost"] };
  }
  const listTotal = roundToShopper(main.list * quantity);
  if (offered >= listTotal && !reason.hasAddOnIntent) {
    return { kind: "accepted", items: [mainQty], listTotal, total: listTotal, line: `${main.title} is already ${formatMoney(roundToShopper(main.list))}${quantity > 1 ? " each" : ""}. You can check out at list price, or send me a lower offer to haggle.`, badges: ["list price", "checkout ready"] };
  }
  const pricedMain = { ...main, list: main.list * quantity };
  const floor = Math.ceil(main.cost * quantity * (1 + FLOOR_PCT / 100));
  const baseTarget = targetOf(pricedMain, floor);
  const sellerTarget = sellerTargetFor(pricedMain, floor, baseTarget, reason, round);
  const ask = sellerAskFor(pricedMain, sellerTarget, round, reason);
  const safeOffered = roundToShopper(offered);
  const hasConvincingReason = reason.score >= 2 || reason.hasBulkIntent || quantity > 1;
  const isLowball = safeOffered < roundToShopper(main.list * quantity * 0.8);
  if (safeOffered >= floor && safeOffered >= sellerTarget && safeOffered <= listTotal && round >= 2 && hasConvincingReason) {
    return { kind: "accepted", items: [mainQty], listTotal, total: safeOffered, line: `${reasonPrefix(reason)}Deal — I can hold ${formatMoney(safeOffered)} for 15 minutes.`, badges: reasonBadges(reason, ["good intent", "held 15:00"]) };
  }
  const addOn = mirror.items.find((item) => item.isAddOn && item.inStock && item.cost !== null);
  if (addOn && !main.isAddOn && addOn.productId !== main.productId && round < MAX_ROUNDS && reason.hasAddOnIntent) {
    const addonPart = Math.ceil(addOn.cost + (addOn.list - addOn.cost) / 2);
    const bundleFloor = floor + Math.ceil(addOn.cost * (1 + FLOOR_PCT / 100));
    const bundleTotal = roundToShopper(Math.max(ask + addonPart, bundleFloor));
    return { kind: "bundle", items: [mainQty, addOn], listTotal: roundToShopper(main.list * quantity + addOn.list), total: bundleTotal, line: `${reasonPrefix(reason)}I would rather protect the single-item price, but I can make the cart better: ${formatMoney(bundleTotal)} with ${addOn.title} included.`, badges: reasonBadges(reason, [`＋ ${addOn.title}`, "bundle value"]) };
  }
  if (round === 1 && reason.score > 0) {
    const openingAsk = sellerAskFor(pricedMain, sellerTarget, 1, reason);
    return {
      kind: "counter",
      items: [mainQty],
      listTotal,
      total: openingAsk,
      line: `${reasonPrefix(reason)}I can start at ${formatMoney(openingAsk)}. If you can show stronger intent — bundle, checkout today, or a real comparison — I may be able to sharpen it.`,
      badges: reasonBadges(reason, ["opening counter", "seller guarded"]),
    };
  }
  if (reason.score === 0 && (round >= 3 || isLowball)) {
    return {
      kind: "counter",
      items: [mainQty],
      listTotal,
      total: ask,
      line: `I am going to hold firm at ${formatMoney(ask)} on this one. I need a stronger reason to move lower — a real bundle, checkout today, or a fair comparison.`,
      badges: ["holding margin", "reason needed"],
    };
  }
  const weakReasonNudge = reason.score === 0 && round < MAX_ROUNDS ? "I need a better reason before I move much. " : "";
  const line = round === MAX_ROUNDS
    ? `${reasonPrefix(reason)}I would stay at ${formatMoney(ask)} here. Going lower does not make sense for the store on this ask.`
    : `${weakReasonNudge}${reasonPrefix(reason)}I can do ${formatMoney(ask)} if you want to move forward.`;
  return { kind: "counter", items: [mainQty], listTotal, total: ask, line, badges: reasonBadges(reason, [round === MAX_ROUNDS ? "firm counter" : reason.score === 0 ? "reason needed" : "seller counter"]) };
}

function analyzeBuyerReason(message) {
  const text = String(message || "").toLowerCase();
  const signals = [
    { pattern: /\b(student|college|school|tight budget|budget is|payday|saving up)\b/, score: 1, label: "budget" },
    { pattern: /\b(buy|buying|grab|take|get|adding|add|order).*\b(two|2|both|multiple|pair|couple|tees|shirts|items|bundle|socks|cap|gaiters|vest|flask|kit)\b|\b(bundle|multiple items|full kit|whole kit|couple|pair)\b/, score: 2, label: "quantity intent", key: "bulk" },
    { pattern: /\b(socks?|cap|gaiters?|vest|flask|kit)\b/, score: 1, label: "add-on intent", key: "addon" },
    { pattern: /\b(returning|repeat|loyal|bought before|customer already|local)\b/, score: 1, label: "repeat shopper" },
    { pattern: /\b(last season|older model|clearance|sale|price match|competitor|elsewhere|same shoe)\b/, score: 2, label: "market comparison", key: "market" },
    { pattern: /\b(race|marathon|trail day|trip|weekend hike|gift|birthday|team|club)\b/, score: 1, label: "real use case" },
    { pattern: /\b(today|right now|checkout now|buy now|order now|ready to buy|buying now)\b/, score: 1, label: "ready to buy", key: "ready" },
  ];
  const matched = signals.filter((signal) => signal.pattern.test(text));
  const score = Math.min(4, matched.reduce((sum, signal) => sum + signal.score, 0));
  const primary = matched.slice().sort((a, b) => b.score - a.score)[0];
  return {
    score,
    label: primary?.label || null,
    labels: matched.map((signal) => signal.label),
    hasBulkIntent: matched.some((signal) => signal.key === "bulk"),
    hasAddOnIntent: matched.some((signal) => signal.key === "addon"),
    hasMarketComparison: matched.some((signal) => signal.key === "market"),
    isReadyToBuy: matched.some((signal) => signal.key === "ready"),
  };
}

function applyNegotiationContext(reason, context = {}) {
  const quantity = Number(context.quantity || 0);
  if (quantity <= 1 || reason.hasBulkIntent) return reason;
  const labels = Array.from(new Set([...(reason.labels || []), "quantity intent"]));
  return {
    ...reason,
    score: Math.min(4, Math.max(reason.score || 0, 2)),
    label: reason.score >= 2 && reason.label ? reason.label : "quantity intent",
    labels,
    hasBulkIntent: true,
  };
}

function reasonAdjustedTarget(list, baseTarget, score) {
  const strength = score >= 4 ? 0.7 : score >= 3 ? 0.55 : score === 2 ? 0.4 : score === 1 ? 0.2 : 0.05;
  return Math.ceil(list - strength * (list - baseTarget));
}

function sellerTargetFor(item, floor, baseTarget, reason, round) {
  const reasonTarget = reasonAdjustedTarget(item.list, baseTarget, reason.score);
  const protectedDiscount = maxSellerDiscount(reason, round);
  const protectedTarget = roundToShopper(item.list * (1 - protectedDiscount));
  return roundToShopper(Math.max(floor, reasonTarget, protectedTarget));
}

function sellerAskFor(item, sellerTarget, round, reason) {
  if (reason.score === 0 && round <= 2) return roundToShopper(item.list);
  return roundToShopper(askFor(item.list, sellerTarget, item.stockedAt, round));
}

function maxSellerDiscount(reason, round) {
  const baseByScore = {
    0: [0, 0, 0.04, 0.06],
    1: [0.02, 0.04, 0.07, 0.09],
    2: [0.03, 0.06, 0.1, 0.12],
    3: [0.04, 0.08, 0.12, 0.15],
    4: [0.05, 0.1, 0.15, 0.18],
  };
  const score = Math.max(0, Math.min(4, reason.score || 0));
  let discount = baseByScore[score][Math.max(1, Math.min(MAX_ROUNDS, round)) - 1];
  if (reason.hasBulkIntent) discount += 0.03;
  if (reason.hasAddOnIntent) discount += 0.02;
  if (reason.isReadyToBuy) discount += 0.02;
  if (reason.hasMarketComparison) discount += 0.02;
  return Math.min(0.22, discount);
}

function reasonPrefix(reason) {
  if (!reason || !reason.label) return "";
  return `That gives me something to work with (${reason.label}). `;
}

function reasonBadges(reason, badges) {
  if (!reason || !reason.label) return badges;
  return [`reason: ${reason.label}`].concat(badges);
}

async function acceptOffer(offerId) {
  const offer = state.offers.get(offerId);
  if (!offer) throw new Error("I cannot find that offer anymore.");
  if (offer.status !== "live") throw new Error("That offer has already been used.");
  if (Date.now() > offer.expiresAt.getTime()) {
    offer.status = "expired";
    throw new Error("That offer expired. Send a fresh offer and I will price it again.");
  }
  if (offer.kind === "closed") throw new Error("That item is not open to offers yet.");
  const settlement = await mintDiscount(offer);
  offer.status = "accepted";
  offer.settlement = settlement;
  return settlement;
}

const DISCOUNT_MUTATION = `#graphql
  mutation BazaarDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            codes(first: 1) { nodes { code } }
            startsAt
            endsAt
          }
        }
      }
      userErrors { field message code }
    }
  }
`;

async function mintDiscount(offer) {
  if (offer.items.some((item) => String(item.variantId).startsWith("seed://"))) throw new Error("This offer came from the seed fallback, so I will not create a fake Shopify checkout.");
  const code = `TRAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const discountAmount = Math.max(0, offer.listTotal - offer.total);
  if (discountAmount <= 0) {
    return { offerId: offer.offerId, code: null, agreedTotal: offer.total, checkoutUrl: checkoutUrl(offer.items), expiresAt: offer.expiresAt.toISOString() };
  }
  const variables = {
    basicCodeDiscount: {
      title: `Trailhead offer ${code}`,
      code,
      startsAt: new Date().toISOString(),
      endsAt: offer.expiresAt.toISOString(),
      context: { all: "ALL" },
      usageLimit: 1,
      appliesOncePerCustomer: true,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: centsToDecimal(offer.listTotal) } },
      customerGets: {
        value: { discountAmount: { amount: centsToDecimal(discountAmount), appliesOnEachItem: false } },
        items: { products: { productVariantsToAdd: offer.items.map((item) => item.variantId) } },
      },
    },
  };
  const data = await shopifyGraphql(DISCOUNT_MUTATION, variables);
  const errors = data.discountCodeBasicCreate?.userErrors || [];
  if (errors.length) throw new Error(`Shopify discount rejected it: ${errors.map((error) => error.message).join("; ")}`);
  return { offerId: offer.offerId, code, agreedTotal: offer.total, checkoutUrl: checkoutUrl(offer.items, code), expiresAt: offer.expiresAt.toISOString() };
}

function checkoutUrl(items, code) {
  const cart = items.map((item) => `${item.variantNumericId}:${item.qty || 1}`).join(",");
  const discount = code ? `?discount=${encodeURIComponent(code)}` : "";
  return `${shopBaseUrl()}/cart/${cart}${discount}`;
}

function findProductFromPayload(payload, mirror, options = {}) {
  const product = payload.product && typeof payload.product === "object" ? payload.product : payload;
  const text = String(payload.text || payload.message || "").toLowerCase();
  const allowFallback = options.allowFallback !== false;
  const payloadIsAuthoritative = isAuthoritativeProductPayload(product, payload, mirror);
  const wantedVariant = String(product.selectedVariantId || product.variantId || "").replace(/^gid:\/\/shopify\/ProductVariant\//, "");
  const wantedProduct = String(product.productId || product.id || "").replace(/^gid:\/\/shopify\/Product\//, "");
  const wantedHandle = stringOrNull(product.handle);
  const wantedTitle = stringOrNull(product.title);
  const explicitItem = bestExplicitProductMention(text, mirror.items);
  let item = explicitItem;
  if (!item && options.contextItem && !payloadIsAuthoritative) item = options.contextItem;
  if (!item && payloadIsAuthoritative) item = mirror.items.find((entry) => entry.variantNumericId === wantedVariant || entry.variantId === product.selectedVariantId);
  if (!item && payloadIsAuthoritative && wantedProduct) item = mirror.items.find((entry) => entry.productNumericId === wantedProduct || entry.productId === product.productId);
  if (!item && payloadIsAuthoritative && wantedHandle) item = mirror.items.find((entry) => entry.handle === wantedHandle);
  if (!item && payloadIsAuthoritative && wantedTitle) item = mirror.items.find((entry) => entry.title.toLowerCase() === wantedTitle.toLowerCase());
  if (!item && allowFallback) item = mirror.items.find((entry) => !entry.isAddOn && entry.inStock && entry.cost !== null) || mirror.items[0];
  if (!item) return null;
  const publicProduct = publicProducts(mirror).find((entry) => entry.productId === item.productId || entry.handle === item.handle);
  return { item, publicProduct };
}

function hasConcreteProductPayload(product) {
  return Boolean(product?.selectedVariantId || product?.variantId || product?.productId || product?.id || product?.handle || product?.title);
}

function isAuthoritativeProductPayload(product, payload, mirror) {
  if (!hasConcreteProductPayload(product)) return false;
  const source = stringOrNull(payload.productContextSource);
  if (source === "active" || source === "current") return true;
  if (source === "none" || source === "default") return false;
  const pageUrl = stringOrNull(payload.pageUrl) || "";
  if (/\/products\//i.test(pageUrl)) return true;
  const firstProduct = publicProducts(mirror)[0];
  if (!firstProduct) return true;
  const sameAsFirst = product.handle === firstProduct.handle
    || product.productId === firstProduct.productId
    || product.id === firstProduct.productId
    || String(product.title || "").toLowerCase() === String(firstProduct.title || "").toLowerCase();
  return !sameAsFirst;
}

function resolveShopperContext(shopperId, mirror) {
  const id = stringOrNull(shopperId);
  if (!id) return null;
  const context = state.shopperContexts.get(id);
  if (!context || Date.now() - context.updatedAt > 30 * 60_000) return null;
  if (!context.productId && !context.variantId) return null;
  const item = mirror.items.find((entry) => entry.variantId === context.variantId || entry.productId === context.productId);
  return item ? { ...context, item } : null;
}

function rememberShopperContext(shopperId, item, quantity, negotiationId, details = {}) {
  const id = stringOrNull(shopperId);
  if (!id || !item) return;
  const existing = state.shopperContexts.get(id) || {};
  state.shopperContexts.set(id, {
    ...existing,
    productId: item.productId,
    variantId: item.variantId,
    quantity,
    negotiationId,
    reasonText: stringOrNull(details.reasonText) || existing.reasonText || null,
    reasonTags: Array.isArray(details.reasonTags) && details.reasonTags.length ? details.reasonTags.slice(0, 6) : existing.reasonTags || [],
    updatedAt: Date.now(),
  });
}

function resolveShopperProducts(shopperId, mirror) {
  const id = stringOrNull(shopperId);
  if (!id) return [];
  const context = state.shopperContexts.get(id);
  if (!context || Date.now() - context.updatedAt > 30 * 60_000 || !Array.isArray(context.productHandles)) return [];
  const products = publicProducts(mirror);
  return context.productHandles
    .map((handle) => products.find((product) => product.handle === handle))
    .filter(Boolean);
}

function rememberShopperProducts(shopperId, products) {
  const id = stringOrNull(shopperId);
  const handles = (Array.isArray(products) ? products : []).map((product) => product.handle).filter(Boolean);
  if (!id || !handles.length) return;
  const existing = state.shopperContexts.get(id) || {};
  state.shopperContexts.set(id, { ...existing, productHandles: handles, updatedAt: Date.now() });
}

function prioritizePublicProducts(mirror, item) {
  const products = publicProducts(mirror);
  if (!item) return products;
  return products.slice().sort((a, b) => {
    const aMatch = a.productId === item.productId || a.handle === item.handle ? 1 : 0;
    const bMatch = b.productId === item.productId || b.handle === item.handle ? 1 : 0;
    return bMatch - aMatch;
  });
}

function bestExplicitProductMention(text, items) {
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return null;
  const candidates = items
    .filter((item) => item.inStock && item.cost !== null)
    .map((item) => ({ item, score: productMentionScore(normalizedText, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  const nonAddOn = candidates.find((candidate) => !candidate.item.isAddOn);
  if (nonAddOn && candidates[0]?.item.isAddOn && /\b(bundle|with|plus|and|add|throw in|include)\b/i.test(normalizedText)) {
    return nonAddOn.item;
  }
  return candidates[0]?.item || null;
}

function productMentionScore(text, item) {
  const haystack = ` ${text} `;
  const title = normalizeSearchText(item.title);
  const handle = normalizeSearchText(item.handle);
  const type = normalizeSearchText(item.productType);
  let score = 0;
  if (title.length > 3 && haystack.includes(` ${title} `)) score += 100;
  if (handle.length > 3 && haystack.includes(` ${handle} `)) score += 90;
  for (const token of productSearchTokens(item, type)) {
    if (haystack.includes(` ${token} `)) score += token.length > 4 ? 18 : 12;
  }
  return score;
}

function productSearchTokens(item, type) {
  const source = normalizeSearchText(`${item.title || ""} ${item.handle || ""} ${type || ""}`);
  const tokens = new Set(source.split(" ").filter((token) => token.length >= 3 && !PRODUCT_STOP_WORDS.has(token)));
  for (const alias of productAliasTokens(item, type)) tokens.add(alias);
  for (const token of [...tokens]) {
    if (token.endsWith("s") && token.length > 3) tokens.add(token.slice(0, -1));
    if (!token.endsWith("s")) tokens.add(`${token}s`);
  }
  return tokens;
}

function productAliasTokens(item, type) {
  const text = normalizeSearchText(`${item.title || ""} ${item.handle || ""} ${type || ""}`);
  const aliases = new Set();
  if (/\b(tee|shirt|t shirts?|apparel)\b/.test(text)) {
    ["top", "tops", "tshirt", "tshirts", "tshirt", "shirt", "shirts", "tee", "tees"].forEach((token) => aliases.add(token));
  }
  if (/\b(shoe|runner|ridge|footwear)\b/.test(text)) {
    ["shoe", "shoes", "runner", "runners", "sneaker", "sneakers", "kick", "kicks", "footwear"].forEach((token) => aliases.add(token));
  }
  if (/\b(sock|socks)\b/.test(text)) {
    ["sock", "socks", "pair", "pairs"].forEach((token) => aliases.add(token));
  }
  if (/\b(cap|hat)\b/.test(text)) {
    ["cap", "caps", "hat", "hats"].forEach((token) => aliases.add(token));
  }
  if (/\b(flask|bottle)\b/.test(text)) {
    ["flask", "flasks", "bottle", "bottles"].forEach((token) => aliases.add(token));
  }
  if (/\b(vest|hydration)\b/.test(text)) {
    ["vest", "vests", "pack", "packs", "hydration"].forEach((token) => aliases.add(token));
  }
  if (/\b(gaiter|gaiters)\b/.test(text)) {
    ["gaiter", "gaiters"].forEach((token) => aliases.add(token));
  }
  return aliases;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_STOP_WORDS = new Set(["the", "and", "for", "with", "trail", "open", "offer", "offers", "product"]);

async function understandOffer(message, payload) {
  return deterministicOfferUnderstanding(message, payload);
}

function deterministicOfferUnderstanding(message, payload = {}) {
  return {
    productHint: null,
    quantity: parseQuantity(message, null),
    dollars: parseMoney(message) ?? parseMoney(payload.amount),
    perUnit: isPerUnitOffer(message),
    reasonText: message,
    reasonTags: [],
    confidence: parseMoney(message) !== null ? 0.6 : 0.35,
  };
}

async function answerWithBackboard(context, fallbackLine) {
  const fallback = () => fallbackLine || fallbackReply(context);
  if (!backboard) return fallback();
  try {
    const answer = await backboard.answerQuestion({
      shopperId: context.shopperId,
      negotiationId: context.negotiationId,
      shopperMessage: context.message,
      product: context.product || undefined,
      products: context.products,
    });
    logBackboardRun("question", answer.trace);
    return answer.reply;
  } catch (error) {
    console.error("[backboard/question]", error instanceof Error ? error.message : error);
    return fallback();
  }
}

async function phraseOfferWithBackboard({ offer, shopperId, negotiationId, message, round, main }) {
  if (!backboard || offer.kind === "closed") return { line: offer.line, trace: null };
  const option = {
    id: offer.kind === "accepted" ? "accepted" : "A",
    kind: offer.kind === "bundle" ? "bundle" : round === MAX_ROUNDS ? "final" : "held",
    items: offer.items.map((item, index) => ({
      variantId: item.variantId,
      title: item.title,
      ...(item.size ? { size: item.size } : {}),
      qty: item.qty || 1,
      ...(index > 0 ? { thrownIn: true } : {}),
    })),
    listTotal: offer.listTotal,
    total: offer.total,
    ownerRank: 1,
    facts: [],
  };
  try {
    const choice = await backboard.chooseAndSay([option], {
      shopperId,
      negotiationId,
      shopperMessage: message,
      productId: main.productId,
      title: main.title,
      ...(main.size ? { size: main.size } : {}),
      round,
    });
    const checked = checkShopkeeperPick({ menu: [option], pick: choice });
    logBackboardRun(checked.ok ? "offer" : `offer_blocked_${checked.reason}`, choice.trace);
    return checked.ok ? { line: choice.line, trace: choice.trace } : { line: offer.line, trace: choice.trace };
  } catch (error) {
    console.error("[backboard/offer]", error instanceof Error ? error.message : error);
    return { line: offer.line, trace: null };
  }
}

function logBackboardRun(kind, trace) {
  console.info("[backboard/run]", {
    kind,
    provider: trace.provider,
    model: trace.model,
    ms: trace.ms,
    costUsd: trace.costUsd,
    threadId: trace.threadId,
    recalledMemory: Boolean(trace.memory),
    files: trace.files || [],
  });
}

function deterministicReply(context) {
  const message = String(context.message || "").toLowerCase();
  const products = Array.isArray(context.products) ? context.products : [];
  const lastProducts = Array.isArray(context.lastProducts) ? context.lastProducts : [];
  if (isTotalQuestion(message)) {
    const scopedProducts = lastProducts.length ? lastProducts : products;
    return { reply: totalReply(scopedProducts), memoryProducts: scopedProducts };
  }
  if (/\b(weekend|outfit|recommend|style|wear|fit)\b/.test(message)) {
    const picks = outfitPicks(products);
    return { reply: outfitReplyFromPicks(picks), memoryProducts: picks };
  }
  if (/\b(price|prices|catalog|products|shop|how much|cost)\b/.test(message)) {
    const listedProducts = products.slice(0, 6);
    return { reply: catalogReply(listedProducts), memoryProducts: listedProducts };
  }
  if (/\b(size|sizing|tee|shirt|shoe|fit)\b/.test(message)) return { reply: sizingReply(context.product, products) };
  if (/\b(shipping|ship|delivery|returns|return)\b/.test(message)) {
    return { reply: "Shipping and returns are handled in Shopify Checkout. For this demo, use the checkout page as the source of truth for shipping, taxes, and the final total." };
  }
  return null;
}

function outfitReply(products) {
  return outfitReplyFromPicks(outfitPicks(products));
}

function outfitPicks(products) {
  const tee = findPublicProduct(products, /tee|shirt/i);
  const shoe = findPublicProduct(products, /runner|ridge|shoe/i);
  const accessory = findPublicProduct(products, /sock|cap|gaiter|flask|vest/i);
  return [tee, shoe, accessory].filter(Boolean);
}

function outfitReplyFromPicks(picks) {
  if (!picks.length) return "For a weekend outfit, start with one breathable layer, one trail-ready shoe, and one small accessory. Ask me about any product and I can help build around it.";
  return `For a weekend trail outfit, I’d start with ${formatPublicProductList(picks)}. It keeps the fit simple: one everyday layer, one useful trail piece, and one practical add-on.`;
}

function catalogReply(products) {
  if (!products.length) return "I do not see published products from the server yet. Once products are live, I can list the visible catalog prices.";
  return `I can see these storefront prices: ${formatPublicProductList(products)}.`;
}

function isTotalQuestion(message) {
  return /\b(total|altogether|all together|sum|combined|add(?:ed)? up|how much for (?:all|those|them|the outfit)|what'?s it come to|come to)\b/i.test(message);
}

function totalReply(products) {
  const scopedProducts = (Array.isArray(products) ? products : []).filter((product) => Number(product.listPrice) > 0);
  if (!scopedProducts.length) return "Tell me which items you mean and I’ll total them up.";
  const total = scopedProducts.reduce((sum, product) => sum + Number(product.listPrice || 0), 0);
  const label = scopedProducts.length === 1 ? scopedProducts[0].title : `those ${scopedProducts.length} items`;
  return `The total for ${label} is ${formatMoney(total)}: ${scopedProducts.map((product) => `${product.title} ${product.price || formatMoney(product.listPrice)}`).join(" + ")}.`;
}

function sizingReply(product, products) {
  const target = product?.title ? product : products[0];
  if (!target) return "For sizing, choose your usual size. If you want a roomier trail fit, size up when that option is available.";
  const sizes = Array.isArray(target.sizes) && target.sizes.length ? ` Available sizes: ${target.sizes.join(", ")}.` : "";
  return `${target.title} is the item I’d size from here.${sizes} Choose your usual size for a standard fit, or size up if you want extra room.`;
}

function findPublicProduct(products, pattern) {
  return products.find((product) => pattern.test(`${product.title || ""} ${product.type || ""}`));
}

function formatPublicProductList(products) {
  return products.map((product) => `${product.title}${product.price ? ` (${product.price})` : ""}`).join(", ");
}

function fallbackReply(context = {}) {
  const products = Array.isArray(context.products) ? context.products : [];
  if (products.length) return outfitReply(products);
  return "I can help with products, sizing, and offers. If you want to haggle, send a number like “Could you do $120?” and I will price a real offer card from the server.";
}

function isOfferIntent(text) {
  const message = String(text || "");
  const hasMoney = parseMoney(message) !== null;
  const hasOfferLanguage = /\b(offer|deal|discount|haggle|checkout|could you do|can you do|would you take|best price|can i get|could i get|give it to me|give them to me|buy|take|grab|order|lower|cheaper|knock|meet me|split the difference|work with me|out the door|otd)\b/i.test(message);
  const hasCasualPriceLanguage = /\b(?:for|at|around|about|under|to|do|take|pay|price|make|call it)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|benjamin)\b/i.test(message);
  return hasMoney || hasOfferLanguage || hasCasualPriceLanguage;
}

function parseOfferTerms(message, payload = {}, understanding = {}, options = {}) {
  const quantity = understanding.quantity || parseQuantity(message, options.fallbackQuantity || 1) || options.fallbackQuantity || 1;
  const textDollars = understanding.dollars ?? parseMoney(message);
  const payloadDollars = parseMoney(payload.amount);
  return {
    dollars: textDollars ?? payloadDollars,
    quantity,
    perUnit: typeof understanding.perUnit === "boolean" ? understanding.perUnit : isPerUnitOffer(message),
  };
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "");
  const match = text.match(/(?:c\$|\$)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:\$|cad|dollars?|bucks?|each|ea|apiece|a piece|a pop|per\b|\/\s*ea|all in|all-in|total|altogether|otd|out the door)/i);
  if (match) return Number(match[1] || match[2]);
  const prefixedNumber = text.match(/\b(?:for|at|around|about|under|to|do|take|offer|pay|price|give|make|call it|down to|knock(?: them| it)? down to|meet me at|what about)\s+(\d+(?:\.\d{1,2})?)\b/i);
  if (prefixedNumber) return Number(prefixedNumber[1]);
  const wordMoney = parseMoneyWords(text);
  if (wordMoney !== null) return wordMoney;
  if (/^\s*\d+(?:\.\d{1,2})?\s*$/.test(text)) return Number(text);
  return null;
}

function parseQuantity(value, fallback = 1) {
  const text = normalizeSearchText(value);
  const match = text.match(/\b(?:buy|get|take|grab|want|order|add|need)\s+(\d{1,2})\b|\b(\d{1,2})\s*(?:x|pcs?|pieces?|items?|tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?)\b/i);
  const wordMatch = text.match(/\b(?:buy|get|take|grab|want|order|add|need)\s+([a-z -]+?)\s+(?:tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?|items?)\b/i);
  const directWordMatch = text.match(new RegExp(`^(${NUMBER_WORD_PATTERN}(?:\\s+${NUMBER_WORD_PATTERN})*)\\s+(?:tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?|items?)\\b`, "i"));
  const pairMatch = /\b(pair|couple|both)\b/i.test(text);
  const halfDozen = /\bhalf dozen\b/i.test(text);
  const wordQuantity = wordMatch ? parseNumberWords(wordMatch[1]) : directWordMatch ? parseNumberWords(directWordMatch[1]) : null;
  const quantity = match ? Number(match[1] || match[2]) : halfDozen ? 6 : pairMatch ? 2 : wordQuantity ?? fallback;
  if (quantity === null || quantity === undefined) return null;
  return Math.max(1, Math.min(MAX_OFFER_QUANTITY, Number.isFinite(quantity) ? quantity : fallback));
}

function isPerUnitOffer(value) {
  return /\b(each|ea|apiece|a piece|a pop|per piece|per item|per unit|each one|per\b|\/\s*ea)\b/i.test(String(value || ""));
}

function withQuantity(item, qty) {
  return { ...item, qty };
}

function parseMoneyWords(value) {
  const text = normalizeSearchText(value);
  const wordPattern = NUMBER_WORD_PATTERN;
  const directContext = text.match(new RegExp(`\\b(?:for|at|around|about|under|to|do|take|offer|pay|price|give|make|call it|down to|knock(?: them| it)? down to|meet me at|what about)\\s+(${wordPattern}(?:\\s+${wordPattern})*)\\b`, "i"));
  if (directContext) {
    const directParsed = parseNumberWords(directContext[1]);
    if (directParsed !== null) return directParsed;
  }
  const moneyContext = text.match(/\b(?:for|at|around|about|under|to|do|take|offer|pay|price|give|make|call it)\s+([a-z -]+?)(?:\s+(?:cad|dollars?|bucks?|each|ea|apiece|a piece|a pop|piece|pop|per|total|altogether|all in|out the door|on|with|if|and|for))\b/i)
    || text.match(/\b([a-z -]+?)\s+(?:cad|dollars?|bucks?|each|ea|apiece|a piece|a pop|total|altogether|all in|out the door)\b/i);
  if (!moneyContext) {
    if (/\b(benjamin)\b/i.test(text)) return 100;
    return null;
  }
  const phrase = moneyContext[1].replace(/\b(?:a|an)$/i, "").trim();
  const parsed = parseNumberWords(phrase);
  if (parsed !== null) return parsed;
  if (/\bbenjamin\b/i.test(phrase)) return 100;
  return null;
}

function parseNumberWords(value) {
  const text = normalizeSearchText(value).replace(/\band\b/g, " ");
  if (!text) return null;
  const hundredMatch = text.match(/\b(?:(a|one)\s+)?hundred(?:\s+(.+))?$/);
  if (hundredMatch) return 100 + (hundredMatch[2] ? (parseNumberWords(hundredMatch[2]) || 0) : 0);
  const words = text.split(" ").filter(Boolean);
  let total = 0;
  let sawNumber = false;
  for (const word of words) {
    if (SMALL_NUMBER_WORDS[word] !== undefined) {
      total += SMALL_NUMBER_WORDS[word];
      sawNumber = true;
    } else if (TENS_NUMBER_WORDS[word] !== undefined) {
      total += TENS_NUMBER_WORDS[word];
      sawNumber = true;
    }
  }
  return sawNumber ? total : null;
}

const SMALL_NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_NUMBER_WORDS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORD_PATTERN = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|benjamin)";

function targetOf(item, floor) {
  const itemUrgency = urgencyFor(item.stockedAt);
  return Math.ceil(item.list - itemUrgency * (item.list - floor));
}

function urgencyFor(stockedAt) {
  if (!stockedAt) return 0;
  const ageDays = (Date.now() - Date.parse(stockedAt)) / DAY_MS;
  return Math.min(1, Math.max(0, (ageDays - 60) / 60));
}

function askFor(list, target, stockedAt, round) {
  const itemUrgency = urgencyFor(stockedAt);
  return list - ((round - 1) / 3) ** (1 / (1 + itemUrgency)) * (list - target);
}

function roundToShopper(cents) {
  return Math.ceil(Number(cents || 0) / 100) * 100;
}

function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function centsToDecimal(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(0)}`;
}

function gidTail(gid) {
  return String(gid || "").split("/").pop() || "";
}

function isAddOn(product) {
  return /accessor|sock|gaiter|flask|cap|bag|tote/i.test(`${product.productType || ""} ${product.title || ""}`);
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publicObjectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
