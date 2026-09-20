// V4 mic halo, live wave, mouth follows the reply audio (docs/PLAN.md). Talks to the chat only through window.BazaarChat.
// Publishes two 0..1 numbers on the widget for any stylesheet to read: --juniper-level (the shopper's mic) and
// --juniper-mouth (Juniper's reply audio). The microphone is opened only while voice is listening, and let go after.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;
  try {
    var widget = chat.elements && chat.elements.widget;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    var raf = window.requestAnimationFrame;
    if (!widget || !AudioContextClass || !raf || !window.Uint8Array) return;
    var canListen = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    var NOISE_FLOOR = 0.02;   // RMS below this is the room, not the shopper
    var MIC_GAIN = 5;         // speech RMS sits around 0.05–0.2
    var MOUTH_GAIN = 4;
    var ATTACK = 0.55;        // share of the gap closed per frame on the way up
    var RELEASE = 0.12;       // and on the way down

    var gestured = Boolean(navigator.userActivation && navigator.userActivation.hasBeenActive);
    var voiceListening = false;   // bazaar-voice:state says hands-free is listening or hearing
    var moodListening = false;    // the legacy push-to-talk is recording
    var mic = null;               // { context, stream, source, analyser, time, freq }
    var micRequest = 0;           // a newer request or a stop outdates a pending getUserMedia
    var micPending = false;
    var level = 0;
    var replyContext = null;      // kept for the page: closing it would cut a playing reply
    var reply = null;             // { audio, source, analyser, time }
    var replyRequest = 0;         // a newer reply or its end outdates a pending context resume
    var mouth = 0;
    var ticking = false;

    function setNumber(name, value) { widget.style.setProperty(name, String(Math.round(value * 1000) / 1000)); }

    function waves() {
      var found = [];
      if (chat.elements.wave) found.push(chat.elements.wave);
      Array.prototype.forEach.call(document.querySelectorAll('[data-juniper-wave]'), function (node) { found.push(node); });
      return found;
    }

    function rms(analyser, buffer) {
      analyser.getByteTimeDomainData(buffer);
      var sum = 0;
      for (var index = 0; index < buffer.length; index += 1) {
        var sample = (buffer[index] - 128) / 128;
        sum += sample * sample;
      }
      return Math.sqrt(sum / buffer.length);
    }

    function follow(current, target) {
      var next = current + (target - current) * (target > current ? ATTACK : RELEASE);
      return next < 0.004 ? 0 : Math.min(1, next);
    }

    // Whoever is making sound right now (the shopper's mic, or Juniper's reply audio) drives the same bars —
    // one mechanism, fed from either analyser, never both live figures fighting on screen at once.
    function drawBarsFrom(analyser, freqBuffer, gainLevel) {
      analyser.getByteFrequencyData(freqBuffer);
      // Speech lives in the low bins (about 200 Hz to 4.5 kHz at fftSize 256); above that is mostly hiss. Bin 0 is DC.
      var usable = Math.max(1, Math.min(freqBuffer.length - 1, 24));
      waves().forEach(function (wave) {
        var bars = wave.children;
        var count = bars.length;
        for (var index = 0; index < count; index += 1) {
          // Mirror the spectrum around the middle so the wave swells from its centre rather than leaning left.
          var distance = Math.abs(index - (count - 1) / 2) / (count / 2);
          var bin = 1 + Math.min(usable - 1, Math.floor(distance * usable));
          var value = gainLevel > 0 ? Math.max(0, freqBuffer[bin] / 255 - 0.08) / 0.92 : 0;
          bars[index].style.setProperty('--juniper-bar', String(Math.round(value * 100) / 100));
        }
      });
    }

    // Queried fresh (via waves()) so a wave marked or unmarked here always reflects whatever is on the page this
    // frame, including one a feature mounted after presence had already started driving the others.
    function markWaves() {
      var active = Boolean(mic) || (Boolean(reply) && !(reply.audio.paused || reply.audio.ended));
      waves().forEach(function (wave) {
        if (active) {
          wave.classList.add('juniper-presence--live');
        } else {
          wave.classList.remove('juniper-presence--live');
          Array.prototype.forEach.call(wave.children, function (bar) { bar.style.removeProperty('--juniper-bar'); });
        }
      });
    }

    function tick() {
      ticking = false;
      if (!mic && !reply) return;
      if (!document.hidden) {
        try {
          if (mic) {
            level = follow(level, Math.min(1, Math.max(0, rms(mic.analyser, mic.time) - NOISE_FLOOR) * MIC_GAIN));
            setNumber('--juniper-level', level);
          }
          if (reply) {
            var silent = reply.audio.paused || reply.audio.ended;
            mouth = silent ? 0 : follow(mouth, Math.min(1, rms(reply.analyser, reply.time) * MOUTH_GAIN));
            setNumber('--juniper-mouth', mouth);
          }
          // The mic wins when both are somehow present — Juniper's own state machine keeps that from happening
          // in practice (the mic closes once she starts speaking), but the shopper's own voice should never be
          // preempted by a reply if it ever did.
          if (mic) drawBarsFrom(mic.analyser, mic.freq, level);
          else if (reply) drawBarsFrom(reply.analyser, reply.freq, mouth);
          markWaves();
        } catch (error) { /* a dead analyser only stills the picture */ }
      }
      schedule();
    }

    function schedule() {
      if (ticking || (!mic && !reply)) return;
      ticking = true;
      raf.call(window, tick);
    }

    // ---- the microphone ----

    function releaseStream(stream) {
      try { stream.getTracks().forEach(function (track) { track.stop(); }); } catch (error) { /* already gone */ }
    }

    function stopMic() {
      micRequest += 1;
      micPending = false;
      if (mic) {
        var old = mic;
        mic = null;
        releaseStream(old.stream);
        try { old.source.disconnect(); } catch (error) { /* fine */ }
        try { old.context.close(); } catch (error) { /* fine */ }
      }
      level = 0;
      setNumber('--juniper-level', 0);
      widget.classList.remove('juniper-presence--listening');
      markWaves();
    }

    function startMic() {
      if (mic || micPending || !canListen || !gestured) return;
      micPending = true;
      var request = micRequest += 1;
      var asked;
      try { asked = navigator.mediaDevices.getUserMedia({ audio: true }); } catch (error) { micPending = false; return; }
      asked.then(function (stream) {
        if (request !== micRequest) { releaseStream(stream); return; }
        micPending = false;
        try {
          var context = new AudioContextClass();
          if (context.state === 'suspended' && context.resume) context.resume();
          var analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          var source = context.createMediaStreamSource(stream);
          source.connect(analyser); // no destination: the shopper must not hear themselves
          mic = { context: context, stream: stream, source: source, analyser: analyser, time: new window.Uint8Array(analyser.fftSize), freq: new window.Uint8Array(analyser.frequencyBinCount) };
          widget.classList.add('juniper-presence--listening');
          markWaves();
          schedule();
        } catch (error) {
          releaseStream(stream);
        }
      }, function () {
        if (request === micRequest) micPending = false;
      });
    }

    function syncMic() {
      if (voiceListening || moodListening) startMic();
      else if (mic || micPending) stopMic();
    }

    document.addEventListener('bazaar-voice:state', function (event) {
      try {
        var detail = event.detail || {};
        voiceListening = Boolean(detail.on) && (detail.state === 'listening' || detail.state === 'hearing');
        syncMic();
      } catch (error) { /* presence never breaks voice */ }
    });

    chat.on('mood', function (detail) {
      moodListening = detail.mood === 'listening';
      syncMic();
    });

    // ---- the reply audio ----

    function restMouth() {
      mouth = 0;
      setNumber('--juniper-mouth', 0);
      markWaves();
    }

    function endReply() {
      replyRequest += 1;
      reply = null;
      restMouth();
    }

    function wireReply(audio) {
      // One source per element, ever: a second createMediaElementSource on the same element throws.
      if (!audio.__juniperPresence) {
        var analyser = replyContext.createAnalyser();
        analyser.fftSize = 256;
        var source = replyContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(replyContext.destination);
        audio.__juniperPresence = { source: source, analyser: analyser, time: new window.Uint8Array(analyser.fftSize), freq: new window.Uint8Array(analyser.frequencyBinCount) };
        audio.addEventListener('pause', restMouth);
        audio.addEventListener('ended', restMouth);
      }
      var wired = audio.__juniperPresence;
      reply = { audio: audio, source: wired.source, analyser: wired.analyser, time: wired.time, freq: wired.freq };
      markWaves();
      schedule();
    }

    chat.on('speak:start', function (detail) {
      var audio = detail && detail.audio;
      endReply();
      // An element routed through a suspended context plays silence, so the mouth is skipped unless the context runs.
      if (!audio || !gestured) return;
      var request = replyRequest;
      try {
        if (!replyContext) replyContext = new AudioContextClass();
        if (replyContext.state === 'running') { wireReply(audio); return; }
        if (!replyContext.resume) return;
        replyContext.resume().then(function () {
          // A newer reply (or this one already ending) may have arrived while resume() was pending;
          // wiring this stale audio now would silently freeze the mouth on whatever plays next.
          if (request !== replyRequest || replyContext.state !== 'running' || audio.ended) return;
          try { wireReply(audio); } catch (error) { endReply(); }
        }, function () {});
      } catch (error) {
        endReply(); // the element keeps playing on its own
      }
    });

    chat.on('speak:end', endReply);

    // ---- a gesture comes first ----

    function onGesture() {
      if (gestured) return;
      gestured = true;
      syncMic();
    }
    ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function (name) {
      document.addEventListener(name, onGesture, { capture: true, passive: true });
    });

    document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });
    window.addEventListener('pagehide', stopMic);

    // Hands-free's autoListen 'always' calls start() synchronously while ITS OWN script runs (theme.liquid loads
    // it before this file), announcing bazaar-voice:state before this file has attached the listener above — the
    // same race juniper-motion.js already accounts for. Without this, the mic (and so the wave and the halo)
    // would stay dark on the exact page-load path the pill exists for, until the shopper's first turn produced a
    // later, catchable state change.
    function handsfreeIsOn() {
      try { return Boolean(chat.handsfree && chat.handsfree.isOn && chat.handsfree.isOn()); } catch (error) { return false; }
    }
    if (handsfreeIsOn()) { voiceListening = true; syncMic(); }
  } catch (error) {
    if (window.console) window.console.error('[juniper-presence]', error);
  }
})();
