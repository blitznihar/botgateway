/*!
 * NextBot universal loader — zero dependencies, framework agnostic.
 *
 *   <script src="https://gateway.example.com/widget.js" data-bot-id="bot_internal_1" async></script>
 *
 * Optional attributes:
 *   data-auth-token="..."   a token from the host's identity provider (prefer getAuthToken below)
 *
 * Runtime API (window.NextBot). Can be pre-defined before the script loads:
 *   window.NextBot = {
 *     context: { policyNumber: 'POL-123' },        // initial host context
 *     getAuthToken: async (botId) => token,        // called on load and whenever the token expires
 *   };
 *   NextBot.getAuthToken = () => auth0.getAccessTokenSilently();                     // Auth0 SPA SDK
 *   NextBot.getAuthToken = async () => (await msal.acquireTokenSilent(req)).accessToken; // Entra ID / MSAL
 *   NextBot.setAuthToken(token | null)    // push a token (or sign out) explicitly
 *   NextBot.setContext({ recordId: '001…' })  // merged & pushed to every bot iframe
 *   NextBot.open() / .close() / .toggle()
 *
 * Screen awareness: if the bot's "Page context" is set to automatic, a snapshot of the visible page
 * (text, form fields, the user's highlighted text) is taken right before each message. Mark anything
 * the bot must never read with data-nextbot-ignore.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) {
    console.error('[NextBot] widget.js must be loaded via a <script> tag (document.currentScript is unavailable).');
    return;
  }

  var botId = script.getAttribute('data-bot-id');
  var attrToken = script.getAttribute('data-auth-token') || null;
  if (!botId) {
    console.error('[NextBot] Missing data-bot-id attribute on the widget <script> tag.');
    return;
  }
  var baseUrl = new URL(script.src, window.location.href).origin;

  // ---- Shared runtime API (one per page, shared by every bot instance) -----------------------
  var existing = window.NextBot && typeof window.NextBot === 'object' ? window.NextBot : {};
  if (!existing.__initialized) {
    var api = {
      __initialized: true,
      context: existing.context && typeof existing.context === 'object' ? existing.context : {},
      getAuthToken: typeof existing.getAuthToken === 'function' ? existing.getAuthToken : null,
      authToken: typeof existing.authToken === 'string' ? existing.authToken : undefined,
      instances: {},
      setContext: function (ctx) {
        if (!ctx || typeof ctx !== 'object') return;
        for (var k in ctx) if (Object.prototype.hasOwnProperty.call(ctx, k)) api.context[k] = ctx[k];
        eachInstance(function (inst) { inst.sendContext(); });
      },
      setAuthToken: function (token) {
        api.authToken = token || null; // null = signed out
        eachInstance(function (inst) { inst.sendContext(); });
      },
      open: function (id) { eachInstance(function (inst) { inst.setOpen(true); }, id); },
      close: function (id) { eachInstance(function (inst) { inst.setOpen(false); }, id); },
      toggle: function (id) { eachInstance(function (inst) { inst.setOpen(!inst.isOpen()); }, id); },
    };
    function eachInstance(fn, id) {
      for (var key in api.instances) if (!id || key === id) fn(api.instances[key]);
    }
    window.NextBot = api;
  }
  var NextBot = window.NextBot;
  if (NextBot.instances[botId]) {
    console.warn('[NextBot] Bot "' + botId + '" is already mounted on this page; ignoring duplicate script.');
    return;
  }
  NextBot.instances[botId] = { sendContext: noop, setOpen: noop, isOpen: function () { return false; } };

  function noop() {}

  // ---- Fetch public config, then mount -------------------------------------------------------
  fetch(baseUrl + '/api/bots/' + encodeURIComponent(botId), { credentials: 'omit' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 403 ? ' (this origin is not in the bot\'s allowedDomains)' : ''));
      return res.json();
    })
    .then(function (config) {
      if (document.body) mount(config);
      else document.addEventListener('DOMContentLoaded', function () { mount(config); });
    })
    .catch(function (err) {
      delete NextBot.instances[botId];
      console.error('[NextBot] Could not load bot "' + botId + '" from ' + baseUrl + ': ' + err.message);
    });

  function mount(config) {
    var theme = config.theme || {};
    var pageCfg = config.pageContext || { mode: 'off' };
    var color = theme.primaryColor || '#1d4ed8';
    var textColor = theme.headerTextColor || '#ffffff';
    var side = theme.position === 'bottom-left' ? 'left' : 'right';
    var title = theme.botTitle || 'Chat';

    var host = document.createElement('div');
    host.setAttribute('data-nextbot', botId);
    // Shadow DOM keeps host-page CSS from leaking into the launcher (and vice versa).
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent =
      ':host{all:initial}' +
      '.nb-wrap{position:fixed;bottom:20px;' + side + ':20px;z-index:999999;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
      '.nb-btn{width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';color:' + textColor + ';' +
      'box-shadow:0 6px 18px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}' +
      '.nb-btn:hover{transform:scale(1.06)}.nb-btn:focus-visible{outline:3px solid ' + color + ';outline-offset:3px}' +
      '.nb-btn svg{width:28px;height:28px}' +
      '.nb-panel{position:fixed;bottom:92px;' + side + ':20px;width:380px;height:560px;max-height:calc(100vh - 112px);' +
      'border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.2);z-index:999999;overflow:hidden;background:#fff;' +
      'opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}' +
      '.nb-panel.nb-open{opacity:1;transform:none;pointer-events:auto}' +
      '.nb-panel iframe{width:100%;height:100%;border:0;display:block}' +
      '@media (max-width:480px){.nb-panel{inset:0;width:100%;height:100%;max-height:none;border-radius:0;bottom:0;' + side + ':0}}';
    root.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'nb-wrap';

    var button = document.createElement('button');
    button.className = 'nb-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Open chat: ' + title);
    button.setAttribute('aria-expanded', 'false');

    var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    button.innerHTML = ICON_CHAT;
    wrap.appendChild(button);

    var panel = null;
    var iframe = null;
    var open = false;

    function currentToken() {
      // Explicit setAuthToken() wins (null = signed out), then data-auth-token.
      return NextBot.authToken !== undefined ? NextBot.authToken : attrToken;
    }

    function post(msg) {
      // Target origin pinned to the gateway so tokens and page content can never be delivered elsewhere.
      if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(msg, baseUrl);
    }

    function sendContext() {
      var payload = {};
      for (var k in NextBot.context) if (Object.prototype.hasOwnProperty.call(NextBot.context, k)) payload[k] = NextBot.context[k];
      payload.pageUrl = window.location.href;
      payload.pageTitle = document.title;
      var token = currentToken();
      if (token) payload.authToken = token;
      post({ type: 'INIT_CONTEXT', payload: payload });
    }

    /** Ask the host app for a fresh token (Auth0 getAccessTokenSilently, MSAL acquireTokenSilent…). */
    function refreshTokenThenSend() {
      if (typeof NextBot.getAuthToken !== 'function') return sendContext();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; sendContext(); } }, 8000);
      Promise.resolve()
        .then(function () { return NextBot.getAuthToken(botId); })
        .then(function (token) { if (typeof token === 'string' || token === null) NextBot.authToken = token; })
        .catch(function (err) { console.warn('[NextBot] getAuthToken failed:', err); })
        .then(function () { if (!done) { done = true; clearTimeout(timer); sendContext(); } });
    }

    function ensurePanel() {
      if (panel) return;
      panel = document.createElement('div');
      panel.className = 'nb-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', title);
      iframe = document.createElement('iframe');
      iframe.src = baseUrl + '/embed/' + encodeURIComponent(botId);
      iframe.title = title;
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
      root.appendChild(panel);
    }

    function setOpen(next) {
      if (next) ensurePanel();
      open = !!next;
      if (panel) panel.classList.toggle('nb-open', open);
      button.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', (open ? 'Close chat: ' : 'Open chat: ') + title);
    }

    button.addEventListener('click', function () { setOpen(!open); });

    window.addEventListener('message', function (event) {
      if (!iframe || event.origin !== baseUrl || event.source !== iframe.contentWindow) return;
      var data = event.data || {};
      if (data.type === 'NEXTBOT_READY') {
        if (!currentToken() && typeof NextBot.getAuthToken === 'function') refreshTokenThenSend();
        else sendContext();
      } else if (data.type === 'NEXTBOT_TOKEN_REQUEST') {
        refreshTokenThenSend();
      } else if (data.type === 'NEXTBOT_SNAPSHOT_REQUEST') {
        var snapshot = null;
        try {
          if (pageCfg.mode === 'auto') snapshot = capturePage(pageCfg);
        } catch (err) {
          console.warn('[NextBot] page capture failed:', err);
        }
        post({ type: 'PAGE_SNAPSHOT', requestId: data.requestId, payload: snapshot });
      } else if (data.type === 'NEXTBOT_CLOSE') {
        setOpen(false);
      }
    });

    root.appendChild(wrap);
    document.body.appendChild(host);

    NextBot.instances[botId] = { sendContext: sendContext, setOpen: setOpen, isOpen: function () { return open; } };
  }

  // ---- Page capture (screen awareness) ---------------------------------------------------------

  var ALWAYS_EXCLUDE = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed',
    '[data-nextbot]', '[data-nextbot-ignore]', 'input[type="password"]', 'input[type="hidden"]',
    '[autocomplete^="cc-"]'];
  var BLOCK_DISPLAY = /^(block|flex|grid|table|table-row|table-cell|list-item|table-caption|flow-root)$/;

  function safeMatches(el, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try { if (el.matches(selectors[i])) return true; } catch (e) { /* invalid admin selector: ignore */ }
    }
    return false;
  }

  function isVisible(el) {
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function fieldLabel(el) {
    var aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var ref = el.getRootNode().getElementById ? el.getRootNode().getElementById(labelledBy) : document.getElementById(labelledBy);
      if (ref) return clean(ref.textContent);
    }
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText || el.labels[0].textContent);
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
  }

  function fieldValue(el) {
    var tag = el.tagName;
    if (tag === 'SELECT') return clean(el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : '');
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'yes' : 'no';
    return clean(el.value);
  }

  /** Label/value pairs from common layouts: <dl>, 2-cell table rows, "*label*" + "*value*" siblings (incl. Salesforce SLDS). */
  function pairFrom(el) {
    var tag = el.tagName;
    if (tag === 'DT' && el.nextElementSibling && el.nextElementSibling.tagName === 'DD') {
      return [clean(el.innerText), clean(el.nextElementSibling.innerText)];
    }
    if (tag === 'TR' && el.cells && el.cells.length === 2 && el.cells[0].tagName === 'TH') {
      return [clean(el.cells[0].innerText), clean(el.cells[1].innerText)];
    }
    var cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    var next = el.nextElementSibling;
    if (next && /label/.test(cls) && !/value|static/.test(cls)) {
      var ncls = typeof next.className === 'string' ? next.className.toLowerCase() : '';
      if (/value|static|output|data/.test(ncls)) return [clean(el.innerText), clean(next.innerText)];
    }
    return null;
  }

  function capturePage(cfg) {
    var maxChars = cfg.maxChars || 6000;
    var excludes = ALWAYS_EXCLUDE.concat(cfg.excludeSelectors || []);
    var roots = [];
    (cfg.includeSelectors || []).forEach(function (sel) {
      try { Array.prototype.push.apply(roots, document.querySelectorAll(sel)); } catch (e) { /* invalid selector */ }
    });
    if (!roots.length) roots = [document.body];

    var lines = [];
    var current = '';
    var total = 0;
    var truncated = false;
    var fields = [];
    var seenPairs = {};

    function flush() {
      var t = clean(current);
      if (t && lines[lines.length - 1] !== t) { lines.push(t); total += t.length + 1; }
      current = '';
    }
    function addField(label, value) {
      if (!label || !value || label.length > 120) return;
      var key = label + '\u0000' + value;
      if (seenPairs[key] || fields.length >= 150) return;
      seenPairs[key] = 1;
      fields.push({ label: label.replace(/[:*]\s*$/, ''), value: value.slice(0, 500) });
    }

    function walk(node) {
      if (total > maxChars) { truncated = true; return; }
      if (node.nodeType === 3) { current += ' ' + node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      var el = node;
      if (safeMatches(el, excludes) || !isVisible(el)) return;

      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        addField(fieldLabel(el), fieldValue(el));
        return;
      }
      var pair = pairFrom(el);
      if (pair) addField(pair[0], pair[1]);

      var block = BLOCK_DISPLAY.test(getComputedStyle(el).display);
      if (block) flush();
      if (el.shadowRoot) for (var s = el.shadowRoot.firstChild; s; s = s.nextSibling) walk(s); // open shadow DOM (web components, Lightning)
      for (var c = el.firstChild; c; c = c.nextSibling) walk(c);
      if (block) flush();
    }

    roots.forEach(function (r) { walk(r); flush(); });

    var selection = '';
    try { selection = clean(String(window.getSelection ? window.getSelection() : '')).slice(0, 2000); } catch (e) { /* ignore */ }

    var text = lines.join('\n');
    if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true; }
    if (cfg.redact !== false) {
      text = redact(text);
      selection = redact(selection);
      fields = fields.map(function (f) { return { label: f.label, value: redact(f.value) }; });
    }
    return {
      url: window.location.href,
      title: document.title,
      selection: selection || undefined,
      fields: fields,
      text: text,
      truncated: truncated,
      capturedAt: new Date().toISOString(),
    };
  }

  // Same rules as the server (lib/page-context.ts): cards (Luhn), US SSNs, IBANs.
  function redact(s) {
    if (!s) return s;
    return s
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN redacted]')
      .replace(/\b(?:\d[ -]?){13,19}\b/g, function (m) { return luhn(m.replace(/\D/g, '')) ? '[card redacted]' : m; })
      .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, '[IBAN redacted]');
  }
  function luhn(d) {
    if (d.length < 13 || d.length > 19) return false;
    var sum = 0;
    for (var i = 0; i < d.length; i++) {
      var n = +d[d.length - 1 - i];
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }
})();
