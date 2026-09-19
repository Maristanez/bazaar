import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://b8wzw0-h3.myshopify.com",
  "http://127.0.0.1:9293",
  "http://localhost:9293",
];
const MAX_ROUNDS = 4;
const MIRROR_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FLOOR_PCT = Number(process.env.BAZAAR_FLOOR_PCT || 25);
const allowedOrigins = getAllowedOrigins();
const seedProducts = loadSeedProducts();
const state = {
  token: null,
  tokenExpiresAt: 0,
  mirror: { loadedAt: 0, products: [], items: [], warnings: [], source: "empty" },
  offers: new Map(),
  negotiations: new Map(),
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
      model,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
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
      const context = {
        message,
        shopperId: stringOrNull(payload.shopperId),
        pageUrl: stringOrNull(payload.pageUrl),
        product: enrichPublicProduct(publicObjectOrNull(payload.product), mirror),
        products: publicProducts(mirror).slice(0, 8),
      };
      const reply = deterministicReply(context) || await askGemini(context);
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
      sendJson(response, request, 200, { settlement, reply: `Deal. Use ${settlement.code} at checkout — I opened it with the code already applied.` });
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
  const match = findProductFromPayload({ ...payload, text: message }, mirror);
  if (!match) return { reply: "Pick a published product first, then send me a number like “Could you do $120?”", products: publicProducts(mirror).slice(0, 8) };
  const dollars = parseMoney(message) ?? parseMoney(payload.amount) ?? Math.round(match.item.list * 0.82 / 100);
  const offered = dollarsToCents(dollars);
  const negotiationId = String(payload.negotiationId || `${payload.shopperId || "shopper"}:${match.item.productId}:${match.item.size || "default"}`);
  const previousRound = state.negotiations.get(negotiationId)?.round || 0;
  const round = Math.min(MAX_ROUNDS, previousRound + 1);
  state.negotiations.set(negotiationId, { round, productId: match.item.productId });
  const offer = priceOffer(match.item, offered, round, mirror);
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
        qty: 1,
        ...(index > 0 ? { thrownIn: true } : {}),
      })),
      listTotal: offer.listTotal,
      total: offer.total,
    },
    line: offer.line,
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
  state.offers.set(offerId, { ...offer, offerId, negotiationId, expiresAt, status: "live" });
  return { reply: offer.line, card, products: publicProducts(mirror).slice(0, 8) };
}

