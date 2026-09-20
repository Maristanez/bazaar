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

  function safely(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (error) { return false; }
    };
  }

  function media(query) {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); } catch (error) { return false; }
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
    try {
      element.scrollIntoView({ behavior: behavior, block: 'center' });
    } catch (error) {
      try { element.scrollIntoView(); } catch (ignored) { /* the ring alone still points */ }
    }
  }

  function chatIsOpen() {
    try { return !!chat.isOpen(); } catch (error) { return false; }
  }

  // On a phone the open chat covers the page; scrolling under it is wasted and the ring would be gone by the time
  // the shopper looks. So the ring waits there and the scroll happens when the chat closes.
  function coveredByChat() {
    return chatIsOpen() && media('(max-width: 480px)');
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
    if (coveredByChat()) { waitingForClose = true; return; }
    if (!midSentence()) scrollTo(element);
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

  function pointAtFirst(handles) {
    for (var i = 0; i < handles.length; i += 1) {
      if (point(handles[i])) return true;
    }
    return false;
  }

  chat.pointer = { point: safely(point) };

  if (typeof chat.on !== 'function') return;

  chat.on('reply', safely(function (detail) {
    detail = detail || {};
    var data = detail.data || {};
    var products = pool(data.products);
    return pointAtFirst(handlesOnCard(data.card, products).concat(handlesInText(detail.text, products)));
  }));

  chat.on('card', safely(function (detail) {
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
