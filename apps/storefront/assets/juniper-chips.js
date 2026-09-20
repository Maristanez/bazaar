// V6 suggestion chips that change (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The chips teach the haggle in the shopper's own voice: a reason to give, or one of the three trades to ask for.
// No chip ever carries a figure — every dollar amount a shopper sees comes from the card (invariant 1).
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  // Anything that could read as a price: a dollar sign, a percent sign, two digits in a row, a decimal, money words.
  var FIGURE = /\$|%|\d{2,}|\d[.,]\d|\b(?:dollars?|bucks|percent|cents?)\b/i;
  var STAGES = ['opening', 'offer', 'held', 'final', 'pending_owner', 'expired', 'deal'];
  var LABEL_MAX = 32;
  var TEXT_MAX = 140;
  var NUMBER_WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };
  var PLURAL_GOODS = /\b(?:shoes?|runners?|socks?|gaiters?|shorts|tights|poles|gloves|sandals|boots?|laces|insoles)\b/i;
  var STOP_WORDS = { a: 1, an: 1, the: 1, i: 1, im: 1, ive: 1, id: 1, is: 1, it: 1, its: 1, to: 1, you: 1, me: 1, my: 1, that: 1, this: 1, of: 1, on: 1, 'do': 1, can: 1, um: 1, uh: 1, so: 1, and: 1 };
  // A reason the card already credits is not suggested again. Both the shopper-facing badge and the engine-era label.
  var BADGE_GROUPS = [
    [/budget/, 'budget'], [/bigger cart|quantity/, 'quantity'], [/adding gear|add-on|bundle/, 'bundle'], [/coming back|repeat/, 'repeat'],
    [/comparison/, 'compare'], [/real plans|real use/, 'use'], [/buying today|ready to buy/, 'now']
  ];

  // Which kinds of chip fill the row, slot by slot. A slot with nothing to offer is skipped.
  var PLANS = {
    product: ['reason', 'trade', 'reason|ask'],
    discover: ['discover', 'discover', 'discover'],
    cart: ['cart', 'reason', 'ask|discover'],
    offer: ['trade', 'trade', 'reason|ask', 'addon'],
    held: ['hold', 'after', 'after', 'addon'],
    'final': ['final', 'final'],
    expired: ['restart', 'trade'],
    deal: ['after', 'after'],
    pending_owner: []
  };

  function safe(value) {
    return typeof value === 'string' && value.length > 0 && !FIGURE.test(value);
  }

  function cleanTitle(value) {
    var title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return title && title.length <= 40 && safe(title) ? title : '';
  }

  function isOneOf(stage, list) {
    return list.indexOf(stage) !== -1;
  }

  function normalize(context) {
    var raw = context && typeof context === 'object' ? context : {};
    var page = raw.page && typeof raw.page === 'object' ? raw.page : null;
    var product = raw.product && typeof raw.product === 'object' ? raw.product : null;
    var card = raw.card && typeof raw.card === 'object' ? raw.card : null;
    var cart = page && page.cart && typeof page.cart === 'object' ? page.cart : null;
    var pageType = page && typeof page.pageType === 'string' ? page.pageType : product ? 'product' : 'other';
    var quantity = product ? Number(product.quantity) : 1;
    var used = {};
    var list = raw.used;
    if (list && typeof list.forEach === 'function') list.forEach(function (id) { used[String(id)] = true; });
    else if (list && typeof list === 'object') Object.keys(list).forEach(function (id) { if (list[id]) used[id] = true; });
    var option = card && card.option && typeof card.option === 'object' ? card.option : {};
    var items = Array.isArray(option.items) ? option.items : [];
    var goods = product ? String(product.type || '') + ' ' + String(product.title || '') : items[0] && typeof items[0] === 'object' ? String(items[0].title || '') : '';
    return {
      stage: isOneOf(raw.stage, STAGES) ? raw.stage : 'opening',
      pageType: pageType,
      product: product,
      quantity: quantity > 0 && quantity === Math.floor(quantity) ? quantity : 1,
      hasSizes: Boolean(product && Array.isArray(product.variants) && product.variants.length > 1),
      plural: !goods.trim() || PLURAL_GOODS.test(goods),
      cartCount: cartCount(cart),
      cartTitle: cartTitle(cart, product, raw.products),
      collectionTitle: cleanTitle(page && page.collection && typeof page.collection === 'object' ? page.collection.title : ''),
      card: card,
      optionKind: typeof option.kind === 'string' ? option.kind : '',
      hasAddOn: option.kind === 'bundle' || items.some(function (item) { return Boolean(item && item.thrownIn); }),
      creditedGroups: creditedGroups(card),
      used: used,
      turn: Math.max(0, Math.floor(Number(raw.turn) || 0)),
      voiceOn: Boolean(raw.voiceOn),
      suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : []
    };
  }

  function cartCount(cart) {
    if (!cart) return 0;
    var count = Number(cart.itemCount !== undefined ? cart.itemCount : cart.item_count);
    if (count > 0) return count;
    return Array.isArray(cart.items) ? cart.items.length : Array.isArray(cart.handles) ? cart.handles.length : 0;
  }

  // The first thing in the cart that is not the product on this page, by its real title.
  function cartTitle(cart, product, products) {
    if (!cart) return '';
    var titles = [];
    (Array.isArray(cart.items) ? cart.items : []).forEach(function (item) {
      if (item && typeof item === 'object') titles.push(item.product_title || item.productTitle || item.title);
    });
    (Array.isArray(cart.titles) ? cart.titles : []).forEach(function (title) { titles.push(title); });
    (Array.isArray(cart.handles) ? cart.handles : []).forEach(function (handle) {
      (Array.isArray(products) ? products : []).forEach(function (entry) {
        if (entry && entry.handle === handle) titles.push(entry.title);
      });
    });
    var own = product ? String(product.title || '').toLowerCase() : '';
    for (var index = 0; index < titles.length; index += 1) {
      var title = cleanTitle(titles[index]);
      if (title && title.toLowerCase() !== own) return title;
    }
    return '';
  }

  function creditedGroups(card) {
    var groups = {};
    (card && Array.isArray(card.badges) ? card.badges : []).forEach(function (badge) {
      var label = String(badge || '').toLowerCase();
      BADGE_GROUPS.forEach(function (entry) { if (entry[0].test(label)) groups[entry[1]] = true; });
    });
    return groups;
  }

  function opening(ctx) { return ctx.stage === 'opening'; }
  function onProduct(ctx) { return opening(ctx) && ctx.pageType === 'product' && Boolean(ctx.product); }
  function onCart(ctx) { return opening(ctx) && ctx.pageType === 'cart'; }
  function browsing(ctx) { return opening(ctx) && !onProduct(ctx); }
  function haggling(ctx) { return ctx.stage === 'offer'; }
  function agreed(ctx) { return isOneOf(ctx.stage, ['held', 'deal']); }
  function these(ctx) { return ctx.plural ? 'these' : 'this'; }

  // The pool. kind = which slot it can fill; group = the move it teaches (a used group never comes back);
  // pin = always first in its slot, because it is about what the shopper has actually done on the page.
  var POOL = [
    // A reason tied to the selection or the cart.
    { id: 'qty-buying', kind: 'reason', group: 'quantity', priority: 100, pin: true,
      when: function (ctx) { return (onProduct(ctx) || haggling(ctx)) && ctx.quantity >= 2; },
      label: function (ctx) { return 'I\'m buying ' + (NUMBER_WORDS[ctx.quantity] || 'a few'); },
      text: function (ctx) { return 'I\'m buying ' + (NUMBER_WORDS[ctx.quantity] || 'a few') + ' of ' + these(ctx) + '. What can you do on ' + (ctx.quantity === 2 ? 'both' : 'the lot') + '?'; } },
    { id: 'cart-item', kind: 'reason', group: 'cart', priority: 95, pin: true,
      when: function (ctx) { return (onProduct(ctx) || haggling(ctx)) && Boolean(ctx.cartTitle); },
      label: function (ctx) { var label = 'I\'ve got ' + ctx.cartTitle + ' in my cart'; return label.length <= LABEL_MAX ? label : 'I\'ve got gear in my cart'; },
      text: function (ctx) { return 'I\'ve already got the ' + ctx.cartTitle + ' in my cart. Does that help with the price on ' + these(ctx) + '?'; } },
    { id: 'cart-some', kind: 'reason', group: 'cart', priority: 94, pin: true,
      when: function (ctx) { return (onProduct(ctx) || haggling(ctx)) && !ctx.cartTitle && ctx.cartCount > 0; },
      label: 'I\'ve got gear in my cart',
      text: function (ctx) { return 'I\'ve already got something in my cart. Does that help with the price on ' + these(ctx) + '?'; } },

    // Reasons the shopper may give. Each is their claim to make, so each is phrased as one.
    { id: 'use-race', kind: 'reason', group: 'use', priority: 80, when: function (ctx) { return onProduct(ctx) || onCart(ctx); },
      label: 'I\'ve got a race coming up',
      text: function (ctx) { return 'I\'ve got a race coming up and I want ' + these(ctx) + ' for it. Can you help me on the price?'; } },
    { id: 'budget', kind: 'reason', group: 'budget', priority: 75, when: function (ctx) { return onProduct(ctx) || onCart(ctx); },
      label: 'I\'m on a tight budget',
      text: function (ctx) { return 'I\'m on a tight budget. What\'s the best you can do on ' + these(ctx) + '?'; } },
    { id: 'qty-ask', kind: 'reason', group: 'quantity', priority: 70, when: function (ctx) { return (onProduct(ctx) || haggling(ctx)) && ctx.quantity === 1; },
      label: 'What if I buy two?',
      text: function (ctx) { return 'What if I buy two of ' + these(ctx) + '? Does the price move?'; } },
    { id: 'now-open', kind: 'reason', group: 'now', priority: 60, when: function (ctx) { return onProduct(ctx) || onCart(ctx); },
      label: 'I\'m ready to buy today',
      text: 'I\'m ready to buy today if we can agree on a price.' },
    { id: 'repeat', kind: 'reason', group: 'repeat', priority: 50, when: function (ctx) { return onProduct(ctx) || onCart(ctx) || haggling(ctx); },
      label: 'I\'ve shopped here before',
      text: 'I\'ve shopped here before. Does coming back count for anything?' },
    { id: 'compare', kind: 'reason', group: 'compare', priority: 45, when: function (ctx) { return onProduct(ctx) || haggling(ctx); },
      label: function (ctx) { return 'I\'ve seen ' + these(ctx) + ' for less'; },
      text: function (ctx) { return 'I\'ve seen ' + these(ctx) + ' for less somewhere else. Can you get closer to that?'; } },
    { id: 'budget-still', kind: 'reason', group: 'budget', priority: 78, when: haggling,
      label: 'It\'s still over my budget',
      text: 'That\'s still over my budget. Is there any way to get closer?' },
    { id: 'use-still', kind: 'reason', group: 'use', priority: 72, when: haggling,
      label: 'It\'s for a race',
      text: function (ctx) { return (ctx.plural ? 'These are' : 'This is') + ' for a race I\'ve got coming up. Does that help?'; } },

    // The three trades: throw something in, a held price for buying now, something cheaper that fits.
    { id: 'bundle-open', kind: 'trade', group: 'bundle', priority: 85, when: onProduct,
      label: function (ctx) { return 'What goes well with ' + these(ctx) + '?'; },
      text: function (ctx) { return 'What goes well with ' + these(ctx) + '? I\'d add something if it helps the price.'; } },
    { id: 'else-open', kind: 'trade', group: 'cheaper', priority: 55, when: onProduct,
      label: 'Anything like this for less?',
      text: function (ctx) { return 'Is there anything like ' + these(ctx) + ' for less? Last season\'s would suit me fine.'; } },
    { id: 'bundle', kind: 'trade', group: 'bundle', priority: 90, when: function (ctx) { return haggling(ctx) && !ctx.hasAddOn; },
      label: 'What if I add something?',
      text: 'What if I add something to my order? Would that move the price?' },
    { id: 'now', kind: 'trade', group: 'now', priority: 85, when: haggling,
      label: 'I can buy right now',
      text: 'I can buy right now if you can hold a better price for me.' },
    { id: 'else', kind: 'trade', group: 'cheaper', priority: 80, when: function (ctx) { return isOneOf(ctx.stage, ['offer', 'expired']) && ctx.optionKind !== 'else'; },
      label: 'Anything cheaper that fits?',
      text: 'Is there anything cheaper that would fit me just as well?' },
    { id: 'else-back', kind: 'trade', group: 'back', priority: 80, when: function (ctx) { return haggling(ctx) && ctx.optionKind === 'else'; },
      label: 'Back to the one I picked',
      text: 'Can we go back to the one I first asked about?' },
    // Kept exactly as the chat had it: only when the card carries an add-on.
    { id: 'skip-add-on', kind: 'addon', group: 'skip-add-on', priority: 100, pin: true, when: function (ctx) { return isOneOf(ctx.stage, ['offer', 'held']) && ctx.hasAddOn; },
      label: 'Skip the add-on',
      text: 'Could you do it without the add-on? Just the main item.' },

    // Questions. They cost no round.
    { id: 'move', kind: 'ask', group: 'move', priority: 88, when: haggling,
      label: 'What would move it?',
      text: 'What would move the price? Tell me what helps.' },
    { id: 'hold-size', kind: 'hold', group: 'hold', priority: 90, when: function (ctx) { return ctx.stage === 'held'; },
      label: 'Hold it while I check my size',
      text: 'Can you hold that while I check my size?' },
    { id: 'best', kind: 'ask', group: 'best', priority: 40, when: haggling,
      label: 'Is that your best?',
      text: function (ctx) { return 'Is that your best on ' + these(ctx) + '?'; } },
    { id: 'fit', kind: 'ask', group: 'fit', priority: 42, when: function (ctx) { return (onProduct(ctx) || haggling(ctx)) && ctx.hasSizes; },
      label: function (ctx) { return ctx.plural ? 'Do these run true to size?' : 'Does this run true to size?'; },
      text: function (ctx) { return (ctx.plural ? 'Do these run' : 'Does this run') + ' true to size? I don\'t want to guess.'; } },
    { id: 'how', kind: 'ask', group: 'how', priority: 41, when: function (ctx) { return opening(ctx) && ctx.turn < 2; },
      label: 'How does making an offer work?',
      text: 'How does making an offer work here?' },

    // The last round: fewer, and honest about it.
    { id: 'best-final', kind: 'final', group: 'best', priority: 90, when: function (ctx) { return ctx.stage === 'final'; },
      label: 'Is that your best?',
      text: 'Is that really your best?' },
    { id: 'hold-final', kind: 'final', group: 'hold', priority: 85, when: function (ctx) { return ctx.stage === 'final'; },
      label: 'Hold it while I check my size',
      text: 'Can you hold that while I check my size?' },
    { id: 'else-final', kind: 'final', group: 'cheaper', priority: 70, when: function (ctx) { return ctx.stage === 'final' && ctx.optionKind !== 'else'; },
      label: 'Anything cheaper that fits?',
      text: 'Is there anything cheaper that would fit me just as well?' },
    { id: 'returns-final', kind: 'final', group: 'returns', priority: 60, when: function (ctx) { return ctx.stage === 'final'; },
      label: 'What if the fit is wrong?',
      text: 'What\'s the return policy if the fit is wrong?' },

    { id: 'restart', kind: 'restart', group: 'restart', priority: 100, when: function (ctx) { return ctx.stage === 'expired'; },
      label: 'Can we start again?',
      text: 'That offer ran out. Can we start again?' },

    { id: 'shipping', kind: 'after', group: 'shipping', priority: 80, when: agreed,
      label: 'How long does shipping take?',
      text: 'How long does shipping take?' },
    { id: 'returns', kind: 'after', group: 'returns', priority: 70, when: agreed,
      label: 'What if the fit is wrong?',
      text: 'What\'s the return policy if the fit is wrong?' },

    // Not on a product page: help them find the thing worth haggling over.
    { id: 'whole-cart', kind: 'cart', group: 'whole-cart', priority: 100, pin: true, when: onCart,
      label: 'A deal on my whole cart?',
      text: 'Can you do something on my whole cart?' },
    { id: 'muddy', kind: 'discover', group: 'muddy', priority: 90, when: browsing,
      label: 'What\'s good for muddy trails?',
      text: 'What\'s good for muddy trails?' },
    { id: 'last-season', kind: 'discover', group: 'cheaper', priority: 85, when: browsing,
      label: 'Anything from last season?',
      text: 'Do you have anything from last season? Older stock suits me if the price is better.' },
    { id: 'pick-size', kind: 'discover', group: 'fit', priority: 80, when: browsing,
      label: 'Help me pick a size',
      text: 'Can you help me pick a size?' },
    { id: 'collection-pick', kind: 'discover', group: 'collection-pick', priority: 78,
      when: function (ctx) { return browsing(ctx) && Boolean(ctx.collectionTitle) && ('Your pick from ' + ctx.collectionTitle + '?').length <= LABEL_MAX; },
      label: function (ctx) { return 'Your pick from ' + ctx.collectionTitle + '?'; },
      text: function (ctx) { return 'What\'s your pick from ' + ctx.collectionTitle + ', and why?'; } },
    { id: 'open-to-offers', kind: 'discover', group: 'open-to-offers', priority: 75, when: browsing,
      label: 'What can I make an offer on?',
      text: 'Which of these can I make an offer on?' },
    { id: 'race-kit', kind: 'discover', group: 'use', priority: 70, when: browsing,
      label: 'I need a kit for a race',
      text: 'I\'m putting together a kit for a race. Where would you start?' }
  ];

  function resolve(value, ctx) {
    return typeof value === 'function' ? value(ctx) : value;
  }

  // Every candidate that fits the context, has not been used and carries no figure, strongest first.
  function candidatesFor(ctx) {
    var usedGroups = {};
    POOL.forEach(function (entry) { if (ctx.used[entry.id]) usedGroups[entry.group] = true; });
    var out = [];
    POOL.forEach(function (entry, order) {
      var fits = false;
      try { fits = Boolean(entry.when(ctx)); } catch (error) { fits = false; }
      if (!fits || ctx.used[entry.id] || usedGroups[entry.group] || ctx.creditedGroups[entry.group]) return;
      var label = resolve(entry.label, ctx);
      var text = resolve(entry.text, ctx);
      if (!safe(label) || !safe(text) || label.length > LABEL_MAX || text.length > TEXT_MAX) return;
      out.push({ id: entry.id, kind: entry.kind, group: entry.group, priority: entry.priority, pin: Boolean(entry.pin), label: label, text: text, order: order });
    });
    return out.sort(function (a, b) { return b.priority - a.priority || a.order - b.order; });
  }

  function suggestionId(text) {
    return 's:' + tokens(text).join('-');
  }

  // Lines the server wrote for this reply. They pass the same filter, and stricter: no digit at all.
  function suggestionsFor(ctx) {
    var seen = {};
    var out = [];
    ctx.suggestions.forEach(function (entry) {
      var text = typeof entry === 'string' ? entry.replace(/\s+/g, ' ').trim() : '';
      var id = suggestionId(text);
      if (!safe(text) || /\d/.test(text) || text.length > LABEL_MAX || seen[id] || ctx.used[id]) return;
      seen[id] = true;
      out.push({ id: id, kind: 'server', group: id, priority: 200, pin: true, label: text, text: text });
    });
    return out.slice(0, 3);
  }

  function planKey(ctx) {
    if (ctx.stage !== 'opening') return ctx.stage;
    return onProduct(ctx) ? 'product' : onCart(ctx) ? 'cart' : 'discover';
  }

  function pick(ctx) {
    var plan = PLANS[planKey(ctx)] || [];
    if (!plan.length) return [];
    var pool = candidatesFor(ctx);
    var picked = [];
    var groups = {};
    function take(entry, slot) { entry.slot = slot; picked.push(entry); groups[entry.group] = true; }
    function open(entry) { return picked.indexOf(entry) === -1 && !groups[entry.group]; }

    plan.forEach(function (slot) {
      var kinds = slot.split('|');
      var list = pool.filter(function (entry) { return kinds.indexOf(entry.kind) !== -1 && open(entry); });
      if (!list.length) return;
      var pinned = list.filter(function (entry) { return entry.pin; });
      // The turn count walks each slot through its alternatives, so two renders in a row differ when they can.
      take(pinned.length ? pinned[0] : list[ctx.turn % list.length], plan.indexOf(slot));
    });

    var size = ctx.stage === 'final' || ctx.stage === 'deal' || ctx.stage === 'expired' ? 2 : 3;
    pool.forEach(function (entry) { if (picked.length < size && entry.kind !== 'addon' && open(entry)) take(entry, plan.length); });
    // A chip that stays keeps its place: the row is ordered by slot, then strength, never by the order of picking.
    picked.sort(function (a, b) { return a.slot - b.slot || Number(b.pin) - Number(a.pin) || b.priority - a.priority || a.order - b.order; });

    var server = ctx.stage === 'deal' ? [] : suggestionsFor(ctx);
    if (server.length) {
      var said = {};
      server.forEach(function (entry) { said[entry.label.toLowerCase()] = true; });
      var rest = picked.filter(function (entry) { return !said[entry.label.toLowerCase()]; });
      var pins = rest.filter(function (entry) { return entry.pin; });
      var others = rest.filter(function (entry) { return !entry.pin; });
      picked = server.concat(pins).slice(0, 4);
      others.forEach(function (entry) { if (picked.length < size) picked.push(entry); });
    }
    return picked.slice(0, 4);
  }

  // Pure: the same context always gives the same chips. Returns [label, sentText] pairs, each carrying its id.
  function buildChips(context) {
    var ctx = normalize(context);
    return pick(ctx).filter(function (entry) { return safe(entry.label) && safe(entry.text); }).map(function (entry) {
      var chip = [entry.label, entry.text];
      chip.id = entry.id;
      return chip;
    });
  }

  function tokens(text) {
    return String(text || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(function (word) { return word && !STOP_WORDS[word]; });
  }

  // Which chip is being said: the one whose label (or sent text) is at least half covered by the words so far.
  function matchSpoken(text, chips) {
    var heard = {};
    tokens(text).forEach(function (word) { heard[word] = true; });
    var best = -1;
    var bestScore = 0;
    var bestHits = 0;
    (Array.isArray(chips) ? chips : []).forEach(function (chip, index) {
      [chip && chip[0], chip && chip[1]].forEach(function (phrase) {
        var words = tokens(phrase);
        if (!words.length) return;
        var hits = words.filter(function (word) { return heard[word]; }).length;
        var score = hits / words.length;
        if (hits < Math.min(2, words.length) || score < 0.5) return;
        if (score > bestScore || (score === bestScore && hits > bestHits)) { best = index; bestScore = score; bestHits = hits; }
      });
    });
    return best;
  }

  chat.chips = {
    build: buildChips,
    candidates: function (context) { return candidatesFor(normalize(context)); },
    match: matchSpoken
  };

  // ── Wiring: everything below touches the page. A failure here leaves the chat exactly as it was. ──
  var elements = chat.elements || {};
  var widget = elements.widget;
  var box = elements.chips;
  if (!widget || !box || typeof chat.setChipProvider !== 'function' || typeof chat.renderChips !== 'function') return;

  var QUANTITY = 'input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]';
  var VARIANT = 'select[name="id"], select[id^="ProductSelect-"]';
  var used = {};
  var turn = 0;
  var voiceOn = false;
  var page = chat.page || null;
  var suggestions = [];
  var current = [];
  var signature = null;
  var landing = false;
  var ghosts = null;
  var ghostTimer = null;
  var tapped = null;
  var refocus = null;
  var spoken = '';
  var queued = null;

  function stillMotion() {
    try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (error) { return false; }
  }

  // The product with the variant and quantity the shopper has picked, read from the same controls the chat reads.
  function selection(state) {
    var product = state.currentProduct;
    if (!product) return null;
    var picker = document.querySelector(VARIANT);
    var quantityInput = document.querySelector(QUANTITY);
    var variantId = picker && picker.value ? String(picker.value) : product.selectedVariantId;
    var variant = null;
    (Array.isArray(product.variants) ? product.variants : []).forEach(function (entry) { if (entry && String(entry.id) === String(variantId)) variant = entry; });
    var copy = {};
    Object.keys(product).forEach(function (key) { copy[key] = product[key]; });
    copy.selectedVariantId = variantId;
    copy.selectedVariantTitle = variant ? variant.title : product.selectedVariantTitle;
    copy.quantity = quantityInput && quantityInput.value ? Number(quantityInput.value) : 1;
    return copy;
  }

  function stageOf(card, hint) {
    if (!card || !card.option || card.status === 'superseded') return 'opening';
    if (card.status === 'pending_owner' || hint === 'pending_owner') return 'pending_owner';
    if (card.status === 'accepted' || card.status === 'paused') return 'deal';
    var expires = Date.parse(card.expiresAt);
    if (card.status === 'expired' || (expires && expires <= Date.now())) return 'expired';
    if ((card.round || 1) >= (card.maxRounds || 4)) return 'final';
    // The shopper's own number was taken: the price is agreed and held, so nothing pushes it further.
    var held = (Array.isArray(card.badges) ? card.badges : []).some(function (badge) { return /^held\b/i.test(String(badge || '')); });
    return held ? 'held' : 'offer';
  }

  function gather(hint, card) {
    var state = chat.state ? chat.state() : {};
    var offer = card || state.card || null;
    return { stage: stageOf(offer, hint), page: chat.page || page, product: selection(state), products: state.products, card: offer, used: used, turn: turn, voiceOn: voiceOn, suggestions: suggestions };
  }

  function clearGhosts() {
    if (ghostTimer) { window.clearTimeout(ghostTimer); ghostTimer = null; }
    if (ghosts && ghosts.parentNode) ghosts.parentNode.removeChild(ghosts);
    ghosts = null;
  }

  // The outgoing chips, copied as plain text where they stood, so they can leave while the new ones land.
  function snapshot() {
    clearGhosts();
    if (stillMotion()) return;
    var buttons = box.querySelectorAll('button[data-ai-chat-prompt]');
    if (!buttons.length) return;
    // The layer sits over the foot, not inside the scrolling row, so the tapped chip can rise past the row's edge.
    var host = box.parentNode && box.parentNode !== widget ? box.parentNode : box;
    var frame = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
    var row = box.getBoundingClientRect ? box.getBoundingClientRect() : { left: 0, right: 0 };
    ghosts = document.createElement('span');
    ghosts.className = 'juniper-chips__ghosts';
    ghosts.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(buttons, function (button) {
      var rect = button.getBoundingClientRect ? button.getBoundingClientRect() : { left: 0, top: 0, right: 0, width: 0, height: 0 };
      if (row.right > row.left && (rect.right <= row.left || rect.left >= row.right)) return;
      var ghost = document.createElement('span');
      var sent = tapped !== null && button.getAttribute('data-ai-chat-prompt') === tapped;
      ghost.className = 'juniper-chips__ghost' + (sent ? ' juniper-chips__ghost--sent' : '');
      ghost.textContent = button.textContent;
      ghost.style.left = (rect.left - frame.left - (host.clientLeft || 0)) + 'px';
      ghost.style.top = (rect.top - frame.top - (host.clientTop || 0)) + 'px';
      if (rect.width) ghost.style.width = rect.width + 'px';
      if (rect.height) ghost.style.height = rect.height + 'px';
      ghosts.appendChild(ghost);
    });
    if (host.classList) host.classList.add('juniper-chips__host');
    host.appendChild(ghosts);
    var layer = ghosts;
    ghostTimer = window.setTimeout(function () { if (ghosts === layer) clearGhosts(); }, 320);
  }

  function provide(args) {
    var fallback = args && Array.isArray(args.labels) ? args.labels : [];
    try {
      var chips = buildChips(gather(args && args.stage, args && args.card));
      var next = chips.map(function (chip) { return chip[1]; }).join('\n');
      landing = next !== signature;
      if (landing && signature !== null) snapshot();
      var active = document.activeElement;
      refocus = active && box.contains(active) && active.getAttribute ? active.getAttribute('data-ai-chat-prompt') : null;
      signature = next;
      current = chips;
      tapped = null;
      return chips;
    } catch (error) {
      landing = false;
      return fallback;
    }
  }

  function markSpoken() {
    var index = spoken ? matchSpoken(spoken, current) : -1;
    Array.prototype.forEach.call(box.querySelectorAll('button[data-ai-chat-prompt]'), function (button, position) {
      if (button.classList) button.classList.toggle('is-spoken', position === index);
    });
  }

  function decorate() {
    box.classList.add('juniper-chips__row');
    var buttons = box.querySelectorAll('button[data-ai-chat-prompt]');
    Array.prototype.forEach.call(buttons, function (button, index) {
      button.classList.add('juniper-chips__chip');
      button.style.setProperty('--juniper-chip-i', String(index));
      if (landing) button.classList.add('juniper-chips__chip--landing');
      if (refocus !== null && button.getAttribute('data-ai-chat-prompt') === refocus && button.focus) {
        try { button.focus({ preventScroll: true }); } catch (error) { button.focus(); }
      }
    });
    refocus = null;
    if (landing) {
      try { box.scrollLeft = 0; } catch (error) { /* a row that cannot scroll stays where it is */ }
    }
    landing = false;
    markSpoken();
  }

  function render() {
    if (queued) { window.clearTimeout(queued); queued = null; }
    var state = chat.state ? chat.state() : {};
    var stage = stageOf(state.card || null);
    // Nothing changed: leave the row alone, so chips that are still landing finish landing.
    var next = buildChips(gather(stage)).map(function (chip) { return chip[1]; }).join('\n');
    if (next === signature && box.querySelectorAll('button[data-ai-chat-prompt]').length === current.length) return;
    chat.renderChips(current, stage);
  }

  // A reply and its card arrive in the same tick; one render after both is enough.
  function renderSoon() {
    if (queued) return;
    queued = window.setTimeout(function () { queued = null; guarded(render)(); }, 0);
  }

  function guarded(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (error) { if (window.console) window.console.error('[juniper-chips]', error); }
    };
  }

  function setVoice(on) {
    voiceOn = Boolean(on);
    if (voiceOn) {
      box.setAttribute('data-juniper-lead', 'Try saying');
      box.setAttribute('aria-label', 'Things you can say');
    } else {
      box.removeAttribute('data-juniper-lead');
      box.setAttribute('aria-label', 'Suggested chat prompts');
      spoken = '';
    }
  }

  // What the shopper just said uses up the chip that says it, whether they tapped it, typed it or spoke it.
  function noteTurn(text) {
    var said = String(text || '').trim().toLowerCase();
    var hit = null;
    current.forEach(function (chip) {
      if (chip[0].toLowerCase() === said || chip[1].toLowerCase() === said) hit = chip;
    });
    if (!hit) {
      var index = matchSpoken(said, current);
      if (index !== -1) hit = current[index];
    }
    if (hit && hit.id) used[hit.id] = true;
  }

  chat.setChipProvider(provide);

  chat.on('chips', guarded(decorate));
  chat.on('turn:start', guarded(function (detail) {
    noteTurn(detail && detail.text);
    suggestions = [];
    spoken = '';
    render();
  }));
  chat.on('reply', guarded(function (detail) {
    turn += 1;
    var data = detail && detail.data;
    suggestions = data && Array.isArray(data.suggestions) ? data.suggestions : [];
    renderSoon();
  }));
  chat.on('card', guarded(renderSoon));

  // Runs before the chat's own click handler sends the chip, so the render that follows knows which one was tapped.
  document.addEventListener('click', guarded(function (event) {
    var chip = event.target && event.target.closest && event.target.closest('[data-ai-chat-prompt]');
    if (!chip || !box.contains(chip)) return;
    tapped = chip.getAttribute('data-ai-chat-prompt');
    window.setTimeout(function () { tapped = null; }, 0);
  }), true);

  document.addEventListener('change', guarded(function (event) {
    if (event.target && event.target.matches && event.target.matches(QUANTITY + ', ' + VARIANT)) render();
  }));
  document.addEventListener('bazaar-page:ready', guarded(function (event) {
    page = (event && event.detail) || chat.page || page;
    render();
  }));
  document.addEventListener('bazaar-voice:state', guarded(function (event) {
    var was = voiceOn;
    setVoice(event && event.detail && event.detail.on);
    if (was !== voiceOn) render();
    else markSpoken();
  }));
  document.addEventListener('bazaar-voice:caption', guarded(function (event) {
    if (!voiceOn) return;
    spoken = String((event && event.detail && event.detail.text) || '');
    markSpoken();
  }));

  try {
    if (chat.handsfree && typeof chat.handsfree.isOn === 'function' && chat.handsfree.isOn()) setVoice(true);
  } catch (error) { /* hands-free is another feature; without it the row stays as it is */ }
  guarded(render)();
})();
