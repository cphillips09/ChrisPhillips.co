/*
 * site-config.js: the only settings file for the website. Safe to be public.
 *
 * APPS_SCRIPT_URL  The new Apps Script web app address (ends in /exec), from
 *                  Deploy → New deployment in the Apps Script of the
 *                  "Website Contacts - chrisphillips.co" Google Sheet.
 *                  While blank, forms show "temporarily unavailable" on submit.
 *                  (The live site on main still uses the old deployment.)
 * MAPS_API_KEY     Google Maps Platform browser key (spec 13.2), restricted to
 *                  chrisphillips.co and localhost. Blank = plain address box.
 * GA4_ID           Google Analytics 4 measurement ID (deferred, D-31). Blank = off.
 * META_PIXEL_ID    Meta (Facebook) pixel ID (deferred, D-31). Blank = off.
 */
window.SITE_CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwD_OtUB7KZtCaZO02HsKErXFxiigE8TRhusTazUQfm2RusL6054MtOVEtV8lqeFBg_/exec',
  MAPS_API_KEY: '',
  GA4_ID: '',
  META_PIXEL_ID: ''
};
