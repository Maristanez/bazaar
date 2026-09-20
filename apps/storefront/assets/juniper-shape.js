// V12 the chat keeps its shape out of the conversation's way (docs/PLAN.md). Talks to the chat only through
// window.BazaarChat. Three jobs, one aim — the messages get the room:
//   size     — the shopper drags the panel's top-left corner (it is anchored bottom-right) or taps the size button;
//              the size is remembered for this browser. Phones keep the full-screen sheet.
//   minimise — the header's one way out folds the chat down to Juniper's launcher or voice pill. Nothing ends: the
//              conversation and hands-free carry on, a reply that lands meanwhile peeks above her and leaves a dot.
//   rail     — suggestions sit on one line that scrolls sideways, with a fade and a "more" button where it runs on.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  try {
    var elements = chat.elements || {};
    var widget = elements.widget;
    var panel = elements.panel;
    var launcher = elements.launcher;
    var messages = elements.messages;
    if (!widget || !panel || !document.createElement) return;

    var SIZE_KEY = 'bazaar:shape';
    var MIN_W = 300;
    var MIN_H = 380;
    var MARGIN = 40;             // critical.css keeps 2.5rem of page around the panel
    var ROOMY = { w: 544, h: 2000 }; // the size button's larger stop; the height is clamped to the window
    var SHORT_H = 430;           // below this the suggestions step aside entirely
    var STEP = 24;
    var PEEK_MS = 7000;
    var desktop = window.matchMedia ? window.matchMedia('(min-width: 481px)') : { matches: true };

    // ---- size ----
    var size = null;
    try { size = JSON.parse(window.localStorage.getItem(SIZE_KEY) || 'null'); } catch (error) { size = null; }

    function clamp(next) {
      var maxW = Math.max(MIN_W, (window.innerWidth || 1200) - MARGIN);
      var maxH = Math.max(MIN_H, (window.innerHeight || 800) - MARGIN);
      return { w: Math.round(Math.min(maxW, Math.max(MIN_W, next.w))), h: Math.round(Math.min(maxH, Math.max(MIN_H, next.h))) };
    }

    function pinnedToEnd() {
      return !messages || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
    }

    function applySize(next, remember) {
      var pinned = pinnedToEnd();
      size = next ? clamp(next) : null;
      if (size) {
        widget.style.setProperty('--juniper-shape-w', size.w + 'px');
        widget.style.setProperty('--juniper-shape-h', size.h + 'px');
      } else {
        widget.style.removeProperty('--juniper-shape-w');
        widget.style.removeProperty('--juniper-shape-h');
      }
      var height = size ? size.h : panel.offsetHeight;
      widget.classList.toggle('juniper-shape--short', Boolean(height) && height < SHORT_H);
      if (pinned && messages) messages.scrollTop = messages.scrollHeight;
      renderSizeButton();
      measureRail();
      if (!remember) return;
      try {
        if (size) window.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        else window.localStorage.removeItem(SIZE_KEY);
      } catch (error) { /* this page only */ }
    }

    function currentSize() {
      return size || { w: panel.offsetWidth || 404, h: panel.offsetHeight || 720 };
    }

    var grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'juniper-shape__grip';
    grip.setAttribute('data-juniper-grip', '');
    grip.setAttribute('aria-label', 'Resize the chat. Drag, or use the arrow keys. Double-click to reset.');
    grip.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 9L9 2M2 14L14 2" /></svg>';
    panel.appendChild(grip);

    var drag = null;
    grip.addEventListener('pointerdown', function (event) {
      if (!desktop.matches) return;
      var start = currentSize();
      drag = { x: event.clientX, y: event.clientY, w: start.w, h: start.h };
      widget.classList.add('juniper-shape--dragging');
      if (grip.setPointerCapture) { try { grip.setPointerCapture(event.pointerId); } catch (error) { /* no capture */ } }
      event.preventDefault();
    });
    grip.addEventListener('pointermove', function (event) {
      if (!drag) return;
      applySize({ w: drag.w + (drag.x - event.clientX), h: drag.h + (drag.y - event.clientY) }, false);
    });
    function endDrag() {
      if (!drag) return;
      drag = null;
      widget.classList.remove('juniper-shape--dragging');
      applySize(size, true);
    }
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('dblclick', function () { applySize(null, true); });
    grip.addEventListener('keydown', function (event) {
      var now = currentSize();
      var key = event.key;
      if (key === 'ArrowLeft') applySize({ w: now.w + STEP, h: now.h }, true);
      else if (key === 'ArrowRight') applySize({ w: now.w - STEP, h: now.h }, true);
      else if (key === 'ArrowUp') applySize({ w: now.w, h: now.h + STEP }, true);
      else if (key === 'ArrowDown') applySize({ w: now.w, h: now.h - STEP }, true);
      else if (key === 'Home') applySize(null, true);
      else return;
      event.preventDefault();
    });

    // The size button: the usual size, or as much room as the window gives.
    var sizeButton = document.createElement('button');
    sizeButton.type = 'button';
    sizeButton.className = 'ai-chat__icon-button juniper-shape__size';
    sizeButton.setAttribute('data-juniper-size', '');
    function isRoomy() {
      return Boolean(size) && size.w >= clamp(ROOMY).w - 1 && size.h >= clamp(ROOMY).h - 1;
    }
    function renderSizeButton() {
      var roomy = isRoomy();
      sizeButton.setAttribute('aria-label', roomy ? 'Back to the usual chat size' : 'Make the chat bigger');
      sizeButton.setAttribute('aria-pressed', roomy ? 'true' : 'false');
      sizeButton.innerHTML = roomy
        ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6" /></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6" /></svg>';
    }
    sizeButton.addEventListener('click', function () { applySize(isRoomy() ? null : ROOMY, true); });

    // ---- minimise: the header's one way out ----
    var closeButton = panel.querySelector('[data-ai-chat-close]');
    if (closeButton) {
      closeButton.setAttribute('aria-label', 'Minimise the chat. Juniper keeps your conversation.');
      closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>';
      if (closeButton.parentNode) closeButton.parentNode.insertBefore(sizeButton, closeButton);
    }

    // ---- a reply that lands while the chat is minimised ----
    var peek = document.createElement('button');
    peek.type = 'button';
    peek.className = 'juniper-shape__peek';
    peek.setAttribute('data-juniper-peek', '');
    peek.hidden = true;
    var dot = document.createElement('span');
    dot.className = 'juniper-shape__dot';
    dot.setAttribute('data-juniper-unread', '');
    dot.hidden = true;
    dot.innerHTML = '<span class="juniper-shape__sr">New message from Juniper</span>';
    widget.appendChild(peek);
    widget.appendChild(dot);
    var peekTimer = null;

    function hidePeek() {
      if (peekTimer) { window.clearTimeout(peekTimer); peekTimer = null; }
      peek.hidden = true;
    }

    function showPeek(text) {
      var line = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!line) return;
      peek.textContent = line;
      peek.setAttribute('aria-label', 'Juniper says: ' + line + '. Open the chat.');
      peek.hidden = false;
      dot.hidden = false;
      if (peekTimer) window.clearTimeout(peekTimer);
      peekTimer = window.setTimeout(hidePeek, PEEK_MS);
    }

    peek.addEventListener('click', function () { if (chat.open) chat.open(); });
    chat.on('reply', function (detail) {
      if (chat.isOpen && chat.isOpen()) return;
      showPeek(detail && detail.text);
    });
    chat.on('open', function () {
      hidePeek();
      dot.hidden = true;
      // A saved size is re-clamped to the window it opens in.
      if (size) applySize(size, false); else applySize(null, false);
    });
    chat.on('turn:start', hidePeek);

    // ---- the suggestion rail ----
    var row = elements.chips || panel.querySelector('[data-ai-chat-prompts]');
    var more = null;

    function measureRail() {
      if (!row || !more) return;
      var overflow = row.scrollWidth - row.clientWidth;
      var atEnd = overflow - row.scrollLeft < 4;
      row.classList.toggle('juniper-shape__rail--more', overflow > 4 && !atEnd);
      row.classList.toggle('juniper-shape__rail--before', row.scrollLeft > 4);
      more.hidden = !(overflow > 4 && !atEnd);
    }

    if (row && row.parentNode) {
      row.classList.add('juniper-shape__rail');
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'juniper-shape__more';
      more.setAttribute('data-juniper-more', '');
      more.setAttribute('aria-label', 'More suggestions');
      more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" /></svg>';
      more.hidden = true;
      // The rail gets a frame of its own, so the "more" button and the chips' leaving ghosts are placed against it.
      var host = document.createElement('div');
      host.className = 'juniper-shape__rail-host';
      row.parentNode.insertBefore(host, row);
      host.appendChild(row);
      host.appendChild(more);
      more.addEventListener('click', function () {
        var by = Math.max(120, row.clientWidth * 0.7);
        if (row.scrollBy) row.scrollBy({ left: by, behavior: 'smooth' }); else row.scrollLeft += by;
      });
      row.addEventListener('scroll', measureRail);
      // A mouse wheel has no sideways axis: turn its up-and-down into along-the-rail.
      row.addEventListener('wheel', function (event) {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) return;
        row.scrollLeft += event.deltaY;
        event.preventDefault();
      }, { passive: false });
      chat.on('chips', function () {
        row.scrollLeft = 0;
        window.setTimeout(measureRail, 0);
        window.setTimeout(measureRail, 700); // once the landing animation has settled
      });
    }

    window.addEventListener('resize', function () { if (size) applySize(size, false); else measureRail(); });

    chat.shape = {
      size: function () { return size; },
      resize: function (next) { applySize(next, true); },
      reset: function () { applySize(null, true); }
    };

    renderSizeButton();
    if (size) applySize(size, false);
    window.setTimeout(measureRail, 0);
  } catch (error) {
    if (window.console) window.console.error('[juniper-shape]', error);
  }
})();
