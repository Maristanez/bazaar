import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackboardShopkeeper } from "@bazaar/llm";
import { check as checkShopkeeperPick } from "./check.ts";
import { createSupabaseDb } from "./infra/db.ts";
import { createOwnerRuntime } from "./owner/runtime.ts";
import { loadRedTeamResult } from "./owner/redteam.ts";
import { dealKpis } from "./owner/kpis.ts";
import { analyzeBuyerReason, applyNegotiationContext, auditOffer, buildNegotiationMenu, ownerApprovalTotal, formatMoney, isAddOn, isLowball, rankNegotiationMenu, resolveSettings, suggestedOpeningOffer, toShopper } from "@bazaar/engine";
import { selectCatalogItem } from "./catalog.ts";
import { publicConfig } from "./public-config.ts";
import { randomUUID } from "node:crypto";


export async function createBazaarServer({ env = process.env, fetchImpl = globalThis.fetch, ownerDb } = {}) {
const fetch = fetchImpl;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://b8wzw0-h3.myshopify.com",
  "http://127.0.0.1:9293",
  "http://localhost:9293",
];
/** The owner's saved settings (SPEC §4.4.1), read fresh on every turn; absent = the defaults. */
const ownerSettings = () => resolveSettings(owner?.getPolicy().settings);
const MAX_OFFER_QUANTITY = 10;
const MIRROR_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VOICE_TEXT = 600;
const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024;


