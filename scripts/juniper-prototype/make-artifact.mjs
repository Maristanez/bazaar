// Builds one self-contained artifact page: the real widget (theme.liquid markup, critical.css, chat-demo.js and the
// chosen juniper-* files) on a stand-in Trailhead store, with a scripted shopkeeper in place of the server
// (artifact pages cannot reach the network) and a simulated microphone when the page is not allowed a real one.
//   node make-artifact.mjs <themeRoot> <out.html> "<Title>" "<what to try html>" [feature ...]   (no features = all)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const [themeRoot, out, title, tryHtml, ...only] = process.argv.slice(2);
const assets = `${themeRoot}/assets`;
const features = readdirSync(assets).filter((file) => file.startsWith("juniper-")).map((file) => file.replace(/^juniper-|\.(js|css)$/g, "")).filter((name, index, all) => all.indexOf(name) === index).filter((name) => !only.length || only.includes(name)).sort();
const read = (file) => { try { return readFileSync(`${assets}/${file}`, "utf8"); } catch { return ""; } };
const inlineJs = (source) => source.replace(/<\/script/gi, "<\\/script");
const liquid = readFileSync(`${themeRoot}/layout/theme.liquid`, "utf8");
const widget = liquid.slice(liquid.indexOf('<div\n      class="ai-chat"'), liquid.indexOf('<script type="application/json" data-ai-chat-products>')).replace("{{ settings.ai_chat_endpoint | escape }}", "https://juniper.prototype");
const css = read("critical.css").replace(/@font-face\s*{[^}]*}/g, "");

const products = [
  { productId: "p1", handle: "trail-runner-3", title: "Trail Runner 3", type: "Shoes", price: "$168", listPrice: 16800, sizes: ["8", "9", "10", "11"], blurb: "This season's grippy all-rounder." },
  { productId: "p2", handle: "trail-runner-2", title: "Trail Runner 2", type: "Shoes", price: "$148", listPrice: 14800, sizes: ["8", "9", "10", "11"], blurb: "Last season's fit, deeper lugs for mud." },
  { productId: "p3", handle: "mud-gaiters", title: "Mud Gaiters", type: "Accessories", price: "$34", listPrice: 3400, sizes: ["S/M", "L/XL"], blurb: "Keeps the trail out of your shoes." },
  { productId: "p4", handle: "trail-socks", title: "Trail Socks", type: "Accessories", price: "$18", listPrice: 1800, sizes: ["M", "L"], blurb: "Merino blend, no blisters." },
  { productId: "p5", handle: "trail-cap", title: "Trail Cap", type: "Accessories", price: "$28", listPrice: 2800, sizes: ["One size"], blurb: "Light, packable, sun-proof." },
  { productId: "p6", handle: "everyday-heavyweight-tee", title: "Everyday Heavyweight Tee", type: "T-Shirts", price: "$58", listPrice: 5800, sizes: ["S", "M", "L"], blurb: "For after the run." },
].map((product) => ({ ...product, url: `#/products/${product.handle}`, available: true, selectedVariantId: `${product.productId}-v1`, variants: product.sizes.map((size, index) => ({ id: `${product.productId}-v${index + 1}`, title: size, price: product.price })) }));

