// V8 the "Jarvis" keyword (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The word only OPENS hands-free; the shopkeeper is still Juniper. Nothing listens before the shopper's own click,
// the ear shows whenever a recogniser runs, and what is heard is matched against KEYWORDS and dropped on the spot.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  // Tune on the demo laptop. Whole words only, any case. No ordinary words here ("service", "travis" stay out).
  var KEYWORDS = ['jarvis', 'hey jarvis', 'hi jarvis', 'jarvus', 'jervis', 'javis', 'jarves'];

  var STORAGE_KEY = 'bazaar:keyword';
  var EAR_LABEL = "Listening for 'Jarvis'";
  var REARM_MS = 500;        // after hands-free, push-to-talk or the panel lets go of the microphone
  var RESTART_MS = 250;      // Chrome ends recognition by itself after silence
  var QUICK_END_MS = 300;    // an end this soon after a start is a failure, not silence
  var QUICK_ENDS = 3;        // this many in a row, then wait
  var BACKOFF_MS = 5000;
  var BACKOFF_CYCLES = 5;    // this many waits, then give up for this page
  var WAKE_FALLBACK_MS = 300;

  function killed() { return Boolean(window.BazaarChatFlags && window.BazaarChatFlags.keyword === false); }
  function Recognition() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

  var pattern = new RegExp('(^|[^a-z])(' + KEYWORDS.map(function (word) {
    return word.toLowerCase().replace(/[^a-z ]/g, '').replace(/ +/g, '[^a-z]+');
  }).join('|') + ')($|[^a-z])');
  function matches(text) { return pattern.test(String(text || '').toLowerCase()); }

  chat.keyword = { KEYWORDS: KEYWORDS, matches: matches, isArmed: function () { return Boolean(recogniser); } };

  if (killed() || !Recognition()) return;

  var optedIn = false;
  var recogniser = null;     // non-null exactly while a recogniser runs
  var startedAt = 0;
  var timer = null;
  var wakeTimer = null;
  var waking = false;
  var voiceOn = false;
  var pushToTalk = false;
  var quickEnds = 0;
  var backoffs = 0;
  var ears = [];
  var control = null;

  function readOptIn() { try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (error) { return false; } }
  function writeOptIn(on) {
    try {
      if (on) window.localStorage.setItem(STORAGE_KEY, '1');
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) { /* storage blocked: the choice lasts this page */ }
  }

  function announce() {
    try { document.dispatchEvent(new CustomEvent('bazaar-keyword:state', { detail: { armed: Boolean(recogniser), optedIn: optedIn } })); } catch (error) { /* no CustomEvent */ }
  }

  // The ear: on the launcher, and on the hands-free pill when V3 has drawn one.
  var EAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path class="juniper-keyword__ear-lobe" d="M8 17.5c0 2 1.4 3 3 3 3.4 0 2.6-4 5-6.2A5.6 5.6 0 1 0 6.4 10"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--one" d="M18.6 6.2q2.6 3.6 0 7.4"/>' +
    '<path class="juniper-keyword__ear-beat juniper-keyword__ear-beat--two" d="M21.2 4q4 5.8 0 11.8"/></svg>';

  function showEars() {
    hideEars();
    var hosts = [chat.elements && chat.elements.launcher];
    Array.prototype.forEach.call(document.querySelectorAll('[data-juniper-pill]'), function (pill) { hosts.push(pill); });
    hosts.forEach(function (host, index) {
      if (!host) return;
      var ear = document.createElement('span');
      ear.className = 'juniper-keyword__ear';
      ear.id = 'juniper-keyword-ear-' + index;
      ear.setAttribute('role', 'img');
      ear.setAttribute('aria-label', EAR_LABEL);
      ear.title = EAR_LABEL;
      ear.innerHTML = EAR_SVG;
      host.appendChild(ear);
      if (!host.getAttribute('aria-describedby')) {
        host.setAttribute('aria-describedby', ear.id);
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

  function wanted() {
    return optedIn && !killed() && !waking && !voiceOn && !pushToTalk && !document.hidden && !chat.isOpen() && Boolean(Recognition());
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
      if (recogniser === mine) { recogniser = null; onStopped(); countQuickEnd(); }
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
    if (code === 'not-allowed' || code === 'service-not-allowed') disarm(true);
  }

  function onEnd() {
    recogniser = null;
    onStopped();
    if (waking) { finishWake(); return; }
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
    if (backoffs >= BACKOFF_CYCLES) { disarm(false); return; }
    sync(BACKOFF_MS);
  }

  // Heard the word: let go of the microphone first, then hand over. What followed the word is not forwarded.
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

  function finishWake() {
    if (!waking) return;
    if (wakeTimer) { window.clearTimeout(wakeTimer); wakeTimer = null; }
    waking = false;
    quickEnds = 0;
    backoffs = 0;
    try {
      if (chat.handsfree && typeof chat.handsfree.start === 'function') chat.handsfree.start();
      else chat.open();
    } catch (error) {
      try { chat.open(); } catch (ignored) { /* the chat stays as it was */ }
    }
    sync(REARM_MS);
  }

  // forget = the browser refused the microphone, so the remembered choice goes too. Otherwise only this page gives up.
  function disarm(forget) {
    optedIn = false;
    if (forget) writeOptIn(false);
    quickEnds = 0;
    backoffs = 0;
    sync();
    renderControl();
    announce();
  }

  function optIn() {
    optedIn = true;
    writeOptIn(true);
    quickEnds = 0;
    backoffs = 0;
    renderControl();
    announce();
    // Ask for the microphone inside the click, so the browser's prompt arrives where the shopper asked for it.
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          stream.getTracks().forEach(function (track) { track.stop(); });
          sync();
        }, function () { disarm(true); });
        return;
      }
    } catch (error) { /* fall through: the recogniser asks when it first starts */ }
    sync();
  }

  function renderControl() {
    if (!control) return;
    control.innerHTML = optedIn
      ? '<p class="juniper-keyword__line"><span class="juniper-keyword__status">Hey Jarvis is on</span>' +
        '<span aria-hidden="true"> · </span><button type="button" class="juniper-keyword__toggle" data-juniper-keyword-toggle aria-pressed="true">Turn off</button></p>'
      : '<p class="juniper-keyword__line"><button type="button" class="juniper-keyword__toggle" data-juniper-keyword-toggle aria-pressed="false">Turn on Hey Jarvis</button></p>' +
        '<p class="juniper-keyword__note">Say "Jarvis" and Juniper starts listening, hands-free. While the chat is closed your browser listens for that one word, and Chrome\'s speech service hears the audio. Turn it off here any time.</p>';
  }

  function mountControl() {
    var panel = chat.elements && chat.elements.panel;
    var home = (panel && panel.querySelector('.ai-chat__foot')) || panel || (chat.elements && chat.elements.widget);
    if (!home) return;
    control = document.createElement('div');
    control.className = 'juniper-keyword__control';
    control.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest || !target.closest('[data-juniper-keyword-toggle]')) return;
      if (optedIn) disarm(true); else optIn();
    });
    home.appendChild(control);
    renderControl();
  }

  try {
    optedIn = readOptIn();
    mountControl();

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
    chat.on('open', function () { sync(); });
    chat.on('close', function () { sync(REARM_MS); });

    // Hands-free restores itself on load when its flag is set (V1); give it the microphone first.
    var restoring = false;
    try { restoring = window.sessionStorage.getItem('bazaar:handsfree') === '1'; } catch (error) { /* storage blocked */ }
    sync(restoring ? 1500 : 0);
  } catch (error) {
    if (window.console) window.console.error('[juniper-keyword]', error);
  }
})();
