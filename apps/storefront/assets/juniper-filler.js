// V11 spoken filler while the shopkeeper picks (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// Three short clips are fetched once through the existing voice route; a turn that takes longer than a moment and
// a half plays one of them. The lines promise nothing and name no figure.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;
  try {
    var LINES = ['Hmm, let me look.', 'One moment, checking the shelf.', 'Let me do the maths on that.'];
    var WAIT_MS = 1500;
    var VOLUME = 0.85;
    if (typeof window.fetch !== 'function' || typeof window.Audio !== 'function' || !window.URL || typeof window.URL.createObjectURL !== 'function') return;

    var handsfree = false;
    var speaking = false;
    var prefetchStarted = false;
    var outstanding = 0;
    var clips = []; // object URLs, kept for the life of the page
    var next = 0;
    var timer = null;
    var waiting = false;
    var playedThisTurn = false;
    var active = null;

    function voiceOn() {
      var spoken = false;
      try { spoken = Boolean(chat.state().spokenReplies); } catch (error) { spoken = false; }
      return handsfree || spoken;
    }

    function fetchClip(text, triesLeft) {
      var request;
      try {
        request = window.fetch(chat.apiUrl('/api/voice/speak'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text })
        });
      } catch (error) { outstanding -= 1; return; }
      request.then(function (response) {
        if (!response || !response.ok) throw new Error('Filler clip returned ' + (response && response.status));
        return response.blob();
      }).then(function (blob) {
        clips.push(window.URL.createObjectURL(blob));
        outstanding -= 1;
      }).catch(function () {
        // One more try, then this clip is given up for the page's life.
        if (triesLeft > 0) fetchClip(text, triesLeft - 1); else outstanding -= 1;
      });
    }

    function prefetch() {
      if (prefetchStarted || !voiceOn()) return;
      prefetchStarted = true;
      outstanding = LINES.length;
      for (var i = 0; i < LINES.length; i += 1) fetchClip(LINES[i], 1);
    }

    function stop() {
      if (!active) return;
      var audio = active;
      active = null;
      try { audio.pause(); audio.currentTime = 0; } catch (error) { /* already stopped */ }
    }

    function endTurn() {
      waiting = false;
      if (timer) { window.clearTimeout(timer); timer = null; }
      stop();
    }

    function play() {
      timer = null;
      if (!waiting || playedThisTurn || speaking || active || !voiceOn()) return;
      if (!prefetchStarted || outstanding > 0 || !clips.length) return;
      playedThisTurn = true;
      try {
        var audio = new window.Audio(clips[next % clips.length]);
        next += 1;
        audio.volume = VOLUME;
        audio.addEventListener('ended', function () { if (active === audio) active = null; });
        active = audio;
        var started = audio.play();
        if (started && typeof started.catch === 'function') started.catch(function () { if (active === audio) active = null; });
      } catch (error) { active = null; }
    }

    document.addEventListener('bazaar-voice:state', function (event) {
      handsfree = Boolean(event && event.detail && event.detail.on);
      if (handsfree) prefetch(); else if (!voiceOn()) stop();
    });
    // The seam has no event for the speaker toggle, so a click inside the widget is the cue to look again.
    if (chat.elements && chat.elements.widget) {
      chat.elements.widget.addEventListener('click', function () {
        window.setTimeout(function () { if (voiceOn()) prefetch(); else stop(); }, 0);
      });
    }

    chat.on('turn:start', function () {
      endTurn();
      prefetch();
      playedThisTurn = false;
      waiting = true;
      timer = window.setTimeout(play, WAIT_MS);
    });
    chat.on('reply', endTurn);
    chat.on('turn:error', endTurn);
    chat.on('close', function () { if (!(chat.flags && chat.flags.voiceStaysOnClose)) endTurn(); });
    chat.on('speak:start', function () { speaking = true; stop(); });
    chat.on('speak:end', function () { speaking = false; });
  } catch (error) {
    if (window.console) window.console.error('[juniper-filler]', error);
  }
})();
