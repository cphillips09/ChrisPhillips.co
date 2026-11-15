/*
 * site.js: small behaviors shared by every page. Loaded with `defer` from the
 * head partial, so the page is fully readable before this runs and still
 * works if it fails.
 *
 * What it does:
 *   1. Marks the current side of the Selling | Operations toggle with
 *      aria-current="page" (for screen readers). The highlight itself is CSS,
 *      driven by <body data-section="selling|operations">, so it shows even
 *      without JavaScript. Legal pages and the 404 page set no data-section.
 *   2. Adds a hairline under the sticky top bar once the page is scrolled.
 *   3. In-page links (href="#contact"): after the smooth scroll (CSS), moves
 *      keyboard focus to the target so screen-reader and keyboard users land
 *      in the right place. If the target is a collapsed section (<details>),
 *      it opens it first: landing pages link to #privacy and #terms this way,
 *      so visitors never leave the page.
 *   4. Fills every <span data-year> with the current year.
 *
 * What to edit: nothing for day-to-day changes. Scroll reveal is added here in
 * Phase 6 (spec 5.6). Form prefill links (data-prefill) are handled by forms.js.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  // 1. Toggle: current page
  var section = document.body.getAttribute('data-section');
  if (section) {
    document.querySelectorAll('.toggle__link[data-section="' + section + '"]').forEach(function (link) {
      link.setAttribute('aria-current', 'page');
    });
  }

  // 2. Top bar hairline after scrolling
  var bar = document.querySelector('.topbar');
  if (bar) {
    var ticking = false;
    var update = function () {
      bar.classList.toggle('is-scrolled', window.scrollY > 4);
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // 3. In-page links: open a collapsed section if the link points at one
  //    (landing pages: footer and form consent link to #privacy / #terms),
  //    then move focus to the target after scrolling.
  var openDetails = function (target) {
    var d = target && target.closest && target.closest('details');
    if (d) d.open = true;
  };
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#"]');
    if (!link) return;
    var id = link.getAttribute('href').slice(1);
    if (!id) return;
    var target = document.getElementById(id);
    if (!target) return;
    openDetails(target);
    var focusEl = target.tagName === 'DETAILS' ? target.querySelector('summary') : target;
    if (focusEl === target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    // preventScroll: CSS smooth scrolling is already moving the page there.
    window.setTimeout(function () { focusEl.focus({ preventScroll: true }); }, 0);
  });
  if (location.hash.length > 1) openDetails(document.getElementById(location.hash.slice(1)));

  // 4. Footer year
  var year = String(new Date().getFullYear());
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = year; });
})();
