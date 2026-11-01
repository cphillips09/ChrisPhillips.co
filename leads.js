/*
 * leads.js: sends form submissions to the Google Apps Script web app.
 * Adds ad attribution (utm_*, gclid, fbclid), the page, and a timestamp.
 * Attribution is remembered for the browser tab, so it survives a page refresh.
 */
(function () {
  'use strict';
  var cfg = window.SITE_CONFIG || {};
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

  function attribution() {
    var q = new URLSearchParams(location.search), found = {}, saved = {};
    KEYS.forEach(function (k) { if (q.get(k)) found[k] = q.get(k); });
    try {
      if (Object.keys(found).length) sessionStorage.setItem('lead_attr', JSON.stringify(found));
      else saved = JSON.parse(sessionStorage.getItem('lead_attr') || '{}');
    } catch (e) { /* storage blocked: use what's in the URL */ }
    var out = Object.keys(found).length ? found : saved;
    out.page = location.pathname;
    out.referrer = document.referrer || '';
    return out;
  }
  attribution(); // capture on page load

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // fields: plain object. Must include `form` (which sheet tab) .
  function submit(fields) {
    if (!cfg.APPS_SCRIPT_URL) return Promise.reject(new Error('not-configured'));
    var payload = Object.assign({}, attribution(), fields, {
      submitted_at: new Date().toISOString(),
      user_agent: navigator.userAgent
    });
    var body = new URLSearchParams();
    Object.keys(payload).forEach(function (k) {
      if (payload[k] !== undefined && payload[k] !== null) body.append(k, payload[k]);
    });
    // Apps Script doesn't send CORS headers, so this is a "simple" no-cors POST.
    // The response is unreadable, but the request still reaches the script.
    return fetch(cfg.APPS_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: body });
  }

  window.Leads = { configured: !!cfg.APPS_SCRIPT_URL, submit: submit, newId: newId };
})();
