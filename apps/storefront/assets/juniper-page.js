// V5 page awareness (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// Tells the shopkeeper where the shopper is: the page Liquid describes, the cart once the chat is in use, and the
// variant and quantity picked. Conversation context only: no price is read, kept or sent from here, and every line
// the shopper hears about the page is recalled by the server — none is written in this file.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var CART_TIMEOUT_MS = 2000;
  var MAX_CART_LINES = 10;
  var VARIANT_SELECTOR = 'select[name="id"], select[id^="ProductSelect-"]';
  var QUANTITY_SELECTOR = 'input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]';
  var currentPage;
  var shopperHasSpoken = false;
  var greetingAsked = false;
  var voiceOn = false;

  function short(value) {
    return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function readBlob() {
    var source = document.querySelector('[data-ai-chat-page]');
    if (!source) return null;
    try {
      var parsed = JSON.parse(source.textContent || '');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.pageType ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  // Without the blob (an older theme.liquid, a stripped page) the address still says what kind of page this is.
  function pageFromLocation() {
    var path = (window.location && window.location.pathname) || '/';
    var pageType = /\/products\//.test(path) ? 'product'
      : /\/collections(\/|$)/.test(path) ? 'collection'
      : /\/cart(\/|$)/.test(path) ? 'cart'
      : /\/search(\/|$)/.test(path) ? 'search'
      : /^\/?$/.test(path) ? 'index'
      : 'page';
    return { pageType: pageType, path: path };
  }

  function readSelection() {
    var select = document.querySelector(VARIANT_SELECTOR);
    var quantityInput = document.querySelector(QUANTITY_SELECTOR);
    if (!select && !quantityInput) return null;
    var selection = {};
    var state = {};
    try { state = chat.state() || {}; } catch (error) { state = {}; }
    var product = state.currentProduct;
    var variantId = select && select.value ? String(select.value) : product && product.selectedVariantId ? String(product.selectedVariantId) : '';
    if (variantId) {
      selection.variantId = variantId;
      // The name comes from the product data; an option's label may carry a price, so it is never read.
      var variant = ((product && product.variants) || []).filter(function (entry) { return String(entry.id) === variantId; })[0];
      if (variant && variant.title) selection.variantTitle = short(variant.title);
    }
    var quantity = quantityInput && quantityInput.value ? Number(quantityInput.value) : 1;
    selection.quantity = quantity > 0 && quantity < 1000 && Math.floor(quantity) === quantity ? quantity : 1;
    return selection;
  }

  function syncSelection() {
    var selection = readSelection();
    if (selection) currentPage.selection = selection;
    else delete currentPage.selection;
  }

  // Shopify's same-origin Ajax cart. Only what the shopper would call the line survives: no price, no properties.
  function refreshCart() {
    if (typeof window.fetch !== 'function') return Promise.resolve();
    var options = { headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    var timer = null;
    if (typeof window.AbortController === 'function') {
      var controller = new window.AbortController();
      options.signal = controller.signal;
      timer = window.setTimeout(function () { try { controller.abort(); } catch (error) { /* already settled */ } }, CART_TIMEOUT_MS);
    }
    var pending;
    try { pending = window.fetch('/cart.js', options); } catch (error) { pending = null; }
    if (!pending || !pending.then) { if (timer) window.clearTimeout(timer); return Promise.resolve(); }
    return pending.then(function (response) {
      return response && response.ok ? response.json() : null;
    }).then(function (cart) {
      if (timer) window.clearTimeout(timer);
      if (!cart || !Array.isArray(cart.items)) return;
      var itemCount = Number(cart.item_count);
      currentPage.cart = {
        itemCount: itemCount >= 0 ? itemCount : cart.items.length,
        items: cart.items.slice(0, MAX_CART_LINES).map(function (item) {
          var line = { handle: short(item.handle), title: short(item.product_title || item.title), quantity: Number(item.quantity) || 1 };
          if (item.variant_title) line.variantTitle = short(item.variant_title);
          return line;
        })
      };
      currentPage.cartItemCount = currentPage.cart.itemCount;
      // The cart usually arrives after the first "page ready" announcement (chips build their opening row before it
      // lands); saying the page is ready again, now that it carries the cart, lets chips pick up a cart-based reason
      // without waiting on the shopper's first turn.
      if (typeof window.CustomEvent === 'function') document.dispatchEvent(new window.CustomEvent('bazaar-page:ready', { detail: currentPage }));
    }).catch(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  function handsFreeStored() {
    try { return window.sessionStorage.getItem('bazaar:handsfree') === '1'; } catch (error) { return false; }
  }

  // True once a carried conversation (juniper-persist.js) has put something on screen: a card is live, or the
  // shopper's own words are already there. Checked lazily, right before showing the opening — persist.js restores
  // synchronously but loads after this file, so nothing has landed yet the moment this script itself runs.
  function conversationAlreadyShowing() {
    try {
      var state = chat.state();
      if (state && state.card && (state.card.status === 'live' || state.card.status === 'pending_owner')) return true;
    } catch (error) { /* fall through to the transcript */ }
    try {
      var messages = chat.elements && chat.elements.messages;
      return Boolean(messages && messages.querySelector && messages.querySelector('.ai-chat__message--user, .ai-chat__offer-card'));
    } catch (error) {
      return false;
    }
  }

  // The spoken opening for this page: asked of the server at most once per page load, and never once the shopper
  // has said something here — typed, spoken, or restored from a carried conversation. Whatever comes back is shown
  // as it is; nothing comes back, nothing is shown.
  function askForOpening() {
    if (greetingAsked || shopperHasSpoken || typeof window.fetch !== 'function') return;
    greetingAsked = true;
    refreshCart().then(function () {
      if (shopperHasSpoken) return null;
      var state = chat.state() || {};
      syncSelection();
      return window.fetch(chat.apiUrl('/api/greeting'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopperId: state.shopperId, product: state.currentProduct || null, page: currentPage })
      });
    }).then(function (response) {
      return response && response.ok ? response.json() : null;
    }).then(function (data) {
      if (shopperHasSpoken || !data || typeof data.greeting !== 'string' || !data.greeting.trim()) return;
      // A carried conversation already on screen (a live card, or the shopper's own restored words) is not a cold
      // open: a fresh "Browsing the whole shelf?" on top of it would talk over a negotiation already under way.
      if (conversationAlreadyShowing()) return;
      // say() (not addMessage) so the line is read aloud when spoken replies are on — a silent bubble in hands-free
      // would leave the shopper waiting on a voice that never speaks.
      if (typeof chat.say === 'function') chat.say(data.greeting.trim());
      else chat.addMessage(data.greeting.trim(), 'bot');
    }).catch(function () { /* no opening is a fine opening */ });
  }

  try {
    currentPage = readBlob() || pageFromLocation();
    if (!currentPage.path) currentPage.path = (window.location && window.location.pathname) || '/';
    syncSelection();

    chat.page = currentPage;
    chat.extendPayload(function (payload) {
      syncSelection();
      payload.page = currentPage;
    });

    chat.on('turn:start', function () { shopperHasSpoken = true; });
    chat.on('open', function () { refreshCart(); });

    // Hands-free hears the shopper well before a turn is committed (the recogniser waits out ~1.2s of quiet first);
    // treating any caption as "spoken" stops Juniper's page-aware opening from landing over the shopper mid-sentence.
    document.addEventListener('bazaar-voice:caption', function () { shopperHasSpoken = true; });

    // juniper-persist.js restores a carried conversation by replaying it through addMessage, which emits 'message'
    // for each line — a restored user line is the shopper having spoken, just on an earlier page.
    chat.on('message', function (detail) { if (detail && detail.type === 'user') shopperHasSpoken = true; });

    document.addEventListener('change', function (event) {
      var target = event.target;
      if (target && target.matches && (target.matches(VARIANT_SELECTOR) || target.matches(QUANTITY_SELECTOR))) syncSelection();
    });

    document.addEventListener('bazaar-voice:state', function (event) {
      var on = Boolean(event && event.detail && event.detail.on);
      if (on && !voiceOn) { if (greetingAsked || shopperHasSpoken) refreshCart(); else askForOpening(); }
      voiceOn = on;
    });

    if (typeof window.CustomEvent === 'function') document.dispatchEvent(new window.CustomEvent('bazaar-page:ready', { detail: currentPage }));
    if (handsFreeStored()) askForOpening();
  } catch (error) {
    if (window.console) window.console.error('[juniper-page]', error);
  }
})();
