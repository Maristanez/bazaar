// V12 the chat keeps its shape out of the conversation's way (docs/PLAN.md). Talks to the chat only through
// window.BazaarChat. Three jobs, one aim — the messages get the room:
//   size     — the shopper drags the panel's top-left corner (it is anchored bottom-right) or taps the size button;
//              it stays a chat, never a page: there is a widest it goes. Phones keep the full-screen sheet.
//   place    — the shopper drags the header to move the panel off whatever it covers. Only the open panel moves:
//              Juniper's resting spot, the launcher's corner, never does, and minimising folds the chat back to it.
//              Size and place are remembered for this browser.
//   minimise — the header's one way out folds the chat down to Juniper's launcher or voice pill. Nothing ends: the
//              conversation and hands-free carry on, a reply that lands meanwhile peeks above her and leaves a dot.
//   herself  — Juniper reshapes her own panel to fit the moment: it grows when she lays an offer card down and draws
//              in while the shopper is only talking. Each change is traced round the panel's edge and said in a
//              line, and it stops for good the moment the shopper picks a size of their own.
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
    var MAX_W = 560;             // wider than this and the lines of a chat stop reading as a chat
    var MAX_H = 860;             // taller than this and the header drifts out of reach of the foot
    var SHAPES = {               // the forms Juniper gives herself
      deal: { w: 480, h: 820, note: 'Juniper made room for your offer' },
      voice: { w: 376, h: 480, note: 'Juniper drew in to listen' }
    };
    var NOTE_MS = 2600;
    var MARGIN = 40;             // critical.css keeps 2.5rem of page around the panel
    var ROOMY = { w: MAX_W, h: 2000 }; // the size button's larger stop; the height is clamped to the window
    var SHORT_H = 430;           // below this the suggestions step aside entirely
    var STEP = 24;
    var PEEK_MS = 7000;
    var desktop = window.matchMedia ? window.matchMedia('(min-width: 481px)') : { matches: true };

    // ---- size ----
    var size = null;
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(SIZE_KEY) || 'null'); } catch (error) { saved = null; }
    if (saved && saved.w && saved.h) size = { w: saved.w, h: saved.h };

    function clamp(next) {
      var maxW = Math.max(MIN_W, Math.min(MAX_W, (window.innerWidth || 1200) - MARGIN));
      var maxH = Math.max(MIN_H, Math.min(MAX_H, (window.innerHeight || 800) - MARGIN));
      return { w: Math.round(Math.min(maxW, Math.max(MIN_W, next.w))), h: Math.round(Math.min(maxH, Math.max(MIN_H, next.h))) };
    }

    // How far the open panel sits from its resting corner: never positive (it rests bottom-right), never off-screen.
    var place = { x: 0, y: 0 };
    if (saved && (saved.x || saved.y)) place = { x: Number(saved.x) || 0, y: Number(saved.y) || 0 };

    function clampPlace(next, box) {
      var roomX = Math.max(0, (window.innerWidth || 1200) - MARGIN - box.w);
      var roomY = Math.max(0, (window.innerHeight || 800) - MARGIN - box.h);
      return { x: Math.round(Math.min(0, Math.max(-roomX, next.x))), y: Math.round(Math.min(0, Math.max(-roomY, next.y))) };
    }

    function applyPlace(next, remember) {
      place = desktop.matches ? clampPlace(next || { x: 0, y: 0 }, currentSize()) : { x: 0, y: 0 };
      widget.style.setProperty('--juniper-shape-x', place.x + 'px');
      widget.style.setProperty('--juniper-shape-y', place.y + 'px');
      widget.classList.toggle('juniper-shape--moved', Boolean(place.x || place.y));
      if (remember) save();
    }

    function save() {
      try {
        if (!size && !place.x && !place.y) { window.localStorage.removeItem(SIZE_KEY); return; }
        var box = (size && !selfShaped) ? size : {};
        if (!box.w && !place.x && !place.y) { window.localStorage.removeItem(SIZE_KEY); return; }
        window.localStorage.setItem(SIZE_KEY, JSON.stringify({ w: box.w, h: box.h, x: place.x, y: place.y }));
      } catch (error) { /* this page only */ }
    }

    function pinnedToEnd() {
      return !messages || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 24;
    }

    var selfShaped = false;      // true while the size on show is one Juniper chose, not the shopper

    function applySize(next, remember) {
      var pinned = pinnedToEnd();
      if (remember) { selfShaped = false; widget.removeAttribute('data-juniper-shape'); }
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
      applyPlace(place, false); // a bigger panel may no longer fit where it was put
      if (remember) save();
    }

    function currentSize() {
      return size || { w: panel.offsetWidth || 376, h: panel.offsetHeight || 576 };
    }

    var grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'juniper-shape__grip';
    grip.setAttribute('data-juniper-grip', '');
    grip.setAttribute('aria-label', 'Resize the chat. Drag, or use the arrow keys; Shift and an arrow moves it. Double-click to reset.');
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
    grip.addEventListener('dblclick', function () { place = { x: 0, y: 0 }; applySize(null, true); });
    grip.addEventListener('keydown', function (event) {
      var now = currentSize();
      var key = event.key;
      // Shift and an arrow moves the panel; an arrow alone resizes it.
      if (event.shiftKey && key === 'ArrowLeft') applyPlace({ x: place.x - STEP, y: place.y }, true);
      else if (event.shiftKey && key === 'ArrowRight') applyPlace({ x: place.x + STEP, y: place.y }, true);
      else if (event.shiftKey && key === 'ArrowUp') applyPlace({ x: place.x, y: place.y - STEP }, true);
      else if (event.shiftKey && key === 'ArrowDown') applyPlace({ x: place.x, y: place.y + STEP }, true);
      else if (key === 'ArrowLeft') applySize({ w: now.w + STEP, h: now.h }, true);
      else if (key === 'ArrowRight') applySize({ w: now.w - STEP, h: now.h }, true);
      else if (key === 'ArrowUp') applySize({ w: now.w, h: now.h + STEP }, true);
      else if (key === 'ArrowDown') applySize({ w: now.w, h: now.h - STEP }, true);
      else if (key === 'Home') { place = { x: 0, y: 0 }; applySize(null, true); }
      else return;
      event.preventDefault();
    });

    // ---- place: the header is the handle ----
    var header = panel.querySelector('.ai-chat__header');
    var move = null;
    if (header) {
      header.setAttribute('data-juniper-move', '');
      header.addEventListener('pointerdown', function (event) {
        if (!desktop.matches || event.button > 0) return;
        if (event.target && event.target.closest && event.target.closest('button, a, input')) return;
        move = { x: event.clientX, y: event.clientY, px: place.x, py: place.y };
        widget.classList.add('juniper-shape--moving');
        if (header.setPointerCapture) { try { header.setPointerCapture(event.pointerId); } catch (error) { /* no capture */ } }
        event.preventDefault();
      });
      header.addEventListener('pointermove', function (event) {
        if (move) applyPlace({ x: move.px + (event.clientX - move.x), y: move.py + (event.clientY - move.y) }, false);
      });
      var endMove = function () {
        if (!move) return;
        move = null;
        widget.classList.remove('juniper-shape--moving');
        save();
      };
      header.addEventListener('pointerup', endMove);
      header.addEventListener('pointercancel', endMove);
    }

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

    // ---- herself: Juniper picks her own form, until the shopper picks one ----
    var note = document.createElement('p');
    note.className = 'juniper-shape__note';
    note.setAttribute('aria-hidden', 'true');
    note.hidden = true;
    panel.appendChild(note);
    var noteTimer = null;
    var hasCard = false;

    function trace(text) {
      widget.classList.remove('juniper-shape--tracing');
      void panel.offsetWidth; // restart the sweep
      widget.classList.add('juniper-shape--tracing');
      note.textContent = text || '';
      var bar = panel.querySelector('.ai-chat__header');
      if (bar && bar.offsetHeight) note.style.top = (bar.offsetHeight + 10) + 'px'; // the header grows a line when narrow
      note.hidden = !text;
      if (noteTimer) window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(function () {
        note.hidden = true;
        widget.classList.remove('juniper-shape--tracing');
      }, NOTE_MS);
    }

    function shapeHerself(name) {
      if (!desktop.matches || (size && !selfShaped)) return;   // the shopper's own size always wins
      if ((widget.getAttribute('data-juniper-shape') || '') === (name || '')) return;
      var shape = name ? SHAPES[name] : null;
      selfShaped = Boolean(shape);
      applySize(shape ? { w: shape.w, h: shape.h } : null, false);
      if (shape) widget.setAttribute('data-juniper-shape', name); else widget.removeAttribute('data-juniper-shape');
      if (chat.isOpen && chat.isOpen()) trace(shape ? shape.note : 'Juniper is back to her usual size');
    }

    chat.on('card', function () { hasCard = true; shapeHerself('deal'); });
    document.addEventListener('bazaar-voice:state', function (event) {
      var on = Boolean(event && event.detail && event.detail.on);
      if (hasCard) return;
      if (on) shapeHerself('voice');
      else if (widget.getAttribute('data-juniper-shape') === 'voice') shapeHerself(null);
    });

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

    // who: 'juniper' (her line; leaves the unread dot) or 'you' (the shopper's own words as they are heard).
    function showPeek(text, who) {
      var line = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!line) return;
      var mine = who === 'you';
      peek.textContent = line;
      peek.setAttribute('data-juniper-peek', mine ? 'you' : 'juniper');
      peek.setAttribute('aria-label', (mine ? 'You said: ' : 'Juniper says: ') + line + '. Open the chat.');
      peek.hidden = false;
      if (!mine) dot.hidden = false;
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
    // Closed, the conversation is still read: the shopper's words as they are heard and sent, then her answer.
    chat.on('turn:start', function (detail) {
      if (chat.isOpen && chat.isOpen()) { hidePeek(); return; }
      showPeek(detail && detail.text, 'you');
    });
    document.addEventListener('bazaar-voice:caption', function (event) {
      if (chat.isOpen && chat.isOpen()) return;
      var heard = event && event.detail && event.detail.text;
      if (heard) showPeek(heard, 'you');
    });

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

    window.addEventListener('resize', function () { if (size) applySize(size, false); else { applyPlace(place, false); measureRail(); } });

    chat.shape = {
      // Other features say a line above the launcher or pill while the chat is minimised (V13's chores do).
      peek: function (text) { if (!(chat.isOpen && chat.isOpen())) showPeek(text); },
      size: function () { return size; },
      shapedBy: function () { return size ? (selfShaped ? 'juniper' : 'shopper') : 'default'; },
      place: function () { return { x: place.x, y: place.y }; },
      resize: function (next) { applySize(next, true); },
      move: function (next) { applyPlace(next, true); },
      reset: function () { place = { x: 0, y: 0 }; applySize(null, true); }
    };

    renderSizeButton();
    if (size) applySize(size, false); else applyPlace(place, false);
    window.setTimeout(measureRail, 0);
  } catch (error) {
    if (window.console) window.console.error('[juniper-shape]', error);
  }
})();
