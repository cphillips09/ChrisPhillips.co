/*
 * fx-cards.js: the card light on phones (spec 5.6.1).
 *
 * The effect itself is pure CSS (see "Card light" in site.css): a line of light
 * slides up the card's left border and a soft shadow slides down its right
 * side. With a mouse, hovering a card or focusing inside it turns it on.
 *
 * Phones have no hover, so this script turns it on for the card nearest the
 * middle of the screen (class "fx-on"); as you scroll, it hands off from card
 * to card. Tapping a card also turns it on. One card at a time.
 * Does nothing with a mouse. The page works the same if this file fails.
 */
(function () {
  'use strict';

  if (!window.matchMedia || matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var cards = [].slice.call(document.querySelectorAll('.fx-card, .form-card'));
  if (!cards.length) return;

  var current = null, ticking = false, tapY = null;

  function only(card) {
    if (current === card) return;
    if (current) current.classList.remove('fx-on');
    current = card;
    if (current) current.classList.add('fx-on');
  }

  function pick() {
    ticking = false;
    if (tapY !== null && Math.abs(window.scrollY - tapY) < 60) return; // a tap wins until you scroll on
    tapY = null;
    var mid = window.innerHeight / 2, band = window.innerHeight * 0.18, best = null, bestD = Infinity;
    cards.forEach(function (card) {
      var r = card.getBoundingClientRect();
      if (r.bottom < mid - band || r.top > mid + band) return;   // not crossing the middle band
      var d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestD) { bestD = d; best = card; }
    });
    only(best);
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(pick); }
  }, { passive: true });
  window.addEventListener('resize', pick);
  cards.forEach(function (card) {
    card.addEventListener('pointerdown', function () { tapY = window.scrollY; only(card); });
  });
  pick();
})();
