// V10 earcons and voice status (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// Two very short synthesized sounds while voice is on, and one hidden status line that says the voice state in words.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;
  try {
    var PEAK = 0.05; // never above 0.06
    var WORDS = { listening: 'Listening', hearing: 'Listening', thinking: 'Thinking', speaking: 'Juniper is speaking', off: 'Voice off' };
    var elements = chat.elements || {};
    var handsfree = false;
    var voiceState = 'off';
    var speaking = false;
    var gestured = false;
    var context = null;
    var lastSaid = '';

    // ---- Accessibility: the messages are a log; the voice state is a status line. ----
    if (elements.messages) {
      elements.messages.setAttribute('role', 'log');
      elements.messages.setAttribute('aria-live', 'polite');
    }
    var status = null;
    if (elements.widget) {
      status = document.createElement('p');
      status.className = 'visually-hidden juniper-earcons__status';
      status.setAttribute('role', 'status');
      elements.widget.appendChild(status);
    }

    function announce(words) {
      if (!status || !words || words === lastSaid) return;
      lastSaid = words;
      status.textContent = words;
    }
    function forget() {
      // A finished push-to-talk turn clears the line, so the next "Listening" is a new announcement.
      if (!status) return;
      lastSaid = '';
      status.textContent = '';
    }

    // ---- Sound ----
    function voiceOn() {
      var spoken = false;
      try { spoken = Boolean(chat.state().spokenReplies); } catch (error) { spoken = false; }
      return handsfree || spoken;
    }

    function audio() {
      if (context) return context;
      if (!gestured) return null;
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (typeof Ctor !== 'function') return null;
      try { context = new Ctor(); } catch (error) { context = null; }
      return context;
    }

    // One note: a sine or triangle through a gain that ramps up in 12 ms and back to silence, so it never clicks.
    function note(ctx, type, from, to, at, length) {
      var oscillator = ctx.createOscillator();
      var gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at);
      if (to !== from) oscillator.frequency.linearRampToValueAtTime(to, at + length);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK, at + 0.012);
      gain.gain.linearRampToValueAtTime(0, at + length);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + length + 0.01);
    }

    function play(notes) {
      if (!voiceOn() || speaking) return;
      try {
        var ctx = audio();
        if (!ctx) return;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
        var now = ctx.currentTime || 0;
        for (var i = 0; i < notes.length; i += 1) note(ctx, notes[i][0], notes[i][1], notes[i][2], now + notes[i][3], notes[i][4]);
      } catch (error) { /* a sound that fails is only a missing sound */ }
    }

    function listeningStarts() { play([['sine', 523.25, 523.25, 0, 0.055], ['sine', 659.25, 659.25, 0.06, 0.06]]); }
    function replyReady() { play([['triangle', 330, 311, 0, 0.09]]); }

    function onGesture() {
      gestured = true;
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    }
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);

    document.addEventListener('bazaar-voice:state', function (event) {
      var detail = (event && event.detail) || {};
      var next = detail.on ? String(detail.state || 'listening') : 'off';
      var previous = voiceState;
      handsfree = Boolean(detail.on);
      voiceState = next;
      if (next === previous) return;
      if (next === 'listening' && (previous === 'off' || previous === 'speaking' || previous === 'thinking')) listeningStarts();
      if (WORDS[next]) announce(WORDS[next]);
    });

    chat.on('mood', function (detail) {
      var mood = detail && detail.mood;
      if (mood === 'listening' || mood === 'thinking' || mood === 'speaking') announce(WORDS[mood]);
      else if (!handsfree) forget();
    });

    chat.on('speak:start', function () { speaking = true; });
    chat.on('speak:end', function () { speaking = false; });
    // `reply` fires before the chat fetches Juniper's voice, so this note is over before she starts.
    chat.on('reply', function () { replyReady(); });
  } catch (error) {
    if (window.console) window.console.error('[juniper-earcons]', error);
  }
})();