const page = `<title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap">
<style>
${css}
:root { color-scheme: light; }
html, body { background: #fdf3e3; }
body { margin: 0; color: #2f1604; font-family: Satoshi, "Avenir Next", "Segoe UI", system-ui, sans-serif; font-size: 16px; }
h1, h2, h3, .proto-brand { font-family: Fredoka, "Avenir Next", system-ui, sans-serif; }
.proto-nav { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; align-items: baseline; padding: .9rem 16px; background: #004c4c; color: #fdf3e3; }
.proto-nav a { color: inherit; text-decoration: none; } .proto-nav a:focus-visible, .proto-main a:focus-visible, .proto-main button:focus-visible { outline: 3px solid #f6d809; outline-offset: 2px; }
.proto-brand { font-size: 1.2rem; font-weight: 600; }
.proto-main { max-width: 66rem; margin: 0 auto; padding-block: 1.25rem 24rem; padding-inline: 16px; display: grid; gap: 1.25rem; }
.proto-note { display: grid; gap: .6rem; padding: 1rem 1.1rem; border-radius: .9rem; background: #fffaf0; border: 1px dashed #ead9bb; font-size: .92rem; line-height: 1.45; max-width: 46rem; }
.proto-note h2 { margin: 0; font-size: 1.05rem; } .proto-note p, .proto-note ul { margin: 0; } .proto-note ul { padding-left: 1.1rem; display: grid; gap: .3rem; }
.proto-note small { color: rgb(47 22 4 / 72%); }
.proto-modes { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
.proto-modes button, .proto-say button { font: inherit; font-weight: 700; padding: .45rem .8rem; border-radius: 999px; border: 2px solid #004c4c; background: transparent; color: #004c4c; cursor: pointer; }
.proto-modes button[aria-pressed="true"] { background: #004c4c; color: #fdf3e3; }
.proto-say { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.proto-say input { flex: 1 1 14rem; min-width: 0; font: inherit; padding: .55rem .8rem; border-radius: .7rem; border: 2px solid #ead9bb; background: #fff; color: inherit; }
.proto-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: 1.25rem; }
.product-card { display: grid; gap: .6rem; } .product-card h3 { margin: 0; font-size: 1rem; } .product-card a { color: inherit; text-decoration: none; } .product-card p { margin: 0; }
.product-card__image { display: grid; place-items: center; aspect-ratio: 4 / 5; max-width: 100%; border-radius: .8rem; background: #d7eadf; color: #004c4c; font: 600 3rem Fredoka, system-ui, sans-serif; }
.proto-product { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.proto-product .product-card__image { aspect-ratio: 1; font-size: 6rem; }
.proto-form { display: grid; gap: .8rem; max-width: 19rem; } .proto-form label { display: grid; gap: .25rem; font-weight: 700; font-size: .9rem; }
.proto-form select, .proto-form input, .proto-form button { font: inherit; padding: .6rem .8rem; border-radius: .6rem; border: 2px solid #ead9bb; background: #fff; color: inherit; }
.proto-form .proto-offer { background: #f3675a; border-color: #f3675a; font-weight: 700; cursor: pointer; }
@media (max-width: 640px) { .proto-product { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
${features.map((name) => read(`juniper-${name}.css`)).join("\n")}
</style>

<nav class="proto-nav" aria-label="Stand-in store"><a class="proto-brand" href="#/">Trailhead Co.</a><a href="#/">All products</a><a href="#/cart">Cart (1)</a></nav>
<main class="proto-main">
  <section class="proto-note" aria-label="About this prototype">
    <h2>${title}</h2>
    ${tryHtml}
    <div class="proto-modes" role="group" aria-label="When does Juniper start listening">
      <span>Listening starts:</span>
      <button type="button" data-proto-mode="">on a click</button>
      <button type="button" data-proto-mode="always">by itself</button>
      <button type="button" data-proto-mode="keyword">on “Jarvis”</button>
    </div>
    <form class="proto-say" data-proto-say hidden>
      <label class="visually-hidden" for="proto-say-input">Say something (simulated microphone)</label>
      <input id="proto-say-input" type="text" autocomplete="off" placeholder="Simulated mic — type what you would say, press Enter">
      <button type="submit">Say it</button>
    </form>
    <small data-proto-mic></small>
    <small>The shopkeeper here is scripted, and its prices are made up: a published page cannot reach our server. Deal is switched off.</small>
  </section>
  <div data-proto-page></div>
</main>
${widget}
<script type="application/json" data-ai-chat-products>${JSON.stringify(products).replace(/</g, "\\u003c")}</script>
<script>
(function () {
  var PRODUCTS = ${JSON.stringify(products).replace(/</g, "\\u003c")};
  var store = { get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { v === null ? window.localStorage.removeItem(k) : window.localStorage.setItem(k, v); } catch (e) {} } };
  var escapeHtml = function (v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };

  // ---- which page (hash routes; a link reloads the page, like the real multi-page theme) ----
  var route = (window.location.hash || '#/').slice(1);
  var current = route.indexOf('/products/') === 0 ? PRODUCTS.filter(function (p) { return p.handle === route.slice(10); })[0] : null;
  var pageType = current ? 'product' : route === '/cart' ? 'cart' : 'collection';
  var mount = document.querySelector('[data-proto-page]');
  if (current) {
    mount.innerHTML = '<section class="proto-product"><div class="product-card__image" aria-hidden="true">' + escapeHtml(current.title.charAt(0)) + '</div><div><h1>' + escapeHtml(current.title) + '</h1><p>' + escapeHtml(current.price) + ' · ' + escapeHtml(current.blurb) + '</p><form class="proto-form" data-product-form onsubmit="return false"><label for="proto-size">Size<select id="proto-size" name="id">' + current.variants.map(function (v) { return '<option value="' + v.id + '">' + escapeHtml(v.title) + '</option>'; }).join('') + '</select></label><label for="proto-qty">Quantity<input id="proto-qty" name="quantity" type="number" min="1" value="1"></label><button type="button">Add to cart</button><button type="button" class="proto-offer" data-ai-chat-open>Make an offer</button></form></div></section>';
    var tag = document.createElement('script'); tag.type = 'application/json'; tag.setAttribute('data-ai-chat-current-product', ''); tag.textContent = JSON.stringify(current); document.body.appendChild(tag);
  } else if (pageType === 'cart') {
    mount.innerHTML = '<section><h1>Your cart</h1><p>Trail Socks · M × 1</p></section>';
  } else {
    mount.innerHTML = '<section><h1>All products</h1><div class="proto-grid">' + PRODUCTS.map(function (p) { return '<article class="product-card"><a class="product-card__image" href="' + p.url + '" aria-label="View ' + escapeHtml(p.title) + '">' + escapeHtml(p.title.charAt(0)) + '</a><div class="product-card__details"><h3><a href="' + p.url + '">' + escapeHtml(p.title) + '</a></h3><p class="product-card__price">' + p.price + '</p></div></article>'; }).join('') + '</div></section>';
  }
  var ctx = { pageType: pageType, template: pageType, path: route, cartItemCount: 1 };
  if (current) ctx.product = { id: current.productId, handle: current.handle, title: current.title, type: current.type, available: true };
  if (pageType === 'collection') ctx.collection = { handle: 'all', title: 'All products', productHandles: PRODUCTS.map(function (p) { return p.handle; }) };
  var blob = document.createElement('script'); blob.type = 'application/json'; blob.setAttribute('data-ai-chat-page', ''); blob.textContent = JSON.stringify(ctx); document.body.appendChild(blob);
  window.addEventListener('hashchange', function () { window.location.reload(); });
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    var at = href.indexOf('/products/');
    if (href.charAt(0) !== '#' && at !== -1) { event.preventDefault(); window.location.hash = '#' + href.slice(at).split('?')[0]; }
  });

  // ---- listening mode ----
  var modeValue = store.get('proto:autoListen') || '';
  window.BazaarChatFlags = { autoListen: modeValue || undefined };
  Array.prototype.forEach.call(document.querySelectorAll('[data-proto-mode]'), function (button) {
    button.setAttribute('aria-pressed', button.getAttribute('data-proto-mode') === modeValue ? 'true' : 'false');
    button.addEventListener('click', function () {
      store.set('proto:autoListen', button.getAttribute('data-proto-mode') || null);
      try { window.sessionStorage.clear(); } catch (e) {}
      window.location.reload();
    });
  });

  // ---- the scripted shopkeeper (stands in for the server) ----
  var state = { round: 0, cards: {} };
  try { state = JSON.parse(window.sessionStorage.getItem('proto:server') || '') || state; } catch (e) {}
  var save = function () { try { window.sessionStorage.setItem('proto:server', JSON.stringify(state)); } catch (e) {} };
  function cardFor(product, qty, addOn) {
    state.round = Math.min(4, state.round + 1);
    var steps = [0.97, 0.93, 0.89, 0.86];
    var items = [{ title: product.title, qty: qty, size: null, listPrice: product.listPrice }];
    if (addOn) items.push({ title: addOn.title, qty: 1, size: null, listPrice: addOn.listPrice, thrownIn: false });
    var list = items.reduce(function (sum, item) { return sum + item.listPrice * item.qty; }, 0);
    var total = Math.round(list * steps[state.round - 1] / 100) * 100;
    var id = 'offer-' + state.round + '-' + product.handle;
    var card = { negotiationId: 'neg-' + product.handle, offerId: id, status: 'live', round: state.round, maxRounds: 4, mood: state.round >= 4 ? 'offended' : 'tempted', line: '', badges: addOn ? ['＋ ' + addOn.title.toLowerCase()] : state.round === 1 ? [] : ['held 15 min'], trail: [], option: { id: 'A', kind: addOn ? 'bundle' : 'held_price', items: items, listTotal: list, total: total }, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), disclosure: ["You're talking to Trailhead Co's deal agent.", 'Only this card is binding; chat text is not.'] };
    state.cards[id] = card; save();
    return card;
  }
  function chat(body) {
    var text = String(body.message || '').toLowerCase();
    var named = PRODUCTS.filter(function (p) { return text.indexOf(p.title.toLowerCase()) !== -1; })[0];
    var product = named || (body.product && PRODUCTS.filter(function (p) { return p.handle === body.product.handle; })[0]) || null;
    var where = body.page ? (body.page.pageType === 'collection' ? 'the ' + (body.page.collection && body.page.collection.title || 'collection') + ' page' : body.page.pageType === 'cart' ? 'your cart' : 'the ' + (body.page.product && body.page.product.title || 'product') + ' page') : null;
    if (/where am i|what page|this one|what am i looking/.test(text)) return { reply: where ? "You're on " + where + (body.page.cart && body.page.cart.items && body.page.cart.items.length ? ', with ' + body.page.cart.items[0].title + ' already in your cart.' : '.') : "I can't see the page in this build — page awareness is prototype V5." };
    if (/mud|muddy|wet|rain/.test(text)) return { reply: 'For muddy trails I would look at the Trail Runner 2 — deeper lugs — and the Mud Gaiters to keep the trail out.', products: PRODUCTS };
    if (/cheaper|less expensive|last season/.test(text)) return { reply: "Last season's Trail Runner 2 is the same fit and easier on the budget.", products: PRODUCTS };
    if (/size|fit/.test(text)) return { reply: 'They run true to size. If you are between sizes, go half up for long descents.' };
    if (!product) return { reply: 'Happy to talk price. Which one are you eyeing — the Trail Runner 3, the Trail Runner 2, or something smaller?', products: PRODUCTS };
    var wantsAddOn = /gaiter|sock|add|bundle|throw/.test(text);
    var reason = /\\d|budget|student|two|pairs|race|today|now|cart|buy|deal|best|middle|move|offer|price|do /.test(text);
    if (!reason) return { reply: product.title + ' — good pick. Name a price and give me a reason, and I will see what I can do.' };
    var qty = Number(body.quantity) > 1 ? Number(body.quantity) : /two|pairs|2 /.test(text) ? 2 : 1;
    var addOn = wantsAddOn ? PRODUCTS.filter(function (p) { return p.handle === (/sock/.test(text) ? 'trail-socks' : 'mud-gaiters'); })[0] : null;
    var card = cardFor(product, qty, addOn);
    var lines = ['I can move a little for that. Here is what I can do.', 'That helps. I will sharpen it — and hold it for fifteen minutes.', 'You drive a fair bargain. This is close to my best.', 'This is my final offer. It is a good one.'];
    card.line = lines[card.round - 1];
    return { reply: card.line, card: card, negotiationId: card.negotiationId, products: PRODUCTS };
  }
  function wav(seconds) {
    var rate = 8000, n = Math.max(1, Math.round(seconds * rate)), buffer = new ArrayBuffer(44 + n * 2), view = new DataView(buffer);
    var put = function (o, s) { for (var i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i)); };
    put(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); put(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, n * 2, true);
    return new Blob([buffer], { type: 'audio/wav' });
  }
  function speak(text) {
    // The real voice comes from our server; here the browser's own voice reads the words over a silent clip of the same length.
    try { if (window.speechSynthesis) { window.speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 1.05; window.speechSynthesis.speak(u); } } catch (e) {}
    return wav(Math.min(14, 0.8 + String(text).split(/\\s+/).length * 0.33));
  }
  var slow = function (value, ms) { return new Promise(function (resolve) { window.setTimeout(function () { resolve(value); }, ms); }); };
  window.fetch = function (input, init) {
    var url = new URL(String(input), window.location.href), path = url.pathname, body = {};
    try { body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch (e) {}
    var respond = function (data, blobValue) { return { ok: true, status: 200, json: function () { return Promise.resolve(data); }, blob: function () { return Promise.resolve(blobValue); } }; };
    if (path === '/cart.js') return slow(respond({ item_count: 1, items: [{ handle: 'trail-socks', title: 'Trail Socks', product_title: 'Trail Socks', variant_title: 'M', quantity: 1 }] }), 60);
    if (path === '/api/voice/config') return slow(respond({ enabled: true, provider: 'prototype' }), 30);
    if (path === '/api/voice/speak') return slow(respond({}, speak(body.text || '')), 250);
    if (path === '/api/voice/transcribe') return slow(respond({ text: '' }), 100);
    if (path === '/api/greeting') { var p = body.page; return slow(respond({ greeting: p && p.pageType === 'collection' ? 'Browsing the whole shelf? Tell me the trail and I will point you at the right pair.' : p && p.pageType === 'cart' ? 'I see socks in your cart. Want me to see what I can do on a pair of shoes to go with them?' : p && p.product ? 'Back at the ' + p.product.title + '? Name a price and a reason.' : '' }), 300); }
    if (path === '/api/accept') return slow({ ok: false, status: 409, json: function () { return Promise.resolve({ reply: 'Deal is switched off in this prototype — on the store it opens Shopify Checkout.' }); } }, 200);
    if (path.indexOf('/api/offers/') === 0) { var card = state.cards[decodeURIComponent(path.slice(12))]; return slow(respond(card ? { card: card, status: card.status } : {}), 80); }
    if (path === '/api/chat') return slow(respond(chat(body)), /slow|think hard/i.test(body.message || '') ? 3200 : 900);
    return slow(respond({}), 40);
  };

  // ---- microphone: the real one when this page is allowed it, otherwise a typed stand-in ----
  var Real = window.SpeechRecognition || window.webkitSpeechRecognition;
  var allowed = true;
  try { if (document.featurePolicy && document.featurePolicy.allowsFeature) allowed = document.featurePolicy.allowsFeature('microphone'); } catch (e) {}
  var micNote = document.querySelector('[data-proto-mic]');
  if (Real && allowed && store.get('proto:simulate') !== '1') {
    micNote.innerHTML = 'Using your real microphone (Chrome). If nothing hears you, <a href="#" data-proto-sim>switch to the simulated microphone</a>.';
    micNote.querySelector('[data-proto-sim]').addEventListener('click', function (event) { event.preventDefault(); store.set('proto:simulate', '1'); window.location.reload(); });
    return;
  }
  micNote.textContent = 'This page is not allowed a real microphone, so the box above stands in for your voice: what you type arrives word by word, the way speech does.';
  var sayForm = document.querySelector('[data-proto-say]'), sayInput = document.getElementById('proto-say-input');
  sayForm.hidden = false;
  var active = [];
  function Fake() { this.continuous = false; this.interimResults = false; this.lang = 'en-US'; }
  Fake.prototype.start = function () { if (active.indexOf(this) === -1) active.push(this); var self = this; window.setTimeout(function () { if (self.onstart) self.onstart({}); if (self.onaudiostart) self.onaudiostart({}); }, 0); };
  Fake.prototype.stop = Fake.prototype.abort = function () { var i = active.indexOf(this); if (i === -1) return; active.splice(i, 1); var self = this; window.setTimeout(function () { if (self.onend) self.onend({}); }, 0); };
  Fake.prototype.addEventListener = function (name, fn) { this['on' + name] = fn; };
  Fake.prototype.removeEventListener = function (name) { this['on' + name] = null; };
  window.SpeechRecognition = window.webkitSpeechRecognition = Fake;
  var level = { gain: null };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = function () {
    var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
    osc.type = 'sawtooth'; osc.frequency.value = 180; gain.gain.value = 0; osc.connect(gain); gain.connect(dest); osc.start(); level.gain = gain; level.ctx = ctx;
    return Promise.resolve(dest.stream);
  };
  function emit(text, isFinal) {
    active.slice().forEach(function (rec) {
      var alt = { transcript: text, confidence: 0.9 }, result = [alt]; result.isFinal = isFinal; result.length = 1; result.item = function () { return alt; };
      var results = [result]; results.item = function () { return result; };
      if (rec.onresult) rec.onresult({ resultIndex: 0, results: results });
    });
  }
  sayForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var words = sayInput.value.trim().split(/\\s+/).filter(Boolean); if (!words.length) return;
    sayInput.value = '';
    var said = [];
    words.forEach(function (word, index) {
      window.setTimeout(function () {
        said.push(word);
        if (level.gain) level.gain.gain.setTargetAtTime(0.5 + Math.random() * 0.5, level.ctx.currentTime, 0.02);
        emit(said.join(' '), index === words.length - 1);
        if (index === words.length - 1 && level.gain) level.gain.gain.setTargetAtTime(0, level.ctx.currentTime + 0.15, 0.05);
      }, 220 * (index + 1));
    });
  });
})();
</script>
<script>${inlineJs(read("chat-demo.js"))}</script>
${features.map((name) => `<script>${inlineJs(read(`juniper-${name}.js`))}</script>`).join("\n")}
`;
writeFileSync(out, page);
console.log(`${out}  ${(page.length / 1024).toFixed(0)} KB  features: ${features.join(", ") || "none"}`);
