(function () {
  var widget = document.querySelector('[data-ai-chat]');

  if (!widget) {
    return;
  }

  var toggle = widget.querySelector('[data-ai-chat-toggle]');
  var close = widget.querySelector('[data-ai-chat-close]');
  var panel = widget.querySelector('#ai-chat-panel');
  var messages = widget.querySelector('[data-ai-chat-messages]');
  var welcome = widget.querySelector('[data-ai-chat-welcome]');
  var form = widget.querySelector('[data-ai-chat-form]');
  var input = widget.querySelector('[data-ai-chat-input]');
  var promptButtons = widget.querySelectorAll('[data-ai-chat-prompt]');
  var productSource = document.querySelector('[data-ai-chat-products]');
  var currentProductSource = document.querySelector('[data-ai-chat-current-product]');
  var products = readProducts(productSource);
  var currentProduct = readCurrentProduct(currentProductSource);
  var shopperId = getShopperId();

  var responses = function () {
    var outfit = findOutfitProducts(products);
    var priceList = summarizeCatalog(products);

    return [
    {
      terms: ['weekend', 'outfit', 'recommend', 'style'],
      text: outfit.length
        ? 'For a clean weekend fit, I would start with ' + formatProductList(outfit) + '. Those are pulled from the public storefront catalog I can see right now.'
        : 'For a clean weekend fit, start with a heavyweight tee, add an overshirt, and finish with a tote. Once products are published, I can name the exact items and prices.'
    },
    {
      terms: ['price', 'prices', 'catalog', 'products', 'shop', 'how much'],
      text: priceList || 'I do not see published storefront products yet. Publish products to the Online Store channel and I can list their visible prices here.'
    },
    {
      terms: ['shipping', 'returns', 'return', 'delivery'],
      text: 'Demo shipping is shown as 3-5 business days, with easy returns within 30 days. When we connect the real store policies, I can answer from live Shopify data.'
    },
    {
      terms: ['size', 'sizing', 'tee', 'fit'],
      text: sizingAnswer(products)
    },
    {
      terms: ['offer', 'deal', 'discount', 'checkout', 'haggle'],
      text: 'The real haggle needs the server app: it reads private cost data, builds safe offers, mints a single-use discount, and opens Shopify Checkout. This demo only uses public storefront product data.'
    },
    {
      terms: ['hoodie', 'jacket', 'overshirt', 'cold'],
      text: outerwearAnswer(products)
    }
  ];
  }();

  if (welcome) {
    welcome.textContent = getWelcomeMessage();
  }

  function readProducts(source) {
    if (!source) {
      return [];
    }

    try {
      var parsed = JSON.parse(source.textContent);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(function (product) {
        return product && product.title && product.price;
      });
    } catch (error) {
      return [];
    }
  }

  function readCurrentProduct(source) {
    if (!source) {
      return null;
    }

    try {
      var parsed = JSON.parse(source.textContent);
      return parsed && parsed.title ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function getShopperId() {
    var params = new URLSearchParams(window.location.search);
    var shopper = params.get('shopper');

    if (shopper) {
      return shopper;
    }

    try {
      var existing = window.localStorage.getItem('bazaar:shopper-id');

      if (existing) {
        return existing;
      }

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
        return 'Eyeing ' + currentProduct.title + '? Welcome back — still a size 10? Ask me about fit, price, or making an offer.';
      }

      return 'Eyeing ' + currentProduct.title + '? I can help with fit, visible price, and a preview of how offers will work.';
    }

    if (products.length) {
      return 'Hi, I can see ' + products.length + ' published storefront ' + pluralize(products.length, 'product') + ' right now. Ask for prices, outfit ideas, sizing, or checkout.';
    }

    return 'Hi, I can help you find outfits, sizes, and shipping info. Try one of the prompts below.';
  }

  function pluralize(count, singular) {
    return count === 1 ? singular : singular + 's';
  }

  function findProductByWords(items, words) {
    return items.find(function (product) {
      var searchable = (product.title + ' ' + product.type).toLowerCase();

      return words.some(function (word) {
        return searchable.indexOf(word) !== -1;
      });
    });
  }

  function findOutfitProducts(items) {
    var preferred = [
      findProductByWords(items, ['tee', 'shirt']),
      findProductByWords(items, ['overshirt', 'jacket', 'hoodie']),
      findProductByWords(items, ['tote', 'bag'])
    ].filter(Boolean);

    if (preferred.length) {
      return preferred.filter(function (product, index) {
        return preferred.indexOf(product) === index;
      });
    }

    return items.slice(0, 3);
  }

  function formatProduct(product) {
    return product.title + ' (' + product.price + ')';
  }

  function formatProductList(items) {
    if (items.length === 1) {
      return formatProduct(items[0]);
    }

    if (items.length === 2) {
      return formatProduct(items[0]) + ' and ' + formatProduct(items[1]);
    }

    return items.slice(0, -1).map(formatProduct).join(', ') + ', and ' + formatProduct(items[items.length - 1]);
  }

  function summarizeCatalog(items) {
    if (!items.length) {
      return '';
    }

    return 'I can see these public storefront prices: ' + formatProductList(items.slice(0, 4)) + '.';
  }

  function getPrimaryProduct() {
    if (currentProduct) {
      return currentProduct;
    }

    return products[0] || null;
  }

  function sizingAnswer(items) {
    var tee = findProductByWords(items, ['tee', 'shirt']);

    if (tee) {
      return tee.title + ' is visible in the storefront at ' + tee.price + '. Demo sizing guidance: choose your usual size, or size up for an oversized fit.';
    }

    return 'Demo sizing guidance: choose your usual size, or size up for an oversized streetwear fit. Product-specific sizing needs the real sizing guide in the server app.';
  }

  function outerwearAnswer(items) {
    var outerwear = findProductByWords(items, ['overshirt', 'jacket', 'hoodie', 'fleece']);

    if (outerwear) {
      return 'For colder weather, I would start with ' + formatProduct(outerwear) + '. That answer comes from the public storefront catalog.';
    }

    return 'I do not see a published outerwear item yet. A hoodie, fleece, or light jacket would make the next catalog feel much more complete.';
  }

  function addOfferCard(product) {
    var card = document.createElement('article');
    var title = product ? product.title : 'A published product';
    var price = product ? product.price : 'list price';
    var url = product && product.url ? product.url : '/collections/all';

    card.className = 'ai-chat__offer-card';
    card.innerHTML = [
      '<div class="ai-chat__offer-topline">',
      '<span>Preview card</span>',
      '<span>Round 1 of 4</span>',
      '</div>',
      '<h3>' + escapeHtml(title) + '</h3>',
      '<p class="ai-chat__offer-price"><span>' + escapeHtml(price) + '</span><strong>Real offer pending server app</strong></p>',
      '<p>This is the shape of the binding card. The real version will use private cost data, an engine-priced menu, a 15-minute expiry, and a Shopify discount code.</p>',
      '<div class="ai-chat__offer-actions">',
      '<a href="' + escapeHtml(url) + '">View product</a>',
      '<button type="button" disabled>Deal needs API</button>',
      '</div>',
      '<p class="ai-chat__offer-footer">Only the future server-generated card is binding. Totals are before tax and shipping.</p>'
    ].join('');

    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function openChat() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () {
      input.focus();
    }, 80);
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
  }

  function getResponse(text) {
    var normalized = text.toLowerCase();
    var match = responses.find(function (response) {
      return response.terms.some(function (term) {
        return normalized.indexOf(term) !== -1;
      });
    });

    if (match) {
      return match.text;
    }

    return summarizeCatalog(products) || 'I am a scripted demo today, but I can still help with product ideas. Ask about outfits, sizing, shipping, or outerwear.';
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) {
      openChat();
    } else {
      closeChat();
    }
  });

  close.addEventListener('click', closeChat);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) {
      closeChat();
    }
  });

  promptButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      input.value = button.getAttribute('data-ai-chat-prompt');
      form.requestSubmit();
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var text = input.value.trim();

    if (!text) {
      return;
    }

    addMessage(text, 'user');
    input.value = '';

    window.setTimeout(function () {
      addMessage(getResponse(text), 'bot');

      if (/offer|deal|discount|checkout|haggle/i.test(text)) {
        addOfferCard(getPrimaryProduct());
      }
    }, 420);
  });
})();
