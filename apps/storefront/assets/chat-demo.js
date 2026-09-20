(function () {
  var widget = document.querySelector('[data-ai-chat]');
  if (!widget) return;

  var toggle = widget.querySelector('[data-ai-chat-toggle]');
  var close = widget.querySelector('[data-ai-chat-close]');
  var panel = widget.querySelector('#ai-chat-panel');
  var messages = widget.querySelector('[data-ai-chat-messages]');
  var welcome = widget.querySelector('[data-ai-chat-welcome]');
  var mode = widget.querySelector('[data-ai-chat-mode]');
  var form = widget.querySelector('[data-ai-chat-form]');
  var input = widget.querySelector('[data-ai-chat-input]');
  var voiceToggle = widget.querySelector('[data-ai-chat-voice-toggle]');
  var micButton = widget.querySelector('[data-ai-chat-mic]');
  var promptButtons = widget.querySelectorAll('[data-ai-chat-prompt]');
  var productSource = document.querySelector('[data-ai-chat-products]');
  var currentProductSource = document.querySelector('[data-ai-chat-current-product]');
  var products = readJsonArray(productSource);
  var currentProduct = readJsonObject(currentProductSource);
  var shopperId = getShopperId();
  var endpoint = normalizeEndpoint(widget.getAttribute('data-ai-chat-endpoint'));
  var sending = false;
  var activeProduct = currentProduct || null;
  var negotiationId = null;
  var negotiationProductKey = null;
  var lastSentProductKey = null;
  var quantitySelectionChanged = false;
  var currentOfferArticle = null;
  var offerArticles = new Map();
  var offerPollers = new WeakMap();
  var countdownTimers = new WeakMap();
  var voiceAvailable = false;
  var voiceEnabled = false;
  var recording = false;
  var mediaRecorder = null;
  var audioChunks = [];
  var activeAudio = null;
  var activeAudioUrl = null;
  var defaultPlaceholder = input.getAttribute('placeholder') || 'Ask about outfits...';
  var promptsBox = widget.querySelector('[data-ai-chat-prompts]');
  var listenBar = widget.querySelector('[data-ai-chat-listen]');
  var listenStop = widget.querySelector('[data-ai-chat-listen-stop]');
  var waveBox = widget.querySelector('[data-ai-chat-wave]');
  var lastBotMessage = null;
  var speakTag = null;
  var currentMood = 'idle';
  var lastCard = null;
  // The seam for the juniper-*.js feature files: they listen and call in through window.BazaarChat and never edit
  // this file. A listener that throws must not take the chat down with it.
  var listeners = {};
  var payloadExtenders = [];
  var localTurns = [];
  var chipProvider = null;
  var flags = { voiceStaysOnClose: false };
  var spokenRepliesWanted = false;
  function emit(name, detail) {
    (listeners[name] || []).slice().forEach(function (listener) {
      try { listener(detail || {}); } catch (error) { if (window.console) window.console.error('[bazaar-chat:' + name + ']', error); }
    });
  }
  // Suggestions once an offer is on the table. No figures here: every dollar amount comes from the card.
  var CHIPS_AFTER = [['Is that your best?'], ['Meet me in the middle'], ['What would move it?']];
  var CHIP_REMOVE_ADD_ON = ['Skip the add-on', 'Could you do it without the add-on? Just the main item.'];
  var CHIPS_FINAL = [['Is that your best?'], ['What would move it?']];
  var ICONS = {
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9q2.5 3 0 6M18.5 6.5q5 5.5 0 11"/></svg>',
    speakerOff: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 21V4M6 5h11l-3 4 3 4H6"/></svg>'
  };

  // The shopkeeper is a die-cut sticker: flat shapes on a thick white cut line. The mood changes the face.
  function stickerSvg(mood) {
    var eyes = mood === 'pleased'
      ? '<path d="M22 35q3-4 6 0M36 35q3-4 6 0" fill="none" stroke="#2f1604" stroke-width="2.4" stroke-linecap="round"/>'
      : mood === 'thinking'
        ? '<circle cx="26" cy="33" r="2.4" fill="#2f1604"/><circle cx="40" cy="33" r="2.4" fill="#2f1604"/>'
        : '<circle cx="25" cy="35" r="2.4" fill="#2f1604"/><circle cx="39" cy="35" r="2.4" fill="#2f1604"/>';
    var mouth = mood === 'pleased' ? '<path d="M25 42q7 7 14 0"/>'
      : mood === 'firm' ? '<path d="M26 44h12"/>'
      : mood === 'speaking' ? '<ellipse cx="32" cy="44" rx="4.2" ry="3.4" fill="#2f1604"/>'
      : mood === 'thinking' ? '<path d="M28 44q3-2 7 0"/>'
      : '<path d="M26 42q6 5 12 0"/>';
    var brows = mood === 'firm' ? '<path d="M21 30l7 2M43 30l-7 2" fill="none" stroke="#2f1604" stroke-width="2.2" stroke-linecap="round"/>' : '';
    var ear = mood === 'listening' ? '<path d="M54 32q4 5 0 10M58 28q7 9 0 18" fill="none" stroke="#f3675a" stroke-width="2.4" stroke-linecap="round"/>' : '';
    var body = '<path d="M14 50q18 12 36 0l-3 9q-15 7 -30 0z"/><circle cx="32" cy="37" r="17"/><ellipse cx="32" cy="23" rx="25" ry="7"/><path d="M16 23q0-17 16-17t16 17z"/>';
    return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<g fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round">' + body + '</g>' +
      '<path d="M14 50q18 12 36 0l-3 9q-15 7 -30 0z" fill="#f3675a"/><circle cx="32" cy="37" r="17" fill="#fdf3e3"/>' +
      '<circle cx="20" cy="41" r="3.2" fill="#ff598b" opacity=".55"/><circle cx="44" cy="41" r="3.2" fill="#ff598b" opacity=".55"/>' +
      '<ellipse cx="32" cy="23" rx="25" ry="7" fill="#004c4c"/><path d="M16 23q0-17 16-17t16 17z" fill="#0a6464"/>' +
      '<path d="M16.4 19h31.2v4.5h-31.2z" fill="#f6d809"/>' + eyes + brows + ear +
      '<g fill="none" stroke="#2f1604" stroke-width="2.4" stroke-linecap="round">' + mouth + '</g></svg>';
  }

  function setMood(mood) {
    currentMood = mood;
    var head = widget.querySelector('[data-ai-chat-sticker="head"]');
    if (head) head.innerHTML = stickerSvg(mood);
    emit('mood', { mood: mood });
  }

  function cardMood(card) {
    var told = { offended: 'firm', tempted: 'pleased', deal: 'pleased', thinking: 'thinking' }[card.mood];
    if (card.status === 'pending_owner') return 'thinking';
    return told || (card.round >= (card.maxRounds || 4) ? 'firm' : 'pleased');
  }

  function renderChips(labels, stage) {
    if (!promptsBox) return;
    if (chipProvider) {
      var provided = null;
      try { provided = chipProvider({ labels: labels, stage: stage || 'offer', card: lastCard }); } catch (error) { provided = null; }
      if (Array.isArray(provided)) labels = provided;
    }
    promptsBox.innerHTML = labels.map(function (chip) {
      return '<button type="button" data-ai-chat-prompt="' + escapeHtml(chip[1] || chip[0]) + '">' + escapeHtml(chip[0]) + '</button>';
    }).join('');
    emit('chips', { labels: labels, stage: stage || 'offer' });
  }

  Array.prototype.forEach.call(widget.querySelectorAll('[data-ai-chat-sticker]'), function (node) { node.innerHTML = stickerSvg('idle'); });
  if (waveBox) {
    for (var bar = 0; bar < 34; bar += 1) waveBox.insertAdjacentHTML('beforeend', '<i style="animation-delay:-' + ((bar * 37) % 90) / 100 + 's"></i>');
  }

  if (currentProduct) setNegotiationForProduct(selectedProduct());

  var scriptedResponses = buildScriptedResponses();

  if (welcome) welcome.textContent = getWelcomeMessage();
  if (mode && !endpoint) mode.textContent = 'Demo mode. Offers need the live shop.';
  startCleanVisit();
  if (voiceToggle || micButton) loadVoiceConfig();

  function normalizeEndpoint(value) {
    return String(value || '').trim().replace(/\/$/, '');
  }

  function readJsonArray(source) {
    if (!source) return [];
    try {
      var parsed = JSON.parse(source.textContent);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function readJsonObject(source) {
    if (!source) return null;
    try {
      var parsed = JSON.parse(source.textContent);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function getShopperId() {
    var params = new URLSearchParams(window.location.search);
    var shopper = params.get('shopper');
    if (shopper) return shopper;
    try {
      var existing = window.localStorage.getItem('bazaar:shopper-id');
      if (existing) return existing;
      var created = 'shopper-' + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem('bazaar:shopper-id', created);
      return created;
    } catch (error) {
      // Storage is blocked (private browsing). A constant here would merge every such shopper into one identity,
      // one thread and one memory; a fresh id per page keeps them apart at the cost of continuity.
      return 'shopper-' + Math.random().toString(36).slice(2, 10);
    }
  }

  // The opening line for a remembered shopper is whatever the server recalled about them, never a line written here.
  // It replaces the plain welcome only while the conversation has not started, and only if one came back.
  function greetFromMemory() {
    var url = endpoint.replace(/\/api\/(?:chat|accept|offers)$/i, '') + '/api/greeting';
    return window.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopperId: shopperId, product: currentProduct }) })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || typeof data.greeting !== 'string' || !data.greeting || !welcome || !welcome.isConnected) return;
        if (messages && messages.querySelector('.ai-chat__message--user, .ai-chat__offer-card')) return;
        welcome.textContent = data.greeting;
      })
      .catch(function () {});
  }

  // ?shopper= names a shareable identity (the demo shopper). Each page load under it is a new visit: the server
  // drops the carried product, round and thread. What the shopkeeper remembers about the shopper is untouched.
  function startCleanVisit() {
    if (!endpoint || !new URLSearchParams(window.location.search).get('shopper')) return;
    // A page reached from inside the chat, or with hands-free on, carries the conversation (juniper-persist.js sets this).
    try { if (window.sessionStorage.getItem('bazaar:carry') === '1') return; } catch (error) { /* storage blocked: a clean visit */ }
    var url = endpoint.replace(/\/api\/(?:chat|accept|offers)$/i, '') + '/api/session/reset';
    try {
      var pending = window.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopperId: shopperId }) });
      if (pending && pending.then) pending.then(greetFromMemory, function () {});
    } catch (error) { /* a failed reset must never stop the chat from loading */ }
  }

  function getWelcomeMessage() {
    if (currentProduct) {
      return 'Eyeing ' + currentProduct.title + '? Name a price and give me a reason — bundles, budget, or race-day plans help.';
    }
    if (products.length) {
      return 'Hi, I can see ' + products.length + ' published products. Make me an offer, ask for a student discount, or try for a small bundle perk.';
    }
    return 'Hi, make me an offer or ask for a small bundle perk. Try one of the prompts below.';
  }

  function buildScriptedResponses() {
    return [
      {
        terms: ['weekend', 'outfit', 'recommend', 'style'],
        text: products.length
          ? 'For a clean weekend fit, I would start with ' + formatProductList(products.slice(0, 3)) + '.'
          : 'For a clean weekend fit, start with a tee, an overshirt, and a useful bag.'
      },
      {
        terms: ['price', 'prices', 'catalog', 'products', 'shop', 'how much'],
        text: summarizeCatalog(products) || 'I do not see published storefront products yet.'
      },
      {
        terms: ['shipping', 'returns', 'return', 'delivery'],
        text: 'Demo shipping is shown as 3–5 business days, with easy returns within 30 days.'
      },
      {
        terms: ['size', 'sizing', 'tee', 'fit'],
        text: 'Choose your usual size, or size up for a relaxed fit. On a product page I can use the selected product as context.'
      },
      {
        terms: ['offer', 'deal', 'discount', 'checkout', 'haggle', '$'],
        text: 'Send a specific number and a reason, like “Could you do $120? I’m buying socks too.” Stronger reasons get sharper offers.'
      }
    ];
  }

  function getContextPayload(text) {
    var contextProduct = getContextProduct();
    var payload = {
      message: text,
      shopperId: shopperId,
      pageUrl: window.location.href,
      product: contextProduct.product,
      productContextSource: contextProduct.source,
      products: products.slice(0, 8)
    };
    if (contextProduct.product && contextProduct.product.quantity !== undefined) payload.quantity = contextProduct.product.quantity;
    var key = productKey(contextProduct.product);
    if (negotiationId && negotiationProductKey === key) payload.negotiationId = negotiationId;
    if (lastSentProductKey && lastSentProductKey !== key) payload.variantSelectionChanged = true;
    if (quantitySelectionChanged) {
      payload.quantitySelectionChanged = true;
      quantitySelectionChanged = false;
    }
    lastSentProductKey = key;
    payloadExtenders.forEach(function (extend) {
      try { extend(payload); } catch (error) { /* a feature file must never block a turn */ }
    });
    return payload;
  }

  function productKey(product) {
    if (!product) return 'none';
    return [product.productId || product.id || product.handle || product.title || '', product.selectedVariantId || 'default'].join(':');
  }

  function selectedProduct() {
    if (!currentProduct) return null;
    var selector = document.querySelector('select[name="id"], select[id^="ProductSelect-"]');
    var selectedVariantId = selector && selector.value ? String(selector.value) : currentProduct.selectedVariantId;
    var selectedVariant = (currentProduct.variants || []).find(function (variant) {
      return String(variant.id) === String(selectedVariantId);
    });
    var quantityInput = document.querySelector('input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]');
    var quantity = quantityInput && quantityInput.value ? Number(quantityInput.value) : 1;
    return Object.assign({}, currentProduct, {
      selectedVariantId: selectedVariantId,
      quantity: Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1,
      ...(selectedVariant ? { selectedVariantTitle: selectedVariant.title, price: selectedVariant.price } : {})
    });
  }

  function setNegotiationForProduct(product, quantityChanged) {
    var key = productKey(product);
    if (negotiationProductKey && (negotiationProductKey !== key || quantityChanged)) negotiationId = null;
    negotiationProductKey = key;
  }

  function askEndpoint(text) {
    return window.fetch(chatUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getContextPayload(text))
    }).then(function (response) {
      if (!response.ok) throw new Error('Chat endpoint returned ' + response.status);
      return response.json();
    });
  }

  function offersUrl(card) {
    var path = '/api/offers/' + encodeURIComponent(card.offerId);
    var query = '?shopperId=' + encodeURIComponent(shopperId) + '&negotiationId=' + encodeURIComponent(card.negotiationId || '');
    if (/\/api\/chat$/i.test(endpoint)) return endpoint.replace(/\/api\/chat$/i, path) + query;
    if (/\/api\/accept$/i.test(endpoint)) return endpoint.replace(/\/api\/accept$/i, path) + query;
    if (/\/api\/offers$/i.test(endpoint)) return endpoint.replace(/\/api\/offers$/i, path) + query;
    return endpoint + path + query;
  }

  function chatUrl() {
    if (/\/api\/chat$/i.test(endpoint)) return endpoint;
    return endpoint + '/api/chat';
  }

  function apiUrl(path) {
    if (!endpoint) return '';
    if (/\/api\/(?:chat|accept|offers)$/i.test(endpoint)) return endpoint.replace(/\/api\/(?:chat|accept|offers)$/i, path);
    return endpoint + path;
  }

  function loadVoiceConfig() {
    syncVoiceUi();
    if (!endpoint) return;
    window.fetch(apiUrl('/api/voice/config'), { headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Voice config returned ' + response.status);
        return response.json();
      })
      .then(function (config) {
        voiceAvailable = Boolean(config && config.enabled && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        // A feature file may have asked for spoken replies before the voice config arrived.
        if (voiceAvailable && spokenRepliesWanted && !voiceEnabled) { voiceEnabled = true; emit('spoken-replies', { on: true }); }
        syncVoiceUi();
      })
      .catch(function () {
        voiceAvailable = false;
        syncVoiceUi();
      });
  }

  function syncVoiceUi() {
    if (voiceToggle) {
      voiceToggle.hidden = !voiceAvailable;
      voiceToggle.setAttribute('aria-pressed', voiceEnabled ? 'true' : 'false');
      voiceToggle.setAttribute('aria-label', voiceEnabled ? 'Turn spoken replies off' : 'Turn spoken replies on');
      voiceToggle.innerHTML = voiceEnabled ? ICONS.speaker : ICONS.speakerOff;
    }
    if (micButton) {
      micButton.hidden = !voiceAvailable;
      micButton.disabled = !voiceAvailable || sending;
      micButton.classList.toggle('is-recording', recording);
    }
    if (listenBar) listenBar.hidden = !recording;
    if (listenBar) form.hidden = recording;
    if (promptsBox) promptsBox.hidden = recording;
    if (recording) setMood('listening');
    else if (currentMood === 'listening') setMood('idle');
  }

  function stopSpeaking() {
    if (speakTag) { speakTag.remove(); speakTag = null; }
    if (currentMood === 'speaking') setMood('idle');
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
      emit('speak:end', { spoken: true });
    }
    if (activeAudioUrl) {
      window.URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = null;
    }
  }

  function speakReply(text) {
    if (!voiceEnabled || !voiceAvailable || !text) { emit('speak:end', { spoken: false }); return Promise.resolve(); }
    stopSpeaking();
    return window.fetch(apiUrl('/api/voice/speak'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 600) })
    }).then(function (response) {
      if (!response.ok) throw new Error('Voice reply returned ' + response.status);
      return response.blob();
    }).then(function (blob) {
      if (!voiceEnabled) return;
      activeAudioUrl = window.URL.createObjectURL(blob);
      activeAudio = new window.Audio(activeAudioUrl);
      activeAudio.addEventListener('ended', stopSpeaking, { once: true });
      if (lastBotMessage) {
        speakTag = document.createElement('span');
        speakTag.className = 'ai-chat__speak';
        speakTag.innerHTML = '<span class="ai-chat__wave" aria-hidden="true"><i></i><i style="animation-delay:-.3s"></i><i style="animation-delay:-.6s"></i><i style="animation-delay:-.15s"></i><i style="animation-delay:-.45s"></i></span>Reading this aloud<button type="button" data-ai-chat-stop-speaking>Stop</button>';
        lastBotMessage.appendChild(speakTag);
        setMood('speaking');
      }
      emit('speak:start', { audio: activeAudio, text: text });
      return activeAudio.play();
    }).catch(function () {
      var wasPlaying = Boolean(activeAudio);
      stopSpeaking();
      if (!wasPlaying) emit('speak:end', { spoken: false });
    });
  }

  function preferredRecordingType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find(function (type) { return window.MediaRecorder.isTypeSupported(type); }) || '';
  }

  function startRecording() {
    if (!voiceAvailable || recording) return;
    voiceEnabled = true;
    stopSpeaking();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mimeType = preferredRecordingType();
      mediaRecorder = mimeType ? new window.MediaRecorder(stream, { mimeType: mimeType }) : new window.MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.addEventListener('dataavailable', function (event) {
        if (event.data && event.data.size) audioChunks.push(event.data);
      });
      mediaRecorder.addEventListener('stop', function () {
        stream.getTracks().forEach(function (track) { track.stop(); });
        var audio = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        recording = false;
        input.setAttribute('placeholder', 'Transcribing...');
        syncVoiceUi();
        transcribeAudio(audio);
      }, { once: true });
      recording = true;
      input.setAttribute('placeholder', 'Listening...');
      mediaRecorder.start();
      syncVoiceUi();
    }).catch(function () {
      addMessage('I could not access the microphone. Check the browser microphone permission and try again.', 'bot');
      recording = false;
      input.setAttribute('placeholder', defaultPlaceholder);
      syncVoiceUi();
    });
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
  }

  function transcribeAudio(audio) {
    window.fetch(apiUrl('/api/voice/transcribe'), {
      method: 'POST',
      headers: { 'Content-Type': audio.type || 'audio/webm' },
      body: audio
    }).then(function (response) {
      if (!response.ok) throw new Error('Voice transcription returned ' + response.status);
      return response.json();
    }).then(function (result) {
      input.value = String(result.text || '').trim();
      if (input.value) form.requestSubmit();
    }).catch(function () {
      addMessage('I could not transcribe that recording. Please try again.', 'bot');
    }).finally(function () {
      input.setAttribute('placeholder', defaultPlaceholder);
      syncVoiceUi();
    });
  }

  function acceptUrl() {
    if (/\/api\/chat$/i.test(endpoint)) return endpoint.replace(/\/api\/chat$/i, '/api/accept');
    if (/\/api\/accept$/i.test(endpoint)) return endpoint;
    return endpoint + '/api/accept';
  }

  function acceptOffer(card, button) {
    button.__bazaarAccepting = true;
    button.disabled = true;
    button.textContent = 'Sealing the deal…';
    return window.fetch(acceptUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offerId: card.offerId,
        negotiationId: card.negotiationId,
        shopperId: shopperId
      })
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data && data.reply ? data.reply : 'Accept failed');
        return data;
      });
    }).then(function (data) {
      var settlement = data.settlement;
      button.textContent = 'Opening checkout';
      addMessage(data.reply || 'Deal — opening Shopify Checkout.', 'bot');
      window.location.href = settlement.checkoutUrl;
    }).catch(function (error) {
      button.__bazaarAccepting = false;
      button.disabled = false;
      button.textContent = dealLabel(card);
      addMessage(error.message || 'That offer could not be accepted. Try a fresh offer.', 'bot');
    });
  }

  function openChat() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () { input.focus(); }, 80);
    emit('open');
  }

  function closeChat() {
    if (recording) stopRecording();
    if (!flags.voiceStaysOnClose) stopSpeaking();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
    emit('close');
  }

  function addMessage(text, type) {
    var message = document.createElement('p');
    message.className = 'ai-chat__message ai-chat__message--' + type;
    message.textContent = text;
    if (type === 'bot') {
      var row = document.createElement('div');
      row.className = 'ai-chat__row';
      row.innerHTML = '<span class="ai-chat__sticker ai-chat__sticker--row" aria-hidden="true">' + stickerSvg(currentMood) + '</span>';
      row.appendChild(message);
      messages.appendChild(row);
      lastBotMessage = message;
    } else {
      messages.appendChild(message);
    }
    messages.scrollTop = messages.scrollHeight;
    emit('message', { element: message, type: type, text: text });
    return message;
  }

  function addThinking() {
    var message = addMessage('Doing the maths', 'bot');
    message.insertAdjacentHTML('beforeend', '<span class="ai-chat__steps" aria-hidden="true"><i></i><i></i><i></i><i></i></span>');
    setRowMood(message, 'thinking');
    setMood('thinking');
    return message;
  }

  function setRowMood(message, mood) {
    var face = message.parentNode && message.parentNode.querySelector('.ai-chat__sticker--row');
    if (face) face.innerHTML = stickerSvg(mood);
  }

  function replaceMessage(message, text) {
    message.textContent = text;
    messages.scrollTop = messages.scrollHeight;
  }

  function shopperReplyText(text) {
    var cleaned = String(text || '')
      .replace(/(?:^|\s)reference:\s*[^.!?]*(?:\[\s*memory\s*#?\s*\d+\s*\]|from memory)[.!?]?/gi, ' ')
      .replace(/\[\s*memory\s*#?\s*\d+\s*\]/gi, '')
      .replace(/\bmemories?\s*\[\s*\d+\s*\]/gi, '')
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return cleaned || 'Here is what I found.';
  }

  function addOfferCard(card, sourceProducts) {
    if (!card || !card.option) return;
    lastCard = card;
    emit('card', { card: card, products: sourceProducts });
    var negotiationKey = card.negotiationId || card.offerId;
    var priorArticle = offerArticles.get(negotiationKey);
    if (priorArticle && priorArticle.__bazaarCard && priorArticle.__bazaarCard.offerId === card.offerId) {
      // The server restated the offer already on the table: the same card moves under the new reply.
      messages.appendChild(priorArticle);
      renderOfferState(priorArticle, card, priorArticle.querySelector('[data-offer-actions] button'));
      showCardTop(priorArticle);
      return;
    }
    if (priorArticle && priorArticle.__bazaarCard) markSuperseded(priorArticle);
    var article = document.createElement('article');
    var dealButton = document.createElement('button');
    var productLink = document.createElement('a');
    var firstItem = card.option.items && card.option.items[0] ? card.option.items[0] : {};
    var itemSummary = offerItemsMarkup(card.option.items);
    var expires = new Date(card.expiresAt);

    article.className = 'ai-chat__offer-card';
    article.__bazaarCard = card;
    article.__bubbleText = lastBotMessage ? lastBotMessage.textContent : '';
    article.innerHTML = [
      '<div class="ai-chat__offer-topline">',
      '<span data-offer-status-label>' + escapeHtml(statusLabel(card)) + '</span>',
      '<span data-offer-countdown="' + escapeHtml(card.expiresAt) + '" aria-live="off">15:00</span>',
      '</div>',
      '<div class="ai-chat__rounds" data-offer-rounds></div>',
      '<h3>' + escapeHtml(firstItem.title || 'Trailhead offer') + '</h3>',
      '<ul class="ai-chat__offer-items" data-offer-items>' + itemSummary + '</ul>',
      '<p class="ai-chat__offer-price" data-offer-price>' + offerPriceMarkup(card) + '</p>',
      '<p class="ai-chat__offer-total-note" data-offer-total-note>Subtotal before shipping and tax</p>',
      '<p data-offer-line>' + escapeHtml(card.line || 'I can hold this for 15 minutes.') + '</p>',
      '<div class="ai-chat__badges" data-offer-badges>' + badgesMarkup(card) + '</div>',
      '<div class="ai-chat__trail" data-offer-trail>' + trailMarkup(card) + '</div>',
      '<div class="ai-chat__offer-actions" data-offer-actions></div>',
      '<p class="ai-chat__offer-footer">' + escapeHtml((card.disclosure && card.disclosure[1]) || 'Only this card is binding.') + '</p>'
    ].join('');

    var cardProduct = findProductByTitle(firstItem.title, sourceProducts) || activeProduct || currentProduct || getPrimaryProduct();
    setActiveProduct(cardProduct);
    productLink.href = cardProduct && cardProduct.url ? cardProduct.url : '/collections/all';
    productLink.textContent = 'View item';
    dealButton.type = 'button';
    dealButton.addEventListener('click', function () {
      acceptOffer(card, dealButton);
    });

    article.querySelector('[data-offer-actions]').appendChild(dealButton);
    article.querySelector('[data-offer-actions]').appendChild(productLink);
    messages.appendChild(article);
    widget.classList.add('ai-chat--has-offer');
    currentOfferArticle = article;
    offerArticles.set(negotiationKey, article);
    renderOfferState(article, card, dealButton);
    showCardTop(article);
    if (endpoint && (card.status === 'live' || card.status === 'pending_owner')) startOfferPolling(card, article, dealButton);
  }

  // The pane scrolls to the card's top; a card that fits lands fully in view because the browser clamps the scroll.
  function showCardTop(article) {
    messages.scrollTop = article.offsetTop - 12;
  }

  function dealLabel(card) {
    return 'Deal at ' + money(card.option && card.option.total);
  }

  // An offer that has been replaced collapses to one line: its round and its total.
  function markSuperseded(article) {
    if (!article || !article.__bazaarCard) return;
    var card = article.__bazaarCard = Object.assign({}, article.__bazaarCard, { status: 'superseded' });
    var countdown = article.querySelector('[data-offer-countdown]');
    if (countdown && countdownTimers.get(countdown)) window.clearTimeout(countdownTimers.get(countdown));
    article.setAttribute('data-offer-status', 'superseded');
    article.classList.add('ai-chat__offer-card--superseded');
    article.innerHTML = '<span>Round ' + escapeHtml(String(card.round || 1)) + ' · ' + supersededItemsLabel(card.option && card.option.items) + '</span><span aria-hidden="true">·</span><span>' + money(card.option && card.option.total) + '</span><span class="visually-hidden">, replaced by a newer offer</span>';
    var poller = offerPollers.get(article);
    if (poller) { window.clearInterval(poller); offerPollers.delete(article); }
    var key = article.__bazaarCard.negotiationId || article.__bazaarCard.offerId;
    if (offerArticles.get(key) === article) offerArticles.delete(key);
  }

  function renderOfferState(article, card, button) {
    if (card.status === 'superseded') { article.__bazaarCard = card; markSuperseded(article); return; }
    article.__bazaarCard = card;
    article.setAttribute('data-offer-status', card.status || 'live');
    var status = article.querySelector('[data-offer-status-label]');
    var title = article.querySelector('h3');
    var items = article.querySelector('[data-offer-items]');
    var price = article.querySelector('[data-offer-price]');
    var badges = article.querySelector('[data-offer-badges]');
    var trail = article.querySelector('[data-offer-trail]');
    var line = article.querySelector('[data-offer-line]');
    var firstItem = card.option && card.option.items && card.option.items[0] ? card.option.items[0] : {};
    var rounds = article.querySelector('[data-offer-rounds]');
    var isFinal = (card.round || 1) >= (card.maxRounds || 4);
    if (rounds) { rounds.innerHTML = roundsMarkup(card); rounds.setAttribute('role', 'img'); rounds.setAttribute('aria-label', statusLabel(card)); }
    article.classList.toggle('is-final', isFinal && card.status === 'live');
    if (article === currentOfferArticle) renderChips(card.status === 'pending_owner' ? [] : offerChips(card, isFinal), card.status === 'pending_owner' ? 'pending_owner' : isFinal ? 'final' : 'offer');
    if (status) status.textContent = statusLabel(card);
    if (title) title.textContent = firstItem.title || 'Trailhead offer';
    if (items) items.innerHTML = offerItemsMarkup(card.option && card.option.items);
    if (price) price.innerHTML = offerPriceMarkup(card);
    if (line) line.textContent = card.line || 'I can hold this for 15 minutes.';
    // The bubble above already says it; the card repeats the line only when a poll has changed it.
    if (line) line.hidden = Boolean(article.__bubbleText) && line.textContent === article.__bubbleText;
    if (badges) badges.innerHTML = badgesMarkup(card);
    if (trail) trail.innerHTML = trailMarkup(card);
    var countdown = article.querySelector('[data-offer-countdown]');
    var pending = card.status === 'pending_owner';
    var expiry = pending && card.pendingUntil ? new Date(card.pendingUntil) : new Date(card.expiresAt);
    countdown.setAttribute('data-offer-countdown', expiry.toISOString());
    button.disabled = button.__bazaarAccepting || !endpoint || card.status !== 'live';
    button.textContent = button.__bazaarAccepting ? 'Sealing the deal…' : !endpoint ? 'Offers are offline' : pending ? 'Waiting for owner' : card.status === 'live' ? dealLabel(card) : 'Offer unavailable';
    startCountdown(countdown, expiry, button, pending);
  }

  // Keep the card readable while an older hosted server may still send engine-era labels.
  function badgesMarkup(card) {
    var seen = {};
    return (card.badges || []).map(shopperBadge).filter(function (badge) {
      if (!badge || seen[badge]) return false;
      seen[badge] = true;
      return true;
    }).map(function (badge) { return '<span>' + escapeHtml(badge) + '</span>'; }).join('');
  }

  function shopperBadge(badge) {
    var label = String(badge || '').trim();
    var legacy = {
      'reason needed': 'needs a reason',
      'firm counter': 'price held firm',
      'bundle value': 'bundle offer',
      'seller counter': '',
      'good intent': ''
    };
    if (Object.prototype.hasOwnProperty.call(legacy, label.toLowerCase())) return legacy[label.toLowerCase()];
    var reason = label.match(/^reason:\s*(.+)$/i);
    if (!reason) return label;
    return {
      'budget': 'for a tight budget',
      'quantity intent': 'for a bigger cart',
      'add-on intent': 'for adding gear',
      'repeat shopper': 'for coming back',
      'market comparison': 'for a fair comparison',
      'real use case': 'for real plans',
      'ready to buy': 'for buying today'
    }[reason[1].toLowerCase()] || '';
  }

  function trailMarkup(card) {
    return (card.trail || []).map(function (step, index) {
      var who = step.by === 'shopper' ? 'You' : index === 0 ? 'List' : 'Me';
      return '<span>' + who + ' ' + money(step.amount) + '</span>';
    }).join('');
  }

  function offerPriceMarkup(card) {
    var option = card.option || {};
    var discounted = Number(option.listTotal) > Number(option.total);
    return (discounted ? '<span>' + money(option.listTotal) + '</span>' : '') + '<strong>' + money(option.total) + '</strong>';
  }

  function offerChips(card, isFinal) {
    if (isFinal) return CHIPS_FINAL;
    var items = card.option && card.option.items || [];
    var hasAddOn = Boolean(card.option && (card.option.kind === 'bundle' || items.some(function (item) {
      return item.thrownIn;
    })));
    return hasAddOn ? CHIPS_AFTER.concat([CHIP_REMOVE_ADD_ON]) : CHIPS_AFTER;
  }

  function roundsMarkup(card) {
    var total = card.maxRounds || 4;
    var here = card.round || 1;
    var out = '';
    for (var round = 1; round <= total; round += 1) {
      out += '<i class="' + (round < here ? 'is-done' : round === here ? 'is-here' : '') + '"></i><b class="' + (round < here ? 'is-done' : '') + '"></b>';
    }
    return out + ICONS.flag;
  }

  function offerItemsMarkup(items) {
    return (items || []).map(function (item) {
      var size = item.size ? ' · size ' + escapeHtml(item.size) : '';
      var quantity = item.qty === undefined || item.qty === null ? 1 : item.qty;
      var list = Number(item.listPrice) > 0 ? ' · list ' + money(item.listPrice) : '';
      return '<li>' + escapeHtml(item.title || 'Item') + size + ' · qty ' + escapeHtml(String(quantity)) + list + '</li>';
    }).join('');
  }

  function supersededItemsLabel(items) {
    return (items || []).map(function (item) {
      var quantity = Number(item.qty) || 1;
      return escapeHtml((quantity > 1 ? quantity + ' × ' : '') + (item.title || 'Item'));
    }).join(' + ') || 'Offer';
  }

  function startOfferPolling(card, article, button) {
    var poller = offerPollers.get(article);
    if (poller) window.clearInterval(poller);
    var poll = function () {
      window.fetch(offersUrl(card), { headers: { Accept: 'application/json' } }).then(function (response) {
        if (!response.ok) throw new Error('Offer status returned ' + response.status);
        return response.json();
      }).then(function (data) {
        if (!data || !data.card || article.__bazaarCard.status === 'superseded') return;
        var next = data.card;
        var line = article.querySelector('[data-offer-line]');
        if (line && next.line) line.textContent = next.line;
        renderOfferState(article, next, button);
        if (next.status !== 'live' && next.status !== 'pending_owner') {
          window.clearInterval(offerPollers.get(article));
          offerPollers.delete(article);
        }
      }).catch(function () { /* Keep the current card usable while the status endpoint is unavailable. */ });
    };
    poller = window.setInterval(poll, 2000);
    offerPollers.set(article, poller);
  }

  function addProductCard(product) {
    if (!product) return;
    setActiveProduct(product);
    var card = document.createElement('a');
    var meta = [product.type, product.available === false ? 'Sold out' : 'Open to offers'].filter(Boolean).join(' · ');
    card.className = 'ai-chat__product-card';
    card.href = product.url || '/collections/all';
    card.innerHTML = [
      product.image ? '<span class="ai-chat__product-image"><img src="' + escapeHtml(product.image) + '" alt=""></span>' : '<span class="ai-chat__product-image ai-chat__product-image--empty" aria-hidden="true">◎</span>',
      '<span class="ai-chat__product-copy">',
      '<strong>' + escapeHtml(product.title || 'Shop product') + '</strong>',
      '<small>' + escapeHtml(meta || 'View product') + '</small>',
      '</span>',
      '<span class="ai-chat__product-price">' + escapeHtml(product.price || money(product.listPrice)) + '</span>'
    ].join('');
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  function startCountdown(node, expires, button, pending) {
    var previous = countdownTimers.get(node);
    if (previous) window.clearTimeout(previous);
    function tick() {
      var remaining = Math.max(0, expires.getTime() - Date.now());
      var minutes = Math.floor(remaining / 60000);
      var seconds = Math.floor((remaining % 60000) / 1000);
      node.textContent = minutes + ':' + String(seconds).padStart(2, '0');
      if (!remaining) {
        countdownTimers.delete(node);
        button.disabled = true;
        button.textContent = pending ? 'Approval expired' : 'Expired';
        return;
      }
      countdownTimers.set(node, window.setTimeout(tick, 1000));
    }
    tick();
  }

  function statusLabel(card) {
    var label = 'Round ' + (card.round || 1) + ' of ' + (card.maxRounds || 4);
    if (card.status === 'pending_owner') return 'With the owner';
    return (card.round || 1) >= (card.maxRounds || 4) ? 'Final offer · ' + label.toLowerCase() : label;
  }

  function setLoading(isLoading) {
    sending = isLoading;
    form.classList.toggle('is-loading', isLoading);
    input.disabled = isLoading;
    form.querySelector('button[type="submit"]').disabled = isLoading;
    syncVoiceUi();
  }

  function getScriptedResponse(text) {
    var normalized = text.toLowerCase();
    var match = scriptedResponses.find(function (response) {
      return response.terms.some(function (term) { return normalized.indexOf(term) !== -1; });
    });
    return match ? match.text : summarizeCatalog(products) || 'I can help with product ideas, sizing, or a specific offer.';
  }

  function getPrimaryProduct() {
    return currentProduct || products[0] || null;
  }

  function getContextProduct() {
    if (activeProduct) {
      var product = activeProduct === currentProduct ? selectedProduct() : activeProduct;
      setNegotiationForProduct(product);
      return { product: product, source: activeProduct === currentProduct ? 'current' : 'active' };
    }
    if (currentProduct) {
      var current = selectedProduct();
      setNegotiationForProduct(current);
      return { product: current, source: 'current' };
    }
    return { product: null, source: 'none' };
  }

  function setActiveProduct(product) {
    if (product && typeof product === 'object') {
      var sameAsCurrent = currentProduct && (
        String(product.productId || '') === String(currentProduct.productId || '')
        || String(product.handle || '') === String(currentProduct.handle || '')
      );
      activeProduct = sameAsCurrent ? currentProduct : product;
      setNegotiationForProduct(activeProduct === currentProduct ? selectedProduct() : activeProduct);
    }
  }

  function getTurnProduct(text, sourceProducts, card) {
    var pool = Array.isArray(sourceProducts) && sourceProducts.length ? sourceProducts : products;
    if (card && card.option && card.option.items && card.option.items[0]) {
      var cardProduct = findProductByTitle(card.option.items[0].title, pool);
      if (cardProduct) return cardProduct;
    }
    var normalized = String(text || '').toLowerCase();
    var named = pool.find(function (product) {
      return product && (
        normalized.indexOf(String(product.title || '').toLowerCase()) !== -1 ||
        normalized.indexOf(String(product.handle || '').toLowerCase()) !== -1
      );
    });
    return named || activeProduct || currentProduct || pool[0] || null;
  }

  function findProductByTitle(title, sourceProducts) {
    if (!title) return null;
    var pool = Array.isArray(sourceProducts) && sourceProducts.length ? sourceProducts : products;
    return pool.find(function (product) {
      return String(product.title || '').toLowerCase() === String(title || '').toLowerCase();
    }) || null;
  }

  function summarizeCatalog(items) {
    if (!items.length) return '';
    return 'I can see these storefront prices: ' + formatProductList(items.slice(0, 4)) + '.';
  }

  function formatProductList(items) {
    return items.map(function (product) {
      return product.title + (product.price ? ' (' + product.price + ')' : '');
    }).join(', ');
  }

  function money(cents) {
    var amount = Math.round(Number(cents || 0));
    var whole = Math.floor(amount / 100);
    var remainder = amount % 100;
    return '$' + whole + (remainder ? '.' + String(remainder).padStart(2, '0') : '');
  }

  function normalizeCents(value) {
    return Number(value) < 1000 ? Math.round(Number(value) * 100) : Number(value);
  }

  function parseMoney(value) {
    var match = String(value || '').match(/(\d+(?:\.\d{1,2})?)/);
    return match ? Number(match[1]) : null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) openChat();
    else closeChat();
  });

  if (close) {
    close.addEventListener('click', function (event) {
      event.preventDefault();
      closeChat();
    });
  }

  if (voiceToggle) {
    voiceToggle.addEventListener('click', function () {
      if (!voiceAvailable) return;
      voiceEnabled = !voiceEnabled;
      spokenRepliesWanted = voiceEnabled;
      emit('spoken-replies', { on: voiceEnabled });
      if (!voiceEnabled) {
        if (recording) stopRecording();
        stopSpeaking();
      }
      syncVoiceUi();
    });
  }

  if (micButton) {
    micButton.addEventListener('click', function () {
      if (recording) stopRecording();
      else startRecording();
    });
  }

  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('[data-ai-chat-close]')) {
      event.preventDefault();
      closeChat();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) closeChat();
  });

  widget.addEventListener('click', function (event) {
    var chip = event.target && event.target.closest && event.target.closest('[data-ai-chat-prompt]');
    if (chip) {
      input.value = chip.getAttribute('data-ai-chat-prompt');
      form.requestSubmit();
    }
    if (event.target && event.target.closest && event.target.closest('[data-ai-chat-stop-speaking]')) stopSpeaking();
  });

  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('[data-ai-chat-open]')) {
      event.preventDefault();
      openChat();
    }
  });

  if (listenStop) listenStop.addEventListener('click', stopRecording);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;
    var text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';
    emit('turn:start', { text: text });

    // A feature file may answer a turn on the page (a shopping chore). Such a turn never reaches the server, so it
    // can never be read as an offer. 'turn:local' is its ending, the way 'reply' and 'turn:error' end the others.
    var claimed = localTurns.some(function (claim) { try { return claim(text) === true; } catch (error) { return false; } });
    if (claimed) { emit('turn:local', { text: text }); return; }

    if (endpoint) {
      setLoading(true);
      var thinking = addThinking();
      askEndpoint(text).then(function (data) {
        var context = getContextProduct();
        var reply = shopperReplyText(data.reply || data.text || data.message || 'Here is what I found.');
        replaceMessage(thinking, reply);
        emit('reply', { text: reply, data: data, element: thinking });
        speakReply(reply);
        var turnProduct = getTurnProduct(text, data.products, data.card);
        var onThisPage = currentProduct && turnProduct && String(turnProduct.handle || '') === String(currentProduct.handle || '');
        if (data.card || onThisPage) setActiveProduct(turnProduct);
        else addProductCard(turnProduct);
        if (data && data.negotiationId) {
          negotiationId = data.negotiationId;
          negotiationProductKey = productKey(activeProduct === currentProduct ? selectedProduct() : turnProduct || context.product);
        }
        setMood(data.card ? cardMood(data.card) : 'idle');
        setRowMood(thinking, currentMood);
        if (data.card) {
          negotiationId = data.card.negotiationId || negotiationId;
          negotiationProductKey = productKey(activeProduct === currentProduct ? selectedProduct() : turnProduct || context.product);
          addOfferCard(data.card, data.products);
        }
      }).catch(function () {
        replaceMessage(thinking, 'The shopkeeper is temporarily unavailable. Please try again.');
        setMood('idle');
        setRowMood(thinking, 'idle');
        emit('turn:error', { text: text });
      }).finally(function () {
        setLoading(false);
        input.focus();
      });
      return;
    }

    window.setTimeout(function () {
      var reply = getScriptedResponse(text);
      addMessage(reply, 'bot');
      speakReply(reply);
      addProductCard(getTurnProduct(text));
    }, 350);
  });

  window.BazaarChat = {
    on: function (name, listener) {
      (listeners[name] = listeners[name] || []).push(listener);
      return function () { listeners[name] = (listeners[name] || []).filter(function (entry) { return entry !== listener; }); };
    },
    send: function (text) {
      if (sending || !String(text || '').trim()) return false;
      input.value = String(text).trim();
      form.requestSubmit();
      return true;
    },
    open: openChat,
    close: closeChat,
    isOpen: function () { return !panel.hidden; },
    setMood: setMood,
    stopSpeaking: stopSpeaking,
    setSpokenReplies: function (on) {
      spokenRepliesWanted = Boolean(on);
      var next = spokenRepliesWanted && voiceAvailable;
      if (next !== voiceEnabled) { voiceEnabled = next; emit('spoken-replies', { on: voiceEnabled }); }
      syncVoiceUi();
      return voiceEnabled;
    },
    // Shows a shopkeeper line and reads it aloud when spoken replies are on. The text must come from the server.
    say: function (text) { var message = addMessage(String(text || ''), 'bot'); speakReply(String(text || '')); return message; },
    restoreNegotiation: function (id, product) { negotiationId = id || null; negotiationProductKey = productKey(product || (activeProduct === currentProduct ? selectedProduct() : activeProduct)); },
    extendPayload: function (extend) { payloadExtenders.push(extend); },
    answerLocally: function (claim) { localTurns.push(claim); },
    setChipProvider: function (provider) { chipProvider = provider; },
    renderChips: renderChips,
    addMessage: addMessage,
    addOfferCard: addOfferCard,
    stickerSvg: stickerSvg,
    apiUrl: apiUrl,
    flags: flags,
    elements: { widget: widget, panel: panel, foot: widget.querySelector('.ai-chat__foot'), launcher: toggle, messages: messages, form: form, input: input, chips: promptsBox, listenBar: listenBar, wave: waveBox, mic: micButton },
    state: function () {
      return { shopperId: shopperId, endpoint: endpoint, currentProduct: currentProduct, products: products, card: lastCard, negotiationId: negotiationId, sending: sending, mood: currentMood, voiceAvailable: voiceAvailable, spokenReplies: voiceEnabled };
    }
  };
  document.dispatchEvent(new CustomEvent('bazaar-chat:ready'));

  document.addEventListener('change', function (event) {
    if (event.target && event.target.matches && event.target.matches('select[name="id"], select[id^="ProductSelect-"]')) {
      setNegotiationForProduct(selectedProduct());
    }
    if (event.target && event.target.matches && event.target.matches('input[name="quantity"], input[id^="Quantity-"], input[data-quantity-input]')) {
      quantitySelectionChanged = true;
      setNegotiationForProduct(selectedProduct(), true);
    }
  });
})();
