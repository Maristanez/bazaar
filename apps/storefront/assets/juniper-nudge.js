// V9 one silent nudge per session (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// After a dwell on a product page the launcher's label changes once. No sound, no figure, no second time.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;
  try {
    var KEY = 'bazaar:nudged';
    var LINE = 'Too steep? Name a price.';
    var DWELL_SECONDS = 20;
    var SHOW_MS = 12000;
    var LIVE_CLASS = 'juniper-nudge__live';
    var PRICE_AREA = '.product-form, .product-shell__price, form[action*="/cart/add"], [data-product-price]';

    var launcher = chat.elements && chat.elements.launcher;
    if (!launcher || !chat.state().currentProduct) return;
    var spans = launcher.querySelectorAll('span');
    var label = spans[1];
    if (!label) return;

    var spent = false;
    var showing = false;
    var dwelt = 0;
    var seen = false;
    var handsfree = false;
    var ticker = null;
    var restoreTimer = null;
    var observer = null;
    var originalText = label.textContent;
    var originalName = launcher.getAttribute('aria-label');

    function read() { try { return window.sessionStorage.getItem(KEY); } catch (error) { return null; } }
    function spend() {
      spent = true;
      try { window.sessionStorage.setItem(KEY, '1'); } catch (error) { /* a blocked store still leaves the page flag */ }
      if (ticker) { window.clearInterval(ticker); ticker = null; }
      if (observer) { try { observer.disconnect(); } catch (error) { /* nothing to undo */ } observer = null; }
    }
    if (read()) return;

    function handsfreeOn() {
      try { if (chat.handsfree && chat.handsfree.isOn()) return true; } catch (error) { /* V1 is not here */ }
      return handsfree;
    }

    function restore() {
      if (restoreTimer) { window.clearTimeout(restoreTimer); restoreTimer = null; }
      if (!showing) return;
      showing = false;
      label.textContent = originalText;
      if (originalName === null) launcher.removeAttribute('aria-label'); else launcher.setAttribute('aria-label', originalName);
      launcher.classList.remove(LIVE_CLASS);
    }

    function show() {
      spend();
      showing = true;
      label.textContent = LINE;
      // The accessible name carries the visible words, and nothing here is a live region: a screen reader hears
      // the new label only when the shopper reaches the button.
      launcher.setAttribute('aria-label', LINE + ' Open the shopkeeper chat');
      launcher.classList.add(LIVE_CLASS);
      restoreTimer = window.setTimeout(restore, SHOW_MS);
    }

    function tick() {
      if (spent) return;
      if (document.visibilityState === 'hidden') return;
      dwelt += 1;
      if (dwelt < DWELL_SECONDS || !seen) return;
      if (chat.isOpen() || handsfreeOn()) return;
      show();
    }

    chat.on('open', function () {
      // A shopper who has opened the chat needs no invitation, now or later in the session.
      if (!spent) spend();
      restore();
    });
    document.addEventListener('bazaar-voice:state', function (event) {
      handsfree = Boolean(event && event.detail && event.detail.on);
      if (handsfree) restore();
    });

    var area = document.querySelector(PRICE_AREA);
    if (area && typeof window.IntersectionObserver === 'function') {
      observer = new window.IntersectionObserver(function (entries) {
        for (var i = 0; i < (entries || []).length; i += 1) {
          if (entries[i] && entries[i].isIntersecting) seen = true;
        }
      }, { threshold: 0.25 });
      observer.observe(area);
    } else {
      seen = true;
    }

    if (chat.isOpen()) { spend(); return; }
    ticker = window.setInterval(tick, 1000);
  } catch (error) {
    if (window.console) window.console.error('[juniper-nudge]', error);
  }
})();
