// V3 open / close motion and the voice pill (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The motion itself is all in juniper-motion.css (@starting-style + allow-discrete on the panel's `hidden`), so
// there is no timing here. This file owns the pill: what stands in the launcher's place while the chat is closed
// and hands-free is still on.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  try {
    var elements = chat.elements || {};
    var widget = elements.widget;
    var launcher = elements.launcher;
    if (!widget || !launcher || !document.createElement) return;

    var STATE_WORDS = { listening: 'Listening', hearing: 'Listening', thinking: 'Thinking', speaking: 'Juniper is speaking' };
    var CAPTION_HARD_CAP = 400; // a sanity bound only — the CSS (direction: rtl) shows the true tail at any length up to this
    var voiceOn = false;
    var voiceState = 'off';
    var captionText = '';

    var pill = document.createElement('div');
    pill.className = 'juniper-motion__pill';
    pill.setAttribute('data-juniper-pill', '');
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', 'Juniper, hands-free');
    pill.hidden = true;
    pill.innerHTML =
      '<button class="juniper-motion__pill-open" type="button" data-juniper-pill-open aria-controls="ai-chat-panel">' +
        '<span class="juniper-motion__halo" aria-hidden="true">' +
          '<span class="ai-chat__sticker juniper-motion__head" data-juniper-pill-head></span>' +
        '</span>' +
        '<span class="juniper-motion__text" data-juniper-pill-text aria-live="off"></span>' +
      '</button>' +
      '<button class="juniper-motion__pill-stop" type="button" data-juniper-pill-stop aria-label="Stop hands-free"><i></i></button>';
    var openButton = pill.querySelector('[data-juniper-pill-open]');
    var stopButton = pill.querySelector('[data-juniper-pill-stop]');
    var head = pill.querySelector('[data-juniper-pill-head]');
    var textBox = pill.querySelector('[data-juniper-pill-text]');

    function currentMood() {
      try { return (chat.state && chat.state().mood) || 'idle'; } catch (error) { return 'idle'; }
    }

    function drawHead(mood) {
      if (chat.stickerSvg) head.innerHTML = chat.stickerSvg(mood || 'idle');
    }

    // A live caption matters at its end, not its start. The visible clipping is CSS's job (.juniper-motion__text
    // is `direction: rtl` so the browser's own ellipsis eats the FRONT of the line) — no fixed character count
    // here can predict what fits 13rem across fonts, weights and zoom, and a wrong guess used to hide the very
    // last words a shorter guess left room for. This only guards against an unbounded string.
    function tail(text) {
      var clean = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (clean.length <= CAPTION_HARD_CAP) return clean;
      var cut = clean.slice(clean.length - CAPTION_HARD_CAP);
      var space = cut.indexOf(' ');
      if (space > -1 && space < cut.length - 1) cut = cut.slice(space + 1);
      return cut;
    }

    function shopperIsSpeaking() {
      return voiceState === 'hearing' || voiceState === 'listening';
    }

    function render() {
      var word = STATE_WORDS[voiceState] || 'Listening';
      var showPill = voiceOn && !(chat.isOpen && chat.isOpen());
      textBox.textContent = captionText && shopperIsSpeaking() ? captionText : word;
      pill.setAttribute('data-state', voiceState);
      openButton.setAttribute('aria-label', word + '. Open the chat with Juniper');
      if (chat.flags) chat.flags.voiceStaysOnClose = voiceOn;
      pill.hidden = !showPill;
      launcher.hidden = showPill;
    }

    function setVoice(on, state) {
      voiceOn = Boolean(on);
      voiceState = voiceOn ? (STATE_WORDS[state] ? state : 'listening') : 'off';
      if (!shopperIsSpeaking()) captionText = '';
      render();
    }

    function handsfreeIsOn() {
      try { return Boolean(chat.handsfree && chat.handsfree.isOn && chat.handsfree.isOn()); } catch (error) { return false; }
    }

    pill.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('[data-juniper-pill-stop]')) return;
      if (chat.open) chat.open();
    });

    stopButton.addEventListener('click', function () {
      try { if (chat.handsfree && chat.handsfree.stop) chat.handsfree.stop(); } catch (error) { /* the pill still lets go below */ }
      // Hands-free normally answers with bazaar-voice:state off. If nobody owns it, let go of the pill ourselves.
      if (voiceOn && !handsfreeIsOn()) setVoice(false, 'off');
      if (pill.hidden && launcher.focus) launcher.focus();
    });

    document.addEventListener('bazaar-voice:state', function (event) {
      var detail = (event && event.detail) || {};
      var hadFocus = pill.contains(document.activeElement);
      setVoice(detail.on, detail.state);
      if (hadFocus && pill.hidden && !launcher.hidden && launcher.focus) launcher.focus();
    });

    document.addEventListener('bazaar-voice:caption', function (event) {
      var detail = (event && event.detail) || {};
      captionText = tail(detail.text);
      render();
    });

    chat.on('mood', function (detail) { drawHead(detail && detail.mood); });

    chat.on('open', function () {
      // The first open arms the launcher's return animation, so it never plays on page load.
      widget.classList.add('juniper-motion--live');
      render();
    });

    chat.on('close', function () {
      // A missed state event must not strand the shopper with a live mic and no pill.
      if (!voiceOn && handsfreeIsOn()) setVoice(true, 'listening');
      else render();
      // The chat hands focus to the launcher on close; when the pill stands in for it, the pill takes the focus.
      if (!pill.hidden && openButton.focus) openButton.focus();
    });

    drawHead(currentMood());
    widget.appendChild(pill);
    if (handsfreeIsOn()) setVoice(true, 'listening');
    else render();
  } catch (error) {
    if (window.console) window.console.error('[juniper-motion]', error);
  }
})();
