(function () {
  var widget = document.querySelector('[data-ai-chat]');

  if (!widget) {
    return;
  }

  var toggle = widget.querySelector('[data-ai-chat-toggle]');
  var close = widget.querySelector('[data-ai-chat-close]');
  var panel = widget.querySelector('#ai-chat-panel');
  var messages = widget.querySelector('[data-ai-chat-messages]');
  var form = widget.querySelector('[data-ai-chat-form]');
  var input = widget.querySelector('[data-ai-chat-input]');
  var promptButtons = widget.querySelectorAll('[data-ai-chat-prompt]');

  var responses = [
    {
      terms: ['weekend', 'outfit', 'recommend', 'style'],
      text: 'For a clean weekend fit, start with the Everyday Heavyweight Tee, layer the Field Brushed Cotton Overshirt, and carry the Studio Canvas Tote. It reads relaxed but still intentional.'
    },
    {
      terms: ['size', 'sizing', 'tee', 'fit'],
      text: 'The demo sizing guide says the tee has a true-to-size regular fit. Choose your usual size, or size up if you want an oversized streetwear shape.'
    },
    {
      terms: ['shipping', 'returns', 'return', 'delivery'],
      text: 'Demo shipping is shown as 3-5 business days, with easy returns within 30 days. When we connect the real store policies, I can answer from live Shopify data.'
    },
    {
      terms: ['hoodie', 'jacket', 'overshirt', 'cold'],
      text: 'For colder weather, the overshirt is the strongest current layer. A hoodie and trail jacket would be good next products to add to the catalog.'
    }
  ];

  function openChat() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () {
      input.focus();
    }, 80);
  }

  function closeChat() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }

  function addMessage(text, type) {
    var message = document.createElement('p');
    message.className = 'ai-chat__message ai-chat__message--' + type;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function getResponse(text) {
    var normalized = text.toLowerCase();
    var match = responses.find(function (response) {
      return response.terms.some(function (term) {
        return normalized.indexOf(term) !== -1;
      });
    });

    if (match) {
      return match.text;
    }

    return 'I am a scripted demo today, but I can still help with product ideas. Ask about outfits, sizing, shipping, or outerwear.';
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) {
      openChat();
    } else {
      closeChat();
    }
  });

  close.addEventListener('click', closeChat);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) {
      closeChat();
    }
  });

  promptButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      input.value = button.getAttribute('data-ai-chat-prompt');
      form.requestSubmit();
    });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var text = input.value.trim();

    if (!text) {
      return;
    }

    addMessage(text, 'user');
    input.value = '';

    window.setTimeout(function () {
      addMessage(getResponse(text), 'bot');
    }, 420);
  });
})();