function priceOffer(main, offered, round, mirror) {
  if (main.cost === null) {
    return { kind: "closed", items: [main], listTotal: roundToShopper(main.list), total: roundToShopper(main.list), line: "I cannot safely haggle this item because the store cost is missing.", badges: ["missing cost"] };
  }
  if (offered >= main.list) {
    return { kind: "accepted", items: [main], listTotal: roundToShopper(main.list), total: roundToShopper(main.list), line: `${main.title} is already ${formatMoney(roundToShopper(main.list))}. You can check out at list price, or send me a lower offer to haggle.`, badges: ["list price", "checkout ready"] };
  }
  const floor = Math.ceil(main.cost * (1 + FLOOR_PCT / 100));
  const target = targetOf(main, floor);
  const ask = roundToShopper(askFor(main.list, target, main.stockedAt, round));
  const safeOffered = roundToShopper(offered);
  if (safeOffered >= floor && safeOffered >= target && safeOffered <= main.list) {
    return { kind: "accepted", items: [main], listTotal: roundToShopper(main.list), total: safeOffered, line: `Deal — I can hold ${formatMoney(safeOffered)} for 15 minutes.`, badges: ["safe margin", "held 15:00"] };
  }
  const addOn = mirror.items.find((item) => item.isAddOn && item.inStock && item.cost !== null);
  if (addOn && round < MAX_ROUNDS) {
    const addonPart = Math.ceil(addOn.cost + (addOn.list - addOn.cost) / 2);
    const bundleTotal = roundToShopper(Math.max(ask + addonPart, floor + addonPart));
    return { kind: "bundle", items: [main, addOn], listTotal: roundToShopper(main.list + addOn.list), total: bundleTotal, line: `I cannot do ${formatMoney(safeOffered)} on that alone, but I can do ${formatMoney(bundleTotal)} with ${addOn.title} included.`, badges: [`＋ ${addOn.title}`, "safe bundle"] };
  }
  return { kind: "counter", items: [main], listTotal: roundToShopper(main.list), total: ask, line: round === MAX_ROUNDS ? `My best is ${formatMoney(ask)}.` : `I can hold ${formatMoney(ask)} for 15 minutes.`, badges: [round === MAX_ROUNDS ? "final offer" : "held 15:00"] };
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
  const code = `BAZAAR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const discountAmount = Math.max(0, offer.listTotal - offer.total);
  if (discountAmount <= 0) throw new Error("No discount is needed for that offer.");
  const variables = {
    basicCodeDiscount: {
      title: `Bazaar offer ${code}`,
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
  const cart = items.map((item) => `${item.variantNumericId}:1`).join(",");
  return `${shopBaseUrl()}/cart/${cart}?discount=${encodeURIComponent(code)}`;
}

function findProductFromPayload(payload, mirror) {
  const product = payload.product && typeof payload.product === "object" ? payload.product : payload;
  const text = String(payload.text || payload.message || "").toLowerCase();
  const wantedVariant = String(product.selectedVariantId || product.variantId || "").replace(/^gid:\/\/shopify\/ProductVariant\//, "");
  const wantedProduct = String(product.productId || product.id || "").replace(/^gid:\/\/shopify\/Product\//, "");
  const wantedHandle = stringOrNull(product.handle);
  const wantedTitle = stringOrNull(product.title);
  let item = mirror.items.find((entry) => {
    const title = entry.title.toLowerCase();
    const handle = entry.handle.toLowerCase();
    return (title.length > 3 && text.includes(title)) || (handle.length > 3 && text.includes(handle));
  });
  if (!item) item = mirror.items.find((entry) => entry.variantNumericId === wantedVariant || entry.variantId === product.selectedVariantId);
  if (!item && wantedProduct) item = mirror.items.find((entry) => entry.productNumericId === wantedProduct || entry.productId === product.productId);
  if (!item && wantedHandle) item = mirror.items.find((entry) => entry.handle === wantedHandle);
  if (!item && wantedTitle) item = mirror.items.find((entry) => entry.title.toLowerCase() === wantedTitle.toLowerCase());
  if (!item) item = mirror.items.find((entry) => !entry.isAddOn && entry.inStock && entry.cost !== null) || mirror.items[0];
  if (!item) return null;
  const publicProduct = publicProducts(mirror).find((entry) => entry.productId === item.productId || entry.handle === item.handle);
  return { item, publicProduct };
}

async function askGemini(context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackReply();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const geminiResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt(context) }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 900 },
    }),
  });
  if (!geminiResponse.ok) throw new Error(`Gemini ${geminiResponse.status}: ${(await geminiResponse.text()).slice(0, 500)}`);
  const data = await geminiResponse.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (!text || isProbablyTruncated(text)) return fallbackReply(context);
  return text;
}

function deterministicReply(context) {
  const message = String(context.message || "").toLowerCase();
  const products = Array.isArray(context.products) ? context.products : [];
  if (/\b(weekend|outfit|recommend|style|wear|fit)\b/.test(message)) return outfitReply(products);
  if (/\b(price|prices|catalog|products|shop|how much|cost)\b/.test(message)) return catalogReply(products);
  if (/\b(size|sizing|tee|shirt|shoe|fit)\b/.test(message)) return sizingReply(context.product, products);
  if (/\b(shipping|ship|delivery|returns|return)\b/.test(message)) {
    return "Shipping and returns are handled in Shopify Checkout. For this demo, use the checkout page as the source of truth for shipping, taxes, and the final total.";
  }
  return null;
}

function outfitReply(products) {
  const tee = findPublicProduct(products, /tee|shirt/i);
  const shoe = findPublicProduct(products, /runner|ridge|shoe/i);
  const accessory = findPublicProduct(products, /sock|cap|gaiter|flask|vest/i);
  const picks = [tee, shoe, accessory].filter(Boolean);
  if (!picks.length) return "For a weekend outfit, start with one breathable layer, one trail-ready shoe, and one small accessory. Ask me about any product and I can help build around it.";
  return `For a weekend trail outfit, I’d start with ${formatPublicProductList(picks)}. It keeps the fit simple: one everyday layer, one useful trail piece, and one practical add-on.`;
}

function catalogReply(products) {
  if (!products.length) return "I do not see published products from the server yet. Once products are live, I can list the visible catalog prices.";
  return `I can see these storefront prices: ${formatPublicProductList(products.slice(0, 6))}.`;
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

function isProbablyTruncated(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (/[.!?)]$/.test(trimmed)) return false;
  if (/[\s([][$€£¥]?$/.test(trimmed)) return true;
  if (/\b(with|and|or|for|to|from|plus|pair|include|including|because|while|at|under|over)$/i.test(trimmed)) return true;
  return trimmed.length < 140;
}

function systemPrompt() {
  return [
    "You are Bazaar's AI shopkeeper for a Shopify clothing and trail gear store.",
    "Use only the public product context supplied by the server.",
    "Help shoppers with outfit ideas, sizing, shipping, returns, and product discovery.",
    "You may mention visible storefront prices if supplied.",
    "Do not invent discounts, checkout links, inventory guarantees, policies, private costs, or binding offers.",
    "If the shopper wants to haggle, tell them to send a specific CAD number; the server will price any binding offer.",
    "Keep replies concise, warm, and useful: 1 to 4 short sentences.",
  ].join(" ");
}

function buildUserPrompt(context) {
  return JSON.stringify({ shopperMessage: context.message, shopperId: context.shopperId, pageUrl: context.pageUrl, currentProduct: context.product, visibleProducts: context.products }, null, 2);
}

function fallbackReply(context = {}) {
  const products = Array.isArray(context.products) ? context.products : [];
  if (products.length) return outfitReply(products);
  return "I can help with products, sizing, and offers. If you want to haggle, send a number like “Could you do $120?” and I will price a real offer card from the server.";
}

function isOfferIntent(text) {
  const message = String(text || "");
  const hasMoney = /(?:c\$|\$)\s*\d+(?:\.\d{1,2})?|\b\d+(?:\.\d{1,2})?\s*(?:cad|dollars?|bucks?)\b/i.test(message);
  const hasOfferLanguage = /\b(offer|deal|discount|haggle|checkout|could you do|can you do|would you take|best price|can i get|could i get|for)\b/i.test(message);
  return hasMoney || hasOfferLanguage;
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").match(/(?:C\$|\$)?\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1]) : null;
}

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
