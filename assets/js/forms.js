/*
 * forms.js: builds every form on the site from /forms.json (spec section 7).
 *
 * How it works:
 *   A page has an empty placeholder like  <div data-form="home-contact"></div>.
 *   This script reads /forms.json, finds that form's definition, and builds the
 *   fields, validation, step-by-step flow, progress saving and submission.
 *   To add a form: add an entry to forms.json and put a placeholder on a page.
 *   Nothing in this file needs to change.
 *
 * What to edit here (rarely):
 *   STANDARD_FIELDS  labels/autocomplete/error text for name, email, phone, address
 *   AREA             where address suggestions are centered (metro Indianapolis, central nine counties)
 *   TIMEOUTS         how long to wait for a submit (12s) or Google Maps (4s)
 *
 * Settings come from /assets/js/site-config.js:
 *   APPS_SCRIPT_URL  where submissions go (the Apps Script web app)
 *   MAPS_API_KEY     turns on address suggestions; blank = plain address box
 *
 * Other behavior:
 *   - Prefill: a button with data-prefill="reason:Sell my home" (or a
 *     placeholder with data-prefill, or ?reason=... in the URL) preselects a field.
 *   - Hide a field on one page: data-hide="address" on the placeholder (comma-
 *     separate several keys). Optional fields only; required fields always show.
 *   - Ad tracking: UTM tags, gclid, fbclid, first referrer, landing page and
 *     entry time are kept for the browser session and sent with every save.
 *   - Test mode: open any page with ?test=1. Lead IDs then start with "test-",
 *     and auto-replies go to Chris only. ?test=0 turns it off.
 *   - Dry run: open any page with ?dryrun=1 to click through every step without
 *     sending anything (each save is logged to the browser console instead).
 *     Handy on Live Server before a new form is pushed. ?dryrun=0 turns it off.
 *   - After a confirmed save, fires a browser event "lead:submitted"
 *     (detail: { form, lead_id }) for analytics to hook into later.
 *   - Consent: forms.json "consent" is shown on every form. A form that asks for
 *     no phone number shows consent.emailOnly instead (when it exists), and that
 *     version is what gets recorded with the lead.
 *   - Thank-you button: a "message" success can add { "button": { "label", "url" } }
 *     (opens in a new tab, so the thank-you stays on screen).
 *   - Landing pages: the consent text's Privacy/Terms links are pointed at the
 *     #privacy / #terms sections on the same page, so nobody leaves the page.
 *   - Submit before the last step: a step with "submit": true sends the lead for
 *     real (alert + auto-reply fire on its stage), then moves on to the remaining
 *     optional step(s). Back can't return past it. If the last step is left
 *     empty, finishing just shows the thank-you without sending again.
 *   - Checkbox groups: { "type": "checks", "options": [...] } saves the boxes
 *     ticked as one comma-separated value.
 *   - Number keypads: "inputmode": "numeric" (or "decimal") on a text field.
 */
