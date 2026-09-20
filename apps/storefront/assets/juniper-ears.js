// How Juniper hears. Two engines behind one SpeechRecognition-shaped constructor, window.BazaarChat.ears.Recognition:
//   browser — Chrome's own SpeechRecognition (live captions). Only Google Chrome really has it: Brave, Arc, Edge,
//             Firefox and Safari either lack it or fail with 'network' and hear nothing.
//   server  — the path push-to-talk always used: the microphone is recorded, a pause ends the clip, and our server
//             transcribes it (POST /api/voice/transcribe). Works wherever a microphone does. No live caption.
// 'auto' picks the browser engine in Google Chrome and the server engine elsewhere, and falls over to the server
// engine for the rest of the session the first time the browser engine fails. window.BazaarChatFlags.ears forces one.
(function () {
  var chat = window.BazaarChat;
  if (!chat) return;

  var Native = window.SpeechRecognition || window.webkitSpeechRecognition;
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var canRecord = Boolean(window.MediaRecorder && AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  var FALLBACK_KEY = 'bazaar:ears';
  var TICK_MS = 50;
  var SPEECH_ON_MS = 120;        // this long above the threshold is speech, not a click
  var SILENCE_MS = 750;          // this long below it ends the clip
  var MIN_CLIP_MS = 350;
  var MAX_CLIP_MS = 15000;
  var LEAD_IN_MS = 2500;         // the idle recorder is renewed this often
  var silentSessions = 0;
  var FLOOR_MIN = 0.012;         // quietest threshold: below this is room tone on any laptop

  function debug() {
    try { if (window.localStorage.getItem('bazaar:debug') !== '1' || !window.console) return; } catch (error) { return; }
    window.console.log.apply(window.console, ['[juniper-ears]'].concat(Array.prototype.slice.call(arguments)));
  }

  function isGoogleChrome() {
    var data = navigator.userAgentData;
    if (navigator.brave) return false;
    if (data && data.brands) return data.brands.some(function (brand) { return brand.brand === 'Google Chrome'; });
    return /Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\/|Arc\//.test(navigator.userAgent);
  }

  function engine() {
    var forced = window.BazaarChatFlags && window.BazaarChatFlags.ears;
    if (forced === 'browser' && Native) return 'browser';
    if (forced === 'server' && canRecord) return 'server';
    var fellOver = false;
    try { fellOver = window.sessionStorage.getItem(FALLBACK_KEY) === 'server'; } catch (error) { /* no storage */ }
    if (Native && isGoogleChrome() && !fellOver) return 'browser';
    if (canRecord) return 'server';
    return Native ? 'browser' : 'none';
  }

  function fallOver(reason) {
    if (!canRecord) return;
    debug('browser engine failed (' + reason + '): the server engine hears from now on');
    try { window.sessionStorage.setItem(FALLBACK_KEY, 'server'); } catch (error) { /* this page only */ }
  }

  // ---- the server engine: a SpeechRecognition look-alike ----
  function ServerRecognition() {
    this.continuous = true;
    this.interimResults = false;
    this.lang = 'en-US';
    this.maxClipMs = MAX_CLIP_MS;
    this._run = 0;
    this._live = false;
  }

  ServerRecognition.prototype._fire = function (name, event) {
    var handler = this['on' + name];
    if (typeof handler === 'function') { try { handler.call(this, event || {}); } catch (error) { /* the listener's problem */ } }
  };

  ServerRecognition.prototype.start = function () {
    if (this._live) throw new Error('recognition has already started');
    var self = this;
    var run = (this._run += 1);
    this._live = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      if (run !== self._run || !self._live) { stopTracks(stream); return; }
      self._listen(stream, run);
    }, function () {
      if (run !== self._run) return;
      self._live = false;
      self._fire('error', { error: 'not-allowed' });
      self._fire('end');
    });
  };

  function stopTracks(stream) {
    try { stream.getTracks().forEach(function (track) { track.stop(); }); } catch (error) { /* already stopped */ }
  }

  ServerRecognition.prototype._listen = function (stream, run) {
    var self = this;
    var context = new AudioCtx();
    var analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    // A page that is capturing the microphone may start audio without a gesture; a click is the backstop.
    var resume = function () { if (context.state === 'suspended' && context.resume) context.resume(); };
    resume();
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);

    var samples = new Float32Array(analyser.fftSize);
    var floor = FLOOR_MIN;
    var loudFor = 0;
    var quietFor = 0;
    var recorder = null;
    var chunks = [];
    var clipStarted = 0;

    function level() {
      analyser.getFloatTimeDomainData(samples);
      var sum = 0;
      for (var i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      return Math.sqrt(sum / samples.length);
    }

    // The recorder runs all the time so a clip keeps the breath before the first word ("Hey Jarvis", not "arvis").
    // While nobody speaks it is restarted every few seconds, so that lead-in stays short.
    var speaking = false;

    function startRecorder() {
      chunks = [];
      var mine = chunks;
      try { recorder = new window.MediaRecorder(stream); } catch (error) { recorder = null; return; }
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) mine.push(event.data); };
      recorder.start();
      clipStarted = Date.now();
    }

    function stopRecorder(keep) {
      var finished = recorder;
      var parts = chunks;
      var spoke = Date.now() - speechStarted;
      recorder = null;
      if (!finished) return;
      finished.onstop = function () {
        if (!keep || run !== self._run || spoke < MIN_CLIP_MS) return;
        self._transcribe(new Blob(parts, { type: finished.mimeType || 'audio/webm' }), run);
      };
      try { finished.stop(); } catch (error) { /* it never started */ }
    }

    var speechStarted = 0;
    this._stopListening = function (keepClip) {
      window.clearInterval(timer);
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      stopRecorder(Boolean(keepClip) && speaking);
      speaking = false;
      stopTracks(stream);
      try { context.close(); } catch (error) { /* closed */ }
    };

    startRecorder();
    var timer = window.setInterval(function () {
      if (run !== self._run) return;
      var now = level();
      var threshold = Math.max(FLOOR_MIN, floor * 2.8);
      if (!speaking) {
        if (now < threshold) floor = floor * 0.95 + now * 0.05;   // learn the room while nobody speaks
        loudFor = now >= threshold ? loudFor + TICK_MS : 0;
        if (loudFor >= SPEECH_ON_MS) {
          loudFor = 0; quietFor = 0; speaking = true; speechStarted = Date.now();
          debug('speech started');
          self._fire('speechstart');
        } else if (!loudFor && Date.now() - clipStarted >= LEAD_IN_MS) {
          stopRecorder(false);
          startRecorder();
        }
        return;
      }
      quietFor = now < threshold ? quietFor + TICK_MS : 0;
      if (quietFor >= SILENCE_MS || Date.now() - speechStarted >= (self.maxClipMs || MAX_CLIP_MS)) {
        quietFor = 0; speaking = false;
        self._fire('speechend');
        stopRecorder(true);
        startRecorder();
      }
    }, TICK_MS);

    debug('server engine listening');
    this._fire('start');
    this._fire('audiostart');
  };

  ServerRecognition.prototype._transcribe = function (clip, run) {
    var self = this;
    debug('transcribing', Math.round(clip.size / 1024) + ' KB');
    window.fetch(chat.apiUrl('/api/voice/transcribe'), { method: 'POST', headers: { 'Content-Type': clip.type || 'audio/webm' }, body: clip })
      .then(function (response) { if (!response.ok) throw new Error('transcribe ' + response.status); return response.json(); })
      .then(function (data) {
        var text = String((data && data.text) || '').trim();
        debug('heard', text);
        if (run !== self._run || !text) return;
        var alternative = { transcript: text, confidence: 0.9 };
        var result = [alternative];
        result.isFinal = true;
        result.item = function () { return alternative; };
        var results = [result];
        results.item = function () { return result; };
        // endpointed: the pause has already been waited for, so a listener need not wait for another one.
        self._fire('result', { resultIndex: 0, results: results, endpointed: true });
      })
      .catch(function (error) {
        debug('transcribe failed', error && error.message);
        if (run === self._run) self._fire('error', { error: 'network' });
      });
  };

  ServerRecognition.prototype._finish = function (keepClip) {
    if (!this._live) return;
    this._live = false;
    var self = this;
    if (this._stopListening) { this._stopListening(keepClip); this._stopListening = null; }
    if (!keepClip) this._run += 1;   // abort: a clip still being transcribed is dropped
    window.setTimeout(function () { self._fire('end'); }, 0);
  };
  ServerRecognition.prototype.stop = function () { this._finish(true); };
  ServerRecognition.prototype.abort = function () { this._finish(false); };

  // ---- what the features construct ----
  function Recognition() {
    var which = engine();
    debug('engine:', which);
    if (which === 'server') return new ServerRecognition();
    if (which === 'none') throw new Error('no way to hear');
    var session = new Native();
    // A Chrome that hears sound but never returns a word (its speech service is unreachable) fails silently.
    var heardSound = false;
    var gotResult = false;
    session.addEventListener('soundstart', function () { heardSound = true; });
    session.addEventListener('result', function () { gotResult = true; silentSessions = 0; });
    session.addEventListener('end', function () {
      if (!heardSound || gotResult) return;
      silentSessions += 1;
      if (silentSessions >= 2) fallOver('sound but no words, twice');
    });
    // Chrome without its speech service says 'network' or 'service-not-allowed'; the next session is the server's.
    session.addEventListener('error', function (event) {
      if (event && (event.error === 'network' || event.error === 'service-not-allowed' || event.error === 'language-not-supported')) fallOver(event.error);
    });
    return session;
  }

  chat.ears = { Recognition: engine() === 'none' ? null : Recognition, engine: engine, ServerRecognition: ServerRecognition };
})();
