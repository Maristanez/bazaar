(function () {
  var widget = document.querySelector('[data-ai-chat]');
  if (!widget) return;

  var toggle = widget.querySelector('[data-ai-chat-toggle]');
  var close = widget.querySelector('[data-ai-chat-close]');
  var panel = widget.querySelector('#ai-chat-panel');
  var messages = widget.querySelector('[data-ai-chat-messages]');
  var welcome = widget.querySelector('[data-ai-chat-welcome]');
  var mode = widget.querySelector('[data-ai-chat-mode]');
  var form = widget.querySelector('[data-ai-chat-form]');
  var input = widget.querySelector('[data-ai-chat-input]');
  var promptButtons = widget.querySelectorAll('[data-ai-chat-prompt]');
  var productSource = document.querySelector('[data-ai-chat-products]');
  var currentProductSource = document.querySelector('[data-ai-chat-current-product]');
  var products = readJsonArray(productSource);
  var currentProduct = readJsonObject(currentProductSource);
  var shopperId = getShopperId();
  var endpoint = normalizeEndpoint(widget.getAttribute('data-ai-chat-endpoint'));
  var sending = false;
  var activeProduct = currentProduct || null;
  var negotiationId = null;
  var negotiationProductKey = null;
  var lastSentProductKey = null;
  var quantitySelectionChanged = false;
  var currentOfferArticle = null;
  var offerArticles = new Map();
  var offerPollers = new WeakMap();
  var countdownTimers = new WeakMap();

  if (currentProduct) setNegotiationForProduct(selectedProduct());

  var scriptedResponses = buildScriptedResponses();

  if (welcome) welcome.textContent = getWelcomeMessage();
  if (mode && endpoint) mode.textContent = 'Live AI + offers';

  function normalizeEndpoint(value) {
    return String(value || '').trim().replace(/\/$/, '');
  }

  function readJsonArray(source) {
    if (!source) return [];
    try {
      var parsed = JSON.parse(source.textContent);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function readJsonObject(source) {
    if (!source) return null;
    try {
      var parsed = JSON.parse(source.textContent);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function getShopperId() {
    var params = new URLSearchParams(window.location.search);
    var shopper = params.get('shopper');
    if (shopper) return shopper;
    try {
      var existing = window.localStorage.getItem('bazaar:shopper-id');
      if (existing) return existing;
      var created = 'shopper-' + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem('bazaar:shopper-id', created);
      return created;
    } catch (error) {
      return 'shopper-session';
    }
  }

  function getWelcomeMessage() {
    if (currentProduct) {
      if (shopperId === 'demo') {
        return 'Eyeing ' + currentProduct.title + '? Welcome back — still a size 10? Ask about fit or try “Could you do $120?”';
      }
      return 'Eyeing ' + currentProduct.title + '? Name a price and give me a reason — bundles, budget, or race-day plans help.';
    }
    if (products.length) {
      return 'Hi, I can see ' + products.length + ' published products. Ask for prices, outfit ideas, sizing, or make an offer with a good reason.';
    }
    return 'Hi, I can help with products, sizing, and offers. Try one of the prompts below.';
  }

  function buildScriptedResponses() {
    return [
      {
        terms: ['weekend', 'outfit', 'recommend', 'style'],
        text: products.length
          ? 'For a clean weekend fit, I would start with ' + formatProductList(products.slice(0, 3)) + '.'
          : 'For a clean weekend fit, start with a tee, an overshirt, and a useful bag.'
      },
      {
        terms: ['price', 'prices', 'catalog', 'products', 'shop', 'how much'],
        text: summarizeCatalog(products) || 'I do not see published storefront products yet.'
      },
      {
        terms: ['shipping', 'returns', 'return', 'delivery'],
        text: 'Demo shipping is shown as 3–5 business days, with easy returns within 30 days.'
      },
      {
        terms: ['size', 'sizing', 'tee', 'fit'],
        text: 'Choose your usual size, or size up for a relaxed fit. On a product page I can use the selected product as context.'
      },
      {
        terms: ['offer', 'deal', 'discount', 'checkout', 'haggle', '$'],
        text: 'Send a specific number and a reason, like “Could you do $120? I’m buying socks too.” Stronger reasons get sharper offers.'
      }
    ];
  }

  function getContextPayload(text) {
    var contextProduct = getContextProduct();
    var payload = {
      message: text,
      shopperId: shopperId,
      pageUrl: window.location.href,
      product: contextProduct.product,
      productContextSource: contextProduct.source,
      products: products.slice(0, 8)
    };
    if (contextProduct.product && contextProduct.product.quantity !== undefined) payload.quantity = contextProduct.product.quantity;
    var key = productKey(contextProduct.product);
    if (negotiationId && negotiationProductKey === key) payload.negotiationId = negotiationId;
    if (lastSentProductKey && lastSentProductKey !== key) payload.variantSelectionChanged = true;
    if (quantitySelectionChanged) {
      payload.quantitySelectionChanged = true;
      quantitySelectionChanged = false;
    }
    lastSentProductKey = key;
    return payload;
  }

  function productKey(product) {
    if (!product) return 'none';
    return [product.productId || product.id || product.handle || product.title || '', product.selectedVariantId || 'default'].join(':');
  }

  function selectedProduct() {
    if (!currentProduct) return null;
    var selector = document.querySelector('select[name="id"], select[id^="ProductSelect-"]');
    var selectedVariantId = selector && selector.value ? String(selector.value) : currentProduct.selectedVariantId;
    var selectedVariant = (currentProduct.variants || []).find(function (variant) {
      return String(variant.id) === String(selectedVariantId);
    });
    var quantityInput = document.querySelector('input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]');
    var quantity = quantityInput && quantityInput.value ? Number(quantityInput.value) : 1;
    return Object.assign({}, currentProduct, {
      selectedVariantId: selectedVariantId,
      quantity: Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1,
      ...(selectedVariant ? { selectedVariantTitle: selectedVariant.title, price: selectedVariant.price } : {})
    });
  }

  function setNegotiationForProduct(product, quantityChanged) {
    var key = productKey(product);
    if (negotiationProductKey && (negotiationProductKey !== key || quantityChanged)) negotiationId = null;
    negotiationProductKey = key;
  }

  function askEndpoint(text) {
    return window.fetch(chatUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getContextPayload(text))
    }).then(function (response) {
      if (!response.ok) throw new Error('Chat endpoint returned ' + response.status);
      return response.json();
    });
  }

  function offersUrl(card) {
    var path = '/api/offers/' + encodeURIComponent(card.offerId);
    var query = '?shopperId=' + encodeURIComponent(shopperId) + '&negotiationId=' + encodeURIComponent(card.negotiationId || '');
    if (/\/api\/chat$/i.test(endpoint)) return endpoint.replace(/\/api\/chat$/i, path) + query;
    if (/\/api\/accept$/i.test(endpoint)) return endpoint.replace(/\/api\/accept$/i, path) + query;
    if (/\/api\/offers$/i.test(endpoint)) return endpoint.replace(/\/api\/offers$/i, path) + query;
    return endpoint + path + query;
  }

  function chatUrl() {
    if (/\/api\/chat$/i.test(endpoint)) return endpoint;
    return endpoint + '/api/chat';
  }

  function acceptUrl() {
    if (/\/api\/chat$/i.test(endpoint)) return endpoint.replace(/\/api\/chat$/i, '/api/accept');
    if (/\/api\/accept$/i.test(endpoint)) return endpoint;
    return endpoint + '/api/accept';
  }

  function acceptOffer(card, button) {
    button.__bazaarAccepting = true;
    button.disabled = true;
    button.textContent = 'Minting...';
    return window.fetch(acceptUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offerId: card.offerId,
        negotiationId: card.negotiationId,
        shopperId: shopperId
      })
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data && data.reply ? data.reply : 'Accept failed');
        return data;
      });
    }).then(function (data) {
      var settlement = data.settlement;
      button.textContent = 'Opening checkout';
      addMessage(data.reply || 'Deal — opening Shopify Checkout.', 'bot');
      window.location.href = settlement.checkoutUrl;
    }).catch(function (error) {
      button.__bazaarAccepting = false;
      button.disabled = false;
      button.textContent = 'Deal';
      addMessage(error.message || 'That offer could not be accepted. Try a fresh offer.', 'bot');
    });
  }

  function openChat() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () { input.focus(); }, 80);
  }

  function closeChat() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }

  function addMessage(text, type) {
    var message = document.createElement('p');
    message.className = 'ai-chat__message ai-chat__message--' + type;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function replaceMessage(message, text) {
    message.textContent = text;
    messages.scrollTop = messages.scrollHeight;
  }

  function addOfferCard(card, sourceProducts) {
    if (!card || !card.option) return;
    var negotiationKey = card.negotiationId || card.offerId;
    var priorArticle = offerArticles.get(negotiationKey);
    if (priorArticle && priorArticle.__bazaarCard && priorArticle.__bazaarCard.offerId !== card.offerId) {
      markSuperseded(priorArticle);
    }
    var article = document.createElement('article');
    var dealButton = document.createElement('button');
    var productLink = document.createElement('a');
    var firstItem = card.option.items && card.option.items[0] ? card.option.items[0] : {};
    var itemSummary = offerItemsMarkup(card.option.items);
    var expires = new Date(card.expiresAt);

    article.className = 'ai-chat__offer-card';
    article.__bazaarCard = card;
    article.innerHTML = [
      '<div class="ai-chat__offer-topline">',
      '<span data-offer-status-label>' + escapeHtml(statusLabel(card)) + '</span>',
      '<span data-offer-countdown="' + escapeHtml(card.expiresAt) + '">15:00</span>',
      '</div>',
      '<h3>' + escapeHtml(firstItem.title || 'Trailhead offer') + '</h3>',
      '<div class="ai-chat__offer-items" data-offer-items>' + itemSummary + '</div>',
      '<p class="ai-chat__offer-price" data-offer-price><span>' + money(card.option.listTotal) + '</span><strong>' + money(card.option.total) + '</strong></p>',
      '<p data-offer-line>' + escapeHtml(card.line || 'I can hold this for 15 minutes.') + '</p>',
      '<div class="ai-chat__badges" data-offer-badges>' + (card.badges || []).map(function (badge) { return '<span>' + escapeHtml(badge) + '</span>'; }).join('') + '</div>',
      '<div class="ai-chat__trail" data-offer-trail>' + (card.trail || []).map(function (step) { return '<span>' + escapeHtml(step.label) + ' ' + money(step.amount) + '</span>'; }).join('') + '</div>',
      '<div class="ai-chat__offer-actions" data-offer-actions></div>',
      '<p class="ai-chat__offer-footer">' + escapeHtml((card.disclosure && card.disclosure[1]) || 'Only this card is binding.') + '</p>'
    ].join('');

    var cardProduct = findProductByTitle(firstItem.title, sourceProducts) || activeProduct || currentProduct || getPrimaryProduct();
    setActiveProduct(cardProduct);
    productLink.href = cardProduct && cardProduct.url ? cardProduct.url : '/collections/all';
    productLink.textContent = 'View item';
    dealButton.type = 'button';
    dealButton.textContent = endpoint && card.status === 'live' ? 'Deal' : card.status === 'pending_owner' ? 'Waiting for owner' : card.status === 'live' ? 'Deal' : 'Offer unavailable';
    dealButton.disabled = !endpoint || card.status !== 'live';
    dealButton.addEventListener('click', function () {
      acceptOffer(card, dealButton);
    });

    article.querySelector('[data-offer-actions]').appendChild(productLink);
    article.querySelector('[data-offer-actions]').appendChild(dealButton);
    messages.appendChild(article);
    currentOfferArticle = article;
    offerArticles.set(negotiationKey, article);
    renderOfferState(article, card, dealButton);
    messages.scrollTop = messages.scrollHeight;
    if (endpoint && (card.status === 'live' || card.status === 'pending_owner')) startOfferPolling(card, article, dealButton);
  }

  function markSuperseded(article) {
    if (!article || !article.__bazaarCard) return;
    article.__bazaarCard = Object.assign({}, article.__bazaarCard, { status: 'superseded' });
    article.setAttribute('data-offer-status', 'superseded');
    article.classList.add('ai-chat__offer-card--superseded');
    var button = article.querySelector('[data-offer-actions] button');
    if (button) { button.disabled = true; button.textContent = 'Superseded'; }
    var poller = offerPollers.get(article);
    if (poller) { window.clearInterval(poller); offerPollers.delete(article); }
    var key = article.__bazaarCard.negotiationId || article.__bazaarCard.offerId;
    if (offerArticles.get(key) === article) offerArticles.delete(key);
  }

  function renderOfferState(article, card, button) {
    article.__bazaarCard = card;
    article.setAttribute('data-offer-status', card.status || 'live');
    var status = article.querySelector('[data-offer-status-label]');
    var title = article.querySelector('h3');
    var items = article.querySelector('[data-offer-items]');
    var price = article.querySelector('[data-offer-price]');
    var badges = article.querySelector('[data-offer-badges]');
    var trail = article.querySelector('[data-offer-trail]');
    var line = article.querySelector('[data-offer-line]');
    var firstItem = card.option && card.option.items && card.option.items[0] ? card.option.items[0] : {};
    if (status) status.textContent = statusLabel(card);
    if (title) title.textContent = firstItem.title || 'Trailhead offer';
    if (items) items.innerHTML = offerItemsMarkup(card.option && card.option.items);
    if (price) price.innerHTML = '<span>' + money(card.option && card.option.listTotal) + '</span><strong>' + money(card.option && card.option.total) + '</strong>';
    if (line) line.textContent = card.line || 'I can hold this for 15 minutes.';
    if (badges) badges.innerHTML = (card.badges || []).map(function (badge) { return '<span>' + escapeHtml(badge) + '</span>'; }).join('');
    if (trail) trail.innerHTML = (card.trail || []).map(function (step) { return '<span>' + escapeHtml(step.label) + ' ' + money(step.amount) + '</span>'; }).join('');
    var countdown = article.querySelector('[data-offer-countdown]');
    var pending = card.status === 'pending_owner';
    var expiry = pending && card.pendingUntil ? new Date(card.pendingUntil) : new Date(card.expiresAt);
    countdown.setAttribute('data-offer-countdown', expiry.toISOString());
    button.disabled = button.__bazaarAccepting || !endpoint || card.status !== 'live';
    button.textContent = button.__bazaarAccepting ? 'Minting...' : !endpoint ? 'Deal needs API' : pending ? 'Waiting for owner' : card.status === 'live' ? 'Deal' : card.status === 'superseded' ? 'Superseded' : 'Offer unavailable';
    startCountdown(countdown, expiry, button, pending);
  }

  function offerItemsMarkup(items) {
    return (items || []).map(function (item) {
      var size = item.size ? ' · size ' + escapeHtml(item.size) : '';
      var quantity = item.qty === undefined || item.qty === null ? 1 : item.qty;
      return '<span>' + escapeHtml(item.title || 'Item') + size + ' · qty ' + escapeHtml(String(quantity)) + '</span>';
    }).join('');
  }

  function startOfferPolling(card, article, button) {
    var poller = offerPollers.get(article);
    if (poller) window.clearInterval(poller);
    var poll = function () {
      window.fetch(offersUrl(card), { headers: { Accept: 'application/json' } }).then(function (response) {
        if (!response.ok) throw new Error('Offer status returned ' + response.status);
        return response.json();
      }).then(function (data) {
        if (!data || !data.card || article.__bazaarCard.status === 'superseded') return;
        var next = data.card;
        var line = article.querySelector('[data-offer-line]');
        if (line && next.line) line.textContent = next.line;
        renderOfferState(article, next, button);
        if (next.status !== 'live' && next.status !== 'pending_owner') {
          window.clearInterval(offerPollers.get(article));
          offerPollers.delete(article);
        }
      }).catch(function () { /* Keep the current card usable while the status endpoint is unavailable. */ });
    };
    poller = window.setInterval(poll, 2000);
    offerPollers.set(article, poller);
  }

  function addProductCard(product) {
    if (!product) return;
    setActiveProduct(product);
    var card = document.createElement('a');
    var meta = [product.type, product.available === false ? 'Sold out' : 'Open to offers'].filter(Boolean).join(' · ');
    card.className = 'ai-chat__product-card';
    card.href = product.url || '/collections/all';
    card.innerHTML = [
      product.image ? '<span class="ai-chat__product-image"><img src="' + escapeHtml(product.image) + '" alt=""></span>' : '<span class="ai-chat__product-image ai-chat__product-image--empty" aria-hidden="true">◎</span>',
      '<span class="ai-chat__product-copy">',
      '<strong>' + escapeHtml(product.title || 'Shop product') + '</strong>',
      '<small>' + escapeHtml(meta || 'View product') + '</small>',
      '</span>',
      '<span class="ai-chat__product-price">' + escapeHtml(product.price || money(product.listPrice)) + '</span>'
    ].join('');
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  function addPreviewOfferCard() {
    var product = getPrimaryProduct();
    var list = product && (product.listPrice || parseMoney(product.price)) ? normalizeCents(product.listPrice || parseMoney(product.price) * 100) : 10000;
    addOfferCard({
      offerId: 'preview',
      status: 'live',
      round: 1,
      maxRounds: 4,
      option: {
        listTotal: list,
        total: Math.ceil(list * 0.88 / 100) * 100,
        items: [{ title: product ? product.title : 'Selected item' }]
      },
      line: 'Preview only. The live server mints the real Shopify discount code.',
      badges: ['preview'],
      trail: [{ label: 'List', amount: list }, { label: 'Shop', amount: Math.ceil(list * 0.88 / 100) * 100 }],
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      disclosure: ['Preview', 'Only server-generated cards are binding.']
    });
  }

  function startCountdown(node, expires, button, pending) {
    var previous = countdownTimers.get(node);
    if (previous) window.clearTimeout(previous);
    function tick() {
      var remaining = Math.max(0, expires.getTime() - Date.now());
      var minutes = Math.floor(remaining / 60000);
      var seconds = Math.floor((remaining % 60000) / 1000);
      node.textContent = minutes + ':' + String(seconds).padStart(2, '0');
      if (!remaining) {
        countdownTimers.delete(node);
        button.disabled = true;
        button.textContent = pending ? 'Approval expired' : 'Expired';
        return;
      }
      countdownTimers.set(node, window.setTimeout(tick, 1000));
    }
    tick();
  }

  function statusLabel(card) {
    return 'Round ' + (card.round || 1) + ' of ' + (card.maxRounds || 4);
  }

  function setLoading(isLoading) {
    sending = isLoading;
    form.classList.toggle('is-loading', isLoading);
    input.disabled = isLoading;
    form.querySelector('button[type="submit"]').disabled = isLoading;
  }

  function getScriptedResponse(text) {
    var normalized = text.toLowerCase();
    var match = scriptedResponses.find(function (response) {
      return response.terms.some(function (term) { return normalized.indexOf(term) !== -1; });
    });
    return match ? match.text : summarizeCatalog(products) || 'I can help with product ideas, sizing, or a specific offer.';
  }

  function getPrimaryProduct() {
    return currentProduct || products[0] || null;
  }

  function getContextProduct() {
    if (activeProduct) {
      var product = activeProduct === currentProduct ? selectedProduct() : activeProduct;
      setNegotiationForProduct(product);
      return { product: product, source: activeProduct === currentProduct ? 'current' : 'active' };
    }
    if (currentProduct) {
      var current = selectedProduct();
      setNegotiationForProduct(current);
      return { product: current, source: 'current' };
    }
    return { product: null, source: 'none' };
  }

  function setActiveProduct(product) {
    if (product && typeof product === 'object') {
      var sameAsCurrent = currentProduct && (
        String(product.productId || '') === String(currentProduct.productId || '')
        || String(product.handle || '') === String(currentProduct.handle || '')
      );
      activeProduct = sameAsCurrent ? currentProduct : product;
      setNegotiationForProduct(activeProduct === currentProduct ? selectedProduct() : activeProduct);
    }
  }

  function getTurnProduct(text, sourceProducts, card) {
    var pool = Array.isArray(sourceProducts) && sourceProducts.length ? sourceProducts : products;
    if (card && card.option && card.option.items && card.option.items[0]) {
      var cardProduct = findProductByTitle(card.option.items[0].title, pool);
      if (cardProduct) return cardProduct;
    }
    var normalized = String(text || '').toLowerCase();
    var named = pool.find(function (product) {
      return product && (
        normalized.indexOf(String(product.title || '').toLowerCase()) !== -1 ||
        normalized.indexOf(String(product.handle || '').toLowerCase()) !== -1
      );
    });
    return named || activeProduct || currentProduct || pool[0] || null;
  }

  function findProductByTitle(title, sourceProducts) {
    if (!title) return null;
    var pool = Array.isArray(sourceProducts) && sourceProducts.length ? sourceProducts : products;
    return pool.find(function (product) {
      return String(product.title || '').toLowerCase() === String(title || '').toLowerCase();
    }) || null;
  }

  function summarizeCatalog(items) {
    if (!items.length) return '';
    return 'I can see these storefront prices: ' + formatProductList(items.slice(0, 4)) + '.';
  }

  function formatProductList(items) {
    return items.map(function (product) {
      return product.title + (product.price ? ' (' + product.price + ')' : '');
    }).join(', ');
  }

  function money(cents) {
    return '$' + Math.round(Number(cents || 0) / 100);
  }

  function normalizeCents(value) {
    return Number(value) < 1000 ? Math.round(Number(value) * 100) : Number(value);
  }

  function parseMoney(value) {
    var match = String(value || '').match(/(\d+(?:\.\d{1,2})?)/);
    return match ? Number(match[1]) : null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) openChat();
    else closeChat();
  });

  if (close) {
    close.addEventListener('click', function (event) {
      event.preventDefault();
      closeChat();
    });
  }

  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('[data-ai-chat-close]')) {
      event.preventDefault();
      closeChat();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) closeChat();
  });

  promptButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      input.value = button.getAttribute('data-ai-chat-prompt');
      form.requestSubmit();
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;
    var text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    if (endpoint) {
      setLoading(true);
      var thinking = addMessage('Thinking...', 'bot');
      askEndpoint(text).then(function (data) {
        var context = getContextProduct();
        replaceMessage(thinking, data.reply || data.text || data.message || 'Here is what I found.');
        var turnProduct = getTurnProduct(text, data.products, data.card);
        addProductCard(turnProduct);
        if (data && data.negotiationId) {
          negotiationId = data.negotiationId;
          negotiationProductKey = productKey(activeProduct === currentProduct ? selectedProduct() : turnProduct || context.product);
        }
        if (data.card) {
          negotiationId = data.card.negotiationId || negotiationId;
          negotiationProductKey = productKey(activeProduct === currentProduct ? selectedProduct() : turnProduct || context.product);
          addOfferCard(data.card, data.products);
        }
      }).catch(function () {
        replaceMessage(thinking, 'The shopkeeper is temporarily unavailable. Please try again.');
      }).finally(function () {
        setLoading(false);
        input.focus();
      });
      return;
    }

    window.setTimeout(function () {
      addMessage(getScriptedResponse(text), 'bot');
      addProductCard(getTurnProduct(text));
      if (/offer|deal|discount|checkout|haggle|\$/i.test(text)) addPreviewOfferCard();
    }, 350);
  });

  document.addEventListener('change', function (event) {
    if (event.target && event.target.matches && event.target.matches('select[name="id"], select[id^="ProductSelect-"]')) {
      setNegotiationForProduct(selectedProduct());
    }
    if (event.target && event.target.matches && event.target.matches('input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]')) {
      quantitySelectionChanged = true;
      setNegotiationForProduct(selectedProduct(), true);
    }
  });
})();