(function () {
  'use strict';

  var SITE = window.SITE_CONFIG || {};
  var CONFIG_URL = '/forms.json';
  var TIMEOUTS = { submit: 12000, maps: 4000 };
  var AREA = { center: { lat: 39.77, lng: -86.16 }, radius: 50000 }; // metro Indianapolis, central nine counties (bias only; 50 km is the API max)
  var TRACK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  var MAX_LEN = { text: 1000, textarea: 5000 };

  var STANDARD_FIELDS = {
    name:    { label: 'Name', type: 'text', autocomplete: 'name', required_msg: 'Please enter your name.' },
    email:   { label: 'Email', type: 'email', autocomplete: 'email', required_msg: 'Please enter your email address.' },
    phone:   { label: 'Phone', type: 'tel', autocomplete: 'tel', required_msg: 'Please enter your phone number.' },
    address: { label: 'Property address', type: 'address', autocomplete: 'street-address',
               placeholder: 'Street address, city, ZIP', required_msg: 'Please enter the property address.' }
  };

  var TEXT = {
    invalidEmail: 'Please enter a valid email address, like name@example.com.',
    invalidPhone: 'Please enter a 10-digit phone number.',
    chooseOne: 'Please choose one.',
    consent: 'Please check the box to continue.',
    failed: "That didn't go through. Please try again.",
    unavailable: 'This form is temporarily unavailable. Please try again shortly.',
    sending: 'Sending…',
    cantFind: "Can't find it? Just type the full address.",
    loading: 'Loading form…',
    loadFailed: "This form didn't load. Please refresh the page to try again."
  };

  /* ---------- small helpers ---------- */

  var store = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'className') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function newId() {
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    return (isTestMode() ? 'test-' : '') + id;
  }

  function titleCase(key) {
    return String(key).replace(/[_-]+/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function interpolate(str, vals) {
    return String(str || '').replace(/\{(\w+)\}/g, function (_, k) { return vals[k] != null ? vals[k] : ''; });
  }

  function digitsOnly(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  }

  function formatPhone(v) {
    var d = digitsOnly(v).slice(0, 10);
    if (d.length < 4) return d;
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  function normalizeEmail(v) {
    v = String(v || '').trim();
    var at = v.lastIndexOf('@');
    return at > 0 ? v.slice(0, at) + '@' + v.slice(at + 1).toLowerCase() : v;
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  /* ---------- test mode + ad tracking (kept for the browser session) ---------- */

  var query = new URLSearchParams(location.search);
  if (query.get('test') === '1') store.set('cp_test', 1);
  if (query.get('test') === '0') store.del('cp_test');
  function isTestMode() { return !!store.get('cp_test'); }
  if (query.get('dryrun') === '1') store.set('cp_dry', 1);
  if (query.get('dryrun') === '0') store.del('cp_dry');
  function isDryRun() { return !!store.get('cp_dry'); }

  function tracking() {
    var t = store.get('cp_track') || {};
    if (!t.entry_time) {
      t.entry_time = new Date().toISOString();
      t.landing_page = location.pathname;
      var ref = document.referrer || '';
      try { if (ref && new URL(ref).host === location.host) ref = ''; } catch (e) { /* ignore */ }
      t.referrer = ref.slice(0, 500);
    }
    var fresh = {};
    TRACK_KEYS.forEach(function (k) { var v = query.get(k); if (v) fresh[k] = v.slice(0, 300); });
    if (Object.keys(fresh).length) {   // a new ad click replaces the old campaign details
      TRACK_KEYS.forEach(function (k) { delete t[k]; });
      Object.keys(fresh).forEach(function (k) { t[k] = fresh[k]; });
    }
    store.set('cp_track', t);
    return t;
  }
  tracking(); // capture on page load, before anything else

  /* ---------- sending ---------- */

  // Apps Script can't answer the browser's CORS pre-check, so the body is sent
  // as text/plain (a "simple" request). Its reply is still readable (spec 7.4).
  function post(payload, opts) {
    opts = opts || {};
    if (isDryRun()) {
      if (window.console) console.info('forms.js dry run (not sent):', payload);
      return Promise.resolve({ ok: true, lead_id: payload.lead_id, dry_run: true });
    }
    if (!SITE.APPS_SCRIPT_URL) return Promise.reject(new Error('not-configured'));
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    };
    if (opts.background) {
      init.keepalive = true; // progress saves still go through if the page is closed
      return fetch(SITE.APPS_SCRIPT_URL, init).catch(function () { /* fire and forget */ });
    }
    var controller = window.AbortController ? new AbortController() : null;
    if (controller) init.signal = controller.signal;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('timeout')); }, TIMEOUTS.submit);
    });
    var request = fetch(SITE.APPS_SCRIPT_URL, init)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || data.ok !== true) throw new Error('not-saved');
        return data;
      });
    return Promise.race([request, timeout]).then(
      function (data) { clearTimeout(timer); return data; },
      function (err) { clearTimeout(timer); throw err; });
  }

  /* ---------- Google address suggestions (loaded on first focus) ---------- */

  var places = null; // Promise of the Places library, or null until first needed

  function loadPlaces() {
    if (places) return places;
    if (!SITE.MAPS_API_KEY) { places = Promise.reject(new Error('no-key')); places.catch(function () {}); return places; }
    places = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('maps-timeout')); }, TIMEOUTS.maps);
      try {
        if (!(window.google && google.maps && google.maps.importLibrary)) bootstrapMaps(SITE.MAPS_API_KEY);
        google.maps.importLibrary('places').then(function (lib) {
          clearTimeout(timer);
          if (!lib || !lib.AutocompleteSuggestion) return reject(new Error('no-places'));
          resolve(lib);
        }, function (e) { clearTimeout(timer); reject(e); });
      } catch (e) { clearTimeout(timer); reject(e); }
    });
    places.catch(function () { /* quietly fall back to the plain address box */ });
    return places;
  }

  // Google's official dynamic loader (developers.google.com/maps/documentation/javascript/load-maps-js-api)
  function bootstrapMaps(key) {
    /* eslint-disable */
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key: key, v: 'weekly' });
    /* eslint-enable */
  }

  function component(list, type, short) {
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i].types && list[i].types.indexOf(type) !== -1) return short ? list[i].shortText : list[i].longText;
    }
    return '';
  }

  // Turns a plain text input into an accessible combobox with Google suggestions.
  // The input always stays the source of truth: typed or AutoFilled addresses
  // are accepted as-is (address_source "typed"), suggestions are optional.
  function AddressBox(input, wrap) {
    var self = this;
    var listId = input.id + '-list';
    var list = el('ul', { className: 'suggest', id: listId, role: 'listbox', hidden: true });
    var credit = el('li', { className: 'suggest__credit', role: 'presentation', translate: 'no', text: 'Google Maps' });
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);

    var lib = null, token = null, items = [], active = -1, seq = 0, debounce = null;
    self.picked = null; // filled when a suggestion is chosen

    function close() {
      list.hidden = true; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function highlight(i) {
      active = i;
      [].forEach.call(list.querySelectorAll('[role=option]'), function (li, n) {
        li.setAttribute('aria-selected', n === i ? 'true' : 'false');
      });
      if (i > -1) input.setAttribute('aria-activedescendant', listId + '-' + i);
      else input.removeAttribute('aria-activedescendant');
    }

    function render(suggestions) {
      list.innerHTML = '';
      items = suggestions.slice(0, 5).map(function (s) { return s.placePrediction; }).filter(Boolean);
      if (!items.length) return close();
      items.forEach(function (p, i) {
        var main = p.mainText ? p.mainText.text : String(p.text && p.text.text || p.text || '');
        var secondary = p.secondaryText ? p.secondaryText.text : '';
        var li = el('li', { id: listId + '-' + i, role: 'option', 'aria-selected': 'false', className: 'suggest__item' }, [
          el('span', { className: 'suggest__main', text: main }),
          secondary ? el('span', { className: 'suggest__sub', text: secondary }) : null
        ]);
        li.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // keep focus in the input
        li.addEventListener('click', function () { choose(i); });
        list.appendChild(li);
      });
      list.appendChild(credit);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight(-1);
    }

    function choose(i) {
      var p = items[i];
      if (!p) return;
      var text = String(p.text && p.text.text || p.text || '');
      input.value = text;
      close();
      var chosen = { address: text, address_source: 'google', place_id: p.placeId || '' };
      self.picked = chosen;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        var place = p.toPlace();
        place.fetchFields({ fields: ['id', 'formattedAddress', 'addressComponents', 'location'] }).then(function () {
          if (self.picked !== chosen) return; // they kept typing
          var c = place.addressComponents;
          chosen.address = place.formattedAddress || text;
          chosen.street = [component(c, 'street_number'), component(c, 'route')].filter(Boolean).join(' ');
          chosen.city = component(c, 'locality') || component(c, 'sublocality') || component(c, 'administrative_area_level_3');
          chosen.state = component(c, 'administrative_area_level_1', true);
          chosen.zip = component(c, 'postal_code');
          chosen.lat = place.location ? place.location.lat() : '';
          chosen.lng = place.location ? place.location.lng() : '';
          chosen.place_id = place.id || chosen.place_id;
          input.value = chosen.address;
        }).catch(function () { /* keep the suggestion text */ });
      } catch (e) { /* keep the suggestion text */ }
      token = null; // a chosen place ends the billing session
    }

    function lookup() {
      var text = input.value.trim();
      if (!lib || text.length < 3) return close();
      if (!token) token = new lib.AutocompleteSessionToken();
      var mine = ++seq;
      lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        sessionToken: token,
        includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
        locationBias: AREA
      }).then(function (res) {
        if (mine !== seq || document.activeElement !== input) return;
        render((res && res.suggestions) || []);
      }).catch(close);
    }

    input.addEventListener('focus', function () {
      loadPlaces().then(function (l) { lib = l; }, function () { /* plain box */ });
    });
    input.addEventListener('input', function () {
      if (self.picked && input.value.trim() !== self.picked.address) self.picked = null;
      clearTimeout(debounce);
      debounce = setTimeout(lookup, 200);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, -1)); }
      else if (e.key === 'Enter' && active > -1) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });

    self.value = function () {
      var typed = input.value.trim();
      var p = self.picked && self.picked.address === typed ? self.picked : null;
      return {
        address: typed,
        street: p && p.street || '', city: p && p.city || '', state: p && p.state || '', zip: p && p.zip || '',
        lat: p && p.lat !== undefined ? p.lat : '', lng: p && p.lng !== undefined ? p.lng : '',
        place_id: p && p.place_id || '',
        address_source: typed ? (p ? 'google' : 'typed') : ''
      };
    };
  }

  /* ---------- building a form ---------- */

  function normalizeField(f) {
    if (typeof f === 'string') f = { key: f.replace(/\*$/, ''), required: /\*$/.test(f) };
    var out = Object.assign({}, STANDARD_FIELDS[f.key] || {}, f);
    out.type = out.type || 'text';
    out.label = out.label || titleCase(out.key);
    return out;
  }

  function FormInstance(host, key, def, consent) {
    var self = this;
    var uid = 'f-' + key;
    var steps = def.mode === 'steps'
      ? def.steps
      : [{ stage: 'complete', fields: def.fields, showConsent: true, submitLabel: def.submitLabel }];
    var hide = String(host.getAttribute('data-hide') || '').split(/[\s,]+/).filter(Boolean);
    steps = steps.map(function (s) {
      return Object.assign({}, s, { fields: (s.fields || []).map(normalizeField).filter(function (f) {
        return f.required || hide.indexOf(f.key) === -1;   // data-hide: optional fields only
      }) });
    });
    var multi = steps.length > 1;
    // No phone field on this form: use the email-only consent text, if there is one.
    var asksPhone = steps.some(function (s) { return s.fields.some(function (f) { return f.type === 'tel'; }); });
    if (consent && consent.emailOnly && !asksPhone) consent = Object.assign({}, consent, consent.emailOnly);
    var fields = {};           // key -> { def, node, input(s), error, address }
    var current = 0, sending = false, lastSaved = '', consentAt = '';
    var submittedAt = -1;      // index of a "submit": true step that has been sent
    var started = Date.now();
    self.key = key;
    self.host = host;
    self.leadId = newId();

    var form = el('form', { className: 'form', novalidate: true, 'aria-label': def.ariaLabel || null });
    var live = el('p', { className: 'visually-hidden', 'aria-live': 'polite' });
    var progressBar = el('span', { className: 'form-progress__bar' });
    var count = el('p', { className: 'form-count' });
    if (multi) {
      form.appendChild(el('div', { className: 'form-progress', 'aria-hidden': 'true' }, [progressBar]));
      form.appendChild(count);
    }

    var stepNodes = steps.map(function (step, i) {
      var titleId = uid + '-s' + i;
      var node = el('div', { className: 'form-step', 'data-step': i });
      if (multi && step.title) node.appendChild(el('h2', { className: 'form-step__title', id: titleId, tabindex: '-1', text: step.title }));
      if (step.hint) node.appendChild(el('p', { className: 'field__hint form-step__hint', text: step.hint }));
      var single = multi && step.fields.filter(function (f) { return f.type !== 'hidden'; }).length === 1;
      step.fields.forEach(function (f) { node.appendChild(buildField(f, single)); });
      if (step.showConsent && consent) node.appendChild(buildConsent());
      form.appendChild(node);
      return node;
    });

    // Honeypot: hidden from people; bots fill it and get ignored by the back end.
    var hp = el('input', { type: 'text', name: 'company', tabindex: '-1', autocomplete: 'off', id: uid + '-company' });
    form.appendChild(el('div', { className: 'hp', 'aria-hidden': 'true' }, [el('label', { for: uid + '-company', text: 'Company' }), hp]));

    var back = el('button', { type: 'button', className: 'btn btn--ghost', text: 'Back', hidden: true });
    var next = el('button', { type: 'submit', className: 'btn btn--primary' });
    var status = el('p', { className: 'form-status form-status--error', role: 'alert' });
    var note = def.note ? el('p', { className: 'form-note', text: def.note }) : null;
    form.appendChild(status);
    form.appendChild(el('div', { className: 'form-nav' }, multi ? [back, next] : [next]));
    if (note) form.appendChild(note);
    form.appendChild(live);

    host.innerHTML = '';
    host.appendChild(form);
    host.classList.add('is-ready');

    /* fields */

    function buildField(f, labelHidden) {
      var id = uid + '-' + f.key;
      var hintId = f.hint ? id + '-hint' : null;
      var errId = id + '-err';
      var described = [hintId, errId].filter(Boolean).join(' ');
      var error = el('p', { className: 'field__error', id: errId });
      var entry = { def: f, error: error };
      fields[f.key] = entry;

      if (f.type === 'hidden') {
        entry.input = el('input', { type: 'hidden', name: f.key, value: f.value || '' });
        return entry.input;
      }

      var optional = !f.required && f.type !== 'select' && f.type !== 'choice'
        ? el('span', { className: 'field__optional', text: ' (optional)' }) : null;

      if (f.type === 'checks') {
        var box = el('fieldset', { className: 'choices choices--checks', 'aria-describedby': described, id: id });
        box.appendChild(el('legend', { className: labelHidden ? 'visually-hidden' : 'field__label' },
          [f.label, f.required ? null : el('span', { className: 'field__optional', text: ' (optional)' })]));
        entry.inputs = (f.options || []).map(function (o, n) {
          var opt = typeof o === 'string' ? { value: o, label: o } : o;
          var cb = el('input', { type: 'checkbox', name: f.key, value: opt.value, id: id + '-' + n });
          cb.addEventListener('change', function () { clearError(f.key); });
          box.appendChild(el('label', { className: 'choice', for: id + '-' + n }, [cb, el('span', { text: opt.label })]));
          return cb;
        });
        entry.node = el('div', { className: 'field' }, [box, error]);
        return entry.node;
      }

      if (f.type === 'choice') {
        var group = el('fieldset', { className: 'choices', 'aria-describedby': described, id: id });
        group.appendChild(el('legend', { className: labelHidden ? 'visually-hidden' : 'field__label', text: f.label }));
        entry.inputs = (f.options || []).map(function (o, n) {
          var opt = typeof o === 'string' ? { value: o, label: o } : o;
          var radio = el('input', { type: 'radio', name: f.key, value: opt.value, id: id + '-' + n });
          group.appendChild(el('label', { className: 'choice', for: id + '-' + n }, [radio, el('span', { text: opt.label })]));
          return radio;
        });
        if (f.default) entry.inputs.forEach(function (r) { r.checked = r.value === f.default; });
        if (f.autoAdvance !== false) entry.inputs.forEach(function (r) {
          r.addEventListener('change', function () { onChoice(f.key); });
        });
        entry.node = el('div', { className: 'field' }, [group, error]);
        return entry.node;
      }

      var input;
      var common = { id: id, name: f.key, 'aria-describedby': described, autocomplete: f.autocomplete || null,
                     placeholder: f.placeholder || null, required: !!f.required };
      if (f.type === 'textarea') {
        input = el('textarea', Object.assign({ className: 'textarea', rows: 6, maxlength: MAX_LEN.textarea }, common));
      } else if (f.type === 'select') {
        input = el('select', Object.assign({ className: 'select' }, common));
        (f.options || []).forEach(function (o) {
          var opt = typeof o === 'string' ? { value: o, label: o } : o;
          input.appendChild(el('option', { value: opt.value, text: opt.label }));
        });
        if (f.default) input.value = f.default;
      } else {
        var type = f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text';
        input = el('input', Object.assign({ className: 'input', type: type, maxlength: MAX_LEN.text,
          inputmode: f.inputmode || (f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : null),
          autocapitalize: f.type === 'email' ? 'off' : null, spellcheck: f.type === 'email' || f.type === 'tel' ? 'false' : null }, common));
      }
      entry.input = input;

      var label = el('label', { className: labelHidden ? 'visually-hidden' : 'field__label', for: id }, [f.label, optional]);
      var parts = [label];
      if (f.type === 'address') {
        var box = el('div', { className: 'address' }, [input]);
        entry.address = new AddressBox(input, box);
        parts.push(box);
        if (SITE.MAPS_API_KEY && !f.hint) {
          hintId = id + '-hint';
          input.setAttribute('aria-describedby', hintId + ' ' + errId);
          parts.push(el('p', { className: 'field__hint', id: hintId, text: TEXT.cantFind }));
        }
      } else {
        parts.push(input);
      }
      if (f.hint) parts.push(el('p', { className: 'field__hint', id: hintId, text: f.hint }));
      parts.push(error);

      if (f.type === 'tel') {
        input.addEventListener('input', function () {
          var atEnd = input.selectionStart === input.value.length;
          if (atEnd) input.value = formatPhone(input.value);
        });
      }
      if (f.type === 'email') input.addEventListener('blur', function () { input.value = input.value.trim(); });
      input.addEventListener('input', function () { clearError(f.key); });
      input.addEventListener('change', function () { clearError(f.key); });

      entry.node = el('div', { className: 'field' }, parts);
      return entry.node;
    }

    function buildConsent() {
      var block = el('div', { className: 'consent-block' });
      var text = el('p', { className: 'consent', html: consent.html });
      // Landing pages show Privacy + Terms on the page itself: no links out (spec D-37).
      var privacy = document.querySelector('details#privacy');
      var terms = document.querySelector('details#terms');
      [].forEach.call(text.querySelectorAll('a[href]'), function (a) {
        var href = a.getAttribute('href');
        if (privacy && /^\/privacy\/?$/.test(href)) { a.setAttribute('href', '#privacy'); a.removeAttribute('target'); }
        else if (terms && /^\/terms\/?$/.test(href)) { a.setAttribute('href', '#terms'); a.removeAttribute('target'); }
        else if (a.getAttribute('target') === '_blank') a.setAttribute('rel', 'noopener');
      });
      if (consent.mode === 'checkbox') {
        var id = uid + '-consent';
        var box = el('input', { type: 'checkbox', id: id, name: '_consent', 'aria-describedby': id + '-err' });
        var err = el('p', { className: 'field__error', id: id + '-err' });
        fields._consent = { def: { key: '_consent', type: 'checkbox', required: true }, input: box, error: err };
        block.appendChild(text);
        block.appendChild(el('label', { className: 'consent-check', for: id }, [box, el('span', { text: consent.checkboxLabel || 'I agree.' })]));
        block.appendChild(err);
        box.addEventListener('change', function () { clearError('_consent'); });
      } else {
        block.appendChild(text);
      }
      return block;
    }

    /* values + validation */

    function valueOf(key) {
      var e = fields[key];
      if (!e) return '';
      var f = e.def;
      if (f.type === 'choice') {
        var c = e.inputs.filter(function (r) { return r.checked; })[0];
        return c ? c.value : '';
      }
      if (f.type === 'checkbox') return e.input.checked ? 'yes' : '';
      if (f.type === 'checks') return e.inputs.filter(function (c) { return c.checked; }).map(function (c) { return c.value; }).join(', ');
      if (f.type === 'address') return e.address.value().address;
      if (f.type === 'email') return normalizeEmail(e.input.value);
      return String(e.input.value || '').trim();
    }

    function values() {
      var out = {};
      Object.keys(fields).forEach(function (k) {
        if (k.charAt(0) === '_') return;
        var f = fields[k].def;
        if (f.type === 'address') {
          var a = fields[k].address.value();
          Object.keys(a).forEach(function (p) { out[p === 'address' ? k : p] = a[p]; });
        } else if (f.type === 'tel') {
          out[k] = valueOf(k);
          out[k + '_digits'] = digitsOnly(out[k]);
        } else {
          out[k] = valueOf(k);
        }
      });
      return out;
    }

    function setError(key, msg) {
      var e = fields[key];
      e.error.textContent = msg;
      (e.inputs || [e.input]).forEach(function (i) { i.setAttribute('aria-invalid', 'true'); });
    }
    function clearError(key) {
      var e = fields[key];
      if (!e || !e.error.textContent) return;
      e.error.textContent = '';
      (e.inputs || [e.input]).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    }

    function checkField(key) {
      var f = fields[key].def, v = valueOf(key);
      if (f.type === 'hidden') return '';
      if (f.required && !v) {
        if (f.type === 'choice' || f.type === 'checks') return f.required_msg || TEXT.chooseOne;
        if (f.type === 'checkbox') return TEXT.consent;
        return f.required_msg || 'Please fill in ' + f.label.toLowerCase() + '.';
      }
      if (v && f.type === 'email' && !validEmail(v)) return TEXT.invalidEmail;
      if (v && f.type === 'tel' && digitsOnly(v).length !== 10) return TEXT.invalidPhone;
      if (v && f.type === 'address' && f.required && v.length < 6) return f.required_msg;
      return '';
    }

    function validateStep(i) {
      var first = null;
      var keys = steps[i].fields.map(function (f) { return f.key; });
      if (steps[i].showConsent && fields._consent) keys.push('_consent');
      keys.forEach(function (k) {
        var msg = checkField(k);
        if (msg) { setError(k, msg); if (!first) first = k; } else clearError(k);
      });
      if (first) {
        var e = fields[first];
        (e.inputs ? e.inputs[0] : e.input).focus();
        return false;
      }
      if (steps[i].showConsent && !consentAt) consentAt = new Date().toISOString();
      return true;
    }

    /* saving */

    function payload(stage) {
      var p = Object.assign({}, tracking(), values(), {
        form: key,
        lead_id: self.leadId,
        stage: stage,
        page: location.pathname,
        company: hp.value,
        elapsed_ms: Date.now() - started,
        submitted_at: new Date().toISOString(),
        user_agent: navigator.userAgent.slice(0, 300),
        test: isTestMode() ? 'yes' : ''
      });
      if (consentAt) { p.consent_version = consent.version; p.consent_at = consentAt; }
      return p;
    }

    function saveProgress(stage) {
      if (!def.saveProgress) return;
      var p = payload(stage);
      var snapshot = JSON.stringify(values()) + '|' + stage;
      if (snapshot === lastSaved) return; // nothing changed since the last save
      lastSaved = snapshot;
      post(p, { background: true });
    }

    /* step flow */

    function show(i, moveFocus) {
      current = i;
      stepNodes.forEach(function (n, k) { n.hidden = k !== i; });
      var last = i === steps.length - 1;
      next.textContent = (last || steps[i].submit) ? (steps[i].submitLabel || def.submitLabel || 'Submit') : 'Continue';
      if (multi) {
        progressBar.style.width = ((i + 1) / steps.length * 100) + '%';
        count.textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
        back.hidden = i === 0 || i <= submittedAt + 1 && submittedAt > -1;
        if (note) note.hidden = !(i === 0 || last);
        if (moveFocus) {
          live.textContent = count.textContent;
          var h = stepNodes[i].querySelector('.form-step__title');
          if (h) h.focus();
        }
      }
      status.textContent = '';
    }

    function goNext() {
      if (!validateStep(current)) return;
      saveProgress(steps[current].stage);
      show(current + 1, true);
    }

    function onChoice(fieldKey) {
      var stepIndex = current;
      var step = steps[stepIndex];
      if (!multi || !step.autoAdvance || stepIndex === steps.length - 1) return;
      setTimeout(function () {
        if (current === stepIndex && valueOf(fieldKey)) goNext();
      }, 250);
    }

    back.addEventListener('click', function () { if (current > 0) show(current - 1, true); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      var midSubmit = current < steps.length - 1 && steps[current].submit && submittedAt < current;
      if (current < steps.length - 1 && !midSubmit) return goNext();
      if (!validateStep(current)) return;
      // Already sent at an earlier step and nothing was filled in here: just say thanks.
      if (!midSubmit && submittedAt > -1 && !steps[current].fields.some(function (f) { return f.type !== 'hidden' && valueOf(f.key); })) {
        return success({}, values());
      }
      if (!SITE.APPS_SCRIPT_URL) { status.textContent = TEXT.unavailable; return; }

      sending = true;
      var label = next.textContent;
      next.disabled = true;
      back.disabled = true;
      next.textContent = TEXT.sending;
      status.textContent = '';
      var data = payload(steps[current].stage);
      post(data).then(function (res) {
        if (midSubmit) {
          submittedAt = current;
          lastSaved = JSON.stringify(values()) + '|' + steps[current].stage;
          sending = false;
          next.disabled = false;
          back.disabled = false;
          document.dispatchEvent(new CustomEvent('lead:submitted', { detail: { form: key, lead_id: self.leadId } }));
          return show(current + 1, true);
        }
        success(res || {}, data);
        if (submittedAt < 0) document.dispatchEvent(new CustomEvent('lead:submitted', { detail: { form: key, lead_id: self.leadId } }));
      }, function () {
        sending = false;
        next.disabled = false;
        back.disabled = false;
        next.textContent = label;
        status.textContent = TEXT.failed; // everything they typed is still there
      });
    });

    function success(res, data) {
      var s = def.success || { type: 'message', text: 'Thanks! I\'ll be in touch soon.' };
      var first = String(data.name || '').trim().split(/\s+/)[0] || 'there';
      var vars = Object.assign({}, data, { first_name: first });
      var panel = el('div', { className: 'thanks', tabindex: '-1' });
      if (s.title) panel.appendChild(el('h2', { text: interpolate(s.title, vars) }));
      if (s.type === 'download' && res.download_url) {
        panel.appendChild(el('p', { text: interpolate(s.text, vars) }));
        panel.appendChild(el('p', {}, [el('a', { className: 'btn btn--primary', href: res.download_url, rel: 'noopener',
          text: s.buttonLabel || 'Download' })]));
        // Start the download on this page (a direct-download link saves the file
        // and the visitor stays here). If the browser blocks it, the button is there.
        try {
          var dl = el('a', { href: res.download_url, rel: 'noopener' });
          dl.style.display = 'none'; document.body.appendChild(dl); dl.click(); dl.remove();
        } catch (e) { /* the button is there */ }
      } else if (s.type === 'download') {
        panel.appendChild(el('p', { text: interpolate(s.noLinkText || s.text, vars) }));
      } else {
        panel.appendChild(el('p', { text: interpolate(s.text, vars) }));
        if (s.button && s.button.url) {
          panel.appendChild(el('p', {}, [el('a', { className: 'btn btn--primary', href: s.button.url, target: '_blank', rel: 'noopener',
            text: s.button.label || 'Open' })]));
        }
      }
      host.innerHTML = '';
      host.appendChild(panel);
      panel.focus();
    }

    /* prefill: "reason:Sell my home" or "reason=Sell my home; timeframe=..." */
    self.prefill = function (spec) {
      String(spec || '').split(/[;|]/).forEach(function (pair) {
        var m = pair.match(/^\s*([\w-]+)\s*[:=]\s*(.+?)\s*$/);
        if (!m || !fields[m[1]]) return;
        var e = fields[m[1]], v = m[2];
        if (e.def.type === 'hidden') return;
        if (e.inputs) e.inputs.forEach(function (r) { r.checked = r.value === v; });
        else if (e.def.type === 'select') {
          if ([].some.call(e.input.options, function (o) { return o.value === v; })) e.input.value = v;
        } else e.input.value = v;
      });
    };

    show(0, false);
    if (host.getAttribute('data-prefill')) self.prefill(host.getAttribute('data-prefill'));
    Object.keys(fields).forEach(function (k) {
      if (query.has(k) && TRACK_KEYS.indexOf(k) === -1 && k !== 'test') self.prefill(k + '=' + query.get(k));
    });
  }

  /* ---------- start ---------- */

  var instances = [];
  var hosts = [].slice.call(document.querySelectorAll('[data-form]'));
  if (!hosts.length) return;

  fetch(CONFIG_URL, { credentials: 'same-origin' })
    .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
    .then(function (cfg) {
      hosts.forEach(function (host) {
        var key = host.getAttribute('data-form');
        var def = cfg.forms && cfg.forms[key];
        if (!def) { host.textContent = TEXT.loadFailed; if (window.console) console.error('forms.js: no form "' + key + '" in forms.json'); return; }
        instances.push(new FormInstance(host, key, def, cfg.consent));
      });
    })
    .catch(function (err) {
      hosts.forEach(function (h) { h.textContent = TEXT.loadFailed; });
      if (window.console) console.error('forms.js: could not load forms.json', err);
    });

  // Buttons and links that preselect a field, e.g. the hero's "See what you'd net"
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('[data-prefill]:not([data-form])');
    if (!trigger || !instances.length) return;
    var target = instances[0];
    var href = trigger.getAttribute('href') || '';
    if (href.charAt(0) === '#') {
      var section = document.getElementById(href.slice(1));
      instances.forEach(function (inst) { if (section && section.contains(inst.host)) target = inst; });
    }
    target.prefill(trigger.getAttribute('data-prefill'));
  });
})();
