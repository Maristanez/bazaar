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
  var products = readProducts(productSource);

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

  if (welcome && products.length) {
    welcome.textContent = 'Hi, I can see ' + products.length + ' published storefront ' + pluralize(products.length, 'product') + ' right now. Ask for prices, outfit ideas, sizing, or checkout.';
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
    }, 420);
  });
})();
