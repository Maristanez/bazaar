// V8 the "Jarvis" keyword (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The word only OPENS hands-free; the shopkeeper is still Juniper. Nothing listens before the shopper's own click,
// the ear shows whenever a recogniser runs, and what is heard is matched against KEYWORDS and dropped on the spot.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  // Tune on the demo laptop. Whole words only, any case. No ordinary words here ("service", "travis" stay out).
  var KEYWORDS = ['jarvis', 'hey jarvis', 'hi jarvis', 'jarvus', 'jervis', 'javis', 'jarves'];

  var STORAGE_KEY = 'bazaar:keyword';
  var SESSION_OFF_KEY = 'bazaar:keyword:off';   // the shopper said Turn off: no auto-arm again this session
  var EAR_LABEL = "Listening for 'Jarvis'";
  var REARM_MS = 500;        // after hands-free, push-to-talk or the panel lets go of the microphone
  var RESTART_MS = 250;      // Chrome ends recognition by itself after silence
  var QUICK_END_MS = 300;    // an end this soon after a start is a failure, not silence
  var QUICK_ENDS = 3;        // this many in a row, then wait
  var BACKOFF_MS = 5000;
  var BACKOFF_CYCLES = 5;    // this many waits, then give up for this page
  var WAKE_FALLBACK_MS = 300;

  function killed() { return Boolean(window.BazaarChatFlags && window.BazaarChatFlags.keyword === false); }
  // The owner's theme setting: arm on page load without the shopper's click. 'always' belongs to hands-free (V1).
  function autoMode() { return Boolean(window.BazaarChatFlags && window.BazaarChatFlags.autoListen === 'keyword'); }
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
  var viaAuto = false;       // armed by the owner's auto-listen flag, not by the shopper's click
  var retryUsed = false;     // a refused auto-arm is tried again once, on the first gesture
  var retryListening = false;

  function readSessionOff() { try { return window.sessionStorage.getItem(SESSION_OFF_KEY) === '1'; } catch (error) { return false; } }
  function writeSessionOff(on) {
    try {
      if (on) window.sessionStorage.setItem(SESSION_OFF_KEY, '1');
      else window.sessionStorage.removeItem(SESSION_OFF_KEY);
    } catch (error) { /* storage blocked */ }
  }

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
      if (recogniser === mine) {
        recogniser = null;
        onStopped();
        if (viaAuto) refused(); else countQuickEnd();
      }
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

  // The browser said no. Quietly back to the opt-in control; an auto-arm gets one more try on the first gesture.
  function refused() {
    var wasAuto = viaAuto;
    disarm(true);
    if (!wasAuto || retryUsed || retryListening) return;
    retryListening = true;
    document.addEventListener('click', retryOnGesture, false);
    document.addEventListener('keydown', retryOnGesture, false);
  }

  // Bubble phase on purpose: a click on "Turn on Hey Jarvis" reaches the control first and counts as the opt-in.
  function retryOnGesture() {
    document.removeEventListener('click', retryOnGesture, false);
    document.removeEventListener('keydown', retryOnGesture, false);
    retryListening = false;
    if (retryUsed) return;
    retryUsed = true;
    if (optedIn || killed() || !autoMode() || readSessionOff()) return;
    autoArm();
  }

  function autoArm() {
    viaAuto = true;
    optedIn = true;
    quickEnds = 0;
    backoffs = 0;
    renderControl();
    announce();
    sync();
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
    viaAuto = false;
    if (forget) writeOptIn(false);
    quickEnds = 0;
    backoffs = 0;
    sync();
    renderControl();
    announce();
  }

  function optIn() {
    optedIn = true;
    viaAuto = false;
    writeOptIn(true);
    writeSessionOff(false);
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
    var note = '<p class="juniper-keyword__note">Say "Jarvis" and Juniper starts listening, hands-free. While the chat is closed your browser listens for that one word, and Chrome\'s speech service hears the audio. Turn it off here any time.</p>';
    // The explanation stays up when the shop turned the word on: the shopper never clicked, so never read it.
    control.innerHTML = optedIn
      ? '<p class="juniper-keyword__line"><span class="juniper-keyword__status">Hey Jarvis is on</span>' +
        '<span aria-hidden="true"> · </span><button type="button" class="juniper-keyword__toggle" data-juniper-keyword-toggle aria-pressed="true">Turn off</button></p>' +
        (viaAuto || autoMode() ? note : '')
      : '<p class="juniper-keyword__line"><button type="button" class="juniper-keyword__toggle" data-juniper-keyword-toggle aria-pressed="false">Turn on Hey Jarvis</button></p>' + note;
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
      if (optedIn) { writeSessionOff(true); disarm(true); } else optIn();
    });
    home.appendChild(control);
    renderControl();
  }

  try {
    optedIn = readOptIn();
    if (autoMode() && !readSessionOff()) { viaAuto = true; optedIn = true; }
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
