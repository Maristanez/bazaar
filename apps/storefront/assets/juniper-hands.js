// V13 Juniper's hands (docs/PLAN.md): she does the shopping chores the shopper asks for, on the page, in plain sight.
// Talks to the chat only through window.BazaarChat. It reads each turn for a chore, and when there is one a hand
// travels from the chat to the control, the control is worked, and a line in the chat says what was done, with Undo
// where undoing means something. A turn that is only a chore is answered here and never reaches the server.
//   chores — open a product, pick a size, set a quantity, add to cart, open the cart, back to all products, undo.
//            A chore for a product on another page takes her there first and is finished on arrival.
//   on her own — asked to find something, she answers, then takes the shopper to the product she named ("Stay
//            here" stops her).
//            Cart edits the shopper asks for: take a named thing out, or empty the cart, each with Undo.
//            Browser: back, forward, refresh, scroll.
//   never  — Deal, checkout, payment, removing what the shopper did not ask to remove. A deal is binding: it takes
//            the shopper's own hand. Nothing here reads, writes or says a price.
(function () {
  var chat = window.BazaarChat;
  if (!chat || typeof chat.on !== 'function') return;

  var elements = chat.elements || {};
  var widget = elements.widget;
  var messages = elements.messages;
  if (!widget || !messages) return;

  var TRAVEL_MS = 620;
  var PRESS_MS = 260;
  var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, pair: 1 };
  var SIZE_WORDS = { 'extra small': 'XS', small: 'S', medium: 'M', large: 'L', 'extra large': 'XL' };
  var lastAdd = null; // { key, quantity, title } — what Undo takes back

  function lower(value) { return String(value == null ? '' : value).toLowerCase(); }

  // "Trail Runner three" and "trail-runner-3" read the same.
  function plain(value) {
    return lower(value).replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, function (word) { return String(NUMBER_WORDS[word]); }).replace(/\b(\d{1,2}) and a half\b/g, '$1.5').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  // What the ear hands over is not what was said: "add to card", "at it to my kart", "hey Jarvis, can you please…".
  function tidy(said) {
    return said
      .replace(/\b(?:card|kart|court)\b/g, function (word, at, whole) { return /(?:gift|credit|debit|business) $/.test(whole.slice(0, at)) ? word : 'cart'; })
      .replace(/^(?:(?:hey|hi|ok|okay|yo|so|um|uh|and|now|then|please|juniper|jarvis|jarvus|jervis)\s+)+/, '')
      .replace(/^(?:(?:can|could|would|will) you|i (?:want|need|d like) you to|i d like to|i want to|let s|let us|go ahead and|just)\s+/, '')
      .replace(/^(?:please|kindly|quickly|just)\s+/, '')
      .replace(/\s+(?:please|for me|thanks|thank you|now|right now|real quick)$/g, '')
      .replace(/^(?:press|click|tap|hit|push|select|choose|use)(?: on)?(?: the)?\s+(.+?)(?: button| link| tab| icon)?$/, '$1')
      .replace(/^(?:at|had|ad|and) ((?:it|this|that|them|these|those) )?(to|in|into) /, 'add $1$2 ');
  }

  function state() { try { return chat.state() || {}; } catch (error) { return {}; } }

  // A chore with no haggling in it is answered here, on the page, and never sent: the server reads every turn as
  // bargaining ("make it two" came back as a two-dollar offer). A sentence that does both gets both.
  var HAGGLING = /\$|\b\d+\s*(?:dollars|bucks)\b|\b(?:offer|discount|deal|price|cheaper|budget|best you can|how about|could you do|would you take|knock|off|gift|free|throw in|perk|bundle|student|percent|half price|match)\b|%/i;

  // ---- a chore that needs another page: she goes there herself and finishes the job on arrival ----
  var PLAN_KEY = 'bazaar:hands:plan';
  var PLAN_FRESH_MS = 60000;
  function planAhead(action) {
    try { window.sessionStorage.setItem(PLAN_KEY, JSON.stringify({ at: Date.now(), kind: action.kind, handle: action.product.handle, size: action.size || '', quantity: action.quantity || 0 })); } catch (error) { /* she still gets there */ }
  }
  function resumePlan() {
    var plan = null;
    try { plan = JSON.parse(window.sessionStorage.getItem(PLAN_KEY) || 'null'); window.sessionStorage.removeItem(PLAN_KEY); } catch (error) { plan = null; }
    var current = state().currentProduct;
    if (!plan || !current || Date.now() - plan.at > PLAN_FRESH_MS || lower(plan.handle) !== lower(current.handle)) return;
    window.setTimeout(function () {
      // Open or minimised is as the shopper left it (V2 carries that over); minimised, the peek reports.
      run({ kind: plan.kind, product: current, size: plan.size, quantity: plan.quantity });
    }, 1100);
  }

  // ---- reading the chore out of what was said ----
  function namedProduct(said, products) {
    var best = null;
    (products || []).forEach(function (product) {
      var title = plain(product && product.title);
      if (!title) return;
      var words = title.split(' ');
      var hit = said.indexOf(title) > -1 || (words.length > 1 && words.every(function (word) { return (' ' + said + ' ').indexOf(' ' + word + ' ') > -1; }));
      if (hit && (!best || title.length > plain(best.title).length)) best = product;
    });
    return best;
  }

  // "the runners", "those socks", "a vest": one telling word is enough when only one product answers to it.
  var COMMON = { trail: 1, the: 1, and: 1, for: 1, with: 1, lite: 1, everyday: 1, size: 1, cart: 1, shop: 1, store: 1, page: 1, product: 1, products: 1 };
  function singular(word) { return word.length > 3 && word.charAt(word.length - 1) === 's' ? word.slice(0, -1) : word; }
  function looselyNamed(said, products) {
    var heard = {};
    said.split(' ').forEach(function (word) { if (word.length >= 3 && !COMMON[word]) heard[singular(word)] = true; });
    var matches = (products || []).filter(function (product) {
      var words = plain([product && product.title, product && product.type, product && product.handle].join(' ')).split(' ');
      return words.some(function (word) { return word.length >= 3 && !COMMON[word] && !/^\d+$/.test(word) && heard[singular(word)]; });
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // The product a reply names first, reading left to right.
  function firstNamed(said, products) {
    var best = null;
    var bestAt = -1;
    (products || []).forEach(function (product) {
      var title = plain(product && product.title);
      var at = title ? said.indexOf(title) : -1;
      if (at > -1 && (bestAt < 0 || at < bestAt)) { best = product; bestAt = at; }
    });
    return best;
  }

  function sizeIn(said) {
    var match = /\bsize\s+(\d{1,2}(?:\.5)?|xs|s|m|l|xl|xxl|extra small|small|medium|large|extra large)\b/.exec(said)
      || /\b(?:in|make (?:it|that|them)|give me|do|want|need|take|get me|i m|i am|i wear|wear) an? (\d{1,2}(?:\.5)?|extra small|small|medium|large|extra large)\b/.exec(said)
      || /\bin (extra small|small|medium|large|extra large)\b/.exec(said);
    if (!match) return '';
    return SIZE_WORDS[match[1]] || match[1].toUpperCase();
  }

  // "add two" counts only inside a cart chore: "could you add two pairs of socks as a gift" is haggling, not a chore.
  function quantityIn(said, adding) {
    var match = /\b(?:make (?:it|that)|quantity(?: of| to)?|change (?:it|that|the quantity) to|set (?:it|the quantity) to)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(said)
      || (adding ? /\b(?:add|put|throw|toss|pop|drop|take|have|get|buy|grab|want|need|order)\s+(?:me )?(\d{1,2}|a couple)\b(?! and a half|\.5)/.exec(said) : null)
      || /^(?:i (?:want|need|ll take|d like|ll have)|give me|get me) (\d{1,2}|a couple)(?: of (?:them|these|those|it)| pairs?)?$/.exec(said);
    if (!match) return 0;
    var value = match[1] === 'a couple' ? 2 : (NUMBER_WORDS[match[1]] || parseInt(match[1], 10));
    return value > 0 && value <= 20 ? value : 0;
  }

  var CART = '(?:cart|bag|basket|trolley)';
  function understand(text, context) {
    var said = tidy(plain(text));
    if (!said) return null;
    context = context || {};
    // Bargaining talk borrows the same verbs ("could you add two pairs of socks as a gift"). With haggling in the
    // sentence, only a chore that names the cart outright is a chore.
    var haggling = HAGGLING.test(String(text || ''));
    // The two things that stay in the shopper's own hand. Said plainly, on the page, without a trip to the server.
    if (/\b(check ?out|pay(?: now| for (?:it|this|them))?|place (?:the |my )?order|buy (?:it )?now)\b/.test(said) && !/\bcheck out the\b/.test(said)) return { kind: 'refuse', what: 'checkout' };
    if (/\b(?:press|click|tap|hit|push|accept|confirm|take)(?: on)? (?:the |that |this |a )?deal\b/.test(plain(text))) return { kind: 'refuse', what: 'deal' };
    var product = namedProduct(said, context.products);
    var going = /\b(show|open|take me|bring me|go to|head to|jump to|navigate|pull up|bring up|let me see|let s see|look at|see the|find|search for|where is|where are|want to see|like to see|check out the)\b/.test(said);
    if (!product && (going || /\b(add|put|throw|toss|pop|drop)\b/.test(said))) product = looselyNamed(said, context.products);
    if (/\b(undo|take (?:that|it|them) (?:back )?out|put (?:that|it|them) back|remove (?:it|that|them|this|the last (?:one|thing))|never ?mind that|scratch that)\b/.test(said) && !namedProduct(said, context.products)) return { kind: 'undo', product: context.currentProduct || null };
    if (/\b(?:clear|empty|delete|wipe|reset)\b.*\bcart\b|\b(?:remove|delete|take out|get rid of) (?:everything|all(?: of (?:it|them))?)\b|^start over$/.test(said)) return { kind: 'clear' };
    if ((/\b(?:remove|delete|take out|take off|get rid of|lose)\b/.test(said) || /\btake\b.+\b(?:out|off)\b/.test(said)) && !haggling) {
      var gone = product || looselyNamed(said, context.products);
      if (gone) return { kind: 'remove', product: gone };
      if (/\b(?:it|this|that|these|those|them)\b/.test(said) && context.currentProduct && !/\b(undo|last)\b/.test(said)) return { kind: 'remove', product: context.currentProduct, orUndo: true };
    }
    if (/^(?:refresh|reload)(?: (?:the |this )?page)?$/.test(said)) return { kind: 'reload' };
    if (/^(?:go |take me |head )?forward(?: (?:a|one) page)?$|^next page$/.test(said)) return { kind: 'forward' };
    if (new RegExp('\\b(add|put|throw|toss|pop|drop|stick|chuck)\\b.*\\b' + CART + '\\b').test(said)
      || (!haggling && (/\badd (?:it|them|this|that|those|these|one|\d{1,2}|a couple)\b/.test(said)
        || /^add(?: (?:to|in|into)(?: (?:my|the))? cart)?$/.test(said)
        || /\b(?:i ll|i will|ill|we ll|i d like to|i want to|let me) (?:take|have|get|buy|grab|order) (?:it|them|this|that|these|those|one|a pair|\d{1,2}|a couple)\b/.test(said)
        || /^(?:buy|get|grab|order|purchase|bag)(?: me)? (?:it|this|that|these|those|them|one|a pair)\b/.test(said)))) {
      return { kind: 'add', product: product || context.currentProduct || null, size: sizeIn(said), quantity: quantityIn(said, true) || 0 };
    }
    if (/\b(open|show|view|see|check|go to|take me to|navigate to|head to|bring up|pull up|what s in|whats in)\b.*\b(cart|bag|basket)\b/.test(said) || /^(?:my |the )?(?:cart|bag|basket)$/.test(said)) return { kind: 'cart' };
    if (/^(?:go |take me |head |navigate )?back(?: (?:a|one) page| to (?:the )?(?:last|previous) page)?$|^(?:the )?(?:previous|last) page$/.test(said)) return { kind: 'back' };
    var scroll = /^(?:scroll|go|move|page)?\s*(?:to (?:the )?)?(up|down|top|bottom)(?: of (?:the )?page)?$/.exec(said) || /\bscroll (?:\w+ )?(up|down|top|bottom)\b/.exec(said) || /\b(?:to|at) the (top|bottom)\b/.exec(said);
    if (scroll) return { kind: 'scroll', where: scroll[1] };
    if (/^(?:the )?(?:home|home ?page|front page|main page|start)$/.test(said)) return { kind: 'home' };
    if (/^(?:the )?(?:shop|store|products|catalog|catalogue|collection|shelves|everything|all)$/.test(said) || /\b(?:show|see|view|browse|open|list)\b.*\b(?:everything|all (?:the |your )?(?:products|items|gear|stuff)|what you (?:have|ve got|sell))\b/.test(said)) return { kind: 'browse' };
    if (/\b(all products|everything you (?:have|ve got|sell)|back to (?:the )?(?:shop|store|products)|keep shopping|browse (?:the )?(?:shop|store)|(?:show|see|open|go to|navigate to|take me to) (?:me )?(?:the )?(?:shop|store|catalog|catalogue|collection|shelves))\b/.test(said)) return { kind: 'browse' };
    if (/\b(go|take me|bring me|head|navigate|back) (?:to (?:the )?)?home(?: ?page)?\b/.test(said)) return { kind: 'home' };
    if (product && going) return { kind: 'show', product: product };
    // Just its name, or its name and a nod: "the vest", "socks please".
    var brief = said.split(' ').length <= 4;
    if (!product && brief && !haggling) product = looselyNamed(said, context.products);
    if (product && brief && !haggling) return { kind: 'show', product: product };
    // A kind of thing, not one thing ("show me shoes"): the shelves, with the first of them pointed out.
    if (going) {
      var kind = kindNamed(said, context.products);
      if (kind) return { kind: 'browse', point: kind.handle };
    }
    var size = sizeIn(said);
    var quantity = quantityIn(said, false);
    if ((size || quantity) && !haggling) return { kind: 'fit', size: size, quantity: quantity };
    // It was an order, not a haggle, and she did not catch it: she says what she can do rather than guess.
    if (/^(?:add|put|remove|open|close|go|take me|bring me|navigate|scroll|show|find|search|select|choose|pick|set|change|switch)\b/.test(said) && !haggling) return { kind: 'unsure' };
    return null;
  }

  function kindNamed(said, products) {
    var heard = {};
    said.split(' ').forEach(function (word) { if (word.length >= 3 && !COMMON[word]) heard[singular(word)] = true; });
    return (products || []).filter(function (product) {
      return plain([product && product.type, product && product.title].join(' ')).split(' ').some(function (word) { return word.length >= 3 && !COMMON[word] && heard[singular(word)]; });
    })[0] || null;
  }

  // Minimised, the chat cannot show her line; V12's peek above the launcher or the voice pill says it instead.
  function isOpen() { try { return Boolean(chat.isOpen && chat.isOpen()); } catch (error) { return false; } }
  function tellMinimised(text) {
    if (isOpen() || !text) return;
    try { if (chat.shape && chat.shape.peek) chat.shape.peek(text); } catch (error) { /* the line is still in the chat */ }
  }

  // ---- the line in the chat that says what she is doing ----
  function step(text) {
    var line = document.createElement('p');
    line.className = 'juniper-hands__step';
    line.setAttribute('data-juniper-step', 'working');
    line.innerHTML = '<span class="juniper-hands__mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="juniper-hands__text"></span>';
    line.querySelector('.juniper-hands__text').textContent = text;
    messages.appendChild(line);
    messages.scrollTop = messages.scrollHeight;
    return {
      done: function (after, undo) {
        line.setAttribute('data-juniper-step', 'done');
        line.querySelector('.juniper-hands__text').textContent = after;
        if (undo) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'juniper-hands__undo';
          button.setAttribute('data-juniper-undo', '');
          button.textContent = 'Undo';
          button.addEventListener('click', function () { button.disabled = true; undo(button); });
          line.appendChild(button);
        }
        messages.scrollTop = messages.scrollHeight;
        tellMinimised(after);
      },
      fail: function (why) {
        tellMinimised(why);
        line.setAttribute('data-juniper-step', 'failed');
        line.querySelector('.juniper-hands__text').textContent = why;
      }
    };
  }

  // ---- the hand: it leaves Juniper, crosses the page, and presses ----
  var hand = null;
  function overlaps(a, b) {
    return Boolean(a && b && a.width && b.width) && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }
  // Where the hand sets out from: her face in the open chat; minimised, the voice pill or the launcher.
  function origin() {
    var pill = widget.querySelector('[data-juniper-pill]');
    if (isOpen()) return widget.querySelector('[data-ai-chat-sticker="head"]') || widget;
    if (pill && !pill.hidden) return pill;
    return elements.launcher || widget;
  }
  function travel(target, then) {
    if (!target || !target.getBoundingClientRect) { then(); return; }
    try { if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (error) { /* stays put */ }
    window.setTimeout(function () {
      var to = target.getBoundingClientRect();
      // Her own panel is in the way of what she is reaching for: she folds herself down to her resting corner,
      // does the job where the shopper can watch it, and unfolds again.
      var steppedAside = false;
      if (isOpen() && elements.panel && overlaps(elements.panel.getBoundingClientRect(), to)) {
        steppedAside = true;
        chat.close();
      }
      var from = origin().getBoundingClientRect();
      if (!hand) {
        hand = document.createElement('span');
        hand.className = 'juniper-hands__hand';
        hand.setAttribute('aria-hidden', 'true');
        document.body.appendChild(hand);
      }
      var startX = from.left + from.width / 2;
      var startY = from.top + from.height / 2;
      hand.style.transition = 'none';
      hand.style.translate = startX + 'px ' + startY + 'px';
      hand.setAttribute('data-juniper-hand', 'out');
      void hand.offsetWidth;
      hand.style.transition = '';
      hand.style.translate = (to.left + to.width / 2) + 'px ' + (to.top + to.height / 2) + 'px';
      window.setTimeout(function () {
        hand.setAttribute('data-juniper-hand', 'press');
        target.classList.add('juniper-hands__pressed');
        window.setTimeout(function () {
          target.classList.remove('juniper-hands__pressed');
          hand.setAttribute('data-juniper-hand', 'away');
          if (steppedAside && chat.open) chat.open();
          then();
        }, PRESS_MS);
      }, TRAVEL_MS);
    }, 180);
  }

  // ---- leaving the page waits for Juniper to finish her line: a turn cut off mid-flight reads as an outage ----
  var turnOpen = false;
  var speaking = false;
  var whenTurnEnds = [];
  function flush() {
    if (turnOpen || speaking) return;
    var waiting = whenTurnEnds;
    whenTurnEnds = [];
    waiting.forEach(function (run) { try { run(); } catch (error) { /* the next one still runs */ } });
  }
  function afterTurn(run) {
    var ran = false;
    var once = function () { if (!ran) { ran = true; run(); } };
    if (!turnOpen && !speaking) { window.setTimeout(once, 500); return; }
    whenTurnEnds.push(function () { window.setTimeout(once, 900); });
    window.setTimeout(once, 12000); // she never answered: the shopper still gets where they asked to go
  }
  chat.on('reply', function () { turnOpen = false; window.setTimeout(flush, 350); }); // 350ms: speech, if any, has begun
  chat.on('turn:error', function () { turnOpen = false; flush(); });
  chat.on('speak:start', function () { speaking = true; });
  chat.on('speak:end', function () { speaking = false; flush(); });

  // ---- the chores ----
  function go(href) {
    // A link inside the widget, clicked: V2 carries the conversation (and the ?shopper= of a demo) across the page.
    var link = document.createElement('a');
    link.href = href;
    link.hidden = true;
    widget.appendChild(link);
    link.click();
  }

  function productForm() {
    var select = document.querySelector('.product-form select[name="id"], form[action*="/cart/add"] select[name="id"], select[name="id"]');
    var quantity = document.querySelector('.product-form input[name="quantity"], form[action*="/cart/add"] input[name="quantity"], input[name="quantity"]');
    return { select: select, quantity: quantity };
  }

  function optionFor(select, size) {
    if (!select || !size) return null;
    var wanted = lower(size);
    var found = null;
    Array.prototype.forEach.call(select.options || [], function (option) {
      if (found || option.disabled) return;
      var label = lower(option.textContent).split('—')[0];
      var parts = label.split(/[\s/·,-]+/).filter(Boolean);
      if (parts.indexOf(wanted) > -1) found = option;
    });
    return found;
  }

  function changed(control) {
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  function fit(action, done) {
    var form = productForm();
    var said = [];
    var next = function () {
      if (action.quantity && form.quantity) {
        travel(form.quantity, function () { form.quantity.value = String(action.quantity); changed(form.quantity); said.push('quantity ' + action.quantity); done(said); });
      } else done(said);
    };
    if (action.size && form.select) {
      var option = optionFor(form.select, action.size);
      if (!option) { done(said, 'No size ' + action.size + ' on this one'); return; }
      travel(form.select, function () { form.select.value = option.value; changed(form.select); said.push('size ' + action.size); next(); });
    } else next();
  }

  function json(url, body) {
    return window.fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } })
      .then(function (response) { if (!response.ok) throw new Error(url + ' ' + response.status); return response.json(); });
  }

  function showCartCount() {
    return json('/cart.js').then(function (cart) {
      var link = document.querySelector('header a[href$="/cart"], a[href="/cart"], a[aria-label="Cart"]');
      if (!link) return;
      var badge = link.querySelector('sup');
      if (!badge) { badge = document.createElement('sup'); link.insertBefore(badge, link.firstChild); }
      badge.textContent = String(cart.item_count);
      badge.classList.add('juniper-hands__bump');
    }).catch(function () { /* the count catches up on the next page */ });
  }

  function variantFor(product, size) {
    var current = state().currentProduct;
    var onPage = current && product && lower(current.handle) === lower(product.handle);
    var form = productForm();
    if (onPage && form.select && !size) return Promise.resolve({ id: form.select.value, quantity: form.quantity ? parseInt(form.quantity.value, 10) || 1 : 1 });
    if (onPage && form.select && size) {
      var option = optionFor(form.select, size);
      return option ? Promise.resolve({ id: option.value }) : Promise.reject(new Error('no-size'));
    }
    if (!size) return Promise.resolve({ id: product.selectedVariantId });
    return json('/products/' + encodeURIComponent(product.handle) + '.js').then(function (full) {
      var wanted = lower(size);
      var match = (full.variants || []).filter(function (variant) {
        return variant.available !== false && lower(variant.title).split(/[\s/·,-]+/).indexOf(wanted) > -1;
      })[0];
      if (!match) throw new Error('no-size');
      return { id: match.id };
    });
  }

  function onCartPage() { return /\/cart\/?$/.test(window.location.pathname); }
  // The cart page is drawn by the server: after a change made from the chat it is loaded again, chat and all.
  function refreshCartPage() { if (onCartPage()) afterTurn(function () { go('/cart'); }); }

  function undoAdd(line) {
    if (!lastAdd) return Promise.resolve(false);
    var taken = lastAdd;
    lastAdd = null;
    return json('/cart/change.js', { id: taken.key, quantity: Math.max(0, taken.lineQuantity - taken.quantity) })
      .then(function () { showCartCount(); if (line) line.done('Taken back out: ' + taken.title); return true; });
  }

  function run(action) {
    if (!action) return;
    var line;
    if (action.kind === 'cart') {
      line = step('Juniper is opening your cart');
      travel(document.querySelector('header a[href$="/cart"], a[href="/cart"], a[aria-label="Cart"]'), function () { line.done('Opening your cart'); afterTurn(function () { go('/cart'); }); });
      return;
    }
    if (action.kind === 'refuse') {
      step('').fail(action.what === 'deal' ? 'A deal is binding, so that button is yours to press' : 'Paying is yours to do. Here is your cart, checkout is right there');
      if (action.what !== 'deal' && !onCartPage()) afterTurn(function () { go('/cart'); });
      return;
    }
    if (action.kind === 'clear') {
      line = step('Juniper is emptying your cart');
      json('/cart.js').then(function (cart) {
        var had = (cart.items || []).map(function (item) { return { id: item.variant_id || item.id, quantity: item.quantity }; });
        if (!had.length) { line.done('Your cart is already empty'); return null; }
        return json('/cart/clear.js', {}).then(function () {
          lastAdd = null;
          showCartCount();
          line.done('Cart emptied', function () {
            json('/cart/add.js', { items: had }).then(function () { showCartCount(); line.done('Put everything back'); refreshCartPage(); })
              .catch(function () { line.fail('The cart did not answer. It is still empty.'); });
          });
          refreshCartPage();
        });
      }).catch(function () { line.fail('The cart did not answer. Nothing was changed.'); });
      return;
    }
    if (action.kind === 'remove') {
      if (action.orUndo && lastAdd) { run({ kind: 'undo' }); return; }
      var gone = action.product;
      line = step('Juniper is taking the ' + gone.title + ' out of your cart');
      json('/cart.js').then(function (cart) {
        var lines = (cart.items || []).filter(function (item) { return lower(item.handle) === lower(gone.handle) || lower(item.product_title || item.title) === lower(gone.title); });
        if (!lines.length) { line.fail('There is no ' + gone.title + ' in your cart'); return null; }
        var back = lines.map(function (item) { return { id: item.variant_id || item.id, quantity: item.quantity }; });
        var updates = {};
        lines.forEach(function (item) { updates[item.key || item.variant_id || item.id] = 0; });
        return json('/cart/update.js', { updates: updates }).then(function () {
          lastAdd = null;
          showCartCount();
          line.done('Took the ' + gone.title + ' out', function () {
            json('/cart/add.js', { items: back }).then(function () { showCartCount(); line.done('Put the ' + gone.title + ' back'); refreshCartPage(); })
              .catch(function () { line.fail('The cart did not answer. It is still out.'); });
          });
          refreshCartPage();
        });
      }).catch(function () { line.fail('The cart did not answer. Nothing was changed.'); });
      return;
    }
    if (action.kind === 'reload') {
      step('').done('Refreshing the page');
      afterTurn(function () { go(window.location.pathname + window.location.search); });
      return;
    }
    if (action.kind === 'forward') {
      step('').done('Going forward');
      afterTurn(function () { window.history.forward(); });
      return;
    }
    if (action.kind === 'unsure') {
      step('').fail('Say it another way? I can open products, pick a size, set a quantity, add to, remove from or clear your cart, scroll, refresh, and take you home, back, or to your cart');
      return;
    }
    if (action.kind === 'scroll') {
      line = step('Juniper is scrolling');
      var top = action.where === 'top' ? 0 : action.where === 'bottom' ? document.documentElement.scrollHeight : window.scrollY + (action.where === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.8);
      try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (error) { window.scrollTo(0, top); }
      line.done(action.where === 'top' ? 'Top of the page' : action.where === 'bottom' ? 'Bottom of the page' : 'Scrolled ' + action.where);
      return;
    }
    if (action.kind === 'back') {
      line = step('Juniper is taking you back');
      var from = '';
      try { from = document.referrer && new URL(document.referrer).origin === window.location.origin ? document.referrer : ''; } catch (error) { from = ''; }
      line.done('Going back');
      afterTurn(function () { go(from || '/collections/all'); });
      return;
    }
    if (action.kind === 'home') {
      line = step('Juniper is taking you home');
      line.done('Heading to the front of the shop');
      afterTurn(function () { go('/'); });
      return;
    }
    if (action.kind === 'browse') {
      line = step('Juniper is taking you back to the shelves');
      var onShelves = /\/collections\//.test(window.location.pathname) || Boolean(action.point && document.querySelector('a[href*="/products/' + action.point + '"]'));
      if (onShelves && action.point && chat.pointer && chat.pointer.point) { chat.pointer.point(action.point); line.done('Here they are'); return; }
      line.done('Heading to the shelves');
      afterTurn(function () { go('/collections/all'); });
      return;
    }
    if (action.kind === 'show') {
      var current = state().currentProduct;
      if (current && lower(current.handle) === lower(action.product.handle)) { step('').done('You are looking at the ' + action.product.title); return; }
      line = step('Juniper is pulling up the ' + action.product.title);
      var card = document.querySelector('a[href*="/products/' + action.product.handle + '"]');
      travel(card, function () { line.done('Opening the ' + action.product.title); afterTurn(function () { go(action.product.url || '/products/' + action.product.handle); }); });
      return;
    }
    if (action.kind === 'fit') {
      if (!productForm().select && !productForm().quantity) { step('').fail('Open a product first and I will set that up'); return; }
      line = step('Juniper is setting that up');
      fit(action, function (said, problem) { if (problem) line.fail(problem); else if (said.length) line.done('Set ' + said.join(', ')); else line.fail('Nothing to change here'); });
      return;
    }
    if (action.kind === 'undo') {
      if (!lastAdd && action.product) { run({ kind: 'remove', product: action.product }); return; }
      if (!lastAdd) { step('').fail('Nothing to take back. Tell me what to remove, or say clear my cart'); return; }
      line = step('Juniper is taking that back out');
      undoAdd(line).catch(function () { line.fail('The cart did not answer. It is still in there.'); });
      return;
    }
    if (action.kind === 'add') {
      if (!action.product) { step('').fail('Tell me which one and I will add it'); return; }
      var title = action.product.title;
      line = step('Juniper is adding the ' + title + ' to your cart');
      var current2 = state().currentProduct;
      var onPage = current2 && lower(current2.handle) === lower(action.product.handle);
      var add = function () {
        variantFor(action.product, action.size).then(function (variant) {
          var quantity = action.quantity || variant.quantity || 1;
          return json('/cart/add.js', { items: [{ id: Number(variant.id) || variant.id, quantity: quantity }] }).then(function (added) {
            var item = (added && added.items && added.items[0]) || added || {};
            lastAdd = { key: item.key || String(variant.id), quantity: quantity, lineQuantity: item.quantity || quantity, title: title };
            showCartCount();
            var detail = [title].concat(action.size ? ['size ' + action.size] : []).concat(quantity > 1 ? ['× ' + quantity] : []);
            line.done('In your cart: ' + detail.join(', '), function () {
              undoAdd(line).catch(function () { line.fail('The cart did not answer. It is still in there.'); });
            });
          });
        }).catch(function (error) {
          line.fail(error && error.message === 'no-size' ? 'No size ' + action.size + ' in the ' + title : 'The cart did not answer. Nothing was added.');
        });
      };
      if (onPage) {
        fit({ size: action.size, quantity: action.quantity }, function (said, problem) {
          if (problem) { line.fail(problem); return; }
          travel(document.querySelector('.product-form [type="submit"], form[action*="/cart/add"] [type="submit"]'), add);
        });
      } else if (action.product.url || action.product.handle) {
        // Not on its page: she walks there first, so the shopper watches the size go in and the button get pressed.
        line.done('Opening the ' + title + ' first');
        planAhead(action);
        var card2 = document.querySelector('a[href*="/products/' + action.product.handle + '"]');
        travel(card2, function () { afterTurn(function () { go(action.product.url || '/products/' + action.product.handle); }); });
      } else add();
    }
  }

  // ---- on her own: when her answer names a product the shopper asked her to find, she takes them to it ----
  var ASKED_TO_FIND = /\b(recommend|suggest|what s good|whats good|what do you have|which|find me|looking for|i need|i want|something for|best for|good for|anything for|help me (?:pick|choose|find)|your pick)\b/;
  var FOLLOW_MS = 2600;
  var lastSaid = '';
  function followThrough(replyText) {
    var current = state();
    if (!ASKED_TO_FIND.test(lastSaid)) return;
    var product = firstNamed(plain(replyText), current.products);
    if (!product || (current.currentProduct && lower(current.currentProduct.handle) === lower(product.handle))) return;
    var cancelled = false;
    var line = step('Juniper is taking you to the ' + product.title);
    var stay = document.createElement('button');
    stay.type = 'button';
    stay.className = 'juniper-hands__undo';
    stay.setAttribute('data-juniper-stay', '');
    stay.textContent = 'Stay here';
    stay.addEventListener('click', function () { cancelled = true; line.fail('Staying put'); stay.disabled = true; });
    messages.lastChild.appendChild(stay);
    window.setTimeout(function () {
      afterTurn(function () {
        if (cancelled) return;
        var card = document.querySelector('a[href*="/products/' + product.handle + '"]');
        travel(card, function () { if (cancelled) return; stay.disabled = true; line.done('Opening the ' + product.title); go(product.url || '/products/' + product.handle); });
      });
    }, FOLLOW_MS);
  }
  chat.on('reply', function (detail) {
    try { followThrough(detail && detail.text); } catch (error) { if (window.console) window.console.error('[juniper-hands]', error); }
  });

  chat.hands = { understand: understand, run: run };

  chat.on('turn:start', function (detail) { turnOpen = true; lastSaid = plain(detail && detail.text); });
  chat.on('turn:local', function () { turnOpen = false; flush(); });

  if (typeof chat.answerLocally === 'function') {
    chat.answerLocally(function (text) {
      try {
        var current = state();
        var chore = understand(text, { products: current.products, currentProduct: current.currentProduct });
        if (!chore) return false;
        run(chore);
        // Haggling in the same breath still goes to her; a refusal or an "I did not catch that" never does.
        return chore.kind === 'refuse' || chore.kind === 'unsure' || !HAGGLING.test(String(text || ''));
      } catch (error) {
        if (window.console) window.console.error('[juniper-hands]', error);
        return false;
      }
    });
  }

  resumePlan();
})();
