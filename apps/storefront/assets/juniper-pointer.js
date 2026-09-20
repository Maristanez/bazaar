// V7 Juniper points at the page (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// When a reply or an offer card names a product that is shown on this page, the page scrolls to that product's card
// and rings it for a moment. A product that is not on this page is left to the chat's own "View item" link.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var RING = 'juniper-pointer__ring';
  var LEAVING = 'juniper-pointer__ring--leaving';
  var HOLD_MS = 2200;
  var LEAVE_MS = 200;

  var ringed = null;
  var leaveTimer = null;
  var clearTimer = null;
  var waitingForClose = false;

  // A card added while a turn is not in flight is V2 restoring a saved offer after navigation, not a fresh
  // reply worth pointing at. turnLive is true from the moment a turn starts until just after it settles (a
  // microtask past its 'reply'/'turn:error', so the 'card' the same turn adds is still counted as live).
  var turnLive = false;

  // The shopper's own scroll, so a page they are mid-scrolling is never fought (`ring()` still marks the
  // card, it just skips the scroll). ownScrollUntil marks a window where scroll events are our own doing
  // (the smooth scrollIntoView we just started), so they never count as the shopper scrolling.
  var lastShopperScrollAt = 0;
  var ownScrollUntil = 0;

  function safely(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (error) { return false; }
    };
  }

  function media(query) {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); } catch (error) { return false; }
  }

  function onWindowScroll() {
    if (Date.now() < ownScrollUntil) return;
    lastShopperScrollAt = Date.now();
  }

  try { window.addEventListener('scroll', onWindowScroll, { passive: true }); } catch (error) {
    try { window.addEventListener('scroll', onWindowScroll); } catch (ignored) { /* no scroll tracking: never suppressed */ }
  }

  function recentlyScrolledByShopper() {
    return lastShopperScrollAt > 0 && Date.now() - lastShopperScrollAt < 600;
  }

  function deferTurnLiveClear() {
    try {
      window.Promise.resolve().then(function () { turnLive = false; });
    } catch (error) {
      window.setTimeout(function () { turnLive = false; }, 0);
    }
  }

  function state() {
    try { return chat.state() || {}; } catch (error) { return {}; }
  }

  function lower(value) {
    return String(value == null ? '' : value).toLowerCase();
  }

  function isWordChar(ch) {
    return !!ch && /[a-z0-9]/.test(ch);
  }

  // Every whole-word place `needle` sits in `text`. Plain indexOf, so a title may hold any character.
  function findWhole(text, needle) {
    var found = [];
    if (!needle) return found;
    var from = 0;
    while (from <= text.length - needle.length) {
      var at = text.indexOf(needle, from);
      if (at === -1) break;
      if (!isWordChar(text.charAt(at - 1)) && !isWordChar(text.charAt(at + needle.length))) found.push(at);
      from = at + 1;
    }
    return found;
  }

  function pool(extra) {
    var seen = {};
    var list = [];
    [state().products, extra].forEach(function (source) {
      if (!Array.isArray(source)) return;
      source.forEach(function (product) {
        var handle = product && lower(product.handle);
        if (!handle || seen[handle]) return;
        seen[handle] = true;
        list.push(product);
      });
    });
    return list;
  }

  // Handles the text names, in the order it names them. Longer names claim their span first, so
  // "Trail Runner 2" is never also read as "Trail Runner".
  function handlesInText(text, products) {
    var haystack = lower(text);
    if (!haystack) return [];
    var names = [];
    products.forEach(function (product) {
      var title = lower(product.title).replace(/\s+/g, ' ').trim();
      if (title) names.push({ name: title, handle: lower(product.handle) });
      names.push({ name: lower(product.handle), handle: lower(product.handle) });
    });
    names.sort(function (a, b) { return b.name.length - a.name.length; });
    var taken = [];
    var hits = [];
    names.forEach(function (entry) {
      findWhole(haystack, entry.name).forEach(function (at) {
        var end = at + entry.name.length;
        var overlaps = taken.some(function (span) { return at < span[1] && end > span[0]; });
        if (overlaps) return;
        taken.push([at, end]);
        hits.push({ at: at, handle: entry.handle });
      });
    });
    hits.sort(function (a, b) { return a.at - b.at; });
    return hits.map(function (hit) { return hit.handle; });
  }

  function handlesOnCard(card, products) {
    var items = card && card.option && Array.isArray(card.option.items) ? card.option.items : [];
    var handles = [];
    items.forEach(function (item) {
      var title = lower(item && item.title);
      if (!title) return;
      products.forEach(function (product) {
        if (lower(product.title) === title) handles.push(lower(product.handle));
      });
    });
    return handles;
  }

  function handleOfLink(link) {
    var href = link.getAttribute('href') || '';
    var at = href.indexOf('/products/');
    if (at === -1) return '';
    var rest = href.slice(at + '/products/'.length).split(/[?#/]/)[0];
    try { rest = decodeURIComponent(rest); } catch (error) { /* a malformed escape stays as written */ }
    return lower(rest);
  }

  // The product's card on this page: the snippet's <article class="product-card">, never a link inside the chat.
  function findCard(handle) {
    var widget = chat.elements && chat.elements.widget;
    var links = document.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (widget && widget.contains(link)) continue;
      if (handleOfLink(link) !== handle) continue;
      if (link.closest('[hidden], [aria-hidden="true"], template')) continue;
      return link.closest('.product-card') || link.closest('article, li') || link;
    }
    return null;
  }

  function clearTimers() {
    if (leaveTimer) window.clearTimeout(leaveTimer);
    if (clearTimer) window.clearTimeout(clearTimer);
    leaveTimer = null;
    clearTimer = null;
  }

  function unring() {
    clearTimers();
    waitingForClose = false;
    if (ringed) {
      ringed.classList.remove(RING);
      ringed.classList.remove(LEAVING);
    }
    ringed = null;
  }

  function startHold() {
    clearTimers();
    var target = ringed;
    leaveTimer = window.setTimeout(function () {
      if (ringed === target && target) target.classList.add(LEAVING);
    }, HOLD_MS - LEAVE_MS);
    clearTimer = window.setTimeout(function () {
      if (ringed === target) unring();
    }, HOLD_MS);
  }

  function scrollTo(element) {
    if (typeof element.scrollIntoView !== 'function') return;
    var behavior = media('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth';
    // A smooth scroll fires its own 'scroll' events for a while; none of them are the shopper scrolling.
    ownScrollUntil = Date.now() + 1000;
    try {
      element.scrollIntoView({ behavior: behavior, block: 'center' });
    } catch (error) {
      try { element.scrollIntoView(); } catch (ignored) { /* the ring alone still points */ }
    }
  }

  function chatIsOpen() {
    try { return !!chat.isOpen(); } catch (error) { return false; }
  }

  function panelBox() {
    var panel = chat.elements && chat.elements.panel;
    if (!panel || typeof panel.getBoundingClientRect !== 'function') return null;
    try {
      var rect = panel.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? rect : null;
    } catch (error) {
      return null;
    }
  }

  // True when the open chat panel sits where this card would show: on a phone the panel covers the whole
  // screen; on a desktop the panel is fixed to a bottom corner, so a card in that column stays behind it no
  // matter how far the page scrolls vertically. Scrolling under it is wasted and the ring would be gone by
  // the time the shopper looks, so the ring waits there and the scroll happens once the chat closes. Where
  // real layout cannot be measured, the old phone-width guess still applies.
  function hiddenByPanel(element) {
    if (!chatIsOpen()) return false;
    var panel = panelBox();
    if (!panel || typeof element.getBoundingClientRect !== 'function') return media('(max-width: 480px)');
    var rect;
    try { rect = element.getBoundingClientRect(); } catch (error) { return media('(max-width: 480px)'); }
    if (!rect || (!rect.width && !rect.height)) return media('(max-width: 480px)');
    return rect.right > panel.left && rect.left < panel.right;
  }

  function midSentence() {
    var input = chat.elements && chat.elements.input;
    return !!input && document.activeElement === input && String(input.value || '').trim() !== '';
  }

  function ring(element) {
    if (ringed === element && !waitingForClose) { startHold(); return; }
    unring();
    ringed = element;
    element.classList.add(RING);
    if (hiddenByPanel(element)) { waitingForClose = true; return; }
    if (!midSentence() && !recentlyScrolledByShopper()) scrollTo(element);
    startHold();
  }

  function point(handle) {
    var wanted = lower(handle).trim();
    if (!wanted) return false;
    var current = state().currentProduct;
    if (current && lower(current.handle) === wanted) return false;
    var element = findCard(wanted);
    if (!element) return false;
    ring(element);
    return true;
  }

  // A reply that names several products (a "muddy trails" answer naming two pairs) points at the first one
  // named that actually has a card on this page, and stops there — one ring, one scroll, never a jump from
  // one card to another for a single reply.
  function pointAtFirst(handles) {
    for (var i = 0; i < handles.length; i += 1) {
      if (point(handles[i])) return true;
    }
    return false;
  }

  chat.pointer = { point: safely(point) };

  if (typeof chat.on !== 'function') return;

  chat.on('turn:start', safely(function () { turnLive = true; }));
  chat.on('turn:error', safely(function () { turnLive = false; }));
  chat.on('turn:local', safely(function () { turnLive = false; }));

  chat.on('reply', safely(function (detail) {
    detail = detail || {};
    var data = detail.data || {};
    var products = pool(data.products);
    var pointed = pointAtFirst(handlesOnCard(data.card, products).concat(handlesInText(detail.text, products)));
    deferTurnLiveClear();
    return pointed;
  }));

  // A card that lands outside a live turn is V2 replaying a saved offer after navigation (restoring must
  // never scroll the page or ring anything), not a fresh reply worth pointing at.
  chat.on('card', safely(function (detail) {
    if (!turnLive) return false;
    detail = detail || {};
    return pointAtFirst(handlesOnCard(detail.card, pool(detail.products)));
  }));

  chat.on('close', safely(function () {
    if (!waitingForClose || !ringed) return false;
    waitingForClose = false;
    scrollTo(ringed);
    startHold();
    return true;
  }));
})();
