// V1 hands-free conversation (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// The chat's own small round mic button (elements.mic) becomes the hands-free control when SpeechRecognition is
// supported: one click opens Chrome's SpeechRecognition; a pause ends the shopper's turn and sends it as a normal
// chat turn; the mic is shut while Juniper thinks and speaks (half-duplex) and reopens when she finishes.
// Nothing new is injected to start voice — the big "Talk to Juniper" control is gone; only the listening bar
// (state word + live caption) is ours to add, and only while hands-free is actually on.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var END_OF_TURN_MS = 1200;      // quiet after the last result that ends the shopper's turn
  var QUICK_END_MS = 300;         // a recognition session shorter than this "ended at once"
  var QUICK_END_LIMIT = 3;        // that many in a row and the restart backs off
  var BACKOFF_MS = 1000;
  var RETRY_SEND_MS = 250;
  var RETRY_SEND_LIMIT = 40;
  var MIN_WORDS_BEFORE_FIRST_TURN = 3; // auto-listen only: an open mic does not send room noise as the opening turn
  var STOP_WORDS = /^\s*(stop|wait|hold on)\b/i;
  var FLAG_KEY = 'bazaar:handsfree';
  var TOLD_KEY = 'bazaar:handsfree:told';
  var OFF_KEY = 'bazaar:handsfree:off';   // the shopper turned it off: no auto-start for the rest of the session
  var STATE_WORDS = { off: '', listening: 'Listening', hearing: 'Hearing you', thinking: 'Juniper is thinking', speaking: 'Juniper is talking' };
  var ON_LABEL = 'Stop talking to Juniper';
  var OFF_LABEL = 'Talk to Juniper';

  // juniper-ears.js chooses between Chrome's recogniser and our server's transcription; without it, Chrome's alone.
  var Recognition = (chat.ears && chat.ears.Recognition) || window.SpeechRecognition || window.webkitSpeechRecognition;

  var on = false;
  var state = 'off';
  var recognition = null;       // the one live recogniser; events from any other instance are ignored
  var startedAt = 0;
  var quickEnds = 0;
  var carried = '';             // words heard this turn before Chrome restarted the session
  var heard = '';               // the whole turn so far
  var pending = '';             // a finished turn the chat could not take yet
  var pendingTries = 0;
  var quiet = false;            // a start nobody clicked for: fail without a word
  var autoListen = Boolean(window.BazaarChatFlags && window.BazaarChatFlags.autoListen === 'always');
  var autoTrying = false;       // the start in progress is the auto-start; a refusal arms one retry
  var gestureRetryUsed = false;
  var shopperTurns = 0;         // turns on this page load, typed or spoken
  var spokenRepliesBefore = false;
  var endTimer = null;
  var restartTimer = null;
  var pendingTimer = null;
  var mic = null;          // the theme's own [data-ai-chat-mic] button — hands-free's only control
  var micObserver = null;
  var root = null;
  var bar = null;
  var stateWord = null;
  var caption = null;
  var stopButton = null;

  function offNoop() {
    chat.handsfree = { start: function () { return false; }, stop: function () {}, isOn: function () { return false; } };
  }

  // Hands-free is off, and says so, wherever the browser cannot do it. Push-to-talk stays exactly as it is.
  if (!Recognition) {
    offNoop();
    return;
  }

  function store(key, value) {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch (error) { /* storage is a convenience */ }
  }

  function stored(key) {
    try { return window.sessionStorage.getItem(key); } catch (error) { return null; }
  }

  function announce(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (error) { /* a listener's trouble is not ours */ }
  }

  function spokenStop() {
    return Boolean(window.BazaarChatFlags && window.BazaarChatFlags.spokenStop);
  }

  function isListening() {
    return state === 'listening' || state === 'hearing';
  }

  function clearTimer(timer) {
    if (timer !== null) window.clearTimeout(timer);
    return null;
  }

  function join(a, b) {
    a = String(a || '').replace(/\s+/g, ' ').trim();
    b = String(b || '').replace(/\s+/g, ' ').trim();
    return a && b ? a + ' ' + b : a || b;
  }

  function showCaption(text) {
    if (caption) caption.textContent = text;
    showInInput();
  }

  // No separate bar in the chat foot: the message box itself says what the microphone is doing, and the small mic
  // glows coral. The shopper's words appear there as they are heard.
  var input = chat.elements.input;
  var restPlaceholder = input ? input.getAttribute('placeholder') || '' : '';
  // The header is where a call shows who is on the line and what they are doing: under Juniper's name, the
  // "Trailhead's AI shopkeeper" line gives way to live bars and one word while voice is on.
  var live = null;
  var liveWord = null;
  function showInHeader() {
    var who = chat.elements.panel && chat.elements.panel.querySelector('.ai-chat__who');
    if (!who) return;
    if (!live) {
      live = document.createElement('p');
      live.className = 'juniper-handsfree__live';
      live.hidden = true;
      live.innerHTML = '<span class="juniper-handsfree__wave" data-juniper-wave aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="juniper-handsfree__word"></span>';
      liveWord = live.querySelector('.juniper-handsfree__word');
      who.appendChild(live);
    }
    var showing = on && state !== 'off';
    live.hidden = !showing;
    live.setAttribute('data-state', state);
    liveWord.textContent = STATE_WORDS[state] || '';
    chat.elements.widget.classList.toggle('juniper-handsfree--live', showing);
  }

  function showInInput() {
    if (!input) return;
    var words = caption ? caption.textContent : '';
    var text = !on || state === 'off' ? restPlaceholder : state === 'hearing' && words ? words : (STATE_WORDS[state] || '') + '…';
    if (input.getAttribute('placeholder') !== text) input.setAttribute('placeholder', text);
  }

  // chat-demo.js's syncVoiceUi() re-toggles is-recording, hidden and disabled on the mic on every sync (it runs on
  // each send, among other things) for its own, now-bypassed, push-to-talk state. Put hands-free's state straight
  // back afterwards — never touching `hidden`, which stays chat-demo's call entirely.
  function reassertMic() {
    if (!mic) return;
    if (on) {
      if (!mic.classList.contains('is-recording')) mic.classList.add('is-recording');
      if (mic.getAttribute('aria-pressed') !== 'true') mic.setAttribute('aria-pressed', 'true');
      if (mic.getAttribute('aria-label') !== ON_LABEL) { mic.setAttribute('aria-label', ON_LABEL); mic.title = ON_LABEL; }
      if (mic.disabled) mic.disabled = false; // the shopper must always be able to stop, even mid-turn
    } else {
      if (mic.classList.contains('is-recording')) mic.classList.remove('is-recording');
      if (mic.getAttribute('aria-pressed') !== 'false') mic.setAttribute('aria-pressed', 'false');
      if (mic.getAttribute('aria-label') !== OFF_LABEL) { mic.setAttribute('aria-label', OFF_LABEL); mic.title = OFF_LABEL; }
    }
  }

  function setState(next) {
    var changed = next !== state;
    state = next;
    if (root) {
      root.setAttribute('data-state', state);
      bar.hidden = !on;
      stateWord.textContent = STATE_WORDS[state] || '';
      stopButton.hidden = state !== 'speaking';
    }
    showInInput();
    showInHeader();
    reassertMic();
    if (isListening()) keepListeningMood();
    else if (state === 'off' && chat.state().mood === 'listening') chat.setMood('idle');
    if (changed) announce('bazaar-voice:state', { on: on, state: state });
  }

  function keepListeningMood() {
    if (chat.state().mood !== 'listening') chat.setMood('listening');
  }

  // ---- The recogniser. A fresh instance per session: Chrome throws when start() meets one that has not ended. ----

  function startRecognition() {
    if (recognition || !on) return;
    restartTimer = clearTimer(restartTimer);
    var session = new Recognition();
    session.continuous = true;
    session.interimResults = true;
    session.lang = 'en-US';
    session.onstart = function () { if (session === recognition) guarded(reallyStarted); };
    session.onresult = function (event) { if (session === recognition) guarded(onResult, event); };
    session.onerror = function (event) { if (session === recognition) guarded(onError, event); };
    session.onend = function () { if (session === recognition) guarded(onEnd); };
    recognition = session;
    startedAt = new Date().getTime();
    try {
      session.start();
    } catch (error) {
      recognition = null;
      refused('I could not open the microphone, so hands-free is off. Typing still works.');
    }
  }

  // The browser let the recogniser open (or results are arriving, which proves the same thing).
  function reallyStarted() {
    var unannounced = quiet;
    quiet = false;
    autoTrying = false;
    if (unannounced) tellOnce();
  }

  function refused(message) {
    var silently = quiet;
    var retry = autoTrying && !gestureRetryUsed;
    turnOff(silently ? '' : message);
    if (retry) armGestureRetry();
  }

  // Chrome may refuse a start nobody clicked for. The first touch or key anywhere is a gesture: try once more.
  function armGestureRetry() {
    gestureRetryUsed = true;
    function retry(event) {
      if (event.type === 'keydown' && event.key === 'Escape') return;
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('keydown', retry, true);
      // A press on the mic is already the shopper asking; the click handler handles it.
      if (mic && event.target && mic.contains(event.target)) return;
      if (on || stored(OFF_KEY) === '1') return;
      guarded(function () { autoStart(); });
    }
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('keydown', retry, true);
  }

  function autoStart() {
    autoTrying = true;
    try { start({ quiet: true }); } catch (error) { turnOff(''); }
  }

  function stopRecognition() {
    var session = recognition;
    recognition = null;
    restartTimer = clearTimer(restartTimer);
    if (!session) return;
    try { session.abort(); } catch (error) { /* already ended */ }
  }

  function guarded(handler, event) {
    try { handler(event); } catch (error) { /* a bad event never breaks the chat */ }
  }

  function transcriptOf(event) {
    var finals = '';
    var interim = '';
    var results = event && event.results ? event.results : [];
    for (var index = 0; index < results.length; index += 1) {
      var result = results[index];
      var text = result && result[0] ? result[0].transcript : '';
      if (result && result.isFinal) finals = join(finals, text);
      else interim = join(interim, text);
    }
    return { finals: finals, interim: interim };
  }

  function onResult(event) {
    var said = transcriptOf(event);
    if (state === 'speaking') {
      // Only behind the spoken-stop flag is a recogniser open here, and it listens for one thing.
      var results = event.results || [];
      var latest = results.length ? results[results.length - 1] : null;
      var words = latest && latest[0] ? latest[0].transcript : '';
      if (STOP_WORDS.test(words)) bargeIn();
      return;
    }
    if (!isListening()) return;
    if (quiet || autoTrying) reallyStarted();
    var text = join(join(carried, said.finals), said.interim);
    if (!text) return;
    heard = text;
    setState('hearing');
    showCaption(heard);
    announce('bazaar-voice:caption', { text: heard, final: !said.interim });
    endTimer = clearTimer(endTimer);
    // The server engine has already waited out the pause before it transcribed.
    endTimer = window.setTimeout(endTurn, event && event.endpointed ? 0 : END_OF_TURN_MS);
  }

  function onError(event) {
    var reason = event && event.error;
    if (reason === 'not-allowed' || reason === 'service-not-allowed') {
      refused('The browser would not let me use the microphone, so hands-free is off. Allow the microphone for this shop and tap the mic again. Typing still works.');
    }
    // no-speech, aborted, network and the rest end the session; onend decides whether to reopen it.
  }

  function onEnd() {
    recognition = null;
    if (!on) return;
    if (!isListening() && !(state === 'speaking' && spokenStop())) return;
    carried = heard;
    var lived = new Date().getTime() - startedAt;
    quickEnds = lived < QUICK_END_MS ? quickEnds + 1 : 0;
    if (quickEnds >= QUICK_END_LIMIT) {
      quickEnds = 0;
      restartTimer = clearTimer(restartTimer);
      restartTimer = window.setTimeout(function () { restartTimer = null; startRecognition(); }, BACKOFF_MS);
      return;
    }
    startRecognition();
  }

  // ---- Turns ----

  function resetTurn() {
    endTimer = clearTimer(endTimer);
    carried = '';
    heard = '';
  }

  function endTurn() {
    endTimer = null;
    var text = String(heard || '').trim();
    if (!on || !text) return;
    // The wake word on its own is a summons, not something to say to Juniper.
    if (chat.keyword && chat.keyword.matches(text) && text.split(/\s+/).length <= 3) { resetTurn(); listen(); return; }
    if (autoListen && shopperTurns === 0 && text.split(/\s+/).length < MIN_WORDS_BEFORE_FIRST_TURN) {
      // Too little to be someone talking to Juniper. A fresh session, so these words do not pad the next ones.
      listen();
      return;
    }
    announce('bazaar-voice:caption', { text: text, final: true });
    resetTurn();
    pending = join(pending, text);
    pendingTries = 0;
    sendPending();
    // Not taken yet: open a fresh session, so the words already kept are not heard a second time.
    if (on && pending) listen();
  }

  function sendPending() {
    pendingTimer = clearTimer(pendingTimer);
    if (!on || !pending) return;
    var text = pending;
    var sent = false;
    try { sent = chat.send(text) === true; } catch (error) { sent = false; }
    if (sent) {
      if (pending === text) pending = '';
      return;
    }
    // A turn is in flight. Keep the words; try again shortly and whenever a reply lands.
    pendingTries += 1;
    if (pendingTries > RETRY_SEND_LIMIT) { pending = ''; listen(); return; }
    pendingTimer = window.setTimeout(sendPending, RETRY_SEND_MS);
  }

  function listen() {
    if (!on) return;
    stopRecognition();
    resetTurn();
    showCaption('');
    setState('listening');
    startRecognition();
  }

  function bargeIn() {
    try { chat.stopSpeaking(); } catch (error) { /* nothing was playing */ }
    // stopSpeaking leads to speak:end, which reopens the mic. If the audio had already gone, do it here.
    if (on && state === 'speaking') listen();
  }

  // ---- On and off ----

  function tellOnce() {
    if (stored(TOLD_KEY) === '1') return;
    store(TOLD_KEY, '1');
    chat.addMessage("Hands-free is on: just talk, and pause when you're done. While it's on, " + (chat.ears && chat.ears.engine() === 'server' ? "this shop's voice service" : "Chrome's speech service") + " hears the audio to turn it into words. Press Esc or tap the mic to stop.", 'bot');
  }

  // A click has every other feature's script long since run, so the pill (if any) already exists: decide now.
  // A quiet, page-load start races juniper-motion.js, which is listed after us in theme.liquid and has not run its
  // own script yet — give it the rest of this tick (a deferred script cannot be interrupted by a timer) before
  // assuming there is no pill to show hands-free's state.
  function openUnlessPilled(quiet) {
    if (!quiet) {
      if (!chat.isOpen() && !chat.elements.widget.querySelector('[data-juniper-pill]')) chat.open();
      return;
    }
    window.setTimeout(function () {
      if (on && !chat.isOpen() && !chat.elements.widget.querySelector('[data-juniper-pill]')) chat.open();
    }, 0);
  }

  function start(options) {
    if (on) return true;
    quiet = Boolean(options && options.quiet);
    on = true;
    store(FLAG_KEY, '1');
    if (!quiet) store(OFF_KEY, null);
    quickEnds = 0;
    pending = '';
    spokenRepliesBefore = Boolean(chat.state().spokenReplies);
    chat.setSpokenReplies(true);
    if (!quiet) tellOnce();
    openUnlessPilled(quiet);
    if (chat.state().sending) setState('thinking');
    else listen();
    return on;
  }

  // The shopper's own off switch (mic click, Esc, a pill's stop): remembered, so auto-listen stays away this session.
  function stop() {
    if (on) store(OFF_KEY, '1');
    turnOff('');
  }

  function turnOff(why) {
    var wasOn = on;
    var wasSpeaking = state === 'speaking';
    on = false;
    quiet = false;
    autoTrying = false;
    endTimer = clearTimer(endTimer);
    pendingTimer = clearTimer(pendingTimer);
    stopRecognition();
    pending = '';
    carried = '';
    heard = '';
    store(FLAG_KEY, null);
    showCaption('');
    setState('off');
    if (!wasOn) return;
    if (wasSpeaking) { try { chat.stopSpeaking(); } catch (error) { /* nothing was playing */ } }
    if (!spokenRepliesBefore) chat.setSpokenReplies(false);
    if (why) chat.addMessage(why, 'bot');
  }

  // ---- The mic takeover and the listening bar ----

  function build() {
    mic = chat.elements.mic;
    var form = chat.elements.form;
    var foot = chat.elements.foot || (form && form.parentNode);
    if (!foot || !mic || !form) return false;
    root = document.createElement('div');
    root.className = 'juniper-handsfree';
    root.setAttribute('data-state', 'off');
    root.innerHTML =
      '<div class="juniper-handsfree__bar" hidden>' +
        '<span class="juniper-handsfree__dot" aria-hidden="true"></span>' +
        '<span class="juniper-handsfree__state"></span>' +
        '<span class="juniper-handsfree__caption"></span>' +
        '<button class="juniper-handsfree__stop" type="button" hidden>Stop</button>' +
      '</div>';
    bar = root.querySelector('.juniper-handsfree__bar');
    stateWord = root.querySelector('.juniper-handsfree__state');
    caption = root.querySelector('.juniper-handsfree__caption');
    stopButton = root.querySelector('.juniper-handsfree__stop');
    stopButton.setAttribute('aria-label', 'Stop Juniper talking');
    foot.insertBefore(root, form);
    stopButton.addEventListener('click', function () { guarded(bargeIn); });

    // Capture phase, on the mic itself: at the target, capturing listeners run before bubble-phase ones, so this
    // runs before chat-demo.js's own (bubble-phase) push-to-talk handler. stopImmediatePropagation keeps that
    // handler — and the MediaRecorder/getUserMedia it opens — from ever running.
    mic.addEventListener('click', function (event) {
      event.stopImmediatePropagation();
      event.preventDefault();
      guarded(function () { if (on) stop(); else start(); });
    }, true);

    reassertMic();
    if (window.MutationObserver) {
      micObserver = new window.MutationObserver(function () { guarded(reassertMic); });
      try { micObserver.observe(mic, { attributes: true, attributeFilter: ['class', 'disabled', 'aria-pressed', 'aria-label'] }); } catch (error) { /* observe is best-effort */ }
    }
    return true;
  }

  if (!build()) {
    offNoop();
    return;
  }

  chat.on('turn:start', function () {
    shopperTurns += 1;
    if (!on) return;
    // Any turn — spoken, typed or a chip — shuts the mic until Juniper has answered.
    pending = '';
    pendingTimer = clearTimer(pendingTimer);
    resetTurn();
    stopRecognition();
    setState('thinking');
  });

  chat.on('speak:start', function () {
    if (!on) return;
    resetTurn();
    stopRecognition();
    setState('speaking');
    if (spokenStop()) startRecognition();
  });

  chat.on('speak:end', function () {
    if (!on) return;
    listen();
    if (pending) { pendingTimer = clearTimer(pendingTimer); pendingTimer = window.setTimeout(sendPending, 0); }
  });

  chat.on('turn:error', function () {
    if (on) listen();
  });

  // A turn answered on the page (V13's chores) has no spoken reply to wait for.
  chat.on('turn:local', function () {
    if (on) listen();
  });

  // chat-demo.js drops the listening mood whenever it re-syncs its own voice controls; put it back.
  chat.on('mood', function (detail) {
    if (on && isListening() && detail && detail.mood === 'idle') chat.setMood('listening');
  });

  // The existing "Reading this aloud · Stop" button already calls stopSpeaking in chat-demo.js; speak:end does the rest.
  // Esc: cut Juniper off if she is talking, otherwise end hands-free. Capture, so the panel does not also close.
  document.addEventListener('keydown', function (event) {
    if (!on || event.key !== 'Escape') return;
    event.stopPropagation();
    guarded(function () {
      if (state === 'speaking') bargeIn();
      else stop();
    });
  }, true);

  chat.handsfree = {
    start: function () { try { return start(); } catch (error) { return false; } },
    stop: function () { try { stop(); } catch (error) { /* already off */ } },
    isOn: function () { return on; }
  };

  // The mic grant lasts for the origin, so a shopper who was talking on the last page keeps talking on this one.
  // With BazaarChatFlags.autoListen === 'always' she listens from the first page too, unless the shopper said no.
  if (autoListen && stored(OFF_KEY) !== '1') {
    autoStart();
  } else if (stored(FLAG_KEY) === '1') {
    try { start({ quiet: true }); } catch (error) { turnOff(''); }
  }
})();
