# Immersive voice widget — research

Researched 20 Sep 2026 against primary sources, for `apps/storefront/assets/chat-demo.js`. Target: desktop Chrome, a few hours of build time. Every claim carries the URL that owns it; what could not be confirmed is in [Unverified](#unverified).

## What to build in 4 hours (ranked by demo impact per hour)

Server column: **none** = theme only; **small** = one field or one route change in `apps/server`.

| # | Build | Hours | Server |
|---|---|---|---|
| 1 | **Conversation survives navigation**: transcript, live card id, panel-open and hands-free flags in `sessionStorage`; re-render and reopen on load. Today a click on a product card reloads the page and wipes the chat (§6). | 0.75 | none (`GET /api/offers/:id` already restores the card) |
| 2 | **Hands-free mode on `SpeechRecognition`**: one opt-in click, `continuous` + `interimResults`, restart in `onend`, send after ~1.2 s of no new result or on a stop phrase (§1). Includes **live captions** of the shopper's words in the message box. | 1.5 | none |
| 3 | **Panel open/close motion + a minimised "voice pill"** (sticker + state + mic level + last caption) using `@starting-style` / `allow-discrete`, 350 ms in, 200 ms out (§5, §6). | 0.75 | none |
| 4 | **Mic-reactive listening halo and amplitude lip-sync**: one `AnalyserNode` on the mic, one on the TTS `Audio` element, each writing a CSS variable (§5, §6). | 0.75 | none |
| 5 | **Half-duplex turn-taking + barge-in** by click, key, Stop, then the spoken word "stop" behind a flag (§3). | 0.5 | none |
| 6 | **Page-context blob** `data-ai-chat-page` from Liquid + `/cart.js` on open (§4). | 0.5 | small — accept `page` on `POST /api/chat`, pass to the prompt as context only |
| 7 | **Agent acts on the page**: product card click scrolls to and rings the product on the current page instead of navigating; after Deal, show the items landing in checkout (§6). | 0.75 | none for highlight |
| 8 | **Filler while thinking**: 3–4 pre-rendered ElevenLabs clips ("Let me look at that…") played at end-of-turn, no dollar figures (§6). Then switch `/api/voice/speak` to the streaming endpoint + Flash model. | 0.5 + 0.5 | small — cache clips; stream the TTS response |
| 9 | **One polite nudge**: sticker wiggle + a one-line bubble after ~10 s dwell on the price block or a variant change; once per session, never opens the panel, never speaks (§6). | 0.5 | none |
| 10 | **Two earcons** (mic open, turn sent) and `role="log"` + a `role="status"` line for the voice state (§5, §6). | 0.25 | none |

First four hours: rows 1–5 (4.25 h). Rows 6–10 as time allows. **Skip:** a wake word (Porcupine needs an AccessKey in the browser and a trained `.ppn`), `@ricky0123/vad-web` (≈13.7 MB of assets for what the silence timer already gives), OpenAI Realtime / ElevenLabs Agents / Hume EVI (the model would speak prices itself — breaks invariant 1 and the buffered wording check), haptics (no desktop support worth having), `speechSynthesis` (ElevenLabs output already exists). Tell the shopper once that hands-free sends audio to Google's recogniser in Chrome, and keep a persistent Listening pill with a one-tap off.

## What exists today (read before building)

- `chat-demo.js` has push-to-talk: `getUserMedia({ audio: true })` → `MediaRecorder` → `POST /api/voice/transcribe` (ElevenLabs, key on the server) → the normal chat turn; replies via `POST /api/voice/speak` played through `new Audio(blobUrl)`; `stopSpeaking()`; a `speaking` mood; a wave + "Reading this aloud / Stop" tag. Mic and speaker toggle are hidden when `GET /api/voice/config` says voice is off (`docs/SPEC.md` §4.2, §8).
- No `SpeechRecognition`, no VAD, no `AnalyserNode`, no `matchMedia` in the script; `critical.css` already has one `prefers-reduced-motion` block.
- Page context today: `sections/product.liquid` emits `<script type="application/json" data-ai-chat-current-product>`; `layout/theme.liquid` emits `data-ai-chat-products`. The script already sends `variantSelectionChanged`.
- `research/` did not exist; this is its first file.

## 1. Hands-free turn-taking

**`SpeechRecognition` facts**

- `continuous` defaults to `false`: "when the user stops talking, speech recognition will end." `interimResults` defaults to `false`. — https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api
- Spec: with `continuous = false` the UA returns no more than one final result; with `true`, zero or more. `interimResults = true` "should" return interim results. — https://webaudio.github.io/web-speech-api/
- Events: `speechend` "Fired when speech recognized by the speech recognition service has stopped being detected"; `end` "Fired when the speech recognition service has disconnected"; also `soundend`, `nomatch`. — https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- **How end-of-utterance is decided is not specified** — it is left to the user agent / recognition service. There is no silence-timeout property. — https://webaudio.github.io/web-speech-api/ . So own the timer yourself (below).
- Audio goes to a server by default: "On some browsers, like Chrome, using Speech Recognition on a web page involves a server-based recognition engine. Your audio is sent to a web service for recognition processing, so it won't work offline." — https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- On-device option: Chrome 139 added `processLocally`, `SpeechRecognition.available()` and `install()` (language-pack download). — https://developer.chrome.com/blog/new-in-chrome-139 , https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API . A pack download is a demo risk; treat as optional.
- Contextual biasing: `recognition.phrases = [new SpeechRecognitionPhrase('Trail Runner', 5.0)]`, boost 0.0–10.0, Chrome 142+. Useful for product names and "Juniper". — same MDN guide; versions from https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json
- Consent and indicator: "User agents must only start speech input sessions with explicit, informed user consent" and "must give the user an obvious indication when audio is being recorded." — https://webaudio.github.io/web-speech-api/
- Permission persistence: "Pages hosted on HTTPS do not need to ask repeatedly for permission, whereas HTTP hosted pages do." — https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api . Shopify storefronts are HTTPS.
- Support (MDN browser-compat-data): Chrome `webkitSpeechRecognition` since 33, unprefixed since 139; Safari 14.1 prefixed (`continuous` from 17); Firefox only behind the `media.webspeech.recognition.enable` preference. Feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition` and fall back to the existing push-to-talk. — https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json

**End of turn: silence timer over results (recommended)**

```js
rec.continuous = true; rec.interimResults = true;
rec.onresult = function (e) {
  var text = ''; for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
  input.value = text;                       // live transcript
  if (STOP.test(text)) return endTurn(text.replace(STOP, ''));
  clearTimeout(t); t = setTimeout(function () { endTurn(text); }, 1200);
};
rec.onend = function () { if (handsFree && !speaking) rec.start(); };   // Chrome ends sessions on its own
```

- Stop phrase: `var STOP = /\b(that's it|that is it|send it|over to you)\W*$/i` tested on the tail of the running transcript (interim included), stripped before sending. Avoid bare "stop" — reserve it for barge-in ("stop" while Juniper is speaking → `stopSpeaking()`).
- 1.2 s is a starting value, not a sourced one; Deepgram's own example pairs `endpointing=300` with `utterance_end_ms=1000` (https://developers.deepgram.com/docs/endpointing) and vad-web defaults to 1400 ms of non-speech (below). Tune between 1.0 and 1.5 s.

**`@ricky0123/vad-web` (Silero VAD via ONNX Runtime Web)**

- CDN load, from the README: `onnxruntime-web@1.22.0/dist/ort.wasm.min.js` + `@ricky0123/vad-web@0.0.31/dist/bundle.min.js`, then `vad.MicVAD.new({ onSpeechStart, onSpeechEnd(audio), onnxWASMBasePath, baseAssetPath })` and `.start()`. `onSpeechEnd` receives a `Float32Array` at 16 kHz. — https://github.com/ricky0123/vad
- Defaults: `positiveSpeechThreshold` 0.3, `negativeSpeechThreshold` 0.25, `redemptionMs` 1400, `preSpeechPadMs` 800, `minSpeechMs` 400; frames of 512 samples for v5/v6. — https://docs.vad.ricky0123.com/user-guide/algorithm/
- Size (jsDelivr file listing): `bundle.min.js` 69 KB, worklet 2.5 KB, `silero_vad_v5.onnx` 2.33 MB, `ort.wasm.min.js` 48 KB, `ort-wasm-simd-threaded.wasm` 11.2 MB. ≈13.7 MB cold. — https://data.jsdelivr.com/v1/packages/npm/@ricky0123/vad-web@0.0.31?structure=flat , https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.22.0?structure=flat
- Licence: **ISC** in the repo `LICENSE` and on npm (the README summary that says MIT is wrong). — https://github.com/ricky0123/vad/blob/master/LICENSE , https://registry.npmjs.org/@ricky0123/vad-web/latest
- Verdict: it fits the existing ElevenLabs path (VAD cuts the clip, encode WAV, `POST /api/voice/transcribe`) and keeps audio off Google, but gives no interim transcript and costs an 11 MB wasm fetch. Second choice; only if the team refuses to send audio to Google.

## 2. Always-listening vs. explicit open

- `getUserMedia` needs a secure context (`navigator.mediaDevices` is `undefined` otherwise); permission is per origin; the browser "must ask the user at least the first time"; denial rejects with `NotAllowedError`. Browsers must show a recording indicator and a permission-granted indicator. — https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- `navigator.permissions.query({ name: 'microphone' })` → `PermissionStatus.state` of `granted | prompt | denied`. Chrome 64+, Firefox 132+, Safari 16+. — https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query , https://github.com/mdn/browser-compat-data/blob/main/api/Permissions.json
- What this allows: after one opt-in click and a persisted grant on the HTTPS shop origin, a later page load can query `granted` and start listening with no prompt. **Do not do that silently.** Shopify storefront navigation is a full page load, so keep a `sessionStorage` flag ("hands-free on"), and on the next page show the Listening pill and resume only if `state === 'granted'`. The mic stream ends on navigation; each page restarts it.
- Audio *output* still needs a gesture per page: Chrome autoplay with sound is allowed once "the user has interacted with the domain (click, tap, etc.)" or the Media Engagement Index threshold is crossed; an `AudioContext` created before a gesture starts `suspended` and needs `resume()`. — https://developer.chrome.com/blog/autoplay . So after a navigation Juniper can listen but may not be able to speak until the first click; call `audioCtx.resume()` and retry `play()` on the first pointer event.
- Wake word:
  - Picovoice Porcupine Web runs in-browser (WASM) but **requires an AccessKey** from Picovoice Console, and a custom word ("Hey Juniper") means training and downloading a `.ppn` for `Web (WASM)` plus a `.pv` model; packages `@picovoice/porcupine-web` + `@picovoice/web-voice-processor`. — https://picovoice.ai/docs/quick-start/porcupine-web/ . The AccessKey ships in the browser, which conflicts with invariant 6. Skip.
  - Cheap alternative: keyword spotting on interim results — `/\b(hey |ok )?juniper\b/i` opens the panel. It only works while the recogniser is already running (so audio is already going to Google), which makes it a convenience inside hands-free mode, not a true wake word. Add "Juniper" to `phrases` on Chrome 142+.
- Privacy worth honouring: explicit consent and an obvious indicator are spec requirements, not niceties (https://webaudio.github.io/web-speech-api/). One opt-in click, a persistent Listening pill, one-tap off, stop listening when the panel closes or the tab is hidden (`visibilitychange`), and a one-line note about where audio goes.

## 3. Barge-in and speaking back

- `speechSynthesis`: `speak()`, `cancel()` ("removes all utterances from the queue. If an utterance is being spoken, speaking ceases immediately"), `getVoices()` populated after `voiceschanged`. — https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis , https://webaudio.github.io/web-speech-api/
- Since Chrome 71 "The `speechSynthesis.speak()` function now throws an error if the document has not received a user activation." — https://developer.chrome.com/blog/chrome-71-deps-rems
- The repo already speaks through ElevenLabs via the server; `speechSynthesis` is only a no-key fallback. Juniper's lines are ≤ 35 words, so the long-utterance cutoff (Unverified) would not bite.
- Echo: `echoCancellation: true` lets "the browser decide" what to remove; it must cancel at least remote (`RTCPeerConnection`) audio and *should* attempt all system audio; string values `"all"` / `"remote-only"` exist where supported. — https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation . Whether Chrome cancels a local `<audio>` element is not promised there.
- The constraint does not reach a plain `recognition.start()`, which opens its own capture. Chrome 135+ accepts `recognition.start(audioTrack)` with a live audio `MediaStreamTrack`, so a `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` track can feed the recogniser — and the same stream feeds the `AnalyserNode`. — https://webaudio.github.io/web-speech-api/ , https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json
- Recommendation: **half-duplex**. `rec.abort()` before `activeAudio.play()`, `rec.start()` on `ended`. Barge-in by click / key / Stop button first; spoken barge-in ("stop", "wait") only behind a flag, tested with the demo laptop's speakers, ignoring transcripts that are a substring of the line being spoken.

**Hosted alternatives** — all three need a server endpoint to keep the key out of the browser (invariant 6).

- **OpenAI Realtime (WebRTC).** Speech-to-speech over a peer connection. Standard keys stay on the server: "you only use standard OpenAI API keys on the server, not in the browser." Either the server mints an ephemeral client secret (`POST /v1/realtime/client_secrets`, looks like `ek_…`, default TTL one minute, configurable) or the browser posts its SDP to your server, which forwards to `/v1/realtime/calls`. — https://developers.openai.com/api/docs/guides/voice-webrtc , https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create . Paid. **Architectural blocker:** the model speaks freely, so prices would not come from the engine menu and lines would bypass the buffered wording check (SPEC §8 streaming, invariant 1); SPEC also says every LLM call goes through Backboard.
- **ElevenLabs.** Already in the stack for STT/TTS. Flash v2.5 TTS "~75ms" model latency excluding network; Scribe v2 Realtime partials in "~150 milliseconds". — https://elevenlabs.io/docs/models . Streaming TTS is `POST /v1/text-to-speech/{voice_id}/stream` with `xi-api-key`. — https://elevenlabs.io/docs/api-reference/text-to-speech/stream . The Agents platform bundles ASR, an LLM, TTS and a turn-taking model with JS/React SDKs; browser clients use a server-minted signed URL (15 min) — "Never expose your ElevenLabs API key client-side." — https://elevenlabs.io/docs/agents-platform/overview , https://elevenlabs.io/docs/agents-platform/customization/authentication . Same invariant-1 blocker for Agents; the cheap win is switching `/api/voice/speak` to the streaming endpoint + Flash model if first-audio latency hurts.
- **Deepgram streaming STT.** Endpointing is on by default at 10 ms and marks `speech_final: true`; docs' example uses `endpointing=300`, `utterance_end_ms=1000`, `interim_results=true`. — https://developers.deepgram.com/docs/endpointing . Browser auth via `POST /auth/grant`: a JWT with a 30 s default TTL, `ttl_seconds` up to 3600. — https://developers.deepgram.com/reference/auth/tokens/grant . Paid key + a token route + a WebSocket client: better endpointing than Web Speech, not worth the hours today.

## 4. Page awareness in a Shopify theme

- Liquid: `request.page_type` ∈ `404, article, blog, captcha, cart, collection, list-collections, customers/*, gift_card, index, metaobject, page, password, policy, product, search`; `request.path`; `request.design_mode` is true in the theme editor (use it to keep the mic off there). — https://shopify.dev/docs/api/liquid/objects/request
- `| json` converts an object to JSON, adds and escapes quotes; product JSON omits `inventory_quantity` / `inventory_policy` on stores created after 5 Dec 2017. — https://shopify.dev/docs/api/liquid/filters/json
- Ajax Cart API: `GET /{locale}/cart.js` returns the cart as JSON, money in cents in the presentment currency; build URLs from `window.Shopify.routes.root`. — https://shopify.dev/docs/api/ajax/reference/cart
- Web Pixels: standard events include `page_viewed`, `product_viewed`, `collection_viewed`, `product_added_to_cart`, `product_removed_from_cart`, `cart_viewed`, `search_submitted`. — https://shopify.dev/docs/api/web-pixels-api/standard-events . `analytics.subscribe` lives in pixels only: app pixels run in a `strict` sandbox (web worker), custom pixels in a `lax` sandbox (an `iframe`) that "cannot access the top frame". — https://shopify.dev/docs/apps/build/marketing-analytics/pixels . Theme code can only **publish** (`Shopify.analytics.publish('my_store:event', data)`); the docs show no theme-side subscribe. — https://shopify.dev/docs/api/web-pixels-api/emitting-data . Not usable for the widget.
- `window.ShopifyAnalytics.meta` — no Shopify doc found; treat as undocumented and do not depend on it.
- Navigation is a full page load in this theme, so "navigation detected" = the script runs again; persist `lastPage` in `sessionStorage` to say "back from the socks?".

**Recommended blob** — in `layout/theme.liquid`, next to `data-ai-chat-products` (every value through `| json`; no cost, floor or margin — invariant 3):

```liquid
<script type="application/json" data-ai-chat-page>
{
  "pageType": {{ request.page_type | json }},
  "template": {{ template.name | json }},
  "path": {{ request.path | json }},
  "designMode": {{ request.design_mode | json }},
  "product": {% if product %}{ "id": {{ product.id | json }}, "handle": {{ product.handle | json }}, "title": {{ product.title | json }}, "variantId": {{ product.selected_or_first_available_variant.id | json }} }{% else %}null{% endif %},
  "collection": {% if collection %}{ "handle": {{ collection.handle | json }}, "title": {{ collection.title | json }} }{% else %}null{% endif %},
  "cart": { "itemCount": {{ cart.item_count | json }}, "handles": {{ cart.items | map: 'handle' | json }} }
}
</script>
```

Then in the script: `JSON.parse` it once; refresh the cart part with `fetch(Shopify.routes.root + 'cart.js')` when the panel opens; listen for `change` on the product form's `[name="id"]` input (already feeds `variantSelectionChanged`); one `IntersectionObserver` on the price/buy block with a dwell timer for the nudge. The cart stays display context only — the server prices from its own catalog.

## 5. Widget motion and presence

- Open/close a `display: none` panel: Chrome 117 added `@starting-style`, `transition-behavior: allow-discrete` and `overlay`. Pattern: `transition: opacity .3s, translate .3s, display .3s allow-discrete;` with the from-state in `@starting-style`. — https://developer.chrome.com/blog/entry-exit-animations . The panel is a plain element toggled by the script, so `overlay` is not needed. Popover API (`popover`, Chrome 114+) or `<dialog>` would add top-layer and light-dismiss, but re-plumbing the toggle is not worth it today. — https://github.com/mdn/browser-compat-data/blob/main/api/HTMLElement.json
- Same-document View Transitions: `document.startViewTransition(() => updateDOM())`, Chrome 111+, guard with `if (!document.startViewTransition) { updateDOM(); return; }`, unique `view-transition-name` per element. Good fit for the live card collapsing to its `superseded` row. "A preference for 'reduced motion' doesn't mean the user wants no motion." — https://developer.chrome.com/docs/web-platform/view-transitions/same-document
- `prefers-reduced-motion: reduce`, and `matchMedia('(prefers-reduced-motion: reduce)')` for the JS-driven orb. — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Mic level: `AnalyserNode` passes audio through unchanged and works with its output unconnected; `getByteTimeDomainData` into a `Uint8Array`, RMS per `requestAnimationFrame`, write to a CSS custom property (`--mic-level`) that scales the sticker's halo. — https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode . The `AudioContext` must be created or resumed inside the opt-in click. — https://developer.chrome.com/blog/autoplay
- Material 3 tokens (from the `material-web` source): durations short 50–200 ms, medium 250–400 ms, long 450–600 ms; `emphasized-decelerate` `cubic-bezier(0.05, 0.7, 0.1, 1)` for entering, `emphasized-accelerate` `cubic-bezier(0.3, 0, 0.8, 0.15)` for leaving, `standard` `cubic-bezier(0.2, 0, 0, 1)`. — https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss . Suggest: panel in 350 ms decelerate, out 200 ms accelerate, state changes on the sticker 150–200 ms.
- Conversation design:
  - Alexa: "Responses can be read out by a human in one or two breaths"; end on a leading question "so the customer knows that it's their turn to speak". — https://developer.amazon.com/en-US/alexa/alexa-haus/design-principles . Juniper's 35-word cap already fits; make spoken lines end on the ask.
  - Google: "Keep messages short and relevant. Let users take their turn." — https://design.google/library/speaking-the-same-language-vui
  - Earcons: few, distinguishable, consistent, in moderation; if you have to teach it, don't use it (page carries a 2023 deprecation notice for Conversational Actions). — https://developers.google.com/assistant/conversation-design/earcons . At most two: mic-open and turn-sent.
  - Latency (NN/g, secondary): 0.1 s feels instant, 1 s keeps flow, 10 s holds attention. — https://www.nngroup.com/articles/response-times-3-important-limits/ . With a 6.5 s Backboard timeout, flip to "thinking" within 100 ms of end-of-turn and keep the thinking line moving.

## 6. What else makes a shopping / voice agent feel immersive

**The gap found in our own widget.** `chat-demo.js` stores only `bazaar:shopper-id` (`localStorage`); the transcript and panel state live in memory. The theme is multi-page and product cards are links, so following the shopkeeper's own suggestion resets the conversation. `sessionStorage` is per tab and origin, survives reloads, and clears when the tab closes — the right lifetime for "this visit". — https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage . Store message text and the card **id** only, and re-fetch the card from `GET /api/offers/:id`; never cache dollar figures client-side (invariant 1). Audio output will not resume until the first click on the new page (autoplay, §2).

**Proactive, page-triggered nudges**

- Intercom's own product supports time-on-page triggers ("after a person has spent a certain amount of time on the page, like 10 seconds"; example: 60 s on a pricing page) and caps rule-based messages at once per day, with explicit frequency limits "to ensure you don't over message customers". — https://www.intercom.com/help/en/articles/5296455-message-rules-when-how-and-to-whom-should-a-message-be-sent , https://www.intercom.com/help/en/articles/5180516-send-repeatable-messages-based-on-events-you-track-in-intercom
- NN/g (secondary): overlays shown before the user has engaged mean "the users' task is interrupted before they even land on the page"; prefer non-modal overlays at the page edge that leave the page usable. — https://www.nngroup.com/articles/popups/
- WCAG 1.4.2: audio that plays automatically for more than 3 s needs a stop or volume control, and the guidance discourages auto-playing sound at all. — https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html
- So: a nudge is a sticker wiggle plus one text bubble, fired by dwell on the price block or a variant change, once per session (`sessionStorage`), dismissible, silent, and never before ~10 s. No exit-intent modal.

**The agent acting on the page**

- Shopify's Storefront MCP gives shopper-facing agents product discovery, "Cart management: Create carts, add or remove items, and complete checkout", policy answers and order tracking, shipped as a theme-extension chat bubble. — https://shopify.dev/docs/apps/build/storefront-mcp
- ElevenLabs "client tools" let the agent run browser-side functions: "trigger browser events, such as alerts, modals or notifications" and "manipulate the Document Object Model (DOM) … to guide users through complex interfaces." — https://elevenlabs.io/docs/agents-platform/customization/tools/client-tools
- Rufus answers questions about the product page being viewed, from listing details, reviews and Q&A. — https://www.aboutamazon.com/news/retail/amazon-rufus . Sidekick "takes action in your admin" (owner side, not storefront). — https://www.shopify.com/magic
- For us, with no new model surface: the reply's `products` array already exists, so the script can `scrollIntoView` and ring the matching `product-card` on the current page, and select the size the shopper said. Keep add-to-cart out of it — our deal settles through the minted checkout URL, and a cart add at list price would confuse the demo.

**Perceived latency: streaming and filler**

- ElevenLabs: "Flash models deliver ~75ms inference speeds"; "Streaming endpoints progressively return audio as it is being generated in real-time, reducing the time-to-first-byte"; the WebSocket endpoint takes streamed text input with `auto_mode`; expected TTFB 100–150 ms in North America; default and instant-clone voices are fastest. — https://elevenlabs.io/docs/best-practices/latency-optimization . `optimize_streaming_latency` is marked deprecated on the stream endpoint. — https://elevenlabs.io/docs/api-reference/text-to-speech/stream
- Our line is buffered whole and checked before the shopper sees a token (SPEC §8), and it is one sentence, so sentence-by-sentence TTS buys nothing. What helps: stream the single `/api/voice/speak` response (play via `MediaSource` or just let `<audio src>` point at a streaming route) and use a Flash model.
- Filler: the wait is the Backboard call (timeout 6500 ms), which sits past NN/g's 1 s flow limit (§5). A short spoken filler at end-of-turn covers it. Pre-render the clips once; they must carry no price and no promise.

**Backchannels, emotion, interruption**

- Hume EVI: stops "rapidly whenever users interject", detects end of turn from tone of voice, and streams prosody measures. — https://dev.hume.ai/docs/speech-to-speech-evi/overview . Speech-to-speech, so the invariant-1 blocker applies; the idea to borrow is interruption that feels instant — cut audio within one frame of a click or "stop".
- Lip-sync: `createMediaElementSource(activeAudio)` → `AnalyserNode` → RMS → mouth `ry` on the sticker's speaking ellipse (it is already an `<ellipse>` in the script). `AnalyserNode` passes audio through unchanged. — https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode . The card's `mood` already drives pleased / firm faces; add a brief reaction on the shopper's turn end (eyebrow raise on a low number is tempting, but the theme must not interpret prices — react to the server's `mood` only).

**Compact voice state.** The ElevenLabs widget ships compact, full and expandable variants, an orb or image avatar, voice-only / voice+text / chat-only modes, a transcript, and a mute control. — https://elevenlabs.io/docs/agents-platform/customization/widget . A minimised pill lets the shopper keep browsing while talking, which is what makes page awareness visible in a demo.

**Sound and haptics.** Earcons: few, distinguishable, consistent (§5). `navigator.vibrate()` needs sticky user activation and is not Baseline — skip for a desktop demo. — https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate

**Accessibility of the voice UI**

- The messages container is already `aria-live="polite"`; MDN recommends `role="log"` for chat with a redundant `aria-live="polite"`, `role="status"` for state text, and warns `assertive` is disruptive. — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions . Announce "Listening" / "Juniper is thinking" in a `role="status"` line; do not put the interim transcript in a live region (it would be re-read on every update).
- Every voice path keeps a typed equivalent; captions show both sides; Stop is always reachable by keyboard (WCAG 1.4.2 above); hands-free state is visible text, not colour alone.

## Unverified

- Chrome's actual silence timeout for `continuous = false`, and that Chrome ends `continuous = true` sessions by itself after a period (widely reported, ~60 s; no primary source found). The `onend` restart covers both.
- Chrome's `speechSynthesis` long-utterance cutoff (~15 s): the Chromium issue (https://issues.chromium.org/issues/41294170) needs a sign-in; not confirmed from a primary source.
- Whether Chrome's `echoCancellation` removes audio played by a same-page `<audio>` element, and whether it has any effect on a track passed to `recognition.start(track)`. Test on the demo laptop.
- Whether a second `getUserMedia` stream can run alongside a plain `recognition.start()` in Chrome without conflict (believed fine; untested). Passing the track (Chrome 135+) sidesteps it.
- Which onnxruntime wasm file vad-web 0.0.31 actually fetches (11.2 MB non-JSEP build assumed), and its WAV-encoding helper (`vad.utils.encodeWAV`) — not checked in source.
- Apple HIG motion page is client-rendered; no quotable text retrieved, so no Apple numbers are cited. The Material M3 site likewise; tokens were taken from the `material-web` repo instead.
- Porcupine free-tier limits and licence terms beyond "AccessKey required".
- OpenAI Realtime and ElevenLabs Agents end-to-end latency: neither doc page fetched gives a figure. ElevenLabs' 75 ms / 150 ms are model-only vendor claims.
- `window.ShopifyAnalytics.meta`: no documentation found; absence of docs is the finding.
- That the Shopify storefront serves no CSP that would block jsDelivr scripts (only matters if vad-web is used).
- ChatGPT voice mode behaviour (live transcript, interruption): the help-centre FAQ returned 403; nothing cited from it.
- Intercom Fin and Klarna publish outcome figures (Klarna: errands in under 2 min vs 11, https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/) but no first-party interaction-design guidance was found; nothing design-related is cited from them.
- Whether `<audio>` pointed at a chunked `/api/voice/speak` response starts playing before the body completes in Chrome for the chosen format (expected for MP3; untested here).
- `createMediaElementSource` on a blob-URL `Audio` element is same-origin and should work; a cross-origin streaming route would need CORS or the analyser reads silence.
