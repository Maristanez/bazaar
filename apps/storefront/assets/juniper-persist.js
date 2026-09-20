// V2 the conversation survives navigation (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// Every page of this theme is a full load, so the chat is written down as it happens and read back on the next page —
// but only when the shopper got there from inside the chat or with hands-free on. A typed or pasted URL starts clean.
// Only what the shopper already saw is stored: their lines, Juniper's lines, the product links and the public card.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var CHAT_KEY = 'bazaar:chat';
  var CARRY_KEY = 'bazaar:carry';
  var HANDSFREE_KEY = 'bazaar:handsfree';
  var THINKING_TEXT = 'Doing the maths';
  var MAX_ENTRIES = 40;

  var elements = chat.elements || {};
  var saved = { v: 1, shopperId: shopperId(), open: false, entries: [], card: null };
  var restoring = false;
  var thinking = null;
  var leavingByLink = false;

  function shopperId() {
    try { return String(chat.state().shopperId || ''); } catch (error) { return ''; }
  }

  function read(key) {
    try { return window.sessionStorage.getItem(key); } catch (error) { return null; }
  }

  function write(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (error) { /* storage blocked: nothing carries */ }
  }

  function remove(key) {
    try { window.sessionStorage.removeItem(key); } catch (error) { /* storage blocked */ }
  }

  function save() {
    if (saved.entries.length > MAX_ENTRIES) saved.entries = saved.entries.slice(-MAX_ENTRIES);
    try { write(CHAT_KEY, JSON.stringify(saved)); } catch (error) { /* a card that will not serialise is not worth a broken chat */ }
  }

  function record(entry) {
    if (restoring) return;
    saved.entries.push(entry);
    save();
  }

  function currentShopperParam() {
    try { return new URLSearchParams(window.location.search).get('shopper'); } catch (error) { return null; }
  }

  // ---- The way in -------------------------------------------------------------------------------------------------

  function readSaved() {
    try {
      var parsed = JSON.parse(read(CHAT_KEY) || 'null');
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return null;
      // A transcript belongs to one shopper; under another identity it would show someone else's haggle.
      if (parsed.shopperId !== saved.shopperId) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function safeHref(href) {
    try {
      var url = new URL(href, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
    } catch (error) {
      return null;
    }
  }

  function addProductLink(entry) {
    var href = safeHref(entry.href);
    if (!href || !elements.messages) return;
    var link = document.createElement('a');
    link.className = 'ai-chat__product-card';
    link.href = href;
    link.__juniperRestored = true;
    var image = document.createElement('span');
    image.className = 'ai-chat__product-image';
    if (entry.image && safeHref(entry.image)) {
      var img = document.createElement('img');
      img.src = entry.image;
      img.alt = '';
      image.appendChild(img);
    } else {
      image.className += ' ai-chat__product-image--empty';
      image.setAttribute('aria-hidden', 'true');
    }
    var copy = document.createElement('span');
    copy.className = 'ai-chat__product-copy';
    var title = document.createElement('strong');
    title.textContent = entry.title || 'Shop product';
    var meta = document.createElement('small');
    meta.textContent = entry.meta || 'View product';
    copy.appendChild(title);
    copy.appendChild(meta);
    var price = document.createElement('span');
    price.className = 'ai-chat__product-price';
    price.textContent = entry.price || '';
    link.appendChild(image);
    link.appendChild(copy);
    link.appendChild(price);
    elements.messages.appendChild(link);
  }

  // The stored copy stands in only while the server cannot be reached, and only while it could still be live.
  function storedCardIfStillGood(card) {
    if (!card || !card.option) return null;
    if (card.status && card.status !== 'live' && card.status !== 'pending_owner') return null;
    var until = new Date(card.status === 'pending_owner' && card.pendingUntil ? card.pendingUntil : card.expiresAt).getTime();
    if (!(until > Date.now())) return null;
    return card;
  }

  function showCard(card, negotiationId) {
    if (!card) { saved.card = null; save(); return; }
    try {
      chat.addOfferCard(card);
      // addOfferCard just resolved and set the chat's active product from the card's own items, so naming no
      // product here lets restoreNegotiation pick that same product up rather than guessing again.
      if (negotiationId && typeof chat.restoreNegotiation === 'function') chat.restoreNegotiation(negotiationId);
    } catch (error) { /* the transcript is still there */ }
  }

  function restoreCard(kept) {
    if (!kept || !kept.offerId) return;
    var base = chat.apiUrl ? chat.apiUrl('/api/offers/' + encodeURIComponent(kept.offerId)) : '';
    if (!base || typeof window.fetch !== 'function') { showCard(storedCardIfStillGood(kept.card), kept.negotiationId); return; }
    var url = base + '?shopperId=' + encodeURIComponent(saved.shopperId) + '&negotiationId=' + encodeURIComponent(kept.negotiationId || '');
    var asked;
    try { asked = window.fetch(url, { headers: { Accept: 'application/json' } }); } catch (error) { asked = null; }
    if (!asked || !asked.then) { showCard(storedCardIfStillGood(kept.card), kept.negotiationId); return; }
    asked.then(function (response) {
      // The server answered: its word on the offer is final, including "no such offer".
      if (!response.ok) return { card: null };
      return response.json().then(function (data) { return { card: data && data.card && data.card.option ? data.card : null }; });
    }, function () {
      return { card: storedCardIfStillGood(kept.card) };
    }).then(function (found) {
      // A newer offer made while we were asking wins.
      var live = chat.state().card;
      if (live && live !== kept.card) return;
      showCard(found.card, kept.negotiationId);
    }).catch(function () {});
  }

  // The panel's own cold-open line ("Eyeing X? Name a price...") is baked into the markup ahead of any script.
  // A restored transcript already opens with real history, so that invitation would sit above it as if Juniper
  // had forgotten the conversation she is about to repeat back.
  function hideColdOpenLine() {
    try {
      var node = elements.messages && elements.messages.querySelector('[data-ai-chat-welcome]');
      if (node) node.hidden = true;
    } catch (error) { /* the restored transcript still reads fine with the line left in */ }
  }

  function restore(previous) {
    if ((previous.entries && previous.entries.length) || previous.card) hideColdOpenLine();
    restoring = true;
    try {
      previous.entries.forEach(function (entry) {
        if (!entry) return;
        if ((entry.t === 'user' || entry.t === 'bot') && typeof entry.text === 'string') chat.addMessage(entry.text, entry.t);
        else if (entry.t === 'product') addProductLink(entry);
      });
    } catch (error) { /* a half-restored transcript still beats a broken chat */ }
    restoring = false;
    saved.entries = previous.entries.slice(-MAX_ENTRIES);
    saved.card = previous.card || null;
    save();
    if (previous.open && !chat.isOpen()) { try { chat.open(); } catch (error) { /* stays closed */ } }
    restoreCard(saved.card);
  }

  // ---- Writing the conversation down ------------------------------------------------------------------------------

  chat.on('message', function (detail) {
    if (restoring || !detail) return;
    if (detail.type === 'bot' && detail.text === THINKING_TEXT) { thinking = detail.element || null; return; }
    if (detail.type === 'user' || detail.type === 'bot') record({ t: detail.type, text: String(detail.text || '') });
  });

  chat.on('reply', function (detail) {
    thinking = null;
    if (detail && detail.text) record({ t: 'bot', text: String(detail.text) });
  });

  chat.on('turn:error', function () {
    var text = thinking && thinking.textContent;
    thinking = null;
    if (text && text !== THINKING_TEXT) record({ t: 'bot', text: String(text) });
  });

  chat.on('card', function (detail) {
    var card = detail && detail.card;
    if (!card || !card.offerId) return;
    saved.card = { offerId: card.offerId, negotiationId: card.negotiationId || '', card: card };
    save();
  });

  chat.on('open', function () { saved.open = true; save(); });
  chat.on('close', function () { saved.open = false; save(); });

  // Product links are appended without a seam event, so they are read off the transcript as they land.
  if (elements.messages && typeof window.MutationObserver === 'function') {
    try {
      new window.MutationObserver(function (changes) {
        changes.forEach(function (change) {
          Array.prototype.forEach.call(change.addedNodes || [], function (node) {
            if (!node || node.nodeType !== 1 || node.__juniperRestored || !node.classList || !node.classList.contains('ai-chat__product-card')) return;
            var pick = function (selector) { var found = node.querySelector(selector); return found ? found.textContent : ''; };
            var img = node.querySelector('img');
            record({ t: 'product', href: node.getAttribute('href') || '', title: pick('strong'), meta: pick('small'), price: pick('.ai-chat__product-price'), image: img ? img.getAttribute('src') || '' : '' });
          });
        });
      }).observe(elements.messages, { childList: true });
    } catch (error) { /* product links will not carry; the rest does */ }
  }

  // ---- The way out ------------------------------------------------------------------------------------------------

  function staysInThisTab(event, link) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    var target = (link.getAttribute('target') || '').toLowerCase();
    return !target || target === '_self';
  }

  if (elements.widget) {
    elements.widget.addEventListener('click', function (event) {
      try {
        var link = event.target && event.target.closest && event.target.closest('a[href]');
        if (!link || !elements.widget.contains(link)) return;
        var shopper = currentShopperParam();
        if (shopper) {
          var url = new URL(link.getAttribute('href'), window.location.href);
          if (url.origin === window.location.origin && !url.searchParams.get('shopper')) {
            url.searchParams.set('shopper', shopper);
            link.setAttribute('href', url.pathname + url.search + url.hash);
          }
        }
        if (!staysInThisTab(event, link)) return;
        leavingByLink = true;
        save();
        write(CARRY_KEY, '1');
      } catch (error) { /* the link still works; the next page just starts clean */ }
    });
  }

  function onLeave() {
    if (leavingByLink || read(HANDSFREE_KEY) === '1') { save(); write(CARRY_KEY, '1'); }
    else remove(CARRY_KEY);
  }

  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);
  // Back from the bfcache: this page is live again, and the link that left it has been spent.
  window.addEventListener('pageshow', function (event) {
    if (event && event.persisted) { leavingByLink = false; remove(CARRY_KEY); }
  });

  // ---- Start ------------------------------------------------------------------------------------------------------

  try {
    var carried = read(CARRY_KEY) === '1';
    remove(CARRY_KEY);
    var previous = carried ? readSaved() : null;
    saved.open = chat.isOpen();
    if (previous) restore(previous);
    else remove(CHAT_KEY);
  } catch (error) {
    restoring = false;
  }
})();
