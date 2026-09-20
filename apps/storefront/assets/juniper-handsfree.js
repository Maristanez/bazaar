// V1 hands-free conversation (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// One click on "Talk to Juniper" opens Chrome's SpeechRecognition; a pause ends the shopper's turn and sends it as a
// normal chat turn; the mic is shut while Juniper thinks and speaks (half-duplex) and reopens when she finishes.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var END_OF_TURN_MS = 1200;      // quiet after the last result that ends the shopper's turn
  var QUICK_END_MS = 300;         // a recognition session shorter than this "ended at once"
  var QUICK_END_LIMIT = 3;        // that many in a row and the restart backs off
  var BACKOFF_MS = 1000;
  var RETRY_SEND_MS = 250;
  var RETRY_SEND_LIMIT = 40;
  var STOP_WORDS = /^\s*(stop|wait|hold on)\b/i;
  var FLAG_KEY = 'bazaar:handsfree';
  var TOLD_KEY = 'bazaar:handsfree:told';
  var STATE_WORDS = { off: '', listening: 'Listening', hearing: 'Hearing you', thinking: 'Juniper is thinking', speaking: 'Juniper is talking' };
  var MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>';

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

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
  var spokenRepliesBefore = false;
  var endTimer = null;
  var restartTimer = null;
  var pendingTimer = null;
  var root = null;
  var toggle = null;
  var bar = null;
  var stateWord = null;
  var caption = null;
  var stopButton = null;

  // Hands-free is off, and says so, wherever the browser cannot do it. Push-to-talk stays exactly as it is.
  if (!Recognition) {
    chat.handsfree = { start: function () { return false; }, stop: function () {}, isOn: function () { return false; } };
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
  }

  function setState(next) {
    var changed = next !== state;
    state = next;
    if (root) {
      root.setAttribute('data-state', state);
      root.classList.toggle('is-on', on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.querySelector('.juniper-handsfree__label').textContent = on ? 'Done talking' : 'Talk to Juniper';
      toggle.setAttribute('aria-label', on ? 'Turn hands-free off' : 'Talk to Juniper, hands-free');
      bar.hidden = !on;
      stateWord.textContent = STATE_WORDS[state] || '';
      stopButton.hidden = state !== 'speaking';
    }
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
    session.onstart = function () { if (session === recognition) quiet = false; };
    session.onresult = function (event) { if (session === recognition) guarded(onResult, event); };
    session.onerror = function (event) { if (session === recognition) guarded(onError, event); };
    session.onend = function () { if (session === recognition) guarded(onEnd); };
    recognition = session;
    startedAt = new Date().getTime();
    try {
      session.start();
    } catch (error) {
      recognition = null;
      turnOff(quiet ? '' : 'I could not open the microphone, so hands-free is off. The mic button and typing still work.');
    }
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
    quiet = false;
    var text = join(join(carried, said.finals), said.interim);
    if (!text) return;
    heard = text;
    setState('hearing');
    showCaption(heard);
    announce('bazaar-voice:caption', { text: heard, final: !said.interim });
    endTimer = clearTimer(endTimer);
    endTimer = window.setTimeout(endTurn, END_OF_TURN_MS);
  }

  function onError(event) {
    var reason = event && event.error;
    if (reason === 'not-allowed' || reason === 'service-not-allowed') {
      turnOff(quiet ? '' : 'The browser would not let me use the microphone, so hands-free is off. Allow the microphone for this shop and tap Talk to Juniper again. Typing still works.');
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
    chat.addMessage("Hands-free is on: just talk, and pause when you're done. While it's on, Chrome's speech service hears the audio to turn it into words. Press Esc or tap Done talking to stop.", 'bot');
  }

  function start(options) {
    if (on) return true;
    quiet = Boolean(options && options.quiet);
    on = true;
    store(FLAG_KEY, '1');
    quickEnds = 0;
    pending = '';
    spokenRepliesBefore = Boolean(chat.state().spokenReplies);
    chat.setSpokenReplies(true);
    if (!quiet) tellOnce();
    if (!chat.isOpen() && !chat.elements.widget.querySelector('[data-juniper-pill]')) chat.open();
    if (chat.state().sending) setState('thinking');
    else listen();
    return on;
  }

  function stop() {
    turnOff('');
  }

  function turnOff(why) {
    var wasOn = on;
    var wasSpeaking = state === 'speaking';
    on = false;
    quiet = false;
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

  // ---- The control and the bar ----

  function build() {
    var form = chat.elements.form;
    var foot = form && form.parentNode;
    if (!foot) return false;
    root = document.createElement('div');
    root.className = 'juniper-handsfree';
    root.setAttribute('data-state', 'off');
    root.innerHTML =
      '<div class="juniper-handsfree__bar" hidden>' +
        '<span class="juniper-handsfree__dot" aria-hidden="true"></span>' +
        '<span class="juniper-handsfree__state" role="status"></span>' +
        '<span class="juniper-handsfree__caption"></span>' +
        '<button class="juniper-handsfree__stop" type="button" hidden>Stop</button>' +
      '</div>' +
      '<button class="juniper-handsfree__toggle" type="button" aria-pressed="false">' + MIC_ICON + '<span class="juniper-handsfree__label">Talk to Juniper</span></button>';
    toggle = root.querySelector('.juniper-handsfree__toggle');
    bar = root.querySelector('.juniper-handsfree__bar');
    stateWord = root.querySelector('.juniper-handsfree__state');
    caption = root.querySelector('.juniper-handsfree__caption');
    stopButton = root.querySelector('.juniper-handsfree__stop');
    stopButton.setAttribute('aria-label', 'Stop Juniper talking');
    foot.insertBefore(root, form);
    toggle.addEventListener('click', function () { guarded(function () { if (on) stop(); else start(); }); });
    stopButton.addEventListener('click', function () { guarded(bargeIn); });
    return true;
  }

  if (!build()) return;

  chat.on('turn:start', function () {
    if (!on) return;
    // Any turn — spoken, typed or a chip — shuts the mic until Juniper has answered.
    pending = '';
    pendingTimer = clearTimer(pendingTimer);
    resetTurn();
    stopRecognition();
    chat.setSpokenReplies(true); // the voice config may have loaded since hands-free began
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
  if (stored(FLAG_KEY) === '1') {
    try { start({ quiet: true }); } catch (error) { turnOff(''); }
  }
})();
