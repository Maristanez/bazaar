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
  // hands-free pill when V3 has drawn one. Never a recogniser without one.
  var EAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path class="juniper-keyword__ear-lobe" d="M8 17.5c0 2 1.4 3 3 3 3.4 0 2.6-4 5-6.2A5.6 5.6 0 1 0 6.4 10"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--one" d="M18.6 6.2q2.6 3.6 0 7.4"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--two" d="M21.2 4q4 5.8 0 11.8"/></svg>';

  function showEars() {
    hideEars();
    var elements = chat.elements || {};
    var header = elements.panel && elements.panel.querySelector('.ai-chat__header-actions');
    var hosts = [{ node: elements.launcher }, { node: header, first: true }];
    Array.prototype.forEach.call(document.querySelectorAll('[data-juniper-pill]'), function (pill) { hosts.push({ node: pill }); });
    hosts.forEach(function (host, index) {
      var node = host.node;
      if (!node) return;
      var ear = document.createElement('span');
      ear.className = 'juniper-keyword__ear';
      ear.id = 'juniper-keyword-ear-' + index;
      ear.setAttribute('role', 'img');
      ear.setAttribute('aria-label', EAR_LABEL);
      ear.title = EAR_LABEL;
      ear.innerHTML = EAR_SVG;
      if (host.first && node.firstChild) node.insertBefore(ear, node.firstChild); else node.appendChild(ear);
      if (!host.first && !node.getAttribute('aria-describedby')) {
        node.setAttribute('aria-describedby', ear.id);
        ear.setAttribute('data-juniper-keyword-describes', '');
      }
      ears.push(ear);
    });
  }

  function hideEars() {
    ears.forEach(function (ear) {
      var host = ear.parentNode;
      if (!host) return;
      if (ear.hasAttribute('data-juniper-keyword-describes') && host.getAttribute('aria-describedby') === ear.id) host.removeAttribute('aria-describedby');
      host.removeChild(ear);
    });
    ears = [];
  }

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