const backboardProvider = env.BACKBOARD_MODEL_PROVIDER || "openai";
const backboardModel = env.BACKBOARD_MODEL_NAME || "gpt-5.6-terra";
const backboardAssistantId = env.BACKBOARD_ASSISTANT_ID || "16072e36-597a-4720-94c3-1d4cf2f520f9";
const backboardTimeoutMs = Number(env.BACKBOARD_TIMEOUT_MS || 6500);
const elevenLabsApiKey = String(env.ELEVENLABS_API_KEY || "").trim();
const elevenLabsVoiceId = String(env.ELEVENLABS_VOICE_ID || "tapn1QwocNXk3viVSowa").trim();
const elevenLabsTtsModel = String(env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5").trim();
const elevenLabsSttModel = String(env.ELEVENLABS_STT_MODEL || "scribe_v2").trim();
const backboard = env.BACKBOARD_API_KEY
  ? createBackboardShopkeeper({
    apiKey: env.BACKBOARD_API_KEY,
    assistantId: backboardAssistantId,
    provider: backboardProvider,
    model: backboardModel,
    memory: env.BACKBOARD_MEMORY_MODE || "Auto",
    isolateMemoryByShopper: true,
    seededShopperIds: ["demo"],
    fetchImpl: fetch,
    timeoutMs: Number.isFinite(backboardTimeoutMs) && backboardTimeoutMs > 0 ? backboardTimeoutMs : 6500,
  })
  : null;

const allowedOrigins = getAllowedOrigins();
const streamEpoch = randomUUID();
const seedProducts = loadSeedProducts();
const state = {
  token: null,
  tokenExpiresAt: 0,
  mirror: { loadedAt: 0, products: [], items: [], warnings: [], source: "empty" },
  offers: new Map(),
  negotiations: new Map(),
  shopperContexts: new Map(),
  locks: new Map(),
};
const db = ownerDb ?? (env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)
  ? createSupabaseDb({ environment: {
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  } }) : null);
const owner = db ? await createOwnerRuntime({
  db,
  redteam: loadRedTeamResult(),
  onPaused: () => {
    for (const offer of state.offers.values()) {
      if (["live", "pending_owner"].includes(offer.status)) offer.status = "paused";
    }
  },
  onApprovalResolved: approval => resolveShopperApproval(approval),
}) : null;

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    sendCors(response, request);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/public-config") {
    const config = publicConfig(env);
    sendJson(response, request, config ? 200 : 503, config || { error: "public_auth_not_configured" });
    return;
  }

  if (url.pathname.startsWith("/api/console/") || ["/api/policy", "/api/pause"].includes(url.pathname) || url.pathname.startsWith("/api/approvals/")) {
    let merchant = null;
    try { merchant = db && await db.verifyBearerToken(request.headers.authorization); } catch { /* Fail closed. */ }
    if (!merchant) {
      sendJson(response, request, 401, { error: "unauthorized" });
      return;
    }
    try {
      if (request.method === "GET" && url.pathname === "/api/console/state") {
        const mirror = await safeSyncMirror();
        sendJson(response, request, 200, {
          policy: owner.getPolicy(), pausePersistence: owner.getPausePersistence(), products: ownerProducts(mirror), pendingApprovals: owner.pendingApprovals(),
          redteam: owner.getRedTeamResult(),
          catalog: { source: mirror.source, loadedAt: mirror.loadedAt ? new Date(mirror.loadedAt).toISOString() : null, warnings: mirror.warnings },
          ...(await ownerKpis()),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/policy") {
        sendJson(response, request, 200, await owner.setPolicy(await readJson(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/pause") {
        const body = await readJson(request);
        sendJson(response, request, 200, await owner.setPaused(body.paused));
        return;
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/approvals/")) {
        const body = await readJson(request);
        const approval = await owner.resolveApproval(decodeURIComponent(url.pathname.slice("/api/approvals/".length)), body.decision);
        sendJson(response, request, 200, approval);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/console/stream") {
        sendCors(response, request);
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        const write = ({ id, event }) => response.write(`id: ${streamEpoch}:${id}\ndata: ${JSON.stringify(event)}\n\n`);
        response.write(": connected\n\n");
        const [epoch, cursor] = String(request.headers["last-event-id"] || "").split(":");
        for (const event of owner.eventsAfter(epoch === streamEpoch ? Number(cursor) || undefined : undefined)) write(event);
        const unsubscribe = owner.subscribe(write);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
        const expiry = setTimeout(() => response.end(), 60000);
        response.on("close", () => { clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); });
        return;
      }
    } catch (error) {
      sendJson(response, request, 400, { error: "owner_request_failed", message: "The change could not be saved. Check the input and try again." });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const mirror = await safeSyncMirror();
    sendJson(response, request, owner ? 200 : 503, {
      ok: Boolean(owner),
      service: "bazaar-chat",
      ownerPolicyConfigured: Boolean(owner),
      model: `${backboardProvider}/${backboardModel}`,
      hasBackboardKey: Boolean(env.BACKBOARD_API_KEY),
      backboardAssistantConfigured: Boolean(backboardAssistantId),
      voiceConfigured: Boolean(elevenLabsApiKey),
      shopifyConfigured: hasShopifyCredentials(),
      products: mirror.products.length,
      mirrorSource: mirror.source,
      mirrorLoadedAt: mirror.loadedAt ? new Date(mirror.loadedAt).toISOString() : null,
      warnings: mirror.warnings,
    });
    return;
  }

  if (request.method === "GET" && (url.pathname === "/console" || url.pathname === "/console/" || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/"))) {
    const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
    const relative = url.pathname.startsWith("/console") ? "index.html" : url.pathname.slice(1);
    const file = resolve(webRoot, relative);
    if (!file.startsWith(webRoot + "/")) { sendJson(response, request, 404, { error: "not_found" }); return; }
    try {
      const body = readFileSync(file);
      const contentType = file.endsWith(".js") ? "text/javascript; charset=utf-8"
        : file.endsWith(".css") ? "text/css; charset=utf-8"
        : file.endsWith(".woff2") ? "font/woff2"
        : file.endsWith(".ttf") ? "font/ttf"
        : "text/html; charset=utf-8";
      const immutable = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/");
      response.writeHead(200, { "Content-Type": contentType, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
      response.end(body);
    } catch { sendJson(response, request, 404, { error: "console_not_built" }); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, request, 200, {
      ok: true,
      service: "bazaar-chat",
      routes: ["GET /api/products", "POST /api/chat", "POST /api/offers", "POST /api/accept", "GET /api/voice/config", "POST /api/voice/speak", "POST /api/voice/transcribe", "GET /api/stream", "GET /health"],
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

  if (request.method === "GET" && url.pathname === "/api/voice/config") {
    sendJson(response, request, 200, {
      enabled: Boolean(elevenLabsApiKey),
      provider: "elevenlabs",
      ttsModel: elevenLabsTtsModel,
      sttModel: elevenLabsSttModel,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/voice/speak") {
    if (!elevenLabsApiKey) { sendJson(response, request, 503, { error: "voice_unavailable" }); return; }
    try {
      const payload = await readJson(request);
      const text = String(payload.text || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > MAX_VOICE_TEXT) { sendJson(response, request, 400, { error: "invalid_voice_text" }); return; }
      const audio = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenLabsVoiceId)}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": elevenLabsApiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: elevenLabsTtsModel }),
      });
      if (!audio.ok) throw new Error(`ElevenLabs TTS HTTP ${audio.status}`);
      const body = Buffer.from(await audio.arrayBuffer());
      sendCors(response, request);
      response.writeHead(200, { "Content-Type": audio.headers.get("content-type") || "audio/mpeg", "Cache-Control": "no-store", "Content-Length": body.length });
      response.end(body);
    } catch (error) {
      console.error("[voice/speak]", error instanceof Error ? error.message : error);
      sendJson(response, request, 502, { error: "voice_generation_failed" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/voice/transcribe") {
    if (!elevenLabsApiKey) { sendJson(response, request, 503, { error: "voice_unavailable" }); return; }
    try {
      const mimeType = String(request.headers["content-type"] || "audio/webm").split(";")[0].trim();
      if (!/^audio\//i.test(mimeType)) { sendJson(response, request, 415, { error: "audio_required" }); return; }
      const audio = await readBuffer(request, MAX_VOICE_AUDIO_BYTES);
      if (!audio.length) { sendJson(response, request, 400, { error: "empty_audio" }); return; }
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mimeType }), `shopper.${audioExtension(mimeType)}`);
      form.append("model_id", elevenLabsSttModel);
      form.append("tag_audio_events", "false");
      const transcription = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": elevenLabsApiKey, Accept: "application/json" },
        body: form,
      });
      if (!transcription.ok) throw new Error(`ElevenLabs STT HTTP ${transcription.status}`);
      const result = await transcription.json();
      const text = String(result?.text || "").trim();
      if (!text) throw new Error("ElevenLabs STT returned no text");
      sendJson(response, request, 200, { text });
    } catch (error) {
      console.error("[voice/transcribe]", error instanceof Error ? error.message : error);
      sendJson(response, request, 502, { error: "transcription_failed" });
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

  if (request.method === "GET" && url.pathname.startsWith("/api/offers/")) {
    const offer = state.offers.get(url.pathname.slice("/api/offers/".length));
    if (!offer || offer.shopperId !== url.searchParams.get("shopperId") || offer.negotiationId !== url.searchParams.get("negotiationId")) {
      sendJson(response, request, 404, { error: "not_found" }); return;
    }
    sendJson(response, request, 200, { card: currentCard(offer) }); return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    try {
      const payload = await readJson(request);
      if (!owner) { sendJson(response, request, 503, { error: "policy_unavailable", reply: "The shopkeeper is unavailable. Please try again shortly." }); return; }
      if (owner.getPolicy().paused) { sendJson(response, request, 200, pausedReply(payload)); return; }
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
      const shopperId = requireShopperId(payload);
      const prior = resolveShopperContext(shopperId, mirror, payload.negotiationId);
      const matched = findProductFromPayload({ ...payload, text: message }, mirror, { contextItem: prior?.item });
      const questionQuantity = matched ? parseQuantity(message, null) : null;
      const quantity = questionQuantity || (matched && prior && matched.item.productId === prior.item.productId ? prior.quantity : 1);
      const negotiation = matched ? negotiationFor(payload, matched.item, quantity) : null;
      const negotiationId = negotiation?.id || `catalog:${shopperId}`;
      if (matched) rememberShopperContext(shopperId, matched.item, quantity, negotiationId);
      const context = {
        message,
        shopperId,
        negotiationId,
        model: `${backboardProvider}/${backboardModel}`,
        pageUrl: stringOrNull(payload.pageUrl),
        product: matched?.publicProduct || enrichPublicProduct(publicObjectOrNull(payload.product), mirror),
        products: publicProducts(mirror),
        lastProducts: resolveShopperProducts(payload.shopperId, mirror),
      };
      const deterministic = deterministicReply(context);
      const sizingQuestion = isSizingQuestion(message);
      const useLocalReply = Boolean(deterministic?.local || deterministic?.memoryProducts?.length) && !sizingQuestion;
      if (useLocalReply) rememberShopperProducts(shopperId, deterministic.memoryProducts);
      const reply = useLocalReply ? deterministic.reply : await answerWithBackboard(context, deterministic?.reply);
      if (owner.getPolicy().paused) { sendJson(response, request, 200, pausedReply(payload)); return; }
      sendJson(response, request, 200, { reply, ...(negotiation ? { negotiationId } : {}), products: publicProducts(mirror) });
    } catch (error) {
      console.error("[api/chat]", error);
      sendJson(response, request, 500, { reply: fallbackReply(), error: "chat_failed" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/offers") {
    try {
      const payload = await readJson(request);
      if (!owner) { sendJson(response, request, 503, { error: "policy_unavailable" }); return; }
      if (owner.getPolicy().paused) { sendJson(response, request, 200, pausedReply(payload)); return; }
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
      const settlement = await withShopperLock(requireShopperId(payload), () => acceptOffer(String(payload.offerId || "").trim(), payload));
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
  const configured = env.ALLOWED_ORIGINS;
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
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID");
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

function readBuffer(request, maximumBytes) {
  return new Promise((resolveBuffer, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > maximumBytes) request.destroy(new Error("Request body too large"));
      else chunks.push(buffer);
    });
    request.on("error", reject);
    request.on("end", () => resolveBuffer(Buffer.concat(chunks)));
  });
}

function audioExtension(mimeType) {
  if (/ogg/i.test(mimeType)) return "ogg";
  if (/mp4|m4a/i.test(mimeType)) return "m4a";
  if (/wav/i.test(mimeType)) return "wav";
  return "webm";
}

function hasShopifyCredentials() {
  return Boolean(shopName() && ((env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) || env.SHOPIFY_ADMIN_ACCESS_TOKEN));
}

function shopName() {
  const configured = String(env.SHOPIFY_SHOP || "b8wzw0-h3").trim();
  return configured.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\.myshopify\.com$/, "");
}

function shopBaseUrl() {
  return `https://${shopName()}.myshopify.com`;
}

// Real settled deals only; the Forecast's simulated figures never pass through here.
async function ownerKpis() {
  if (!db.listDeals) return {};
  try {
    const agentCostUsd = owner.eventsAfter().reduce((sum, { event }) => sum + (event.llm?.costUsd || 0), 0);
    return { kpis: dealKpis(await db.listDeals(), agentCostUsd) };
  } catch (error) {
    console.error("[kpis]", error);
    return {};
  }
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
    inventory: variant.inventory,
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
    const costAmount = variant.inventoryItem?.unitCost?.amount;
    const unitCost = costAmount != null && Number.isFinite(Number(costAmount)) ? dollarsToCents(costAmount) : null;
    return {
      gid: variant.id,
      numericId: gidTail(variant.id),
      title: variant.title,
      sku: variant.sku,
      price: dollarsToCents(variant.price),
      unitCost,
      inStock: Number(variant.inventoryQuantity ?? 0) > 0,
      inventory: Number(variant.inventoryQuantity ?? 0),
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
      inventory: variant.inventory,
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
    inventory: variant.inventory,
    isAddOn: isAddOn(product),
    image: product.image,
    url: `/products/${product.handle}`,
  })));
  return { loadedAt: Date.now(), products, items, warnings: [reason].filter(Boolean), source: "seed-fallback" };
}

async function getShopifyToken({ force = false } = {}) {
  if (!force && state.token && Date.now() < state.tokenExpiresAt - 60_000) return state.token;
  if (env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    state.token = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    state.tokenExpiresAt = Date.now() + DAY_MS;
    return state.token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SHOPIFY_CLIENT_ID || "",
    client_secret: env.SHOPIFY_CLIENT_SECRET || "",
  });
  const response = await fetch(`${shopBaseUrl()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(5000),
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
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  const response = await fetch(`${shopBaseUrl()}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5000),
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
      variants: product.variants.map(variant => ({ id: variant.numericId, title: variant.title, price: variant.price, available: variant.inStock })),
      url: `/products/${product.handle}`,
      type: product.productType,
      listPrice: first ? first.price : 0,
      price: first ? formatMoney(first.price) : "",
      sizes: purchasable.map((variant) => variant.title).filter((title) => title && title !== "Default Title"),
      selectedVariantId: first?.gid,
      selectedVariantNumericId: first?.numericId,
      openToOffers: purchasable.some((variant) => variant.unitCost !== null),
    };
  });
}

function ownerProducts(mirror) {
  return publicProducts(mirror).map(product => {
    const items = mirror.items.filter(item => item.productId === product.productId);
    return {
      ...product, variants: items.map(item => ({ variantId: item.variantId, ...(item.size ? { size: item.size } : {}), price: item.list, unitCost: item.cost, inStock: item.inStock })),
      productType: items[0]?.productType || "", stockedAt: items[0]?.stockedAt || null,
      missingCost: items.some(item => item.cost === null), missingStockedAt: !items[0]?.stockedAt,
    };
  });
}

function enrichPublicProduct(product, mirror) {
  if (!product) return null;
  return findProductFromPayload({ product }, mirror)?.publicProduct || product;
}

async function makeOfferFromPayload(payload, message) {
  return withShopperLock(requireShopperId(payload), () => makeOfferTurn(payload, message));
}

async function withShopperLock(shopperId, work) {
  const previous = state.locks.get(shopperId) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  state.locks.set(shopperId, tail);
  await previous;
  try { return await work(); }
  finally { release(); if (state.locks.get(shopperId) === tail) state.locks.delete(shopperId); }
}

function requireShopperId(payload) {
  const id = stringOrNull(payload.shopperId);
  if (!id || id.length > 128) throw new Error("A valid shopper session is required.");
  return id;
}

function negotiationFor(payload, item, quantity) {
  const shopperId = requireShopperId(payload);
  const candidate = payload.negotiationId || state.shopperContexts.get(shopperId)?.negotiationId;
  const existing = state.negotiations.get(candidate);
  if (existing && existing.shopperId !== shopperId) throw new Error("That negotiation belongs to another shopper.");
  if (existing && existing.variantId === item.variantId && existing.quantity === quantity) return existing;
  const negotiation = { id: randomUUID(), shopperId, productId: item.productId, variantId: item.variantId, quantity, round: 0, approvalUsed: false };
  state.negotiations.set(negotiation.id, negotiation);
  return negotiation;
}

async function makeOfferTurn(payload, message) {
  if (owner.getPolicy().paused) return pausedReply(payload);
  const active = state.negotiations.get(payload.negotiationId || state.shopperContexts.get(payload.shopperId)?.negotiationId);
  const needsFreshApprovalCost = active?.round >= ownerSettings().maxRounds && owner.getPolicy().askOwner && !active.approvalUsed;
  const mirror = await syncMirror({ force: needsFreshApprovalCost });
  const shopperContext = resolveShopperContext(payload.shopperId, mirror, payload.negotiationId);
  const understanding = await understandOffer(message, payload, mirror, shopperContext);
  if (understanding.currency === "unsupported") {
    return { reply: "Please send the offer in CAD so I can price it safely.", products: publicProducts(mirror) };
  }
  const matchText = [message, understanding.productHint, ...(understanding.items || []).map(item => item.productHint)].filter(Boolean).join(" ");
  const understoodMatch = understanding.productHint
    ? findProductFromPayload({ ...payload, message: understanding.productHint, text: understanding.productHint }, mirror, { contextItem: shopperContext?.item, allowFallback: false })
    : null;
  const match = understoodMatch || findProductFromPayload({ ...payload, text: matchText }, mirror, { contextItem: shopperContext?.item, allowFallback: false });
  if (!match) return { reply: "Pick a published product first, then send me a number like “Could you do $120?”", products: publicProducts(mirror) };
  const sameContextItem = shopperContext?.item && shopperContext.item.productId === match.item.productId;
  const cartRequest = requestedCartFromUnderstanding(understanding.items, mirror, match.item)
    || requestedCartFromMessage(message, mirror, match.item);
  if (cartRequest.unavailable.length) {
    return {
      reply: unavailableCartReply(cartRequest.unavailable, mirror, match.item),
      products: prioritizePublicProducts(mirror, match.item),
    };
  }
  const pageItem = selectCatalogItem({ ...payload, message: "", text: "" }, mirror.items, undefined, false);
  const selectedQuantity = pageItem?.productId === match.item.productId && (!payload.negotiationId || payload.quantitySelectionChanged)
    ? payload.quantity : undefined;
  const terms = parseOfferTerms(message, payload, understanding, { fallbackQuantity: selectedQuantity ?? (sameContextItem ? shopperContext.quantity : 1) });
  if (cartRequest.mainQuantity) terms.quantity = cartRequest.mainQuantity;
  if (cartRequest.quotedTotalDollars !== null) {
    terms.dollars = cartRequest.quotedTotalDollars;
    terms.perUnit = false;
  }
  if (!Number.isSafeInteger(terms.quantity) || terms.quantity < 1 || terms.quantity > MAX_OFFER_QUANTITY) {
    return { reply: `Please choose a quantity from 1 to ${MAX_OFFER_QUANTITY}.` };
  }
  const reasonText = [
    message,
    understanding.reasonText,
    ...(understanding.reasonTags || []),
    ...(sameContextItem ? [shopperContext?.reasonText, ...(shopperContext?.reasonTags || [])] : []),
  ].filter(Boolean).join(" ");
  const declinedAddOns = /\b(?:without|no|remove|skip|exclude)\s+(?:(?:the|any|merino|trail|soft)\s+)*(?:socks?|gaiters?|caps?|flasks?|vests?|add[ -]?ons?|bundles?)\b|\b(?:just|only) (?:the )?(?:shoes?|main item)\b/i.test(message);
  const reason = applyNegotiationContext(analyzeBuyerReason(reasonText), { quantity: terms.quantity });
  if (declinedAddOns) reason.hasAddOnIntent = false;
  const requestedItems = declinedAddOns
    ? []
    : cartRequest.requestedItems.length
      ? cartRequest.requestedItems
      : sameContextItem && Array.isArray(shopperContext?.requestedItems)
        ? shopperContext.requestedItems
        : [];
  if (requestedItems.length) {
    reason.hasAddOnIntent = true;
    reason.hasBulkIntent = true;
    reason.score = Math.max(reason.score, 2);
    reason.label ||= "quantity intent";
    reason.labels = Array.from(new Set([...reason.labels, "quantity intent"]));
  }
  if (terms.dollars === null) {
    rememberShopperContext(payload.shopperId, match.item, terms.quantity || shopperContext?.quantity || 1, shopperContext?.negotiationId || null, { reasonText, reasonTags: reason.labels, requestedItems });
    if (isStudentDiscountRequest(message)) {
      return {
        reply: `We do not have a fixed student discount, but I can treat student status as a budget reason. Tell me the total you want for ${match.item.title} and I will price it safely.`,
        products: prioritizePublicProducts(mirror, match.item),
      };
    }
    return {
      reply: `I can talk about ${match.item.title}, but I need your number first. Try “Could you do ${formatMoney(suggestedOpeningOffer(match.item.list, terms.quantity || 1))}${(terms.quantity || 1) > 1 ? " total" : ""}?” and give me a reason.`,
      products: prioritizePublicProducts(mirror, match.item),
    };
  }
  const quantity = terms.quantity;
  const offered = dollarsToCents(terms.perUnit ? terms.dollars * quantity : terms.dollars);
  if (!Number.isSafeInteger(offered) || offered <= 0 || offered > match.item.list * quantity * 10 || /\b(?:USD|EUR|JPY)\b|[-−]\s*\$|\$\s*[-−]/i.test(message)) {
    return { reply: "Please send a positive CAD offer for this product." };
  }
  const negotiation = negotiationFor(payload, match.item, quantity);
  const negotiationId = negotiation.id;
  const previousRound = negotiation.round;
  const pending = [...state.offers.values()].find(offer => offer.negotiationId === negotiationId && offer.status === "pending_owner");
  if (pending) return { reply: pending.card.line, card: currentCard(pending), negotiationId };
  const { maxRounds, discountCapPct, lowballCutoffPct } = ownerSettings();
  // A lowball earns nothing: code counters with the quote already on the table, no LLM call, and the round does not advance.
  const lowball = isLowball(offered, match.item.list * quantity, lowballCutoffPct);
  const round = lowball ? Math.max(1, previousRound) : Math.min(maxRounds, previousRound + 1);
  negotiation.round = lowball ? previousRound : round;
  rememberShopperContext(payload.shopperId, match.item, quantity, negotiationId, { reasonText, reasonTags: reason.labels, requestedItems });
  const policy = owner.getPolicy();
  const allowAlternatives = /\b(alternative|something else|anything cheaper|recommend|instead|other options)\b/i.test(message);
  const priceMenu = floorPct => {
    const choices = buildNegotiationMenu({ main: match.item, mirror, offered, round, reason, quantity, floorPct, now: new Date(), requestedItems, allowAlternatives, discountCapPct, maxRounds });
    return rankNegotiationMenu(choices, { main: match.item, offered, requestedItems, allowAlternatives });
  };
  let candidates = priceMenu(policy.floorPct);
  const shopperId = requireShopperId(payload);
  if (!candidates.length) return { reply: requestedItems.length ? "I could not price every requested item safely, so I did not create a partial offer." : "This item or quantity is not open to offers right now.", negotiationId };
  const fallback = choices => choices[0];
  let menu = negotiationOptions(candidates, round, match.item, maxRounds);
  let phrased = lowball
    ? lowballCounter(candidates, menu, offered)
    : await phraseOfferWithBackboard({ menu, fallback: fallback(candidates), shopperId, negotiationId, message, round, main: match.item });
  const latestPolicy = owner.getPolicy();
  if (latestPolicy.paused) return pausedReply(payload);
  if (latestPolicy.floorPct !== policy.floorPct) {
    const selectedItems = candidates.find(candidate => candidate.id === phrased.optionId)?.offer.items;
    candidates = priceMenu(latestPolicy.floorPct);
    if (!candidates.length) return { reply: "This item is not open to offers right now.", negotiationId };
    menu = negotiationOptions(candidates, round, match.item, maxRounds);
    const fresh = candidates.find(candidate => sameOfferItems(candidate.offer.items, selectedItems)) || fallback(candidates);
    phrased = lowball ? lowballCounter(candidates, menu, offered) : { optionId: fresh.id, line: `I can hold ${formatMoney(fresh.offer.total)} for 15 minutes.`, trace: null };
  }
  const selected = candidates.find(candidate => candidate.id === phrased.optionId) || fallback(candidates);
  const offer = selected.offer;
  const selectedMain = offer.items[0];
  negotiation.productId = selectedMain.productId;
  negotiation.variantId = selectedMain.variantId;
  rememberShopperContext(shopperId, selectedMain, quantity, negotiationId, { reasonText, reasonTags: reason.labels, requestedItems });
  const replyLine = phrased.line;
  const offerId = randomId("offer");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const card = {
    negotiationId,
    offerId,
    status: "live",
    round,
    maxRounds,
    option: {
      id: selected.id,
      kind: menu.find(option => option.id === selected.id).kind,
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
      { label: round === 1 ? "Your offer" : `Round ${round}`, amount: toShopper(offered), by: "shopper" },
      { label: "Shop", amount: offer.total, by: "shop" },
    ],
    expiresAt: expiresAt.toISOString(),
    disclosure: ["You're talking to Trailhead Co's deal agent.", "Only this card is binding; chat text is not."],
  };
  for (const previous of state.offers.values()) if (previous.negotiationId === negotiationId && previous.status === "live") previous.status = "superseded";
  const stored = { ...offer, line: replyLine, offerId, negotiationId, shopperId, expiresAt, status: "live", backboard: phrased.trace, card };
  state.offers.set(offerId, stored);
  const audit = auditOffer(offer.items, offer.total, owner.getPolicy().floorPct, new Date());
  const approvalTotal = audit ? ownerApprovalTotal(offered, audit, offer.total) : null;
  if (!lowball && previousRound >= maxRounds && latestPolicy.askOwner && !negotiation.approvalUsed && approvalTotal !== null) {
    const approval = owner.requestApproval({ negotiationId, shopperId, surface: "storefront", items: card.option.items, offer: approvalTotal, cost: audit.cost, finalTotal: offer.total });
    negotiation.approvalUsed = true;
    stored.finalOffer = { ...offer };
    stored.approvalId = approval.id;
    stored.status = "pending_owner";
    stored.total = approvalTotal;
    card.status = "pending_owner";
    card.pendingUntil = approval.deadline;
    card.option.total = stored.total;
    card.line = "Let me check with the owner…";
    card.badges = ["waiting for owner"];
    return { reply: card.line, card, negotiationId };
  }
  if (audit) owner.publish({
    at: new Date().toISOString(), surface: "storefront", shopperId, negotiationId,
    kind: "decision", reasoning: lowball
      ? `Lowball · countered at ${formatMoney(offer.total)} · no LLM call. ${formatMoney(toShopper(offered))} is under ${lowballCutoffPct}% of list; round ${round} stands.`
      : `Server-priced ${selectedMain.title}; ${reason.label || "no buyer reason"}.`,
    offer: offered, round, menu, picked: card.option.id,
    ...audit, ...(phrased.trace ? { threadId: phrased.trace.threadId, memory: phrased.trace.memory, llm: { provider: phrased.trace.provider, model: phrased.trace.model, ms: phrased.trace.ms, costUsd: phrased.trace.costUsd } } : {}),
  });
  return { reply: replyLine, card, negotiationId, products: prioritizePublicProducts(mirror, selectedMain) };
}

function currentCard(offer) {
  if (["live", "pending_owner"].includes(offer.status) && Date.now() >= offer.expiresAt.getTime()) offer.status = "expired";
  const status = owner.getPolicy().paused && offer.status === "live" ? "paused" : offer.status;
  return { ...offer.card, status };
}

function resolveShopperApproval(approval) {
  const offer = [...state.offers.values()].find(candidate => candidate.approvalId === approval.id);
  if (!offer || offer.status !== "pending_owner") return;
  const approved = approval.status === "approved";
  offer.ownerApproved = approved;
  offer.status = owner.getPolicy().paused ? "paused" : "live";
  if (!approved) Object.assign(offer, offer.finalOffer);
  offer.line = approved ? `I can hold ${formatMoney(offer.total)} for 15 minutes.` : `My best stays ${formatMoney(offer.total)}.`;
  offer.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  offer.card = { ...offer.card, status: offer.status, option: { ...offer.card.option, total: offer.total }, line: offer.line, badges: [approved ? "owner approved" : "final offer"], expiresAt: offer.expiresAt.toISOString() };
  delete offer.card.pendingUntil;
}

async function acceptOffer(offerId, payload) {
  const offer = state.offers.get(offerId);
  if (!offer) throw new Error("I cannot find that offer anymore.");
  if (offer.shopperId !== payload.shopperId || offer.negotiationId !== payload.negotiationId) throw new Error("That offer belongs to another shopper session.");
  if (offer.status === "accepted" && offer.settlement) return { ...offer.settlement };
  if (!owner || owner.getPolicy().paused) throw new Error("The owner's paused deals — list price stands.");
  if (offer.status !== "live") throw new Error("That offer has already been used.");
  if (Date.now() > offer.expiresAt.getTime()) {
    offer.status = "expired";
    throw new Error("That offer expired. Send a fresh offer and I will price it again.");
  }
  if (offer.kind === "closed") throw new Error("That item is not open to offers yet.");
  let mirror;
  let deadline;
  try {
    mirror = await Promise.race([syncMirror({ force: true }), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Shopify refresh timed out")), 1500);
    })]);
  } catch {
    if (state.mirror.source !== "shopify-admin" || Date.now() - state.mirror.loadedAt >= 120000) throw new Error("I cannot verify this offer right now. Please try again shortly.");
    mirror = state.mirror;
  } finally { clearTimeout(deadline); }
  const freshItems = offer.items.map(item => {
    const fresh = mirror.items.find(candidate => candidate.variantId === item.variantId);
    return fresh && fresh.inventory >= (item.qty || 1) ? { ...fresh, qty: item.qty || 1 } : null;
  });
  const policy = owner.getPolicy();
  let audit = freshItems.every(Boolean) ? auditOffer(freshItems, offer.total, policy.floorPct, new Date(), offer.ownerApproved === true) : null;
  if (policy.paused || !audit) {
    owner.publish({ at: new Date().toISOString(), surface: "storefront", shopperId: offer.shopperId, negotiationId: offer.negotiationId, kind: "blocked", blockedBy: "auditor", reasoning: "Checkout rejected after current policy, cost, or availability changed." });
    throw new Error(policy.paused ? "The owner's paused deals — list price stands." : "That offer no longer meets the store's current rules. Please request a fresh offer.");
  }
  offer.items = freshItems;
  offer.listTotal = freshItems.reduce((sum, item) => sum + item.list * item.qty, 0);
  const { discountId, ...settlement } = await mintDiscount(offer);

  const postMintPolicy = owner.getPolicy();
  const postMintAudit = freshItems.every(Boolean)
    ? auditOffer(freshItems, offer.total, postMintPolicy.floorPct, new Date(), offer.ownerApproved === true)
    : null;
  if (postMintPolicy.paused || !postMintAudit) {
    offer.status = postMintPolicy.paused ? "paused" : "declined";
    if (discountId) {
      try {
        await shopifyGraphql("mutation RevokeOffer($id: ID!) { discountCodeDeactivate(id: $id) { userErrors { message } } }", { id: discountId });
      } catch {
        console.error("[settlement] Could not revoke a discount invalidated during minting.");
      }
    }
    owner.publish({ at: new Date().toISOString(), surface: "storefront", shopperId: offer.shopperId, negotiationId: offer.negotiationId, kind: "blocked", blockedBy: "auditor", reasoning: "Checkout rejected because policy or PAUSE changed while Shopify minted the discount." });
    throw new Error(postMintPolicy.paused ? "The owner's paused deals — list price stands." : "That offer no longer meets the store's current rules. Please request a fresh offer.");
  }
  audit = postMintAudit;
  offer.status = "accepted";
  offer.settlement = settlement;

  const dealInput = structuredClone({
    merchantId: db.merchantId, offerId, surface: "storefront", items: offer.card.option.items,
    listTotal: offer.listTotal, agreedTotal: offer.total, cost: audit.cost, floor: audit.floor,
    ownerApproved: offer.ownerApproved === true, code: settlement.code || null,
  });
  const retries = state.dealWriteRetries ??= new Map();
  state.dealWriteRetriesClosed ??= false;
  if (!state.dealWriteRetryCleanupInstalled) {
    state.dealWriteRetryCleanupInstalled = true;
    server.once("close", () => {
      state.dealWriteRetriesClosed = true;
      for (const retry of retries.values()) clearTimeout(retry.timer);
      retries.clear();
    });
  }
  const retryDelays = [250, 1_000, 5_000, 15_000, 30_000];
  const isRecordedDuplicate = (error) => {
    const detail = (() => {
      try { return `${String(error)} ${JSON.stringify(error)}`; } catch { return String(error); }
    })();
    return /(?:offer_id|deals_offer_id)/i.test(detail) && /(?:23505|duplicate|unique)/i.test(detail);
  };
  const scheduleRetry = (attempt) => {
    if (state.dealWriteRetriesClosed) return;
    const delay = retryDelays[attempt];
    if (delay === undefined) {
      retries.delete(offerId);
      console.error(`[settlement] Deal ${offerId} could not be recorded after bounded retries.`);
      return;
    }
    const timer = setTimeout(async () => {
      const pending = retries.get(offerId);
      if (!pending || pending.timer !== timer) return;
      try {
        await db.insertDeal(dealInput);
        retries.delete(offerId);
      } catch (error) {
        if (isRecordedDuplicate(error)) retries.delete(offerId);
        else if (!state.dealWriteRetriesClosed) scheduleRetry(attempt + 1);
      }
    }, delay);
    timer.unref?.();
    retries.set(offerId, { timer, attempt });
  };
  void (async () => {
    try {
      await db.insertDeal(dealInput);
    } catch (error) {
      if (!isRecordedDuplicate(error) && !state.dealWriteRetriesClosed) scheduleRetry(0);
    }
  })();
  owner.publish({ at: new Date().toISOString(), surface: "storefront", shopperId: offer.shopperId, negotiationId: offer.negotiationId, kind: "settled", reasoning: "Agreed offer settled into Shopify Checkout.", ...audit });
  return { ...settlement };
}

function pausedReply(payload) {
  owner.publish({ at: new Date().toISOString(), surface: "storefront", negotiationId: String(payload.negotiationId || "paused"), shopperId: String(payload.shopperId || "anonymous"), kind: "blocked", blockedBy: "auditor", reasoning: "Owner paused deals." });
  return { paused: true, reply: "The owner's paused deals — list price stands." };
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
  return { offerId: offer.offerId, code, agreedTotal: offer.total, checkoutUrl: checkoutUrl(offer.items, code), expiresAt: offer.expiresAt.toISOString(), discountId: data.discountCodeBasicCreate?.codeDiscountNode?.id };
}

function checkoutUrl(items, code) {
  const cart = items.map((item) => `${item.variantNumericId}:${item.qty || 1}`).join(",");
  const discount = code ? `?discount=${encodeURIComponent(code)}` : "";
  return `${shopBaseUrl()}/cart/${cart}${discount}`;
}

function findProductFromPayload(payload, mirror, options = {}) {
  const item = selectCatalogItem(payload, mirror.items, options.contextItem, options.allowFallback !== false);
  if (!item) return null;
  const publicProduct = publicProducts(mirror).find(entry => entry.productId === item.productId);
  return { item, publicProduct };
}

function resolveShopperContext(shopperId, mirror, negotiationId) {
  const id = stringOrNull(shopperId);
  if (!id) return null;
  const negotiation = negotiationId ? state.negotiations.get(negotiationId) : null;
  if (negotiation && negotiation.shopperId !== id) throw new Error("That negotiation belongs to another shopper.");
  const context = negotiation?.context || state.shopperContexts.get(id);
  if (!context || Date.now() - context.updatedAt > 30 * 60_000) return null;
  if (!context.productId && !context.variantId) return null;
  const item = mirror.items.find(entry => entry.variantId === context.variantId)
    || mirror.items.find(entry => entry.productId === context.productId);
  return item ? { ...context, item } : null;
}

function rememberShopperContext(shopperId, item, quantity, negotiationId, details = {}) {
  const id = stringOrNull(shopperId);
  if (!id || !item) return;
  const negotiation = state.negotiations.get(negotiationId);
  const previous = negotiation?.context || state.shopperContexts.get(id);
  const existing = previous?.productId === item.productId ? previous : {};
  const context = {
    ...existing,
    productId: item.productId,
    variantId: item.variantId,
    quantity,
    negotiationId,
    reasonText: stringOrNull(details.reasonText) || existing.reasonText || null,
    reasonTags: Array.isArray(details.reasonTags) && details.reasonTags.length ? details.reasonTags.slice(0, 6) : existing.reasonTags || [],
    requestedAddOn: details.requestedAddOn ?? existing.requestedAddOn,
    requestedItems: Object.hasOwn(details, "requestedItems") ? details.requestedItems : existing.requestedItems || [],
    updatedAt: Date.now(),
  };
  state.shopperContexts.set(id, context);
  if (negotiation && negotiation.shopperId === id) negotiation.context = context;
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

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function understandOffer(message, payload, mirror, shopperContext) {
  const fallback = () => deterministicOfferUnderstanding(message, payload);
  if (!backboard) return fallback();
  // A plain dollar figure under the owner's lowball cutoff is read by code alone, so a junk offer never costs an LLM call.
  const plain = fallback();
  const listed = shopperContext?.item?.list ?? findProductFromPayload(payload, mirror, { contextItem: shopperContext?.item })?.item?.list;
  const { lowballCutoffPct } = ownerSettings();
  // Only an unmistakable total qualifies: one number, and no wording that could make it relative, per unit or a bundle ask.
  const unambiguous = (String(message).match(/\d+(?:\.\d+)?/g) || []).length === 1
    && !/\b(?:off|cheaper|less|lower|discount|each|per|apiece|free|throw|include|plus|another|extra)\b|%/i.test(String(message));
  if (unambiguous && listed && plain.priceMode === "total" && plain.currency === "CAD" && Number.isFinite(plain.dollars)
    && isLowball(plain.dollars * 100, listed * (plain.quantity || shopperContext?.quantity || 1), lowballCutoffPct)) return plain;
  const shopperId = requireShopperId(payload);
  const negotiationId = payload.negotiationId || shopperContext?.negotiationId || `catalog:${shopperId}`;
  const latest = latestNegotiationOffer(negotiationId);
  const products = publicProducts(mirror);
  const currentProduct = shopperContext?.item
    ? { ...products.find(product => product.productId === shopperContext.item.productId), quantity: shopperContext.quantity }
    : enrichPublicProduct(publicObjectOrNull(payload.product), mirror);
  try {
    const analysis = await backboard.understandOffer({
      shopperId,
      negotiationId,
      shopperMessage: message,
      ...(currentProduct ? { currentProduct } : {}),
      products,
      latestShopTotal: latest ? latest.total / 100 : null,
    });
    const relativeAmount = analysis.priceMode === "relative_discount"
      ? latest && analysis.amount !== null ? latest.total / 100 - analysis.amount : null
      : analysis.amount;
    if (relativeAmount !== null && (!Number.isFinite(relativeAmount) || relativeAmount <= 0)) throw new Error("invalid relative offer");
    logBackboardRun("understand", analysis.trace);
    const relativeFollowup = analysis.priceMode === "relative_discount";
    const explicitQuantity = parseQuantity(message, null);
    return {
      productHint: analysis.productHint,
      quantity: relativeFollowup && explicitQuantity === null ? null : analysis.quantity,
      dollars: relativeAmount,
      perUnit: analysis.priceMode === "per_unit",
      priceMode: analysis.priceMode,
      currency: analysis.currency,
      items: relativeFollowup ? [] : analysis.items,
      reasonText: message,
      reasonTags: analysis.reasonTags,
      confidence: analysis.confidence,
    };
  } catch (error) {
    console.error("[backboard/understand]", error instanceof Error ? error.message : error);
    return fallback();
  }
}

function latestNegotiationOffer(negotiationId) {
  let latest = null;
  for (const offer of state.offers.values()) if (offer.negotiationId === negotiationId) latest = offer;
  return latest;
}

function deterministicOfferUnderstanding(message, payload = {}) {
  const dollars = parseMoney(message) ?? parseMoney(payload.amount);
  return {
    productHint: null,
    quantity: parseQuantity(message, null),
    dollars,
    perUnit: isPerUnitOffer(message),
    priceMode: dollars === null ? "none" : isPerUnitOffer(message) ? "per_unit" : "total",
    currency: /\b(?:USD|EUR|JPY)\b/i.test(String(message || "")) ? "unsupported" : "CAD",
    items: [],
    reasonText: message,
    reasonTags: [],
    confidence: dollars !== null ? 0.6 : 0.35,
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

function requestedCartFromMessage(message, mirror, main) {
  const text = normalizeSearchText(message);
  const groups = new Map();
  for (const item of mirror.items) {
    const group = groups.get(item.productId) || [];
    group.push(item);
    groups.set(item.productId, group);
  }
  let mainQuantity = null;
  const requestedItems = [];
  const unavailable = [];
  const quotedLineAmounts = [];
  for (const variants of groups.values()) {
    const sample = variants[0];
    const mention = productMention(text, sample);
    if (!mention) continue;
    const explicitQuantity = quantityBeforeProduct(text, mention.index);
    const quantity = explicitQuantity || 1;
    const quotedLineAmount = quotedLinePrice(text, mention);
    if (quotedLineAmount !== null) quotedLineAmounts.push(quotedLineAmount);
    if (sample.productId === main.productId) {
      mainQuantity = explicitQuantity;
      const selected = variants.find(item => item.variantId === main.variantId) || main;
      if (!selected.inStock || selected.cost === null || Number(selected.inventory ?? quantity) < quantity) unavailable.push({ ...sample, quantity });
      continue;
    }
    const available = variants.find(item => item.inStock && item.cost !== null && Number(item.inventory ?? quantity) >= quantity);
    if (!available) unavailable.push({ ...sample, quantity });
    else requestedItems.push({ variantId: available.variantId, quantity });
  }
  return {
    mainQuantity,
    requestedItems,
    unavailable,
    quotedTotalDollars: quotedLineAmounts.length >= 2 ? quotedLineAmounts.reduce((sum, amount) => sum + amount, 0) : null,
  };
}

function requestedCartFromUnderstanding(items, mirror, main) {
  if (!Array.isArray(items) || !items.length) return null;
  const groups = new Map();
  for (const item of mirror.items) {
    const group = groups.get(item.productId) || [];
    group.push(item);
    groups.set(item.productId, group);
  }
  let mainQuantity = null;
  const requestedItems = [];
  const unavailable = [];
  const seen = new Set();
  for (const requested of items) {
    const hint = normalizeSearchText(requested?.productHint);
    const variants = [...groups.values()].find(group => productMention(hint, group[0]));
    if (!variants) return null;
    const sample = variants[0];
    if (seen.has(sample.productId)) continue;
    seen.add(sample.productId);
    const quantity = Number(requested.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_OFFER_QUANTITY) return null;
    if (sample.productId === main.productId) {
      mainQuantity = quantity;
      const selected = variants.find(item => item.variantId === main.variantId) || main;
      if (!selected.inStock || selected.cost === null || Number(selected.inventory ?? quantity) < quantity) unavailable.push({ ...sample, quantity });
      continue;
    }
    const available = variants.find(item => item.inStock && item.cost !== null && Number(item.inventory ?? quantity) >= quantity);
    if (!available) unavailable.push({ ...sample, quantity });
    else requestedItems.push({ variantId: available.variantId, quantity });
  }
  return { mainQuantity, requestedItems, unavailable, quotedTotalDollars: null };
}

function productMention(text, item) {
  const aliases = productAliases(item).sort((left, right) => right.length - left.length);
  for (const alias of aliases) {
    const match = new RegExp(`\\b${escapeRegExp(alias).replace(/\\ /g, "\\s+")}\\b`, "i").exec(text);
    if (match) return match;
  }
  return null;
}

function productAliases(item) {
  const title = normalizeSearchText(item.title);
  const handle = normalizeSearchText(item.handle || "");
  const aliases = new Set([title, handle].filter(Boolean));
  if (/\b(?:tee|shirt|top)\b/.test(title)) ["tee", "tees", "shirt", "shirts", "top", "tops"].forEach(alias => aliases.add(alias));
  if (/\bsocks?\b/.test(title)) ["sock", "socks"].forEach(alias => aliases.add(alias));
  if (/\bgaiters?\b/.test(title)) ["gaiter", "gaiters"].forEach(alias => aliases.add(alias));
  if (/\bcap\b/.test(title)) ["cap", "caps", "hat", "hats"].forEach(alias => aliases.add(alias));
  if (/\b(?:flask|bottle)\b/.test(title)) ["flask", "flasks", "bottle", "bottles"].forEach(alias => aliases.add(alias));
  if (/\bvest\b/.test(title)) ["vest", "vests"].forEach(alias => aliases.add(alias));
  return [...aliases];
}

function quantityBeforeProduct(text, index) {
  const prefix = text.slice(Math.max(0, index - 70), index);
  const numeric = prefix.match(/\b(\d+)\s*(?:x|pairs?\s+of|pieces?\s+of|items?\s+of)?\s*$/i);
  if (numeric) return Number(numeric[1]);
  const words = prefix.match(new RegExp(`\\b(${NUMBER_WORD_PATTERN}(?:\\s+${NUMBER_WORD_PATTERN})*)\\s*(?:pairs?\\s+of|pieces?\\s+of|items?\\s+of)?\\s*$`, "i"));
  const parsed = words ? parseNumberWords(words[1]) : null;
  return parsed && Number.isSafeInteger(parsed) ? parsed : null;
}

function quotedLinePrice(text, mention) {
  const prefix = text.slice(Math.max(0, mention.index - 90), mention.index);
  const suffix = text.slice(mention.index + mention[0].length, mention.index + mention[0].length + 50);
  if (/\bfree(?:\s+\w+){0,2}\s*$/.test(prefix) || /^\s*(?:for\s+)?free\b/.test(suffix)) return 0;
  const after = suffix.match(/^\s*(?:for|at)\s+(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)?\b/);
  if (after) return Number(after[1]);
  const before = prefix.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(?:total\\s+)?for\\s+(?:\\d+|${NUMBER_WORD_PATTERN}(?:\\s+${NUMBER_WORD_PATTERN})*)\\s*(?:pairs?\\s+of|pieces?\\s+of|items?\\s+of)?\\s*$`, "i"));
  return before ? Number(before[1]) : null;
}

function unavailableCartReply(unavailable, mirror, main) {
  const item = unavailable[0];
  const insufficientQuantity = item.quantity > 1;
  const alternative = availableAlternativeFor(item, mirror.items, main);
  const detail = insufficientQuantity ? " is unavailable in that quantity right now" : " is unavailable right now";
  const suggestion = alternative ? ` ${alternative.title} is available if you want to swap it in.` : " Please choose another published product.";
  return `${item.title}${detail}, so I did not create a partial offer.${suggestion}`;
}

function availableAlternativeFor(unavailable, items, main) {
  const unique = new Map();
  for (const item of items) {
    if (item.productId === unavailable.productId || item.productId === main.productId || !item.inStock || item.cost === null || Number(item.inventory ?? 1) < 1) continue;
    if (!unique.has(item.productId)) unique.set(item.productId, item);
  }
  const alternatives = [...unique.values()];
  return alternatives.find(item => Boolean(item.isAddOn) === Boolean(unavailable.isAddOn))
    || alternatives.find(item => item.productType === unavailable.productType)
    || alternatives[0];
}

function isStudentDiscountRequest(message) {
  const text = String(message || "");
  return /\b(?:student|college|school)\b/i.test(text) && /\b(?:discount|deal|price|offer)\b/i.test(text);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function negotiationOptions(candidates, round, main, maxRounds) {
  return candidates.map(({ id, offer }, index) => ({
    id,
    kind: offer.items[0].productId !== main.productId ? "else" : offer.kind === "bundle" ? "bundle" : round === maxRounds ? "final" : "held",
    items: offer.items.map((item, position) => ({ variantId: item.variantId, title: item.title, ...(item.size ? { size: item.size } : {}), qty: item.qty || 1, ...(position > 0 ? { thrownIn: true } : {}) })),
    listTotal: offer.listTotal, total: offer.total, ownerRank: index + 1, facts: [],
  }));
}

/** Option A, or the first "something else" when the offer is below every option's total. The line is a template around one public fact. */
function lowballCounter(candidates, menu, offered) {
  const belowAll = candidates.every(candidate => offered < candidate.offer.total);
  const elseOption = belowAll ? menu.find(option => option.kind === "else") : undefined;
  const picked = candidates.find(candidate => candidate.id === elseOption?.id) || candidates[0];
  const { offer } = picked;
  const title = offer.items[0].title;
  const fact = offer.items.length > 1
    ? `that includes ${offer.items.slice(1).map(item => `${item.qty || 1} × ${item.title}`).join(" and ")}`
    : offer.total < offer.listTotal
      ? `that is already ${formatMoney(offer.listTotal - offer.total)} off the ${formatMoney(offer.listTotal)} list price`
      : `that is the list price`;
  return { optionId: picked.id, line: `I can't get near ${formatMoney(toShopper(offered))}. ${title} is ${formatMoney(offer.total)} — ${fact}. Send me a fairer number and a reason, and I can work with you.`, trace: null };
}

function sameOfferItems(items, other) {
  return other && items.length === other.length && items.every((item, index) => item.variantId === other[index].variantId && (item.qty || 1) === (other[index].qty || 1));
}

async function phraseOfferWithBackboard({ menu, fallback, shopperId, negotiationId, message, round, main }) {
  const safeFallback = () => ({ optionId: fallback.id, line: fallback.offer.line, trace: null });
  if (!backboard) return safeFallback();
  try {
    const choice = await backboard.chooseAndSay(menu, {
      shopperId, negotiationId, shopperMessage: message, productId: main.productId, title: main.title,
      ...(main.size ? { size: main.size } : {}), round,
    });
    const checked = checkShopkeeperPick({ menu, pick: choice });
    if (checked.ok) {
      logBackboardRun("offer", choice.trace);
      return { optionId: choice.optionId, line: choice.line, trace: choice.trace };
    }
    const option = menu.find(option => option.id === choice.optionId);
    const neutralLine = option && checked.reason === "unsupported_reason" ? neutralBackboardLine(choice.line, option) : null;
    const neutralChecked = neutralLine ? checkShopkeeperPick({ menu, pick: { optionId: choice.optionId, line: neutralLine } }) : null;
    logBackboardRun(neutralChecked?.ok ? "offer_neutralized" : `offer_blocked_${checked.reason}`, choice.trace);
    owner.publish({ at: new Date().toISOString(), surface: "storefront", shopperId, negotiationId, kind: "blocked", blockedBy: "check", reasoning: `Unsafe agent wording was replaced: ${checked.reason}.` });
    return neutralChecked?.ok ? { optionId: choice.optionId, line: neutralLine, trace: choice.trace } : { ...safeFallback(), trace: choice.trace };
  } catch (error) {
    console.error("[backboard/offer]", error instanceof Error ? error.message : error);
    return safeFallback();
  }
}

function neutralBackboardLine(line, option) {
  const text = String(line || "").trim();
  const dollars = String(Math.round((option.total || 0) / 100));
  const pricePattern = `\\$\\s*${dollars}(?:\\.00)?`;
  const quantity = (option.items || []).reduce((sum, item) => sum + (item.qty || 1), 0);
  const bothAllowed = option.items?.length === 2 || quantity === 2;
  if (bothAllowed && new RegExp(`^I can do\\s+${pricePattern}\\s+for both\\b`, "i").test(text)) return `I can do ${formatMoney(option.total)} for both.`;
  if (bothAllowed && new RegExp(`^I can offer\\s+${pricePattern}\\s+for both\\b`, "i").test(text)) return `I can offer ${formatMoney(option.total)} for both.`;
  if (new RegExp(`^I can do\\s+${pricePattern}\\b`, "i").test(text)) return `I can do ${formatMoney(option.total)}.`;
  if (new RegExp(`^I can offer\\s+${pricePattern}\\b`, "i").test(text)) return `I can offer ${formatMoney(option.total)}.`;
  if (new RegExp(`^How about\\s+${pricePattern}\\b`, "i").test(text)) return `How about ${formatMoney(option.total)}.`;
  if (new RegExp(`^I can hold\\s+${pricePattern}\\s+for 15 minutes\\b`, "i").test(text)) return `I can hold ${formatMoney(option.total)} for 15 minutes.`;
  if (option.kind === "final" && new RegExp(`^My best is\\s+${pricePattern}\\b`, "i").test(text)) return `My best is ${formatMoney(option.total)}.`;
  for (const item of option.items || []) {
    const escapedTitle = escapeRegExp(String(item.title || "").trim());
    if (escapedTitle && new RegExp(`^${escapedTitle}\\s+is ready at\\s+${pricePattern}\\b`, "i").test(text)) return `${item.title} is ready at ${formatMoney(option.total)}.`;
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (isModelIdentityQuestion(message)) {
    return { reply: `This shopkeeper uses ${context.model} through Backboard. Server code, not the language model, calculates every offer total.`, local: true };
  }
  const quantityPrice = quantityPriceReply(message, products);
  if (quantityPrice) return { reply: quantityPrice.reply, memoryProducts: [quantityPrice.product] };
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
  if (isSizingQuestion(message)) return { reply: sizingReply(context.product, products) };
  if (/\b(shipping|ship|delivery|returns|return)\b/.test(message)) {
    return { reply: "Shipping and returns are handled in Shopify Checkout. For this demo, use the checkout page as the source of truth for shipping, taxes, and the final total." };
  }
  return null;
}

function isModelIdentityQuestion(message) {
  const text = normalizeSearchText(message);
  if (/\b(?:shoe|shoes|runner|product|tee|shirt|socks?)\b/.test(text)) return false;
  return /\b(?:model|llm)\b/.test(text) && /\b(?:you|your|using|use|powered|llm|ai|language)\b/.test(text);
}

function quantityPriceReply(message, products) {
  if (!/\b(?:how much|what does|what do|cost|price)\b/i.test(message)) return null;
  const quantity = parseQuantity(message, null);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  const text = normalizeSearchText(message);
  const product = products.find(candidate => productMention(text, candidate));
  if (!product || !Number.isSafeInteger(product.listPrice) || product.listPrice <= 0) return null;
  return {
    product,
    reply: `${quantity} ${product.title} cost ${formatMoney(product.listPrice * quantity)} at the storefront price. If you want to negotiate, tell me your total and give me a reason.`,
  };
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

function isSizingQuestion(message) {
  return /\b(size|sizing|tee|shirt|shoe|fit|fits|fitting|small|large|big|tight|loose|roomy|true to size|tts|run small|runs small|run big|runs big)\b/i.test(String(message || ""));
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
  return hasMoney || hasOfferLanguage;
}

function parseOfferTerms(message, payload = {}, understanding = {}, options = {}) {
  const quantity = understanding.quantity ?? parseQuantity(message, options.fallbackQuantity ?? 1) ?? 1;
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
  const prefixedNumber = text.match(/\b(for|at|around|about|under|to|do|take|offer|pay|price|give|make|call it|down to|knock(?: them| it)? down to|meet me at|what about)\s+(\d+(?:\.\d{1,2})?)\b/i);
  if (prefixedNumber) {
    const tail = text.slice((prefixedNumber.index || 0) + prefixedNumber[0].length);
    const isQuantity = prefixedNumber[1].toLowerCase() === "for" && /^\s*(?:x|pcs?|pieces?|items?|tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?)\b/i.test(tail);
    if (!isQuantity) return Number(prefixedNumber[2]);
  }
  const wordMoney = parseMoneyWords(text);
  if (wordMoney !== null) return wordMoney;
  if (/^\s*\d+(?:\.\d{1,2})?\s*$/.test(text)) return Number(text);
  return null;
}

function parseQuantity(value, fallback = 1) {
  const text = normalizeSearchText(value);
  const match = text.match(/\b(?:buy|get|take|grab|want|order|add|need)\s+(\d+)\b|\b(\d+)\s*(?:x|pcs?|pieces?|items?|tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?)\b/i);
  const wordMatch = text.match(/\b(?:buy|get|take|grab|want|order|add|need)\s+([a-z -]+?)\s+(?:tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?|items?)\b/i);
  const directWordMatch = text.match(new RegExp(`\\b(${NUMBER_WORD_PATTERN}(?:\\s+${NUMBER_WORD_PATTERN})*)\\s+(?:tees?|shirts?|socks?|pairs?|tops?|shoes?|runners?|vests?|caps?|items?)\\b`, "i"));
  const pairMatch = /\b(couple|both)\b/i.test(text);
  const halfDozen = /\bhalf dozen\b/i.test(text);
  const wordQuantity = wordMatch ? parseNumberWords(wordMatch[1]) : directWordMatch ? parseNumberWords(directWordMatch[1]) : null;
  const quantity = match ? Number(match[1] || match[2]) : halfDozen ? 6 : wordQuantity ?? (pairMatch ? 2 : /\b(?:a|one) pair\b/.test(text) ? 1 : fallback);
  if (quantity === null || quantity === undefined) return null;
  return Number.isFinite(quantity) ? quantity : fallback;
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

function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function centsToDecimal(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function gidTail(gid) {
  return String(gid || "").split("/").pop() || "";
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

server.on("close", () => owner?.dispose());
return server;
}
