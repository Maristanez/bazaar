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

  var scriptedResponses = buildScriptedResponses();

  if (welcome) welcome.textContent = getWelcomeMessage();
  if (mode && endpoint) mode.textContent = 'Live AI + offers';

  function normalizeEndpoint(value) {
    return String(value || '').trim().replace(/\/$/, '').replace(/\/api\/chat$/, '');
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
      return 'Eyeing ' + currentProduct.title + '? Ask about fit, or name a price and I will build a real offer card.';
    }
    if (products.length) {
      return 'Hi, I can see ' + products.length + ' published products. Ask for prices, outfit ideas, sizing, or make an offer.';
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
        text: 'Send a specific number like “Could you do $120?” and I will show the offer card shape. The live server creates the binding version.'
      }
    ];
  }

  function getContextPayload(text) {
    return {
      message: text,
      shopperId: shopperId,
      pageUrl: window.location.href,
      product: currentProduct || getPrimaryProduct(),
      products: products.slice(0, 8)
    };
  }

  function askEndpoint(text) {
    return window.fetch(endpoint + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getContextPayload(text))
    }).then(function (response) {
      if (!response.ok) throw new Error('Chat endpoint returned ' + response.status);
      return response.json();
    });
  }

  function acceptOffer(card, button) {
    button.disabled = true;
    button.textContent = 'Minting...';
    return window.fetch(endpoint + '/api/accept', {
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

  function addOfferCard(card) {
    if (!card || !card.option) return;
    var article = document.createElement('article');
    var dealButton = document.createElement('button');
    var productLink = document.createElement('a');
    var firstItem = card.option.items && card.option.items[0] ? card.option.items[0] : {};
    var expires = new Date(card.expiresAt);

    article.className = 'ai-chat__offer-card';
    article.innerHTML = [
      '<div class="ai-chat__offer-topline">',
      '<span>' + escapeHtml(statusLabel(card)) + '</span>',
      '<span data-offer-countdown="' + escapeHtml(card.expiresAt) + '">15:00</span>',
      '</div>',
      '<h3>' + escapeHtml(firstItem.title || 'Bazaar offer') + '</h3>',
      '<p class="ai-chat__offer-price"><span>' + money(card.option.listTotal) + '</span><strong>' + money(card.option.total) + '</strong></p>',
      '<p>' + escapeHtml(card.line || 'I can hold this for 15 minutes.') + '</p>',
      '<div class="ai-chat__badges">' + (card.badges || []).map(function (badge) { return '<span>' + escapeHtml(badge) + '</span>'; }).join('') + '</div>',
      '<div class="ai-chat__trail">' + (card.trail || []).map(function (step) { return '<span>' + escapeHtml(step.label) + ' ' + money(step.amount) + '</span>'; }).join('') + '</div>',
      '<div class="ai-chat__offer-actions" data-offer-actions></div>',
      '<p class="ai-chat__offer-footer">' + escapeHtml((card.disclosure && card.disclosure[1]) || 'Only this card is binding.') + '</p>'
    ].join('');

    productLink.href = currentProduct && currentProduct.url ? currentProduct.url : '/collections/all';
    productLink.textContent = 'View item';
    dealButton.type = 'button';
    dealButton.textContent = endpoint ? 'Deal' : 'Deal needs API';
    dealButton.disabled = !endpoint;
    dealButton.addEventListener('click', function () {
      acceptOffer(card, dealButton);
    });

    article.querySelector('[data-offer-actions]').appendChild(productLink);
    article.querySelector('[data-offer-actions]').appendChild(dealButton);
    messages.appendChild(article);
    startCountdown(article.querySelector('[data-offer-countdown]'), expires, dealButton);
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

  function startCountdown(node, expires, button) {
    function tick() {
      var remaining = Math.max(0, expires.getTime() - Date.now());
      var minutes = Math.floor(remaining / 60000);
      var seconds = Math.floor((remaining % 60000) / 1000);
      node.textContent = minutes + ':' + String(seconds).padStart(2, '0');
      if (!remaining) {
        button.disabled = true;
        button.textContent = 'Expired';
        return;
      }
      window.setTimeout(tick, 1000);
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

  close.addEventListener('click', closeChat);

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
        replaceMessage(thinking, data.reply || data.text || data.message || 'Here is what I found.');
        if (data.card) addOfferCard(data.card);
      }).catch(function () {
        replaceMessage(thinking, getScriptedResponse(text) + ' I could not reach the live endpoint, so I used the storefront fallback.');
        if (/offer|deal|discount|checkout|haggle|\$/i.test(text)) addPreviewOfferCard();
      }).finally(function () {
        setLoading(false);
        input.focus();
      });
      return;
    }

    window.setTimeout(function () {
      addMessage(getScriptedResponse(text), 'bot');
      if (/offer|deal|discount|checkout|haggle|\$/i.test(text)) addPreviewOfferCard();
    }, 350);
  });
})();
