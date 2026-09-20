#!/usr/bin/env node
// Showcase for the immersive shopkeeper (PLAN V1–V11): a stand-in Trailhead store on localhost — where the microphone
// works — with the REAL widget markup from layout/theme.liquid and every juniper-* feature file of the chosen theme folder.
//   node scripts/juniper-showcase.mjs                      # this checkout's theme
//   THEME_ROOT=/path/to/worktree/apps/storefront node scripts/juniper-showcase.mjs
// The chat is relayed to the LIVE server, so NEVER click Deal: it mints a real discount.
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const themeRoot = resolve(process.env.THEME_ROOT || `${repo}/apps/storefront`);
const port = Number(process.env.SHOWCASE_PORT || 9294);
const upstream = process.env.BAZAAR_SERVER_URL || "https://bazaar-chat-production.up.railway.app";
// The widget calls this server and /api/* is relayed, so the live server's CORS list never matters.
const endpoint = `http://localhost:${port}`;
const types = { ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

const TRY = [
  ["V1 Hands-free", "Open the chat, click the small mic, then just talk. Pause ~1 s and your turn sends itself; when she finishes speaking the mic reopens. Add ?listen=always to the URL and she listens from page load."],
  ["V2 Survives navigation", "Haggle on a product, then click a product card inside the chat. The transcript and card come with you. Pasting the URL in a new tab starts clean."],
  ["V3 Motion + pill", "Open and close the chat. With hands-free on, close it: a listening pill stays."],
  ["V4 Live presence", "With hands-free on, watch the halo and bars follow your voice, and Juniper’s mouth follow hers."],
  ["V5 Page awareness", "On All products or Cart, ask “what about this one?” or mention what is in your cart. (The spoken page-aware opening needs the server change deployed.)"],
  ["V6 Chips that change", "Compare the chips here, on a product page at quantity 1 and 2, and after each offer. A used chip never comes back."],
  ["V7 Juniper points", "On All products, ask “what’s good for muddy trails?” — the product she names is scrolled to and ringed."],
  ["V8 “Hey Jarvis”", "With the chat closed, say “Hey Jarvis”: the chat opens and she is listening. The ear on the launcher shows it is armed; allow the microphone when Chrome asks."],
  ["V9 Nudge", "On a product page, leave the chat closed for 20 s. Once per session."],
  ["V10 Sounds + status", "With voice on: a soft rising note when listening starts, a low note when the reply is ready."],
  ["V11 Filler", "With spoken replies on, a slow reply (> 1.5 s) gets one short spoken filler."],
];

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const cart = { item_count: 1, items: [{ key: "socks-m", handle: "trail-socks", title: "Trail Socks", product_title: "Trail Socks", variant_title: "M", quantity: 1 }] };

let products = [];
async function loadProducts() {
  if (products.length) return products;
  const body = await (await fetch(`${upstream}/api/products`)).json();
  products = Array.isArray(body.items) ? body.items : [];
  return products;
}

function widgetMarkup() {
  const liquid = readFileSync(`${themeRoot}/layout/theme.liquid`, "utf8");
  const start = liquid.indexOf('<div\n      class="ai-chat"');
  const end = liquid.indexOf('<script type="application/json" data-ai-chat-products>');
  return liquid.slice(start, end).replace("{{ settings.ai_chat_endpoint | escape }}", endpoint);
}

function featureTags() {
  // Same order as layout/theme.liquid loads them, so load-order bugs show up here too.
  const order = [...readFileSync(`${themeRoot}/layout/theme.liquid`, "utf8").matchAll(/'(juniper-[a-z]+\.js)'/g)].map((match) => match[1]);
  const rank = (file) => (order.indexOf(file.replace(/\.css$/, ".js")) + 1) || 99;
  const assets = readdirSync(`${themeRoot}/assets`).filter((file) => file.startsWith("juniper-")).sort((a, b) => rank(a) - rank(b));
  const css = assets.filter((file) => file.endsWith(".css")).map((file) => `<link rel="stylesheet" href="/assets/${file}">`);
  const js = assets.filter((file) => file.endsWith(".js")).map((file) => `<script src="/assets/${file}" defer></script>`);
  return [...css, ...js].join("\n");
}

let listenMode = "";
function withShopper(path, shopper) {
  const query = new URLSearchParams();
  if (shopper) query.set("shopper", shopper);
  if (listenMode) query.set("listen", listenMode);
  return query.size ? `${path}?${query}` : path;
}

function productCard(product, shopper) {
  const url = withShopper(product.url, shopper);
  const image = product.image ? `<img src="${escapeHtml(product.image)}&width=540" alt="" loading="lazy">` : `<span class="product-card__placeholder" aria-hidden="true">${escapeHtml(String(product.title || "").slice(0, 1))}</span>`;
  return `<article class="product-card"><a class="product-card__image" href="${escapeHtml(url)}" aria-label="View ${escapeHtml(product.title)}">${image}</a><div class="product-card__details"><h3><a href="${escapeHtml(url)}">${escapeHtml(product.title)}</a></h3><p class="product-card__price">${escapeHtml(product.price || "")}</p></div></article>`;
}

async function page(url) {
  const all = await loadProducts();
  const shopper = url.searchParams.get("shopper") || "";
  listenMode = url.searchParams.get("listen") === "always" ? "always" : "";
  const handle = url.pathname.startsWith("/products/") ? decodeURIComponent(url.pathname.slice("/products/".length)) : "";
  const current = handle ? all.find((product) => product.handle === handle) : null;
  const isCart = url.pathname === "/cart";
  if (url.pathname === "/collections/all") url.pathname = "/";
  const pageType = current ? "product" : isCart ? "cart" : "collection";
  const context = { pageType, template: pageType, path: url.pathname, cartItemCount: cart.item_count };
  if (current) context.product = { id: current.productNumericId, handle: current.handle, title: current.title, type: current.type, available: true };
  if (pageType === "collection") context.collection = { handle: "all", title: "All products", productHandles: all.slice(0, 12).map((product) => product.handle) };

  const nav = `<nav class="showcase-nav"><a href="${withShopper("/", shopper)}"><strong>Trailhead Co.</strong></a><a href="${withShopper("/", shopper)}">All products</a><a href="${withShopper("/cart", shopper)}">Cart (${cart.item_count})</a><span>showcase · ${escapeHtml(themeRoot.replace(repo, "."))}</span></nav>`;
  let main;
  if (current) {
    const options = (current.variants || []).map((variant) => `<option value="${escapeHtml(variant.id)}"${String(variant.id) === String(current.selectedVariantNumericId) ? " selected" : ""}>${escapeHtml(variant.title)}</option>`).join("");
    main = `<section class="showcase-product"><div class="showcase-product__image">${current.image ? `<img src="${escapeHtml(current.image)}&width=900" alt="">` : ""}</div><div><h1>${escapeHtml(current.title)}</h1><p class="showcase-product__price" data-product-price>${escapeHtml(current.price || "")}</p><form class="showcase-form product-form" onsubmit="return false"><label>Size <select name="id">${options}</select></label><label>Quantity <input name="quantity" type="number" min="1" value="1"></label><button type="submit">Add to cart</button><button type="button" class="showcase-offer" data-ai-chat-open>Make an offer</button></form></div></section>`;
  } else if (isCart) {
    main = `<section class="showcase-cart"><h1>Your cart</h1>${cart.items.map((item) => `<p>${escapeHtml(item.title)} · ${escapeHtml(item.variant_title)} × ${item.quantity}</p>`).join("")}</section>`;
  } else {
    main = `<section><h1>All products</h1><div class="showcase-grid">${all.map((product) => productCard(product, shopper)).join("")}</div></section>`;
  }
  const rail = `<details class="showcase-try" open><summary>What to try</summary><p class="showcase-warn">The chat is live. Never click <b>Deal</b> — it mints a real discount.</p><ol>${TRY.map(([name, how]) => `<li><b>${escapeHtml(name)}</b> ${escapeHtml(how)}</li>`).join("")}</ol></details>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Juniper showcase</title>
<link rel="stylesheet" href="/assets/critical.css">
<style>
  body { margin: 0; background: var(--cream, #fdf3e3); color: var(--bark, #2f1604); font-family: Satoshi, system-ui, sans-serif; }
  main { max-width: 68rem; margin: 0 auto; padding: 1.5rem 1.25rem 12rem; }
  h1 { font-family: Fredoka, system-ui, sans-serif; }
  .showcase-nav { display: flex; gap: 1.25rem; align-items: baseline; padding: 1rem 1.25rem; background: var(--teal, #004c4c); color: var(--cream, #fdf3e3); }
  .showcase-nav a { color: inherit; text-decoration: none; } .showcase-nav span { margin-left: auto; opacity: .7; font-size: .8rem; }
  .showcase-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 1.5rem; }
  .product-card { display: grid; gap: .8rem; } .product-card__image { display: grid; aspect-ratio: 4 / 5; overflow: hidden; background: #d7eadf; border-radius: .75rem; }
  .product-card__image img { width: 100%; height: 100%; object-fit: cover; } .product-card h3 { margin: 0; font-size: 1rem; } .product-card a { color: inherit; text-decoration: none; } .product-card__price { margin: 0; }
  .showcase-product { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; } .showcase-product__image img { width: 100%; border-radius: 1rem; }
  .showcase-form { display: grid; gap: .9rem; max-width: 20rem; } .showcase-form select, .showcase-form input, .showcase-form button { font: inherit; padding: .6rem .8rem; border-radius: .6rem; border: 1px solid var(--paper-edge, #ead9bb); }
  .showcase-offer { background: var(--coral, #f3675a); border-color: transparent !important; font-weight: 700; }
  .showcase-try { position: fixed; left: 1rem; bottom: 1rem; z-index: 5; width: min(24rem, calc(100vw - 2rem)); max-height: 70vh; overflow: auto; padding: .75rem 1rem; border-radius: .9rem; background: #fff; box-shadow: 0 12px 30px -12px rgb(47 22 4 / 45%); font-size: .85rem; line-height: 1.4; }
  .showcase-try summary { cursor: pointer; font-weight: 700; } .showcase-try ol { padding-left: 1.1rem; } .showcase-try li { margin: .45rem 0; } .showcase-warn { color: var(--coral-deep, #c9483c); }
  @media (max-width: 720px) { .showcase-product { grid-template-columns: 1fr; } .showcase-try { position: static; width: auto; margin: 1rem; } }
</style></head><body>
${nav}<main>${main}</main>${rail}
${widgetMarkup()}
<script type="application/json" data-ai-chat-products>${json(all.map((product) => ({ productId: product.productNumericId, handle: product.handle, title: product.title, url: product.url, type: product.type, price: product.price, listPrice: product.listPrice, available: true, selectedVariantId: product.selectedVariantNumericId })))}</script>
${current ? `<script type="application/json" data-ai-chat-current-product>${json({ ...current, productId: current.productNumericId, selectedVariantId: current.selectedVariantNumericId })}</script>` : ""}
<script>window.BazaarChatFlags = ${json({ ...(url.searchParams.get("listen") === "always" ? { autoListen: "always" } : {}), ...(url.searchParams.get("ears") ? { ears: url.searchParams.get("ears") } : {}) })};</script>
<script src="/assets/chat-demo.js" defer></script>
<script type="application/json" data-ai-chat-page>${json(context)}</script>
${featureTags()}
</body></html>`;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);
    if (url.pathname.startsWith("/assets/")) {
      const file = resolve(themeRoot, "assets", url.pathname.slice("/assets/".length));
      if (!file.startsWith(`${themeRoot}/assets/`) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(readFileSync(file));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const relayed = await fetch(`${upstream}${url.pathname}${url.search}`, { method: request.method, headers: { "Content-Type": request.headers["content-type"] || "application/json", Accept: request.headers.accept || "*/*" }, body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks) });
      response.writeHead(relayed.status, { "Content-Type": relayed.headers.get("content-type") || "application/json", "Cache-Control": "no-store" });
      response.end(Buffer.from(await relayed.arrayBuffer()));
      return;
    }
    // A stand-in for Shopify's cart API, so Juniper's hands (V13) have a cart to work on. Held in memory.
    if (url.pathname === "/cart/add.js" || url.pathname === "/cart/change.js") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      let touched = null;
      if (url.pathname === "/cart/add.js") {
        for (const wanted of body.items || []) {
          const owner = (await loadProducts()).find((product) => (product.variants || []).some((variant) => String(variant.id) === String(wanted.id)) || String(product.selectedVariantId) === String(wanted.id) || String(product.selectedVariantNumericId) === String(wanted.id));
          const variant = owner && (owner.variants || []).find((entry) => String(entry.id) === String(wanted.id));
          touched = cart.items.find((item) => item.key === String(wanted.id));
          if (touched) touched.quantity += wanted.quantity || 1;
          else { touched = { key: String(wanted.id), handle: owner ? owner.handle : "", title: owner ? owner.title : "Item", product_title: owner ? owner.title : "Item", variant_title: variant ? variant.title : "", quantity: wanted.quantity || 1 }; cart.items.push(touched); }
        }
      } else {
        touched = cart.items.find((item) => item.key === String(body.id));
        if (touched) touched.quantity = body.quantity;
        cart.items = cart.items.filter((item) => item.quantity > 0);
      }
      cart.item_count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(url.pathname === "/cart/add.js" ? { items: [touched] } : cart));
      return;
    }
    if (url.pathname.startsWith("/products/") && url.pathname.endsWith(".js")) {
      const wanted = decodeURIComponent(url.pathname.slice("/products/".length, -3));
      const found = (await loadProducts()).find((product) => product.handle === wanted);
      response.writeHead(found ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify(found ? { handle: found.handle, title: found.title, variants: (found.variants || []).map((variant) => ({ id: variant.id, title: variant.title, available: variant.available !== false })) } : {}));
      return;
    }
    if (url.pathname === "/cart.js") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(cart)); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(await page(url));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(error instanceof Error ? error.stack : String(error));
  }
}).listen(port, "127.0.0.1", () => console.log(`Juniper showcase: http://localhost:${port}/?shopper=demo  (theme: ${themeRoot})`));
