#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const themeRoot = resolve(root, "shopify-theme");
const port = Number(process.env.BAZAAR_PREVIEW_PORT || 9293);
const upstream = process.env.BAZAAR_SERVER_URL || "http://127.0.0.1:3000";

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) return proxyApi(request, response, url);
    if (url.pathname === "/assets/chat-demo.js") return staticFile(response, resolve(themeRoot, "assets/chat-demo.js"), "application/javascript; charset=utf-8");
    if (url.pathname === "/assets/critical.css") return staticFile(response, resolve(themeRoot, "assets/critical.css"), "text/css; charset=utf-8");
    if (url.pathname === "/health") return sendJson(response, 200, { ok: true, preview: true, upstream });
    return renderPreview(response, url);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bazaar LOCAL storefront preview: http://127.0.0.1:${port}/?shopper=demo`);
  console.log(`Proxying /api/* to ${upstream}; press Ctrl-C to stop.`);
});

async function renderPreview(response, url) {
  const products = await loadProducts();
  const selected = products.find((product) => product.handle === url.searchParams.get("product")) || products[0] || emptyProduct();
  const current = selected;
  const productJson = jsonForScript(current);
  const productsJson = jsonForScript(products);
  const shopper = url.searchParams.get("shopper");
  const cards = products.map((product) => {
    const query = new URLSearchParams({ product: String(product.handle || "") });
    if (shopper) query.set("shopper", shopper);
    return `<a class="preview-product" href="/?${query.toString()}"><strong>${escapeHtml(product.title || "Product")}</strong><span>${escapeHtml(product.price || "")}</span></a>`;
  }).join("");
  const variants = (current.variants || []).map((variant) => `<option value="${escapeHtml(variant.id)}"${String(variant.id) === String(current.selectedVariantId) ? " selected" : ""}>${escapeHtml(variant.title || "Selected variant")}</option>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Trailhead LOCAL Storefront Preview</title><link rel="stylesheet" href="/assets/critical.css"><style>
body{margin:0;background:#fbf7ef;color:#17211c;font-family:system-ui,sans-serif}.local-banner{position:sticky;top:0;z-index:20;padding:.65rem 1rem;background:#7c2d12;color:#fff;text-align:center;font-weight:800;letter-spacing:.03em}.preview-shell{max-width:1100px;margin:0 auto;padding:2rem 1rem 8rem}.preview-nav{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:2rem}.preview-product{display:flex;justify-content:space-between;gap:1rem;padding:.75rem 1rem;border:1px solid #d1fae5;border-radius:.75rem;background:#fff;color:#064e3b;text-decoration:none}.preview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.75rem}.preview-panel{max-width:38rem;padding:1.5rem;border-radius:1.35rem;background:#fff;box-shadow:0 24px 80px rgb(23 33 28 / 10%)}.preview-panel select{width:100%;min-height:3rem;padding:.5rem;border:1px solid #b7c9bd;border-radius:.75rem}.preview-panel h1{color:#064e3b;font-size:clamp(2.5rem,7vw,5rem);line-height:.95;margin:.5rem 0}.preview-label{color:#9a3412;font-size:.8rem;font-weight:800;text-transform:uppercase}
</style></head><body><div class="local-banner">LOCAL PREVIEW · storefront chat → ${escapeHtml(upstream)} · unpublished</div><main class="preview-shell"><nav class="preview-nav"><strong>Trailhead Co.</strong><span>Choose a public product to test:</span></nav><div class="preview-grid">${cards || "<span>No public products returned by the local server.</span>"}</div><section class="preview-panel"><p class="preview-label">Local Shopify product preview</p><h1>${escapeHtml(current.title || "Trailhead product")}</h1><p>${escapeHtml(current.price || "Ask the shopkeeper about this item.")}</p><label for="ProductSelect-local">Variant / size</label><select id="ProductSelect-local" name="id">${variants || `<option value="${escapeHtml(current.selectedVariantId || "")}">Selected variant</option>`}</select><p>Use the bottom-right shopkeeper to test Q&A, Backboard memory, offers, approval polling, and checkout handoff.</p></section></main>
<div class="ai-chat" data-ai-chat data-ai-chat-endpoint="http://127.0.0.1:${port}"><section id="ai-chat-panel" class="ai-chat__panel" aria-labelledby="ai-chat-title" hidden><div class="ai-chat__header"><div><p class="ai-chat__eyebrow" data-ai-chat-mode>Scripted demo</p><h2 id="ai-chat-title">Trailhead AI shopkeeper</h2></div><button class="ai-chat__close" type="button" data-ai-chat-close aria-label="Close chat">&times;</button></div><div class="ai-chat__messages" data-ai-chat-messages aria-live="polite"><p class="ai-chat__message ai-chat__message--bot" data-ai-chat-welcome>Hi, I can help you find outfits, sizes, and offers.</p></div><div class="ai-chat__prompts" aria-label="Suggested chat prompts"><button type="button" data-ai-chat-prompt="Recommend a weekend outfit">Weekend outfit</button><button type="button" data-ai-chat-prompt="What size should I get?">Sizing help</button><button type="button" data-ai-chat-prompt="Could you do $120? I am buying socks too">Make an offer</button></div><form class="ai-chat__form" data-ai-chat-form><label class="visually-hidden" for="ai-chat-input">Message the Trailhead AI shopkeeper</label><input id="ai-chat-input" type="text" name="message" autocomplete="off" placeholder="Ask about outfits..." data-ai-chat-input><button type="submit">Send</button></form><p class="ai-chat__source">LOCAL PREVIEW: Backboard routes OpenAI with store documents and shopper memory.</p></section><button class="ai-chat__launcher" type="button" aria-label="Open Trailhead AI shopkeeper chat" aria-expanded="false" aria-controls="ai-chat-panel" data-ai-chat-toggle><span class="ai-chat__launcher-icon" aria-hidden="true">✦</span><span>AI chat</span></button></div><script type="application/json" data-ai-chat-products>${productsJson}</script><script type="application/json" data-ai-chat-current-product>${productJson}</script><script src="/assets/chat-demo.js" defer></script></body></html>`;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
}

async function loadProducts() {
  const response = await fetch(`${upstream}/api/products`);
  if (!response.ok) throw new Error(`Local server /api/products returned ${response.status}; start apps/server on port 3000 first.`);
  const body = await response.json();
  return Array.isArray(body.items) ? body.items : [];
}

function emptyProduct() { return { productId: "", handle: "", title: "Trailhead", price: "", listPrice: 0, variants: [] }; }
function jsonForScript(value) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

async function proxyApi(request, response, url) {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
  const target = `${upstream}${url.pathname}${url.search}`;
  const upstreamResponse = await fetch(target, { method: request.method, headers: { "Content-Type": request.headers["content-type"] || "application/json", Accept: request.headers.accept || "application/json" }, body });
  const data = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(upstreamResponse.status, { "Content-Type": upstreamResponse.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
  response.end(data);
}

function readBody(request) { return new Promise((resolveBody, reject) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => resolveBody(Buffer.concat(chunks))); request.on("error", reject); }); }
async function staticFile(response, path, type) { response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(await readFile(path)); }
function sendJson(response, status, body) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
