// V8 the "Jarvis" keyword (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The word only OPENS the agent; the shopkeeper is still Juniper. The recogniser is armed on every page load unless
// the theme turns it off, the ear shows whenever a recogniser runs (and carries the disclosure), and what is heard is
// matched against KEYWORDS and dropped on the spot.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  // Tune on the demo laptop. Whole words only, any case. No ordinary words here ("service", "travis" stay out).
  var KEYWORDS = ['jarvis', 'hey jarvis', 'hi jarvis', 'jarvus', 'jervis', 'javis', 'jarves'];

  var EAR_LABEL = "Listening for 'Hey Jarvis' — Chrome's speech service hears the audio";
  var POPOVER_TEXT = "Listening for 'Hey Jarvis'. Chrome's speech service hears the audio.";
  var REARM_MS = 500;        // after hands-free, push-to-talk or a turn lets go of the microphone
  var RESTART_MS = 250;      // Chrome ends recognition by itself after silence
  var QUICK_END_MS = 300;    // an end this soon after a start is a failure, not silence
  var QUICK_ENDS = 3;        // this many in a row, then wait
  var BACKOFF_MS = 5000;
  var BACKOFF_CYCLES = 5;    // this many waits, then give up for this page
  var WAKE_FALLBACK_MS = 300;

  // Off by the theme's kill switch, and off when hands-free owns the microphone from the start ('always' is V1's).
  function killed() {
    var flags = window.BazaarChatFlags;
    return Boolean(flags && (flags.keyword === false || flags.autoListen === 'always'));
  }
  function Recognition() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

  var pattern = new RegExp('(^|[^a-z])(' + KEYWORDS.map(function (word) {
    return word.toLowerCase().replace(/[^a-z ]/g, '').replace(/ +/g, '[^a-z]+');
  }).join('|') + ')($|[^a-z])');
  function matches(text) { return pattern.test(String(text || '').toLowerCase()); }

  chat.keyword = { KEYWORDS: KEYWORDS, matches: matches, isArmed: function () { return Boolean(recogniser); } };

  if (killed() || !Recognition()) return;

  var enabled = true;        // false once the browser refused twice or the back-off ran out: off for this page
  var recogniser = null;     // non-null exactly while a recogniser runs
  var startedAt = 0;
  var timer = null;
  var wakeTimer = null;
  var waking = false;
  var voiceOn = false;
  var pushToTalk = false;
  var turnInFlight = false;
  var quickEnds = 0;
  var backoffs = 0;
  var ears = [];
  var retryUsed = false;     // a refusal is tried again once, on the first gesture
  var retryListening = false;

  function announce() {
    try { document.dispatchEvent(new CustomEvent('bazaar-keyword:state', { detail: { armed: Boolean(recogniser) } })); } catch (error) { /* no CustomEvent */ }
  }

  // The ear: on the launcher, in the panel's header (the launcher hides while the panel is open), and on the
  // hands-free pill when V3 has drawn one. Never a recogniser without one. Each ear is a real button — there is
  // no toggle any more, so the only way to reach the disclosure without a mouse hover is to make the ear itself
  // focusable and tappable. The launcher is already a button, and a button cannot contain another button (invalid
  // markup, and screen readers do not reliably expose a focusable thing nested inside one), so the launcher's ear
  // is not a DOM child of the launcher: it is mounted as a sibling on `elements.widget`, a die-cut badge pinned to
  // the launcher's corner (the two share exactly the same box while the panel is closed), and only described-by
  // the launcher through `aria-describedby`. It is hidden by CSS, not removed, once the panel opens — the header's
  // own ear takes over there.
  var EAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path class="juniper-keyword__ear-lobe" d="M8 17.5c0 2 1.4 3 3 3 3.4 0 2.6-4 5-6.2A5.6 5.6 0 1 0 6.4 10"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--one" d="M18.6 6.2q2.6 3.6 0 7.4"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--two" d="M21.2 4q4 5.8 0 11.8"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var openPopover = null;    // the one disclosure showing, if any — a popover is a fact, never a control

  function closePopover() {
    if (!openPopover) return;
    var entry = openPopover;
    openPopover = null;
    entry.popover.hidden = true;
    entry.ear.setAttribute('aria-expanded', 'false');
  }

  function openPopoverFor(entry) {
    if (openPopover === entry) return;
    closePopover();
    entry.popover.hidden = false;
    entry.ear.setAttribute('aria-expanded', 'true');
    openPopover = entry;
  }

  function showEars() {
    hideEars();
    var elements = chat.elements || {};
    var widget = elements.widget;
    var header = elements.panel && elements.panel.querySelector('.ai-chat__header-actions');
    var hosts = [
      { describes: elements.launcher, mount: widget, corner: true, up: true },
      { describes: header, mount: header, first: true }
    ];
    Array.prototype.forEach.call(document.querySelectorAll('[data-juniper-pill]'), function (pill) {
      hosts.push({ describes: pill, mount: pill, up: true });
    });
    hosts.forEach(function (host, index) {
      var mount = host.mount;
      var describes = host.describes;
      if (!mount || !describes || !widget) return;
      var earId = 'juniper-keyword-ear-' + index;
      var popId = earId + '-pop';

      var wrap = document.createElement('span');
      wrap.className = 'juniper-keyword__ear-wrap' +
        (host.corner ? ' juniper-keyword__ear-wrap--corner' : '') +
        (host.up ? ' juniper-keyword__ear-wrap--up' : '');

      var ear = document.createElement('button');
      ear.type = 'button';
      ear.className = 'juniper-keyword__ear';
      ear.id = earId;
      ear.setAttribute('aria-label', EAR_LABEL);
      ear.setAttribute('aria-haspopup', 'true');
      ear.setAttribute('aria-expanded', 'false');
      ear.setAttribute('aria-controls', popId);
      ear.title = EAR_LABEL;
      ear.innerHTML = EAR_SVG;

      var popover = document.createElement('div');
      popover.className = 'juniper-keyword__popover';
      popover.id = popId;
      popover.setAttribute('role', 'status');
      popover.hidden = true;
      popover.innerHTML = '<p>' + POPOVER_TEXT + '</p>' +
        '<button type="button" class="juniper-keyword__popover-close" aria-label="Close">' + CLOSE_SVG + '</button>';

      wrap.appendChild(ear);
      wrap.appendChild(popover);
      if (host.first && mount.firstChild) mount.insertBefore(wrap, mount.firstChild); else mount.appendChild(wrap);

      var describesAlready = Boolean(describes.getAttribute('aria-describedby'));
      if (!describesAlready) describes.setAttribute('aria-describedby', earId);

      var entry = { wrap: wrap, ear: ear, popover: popover, host: describes, wroteDescribedby: !describesAlready };
      ear.addEventListener('click', function (event) {
        event.stopPropagation();
        if (openPopover === entry) closePopover(); else openPopoverFor(entry);
      });
      popover.querySelector('.juniper-keyword__popover-close').addEventListener('click', function (event) {
        event.stopPropagation();
        closePopover();
        try { ear.focus(); } catch (error) { /* nothing to return focus to */ }
      });

      ears.push(entry);
    });
  }

  function hideEars() {
    ears.forEach(function (entry) {
      if (openPopover === entry) closePopover();
      var host = entry.host;
      if (entry.wroteDescribedby && host && host.getAttribute('aria-describedby') === entry.ear.id) host.removeAttribute('aria-describedby');
      var wrap = entry.wrap;
      if (wrap && wrap.contains(document.activeElement) && host && host.focus) { try { host.focus(); } catch (error) { /* not focusable */ } }
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });
    ears = [];
  }

  // Dismiss on Escape or a click elsewhere. Hands-free is always off while any ear exists (see `wanted()`), so
  // this never fights V1's own Escape handler for the microphone.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && openPopover) { var entry = openPopover; closePopover(); try { entry.ear.focus(); } catch (error) { /* fine */ } }
  });
  document.addEventListener('click', function (event) {
    if (!openPopover) return;
    var target = event.target;
    if (openPopover.wrap && openPopover.wrap.contains(target)) return;
    closePopover();
  });

  // An open panel alone does not stop the listening: only hands-free, push-to-talk, a turn in flight or a hidden tab.
  function wanted() {
    return enabled && !killed() && !waking && !voiceOn && !pushToTalk && !turnInFlight && !document.hidden && Boolean(Recognition());
  }

  function clearTimer() { if (timer) { window.clearTimeout(timer); timer = null; } }

  // The one place that decides whether a recogniser should be running right now.
  function sync(delay) {
    if (!wanted()) {
      clearTimer();
      stopRecogniser();
      return;
    }
    if (recogniser || timer) return;
    timer = window.setTimeout(function () {
      timer = null;
      if (wanted() && !recogniser) startRecogniser();
    }, delay || 0);
  }

  function startRecogniser() {
    var Ctor = Recognition();
    var mine;
    try {
      mine = new Ctor();
      mine.continuous = true;
      mine.interimResults = true;
      mine.lang = 'en-US';
      try { mine.maxAlternatives = 3; } catch (error) { /* optional */ }
      mine.onresult = function (event) { if (recogniser === mine) onResult(event); };
      mine.onerror = function (event) { if (recogniser === mine) onError(event); };
      mine.onend = function () { if (recogniser === mine) onEnd(); };
      recogniser = mine;
      startedAt = Date.now();
      mine.start();
    } catch (error) {
      if (recogniser === mine) { recogniser = null; onStopped(); }
      refused();
      return;
    }
    if (recogniser === mine) { showEars(); announce(); }
  }

  function stopRecogniser() {
    var mine = recogniser;
    if (!mine) return;
    recogniser = null;
    mine.onresult = null;
    try { if (mine.abort) mine.abort(); else mine.stop(); } catch (error) { /* already ended */ }
    onStopped();
  }

  function onStopped() { hideEars(); announce(); }

  // Only the yes/no of the match leaves this function. The transcript is never stored, logged, sent or shown.
  function onResult(event) {
    var results = event && event.results;
    if (!results) return;
    for (var i = event.resultIndex || 0; i < results.length; i += 1) {
      var result = results[i];
      for (var j = 0; result && j < result.length; j += 1) {
        if (result[j] && matches(result[j].transcript)) { wake(); return; }
      }
    }
  }

  function onError(event) {
    var code = event && event.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') refused();
  }

  // The browser said no. Stay quiet; one more try on the first gesture, then off for this page.
  function refused() {
    enabled = false;
    quickEnds = 0;
    backoffs = 0;
    sync();
    if (retryUsed || retryListening) return;
    retryListening = true;
    document.addEventListener('click', retryOnGesture, false);
    document.addEventListener('keydown', retryOnGesture, false);
  }

  function retryOnGesture() {
    document.removeEventListener('click', retryOnGesture, false);
    document.removeEventListener('keydown', retryOnGesture, false);
    retryListening = false;
    if (retryUsed) return;
    retryUsed = true;
    enabled = true;
    sync();
  }

  function onEnd() {
    recogniser = null;
    onStopped();
    if (waking) { finishWake(); return; }
    if (!enabled) return;
    if (Date.now() - startedAt < QUICK_END_MS) { countQuickEnd(); return; }
    quickEnds = 0;
    backoffs = 0;
    sync(RESTART_MS);
  }

  function countQuickEnd() {
    quickEnds += 1;
    if (quickEnds < QUICK_ENDS) { sync(RESTART_MS); return; }
    quickEnds = 0;
    backoffs += 1;
    if (backoffs >= BACKOFF_CYCLES) { enabled = false; sync(); return; }
    sync(BACKOFF_MS);
  }

  // Heard the word: let go of the microphone first, then open the agent. What followed the word is not forwarded.
  function wake() {
    if (waking) return;
    waking = true;
    clearTimer();
    var mine = recogniser;
    if (!mine) { finishWake(); return; }
    mine.onresult = null;
    wakeTimer = window.setTimeout(function () {
      if (recogniser === mine) { recogniser = null; onStopped(); }
      finishWake();
    }, WAKE_FALLBACK_MS);
    try { if (mine.abort) mine.abort(); else mine.stop(); } catch (error) { /* onend or the fallback finishes it */ }
  }

  // The panel opens where the shopper can see it, then hands-free takes the microphone if it is there.
  function finishWake() {
    if (!waking) return;
    if (wakeTimer) { window.clearTimeout(wakeTimer); wakeTimer = null; }
    quickEnds = 0;
    backoffs = 0;
    try { chat.open(); } catch (error) { /* the chat stays as it was */ }
    try {
      if (chat.handsfree && typeof chat.handsfree.start === 'function') chat.handsfree.start();
    } catch (error) { /* the panel is open; the shopper can type */ }
    waking = false;
    sync(REARM_MS);
  }

  try {
    document.addEventListener('bazaar-voice:state', function (event) {
      var on = Boolean(event && event.detail && event.detail.on);
      if (on === voiceOn) return;
      voiceOn = on;
      sync(REARM_MS);
    });
    document.addEventListener('visibilitychange', function () { sync(RESTART_MS); });
    chat.on('mood', function (detail) {
      var recording = Boolean(detail && detail.mood === 'listening');
      if (recording === pushToTalk) return;
      pushToTalk = recording;
      sync(REARM_MS);
    });
    chat.on('turn:start', function () { turnInFlight = true; sync(); });
    // speak:end follows every reply, spoken or not, so Juniper's own voice is never listened to.
    chat.on('speak:end', function () { turnInFlight = false; sync(REARM_MS); });
    chat.on('turn:error', function () { turnInFlight = false; sync(REARM_MS); });

    // Hands-free restores itself on load when its flag is set (V1); give it the microphone first.
    var restoring = false;
    try { restoring = window.sessionStorage.getItem('bazaar:handsfree') === '1'; } catch (error) { /* storage blocked */ }
    sync(restoring ? 1500 : 0);
  } catch (error) {
    if (window.console) window.console.error('[juniper-keyword]', error);
  }
})();
