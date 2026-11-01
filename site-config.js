/*
 * site-config.js: the only file you need to edit to connect the forms.
 *
 * APPS_SCRIPT_URL: the Web App URL from your Google Apps Script deployment
 *                  (looks like https://script.google.com/macros/s/AKfy.../exec).
 *                  While it's blank, the home page form falls back to opening
 *                  an email, and the landing page shows a "not connected" note.
 * MAPS_API_KEY:    a Google Maps Platform browser key with "Places API (New)"
 *                  and "Maps JavaScript API" enabled, restricted to your domain.
 *                  While it's blank, the landing page uses a plain address box.
 */
window.SITE_CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbydzZb9fvzBxEzRn6OL-A5YY3E1JGcuQcrViFBDGQWxErKgjFnzJg168l2D42Rklrc6/exec',
  MAPS_API_KEY: '',
  CONTACT_EMAIL: 'hello@chrisphillips.co'
};
