/*
 * dog.js: the 404 page's "lost dog" (spec 4.4).
 *
 * Shows a random dog from the free Dog CEO API (https://dog.ceo). The page
 * starts with a local backup photo (/assets/img/dog-fallback.webp), so the
 * frame is never empty, then swaps in a random dog. "Find your dog" fetches
 * another: the button reads "Sniffing…" while loading, the new photo is fully
 * loaded before it crossfades in, and if anything fails the current photo
 * stays and a short "try again" note appears.
 *
 * What to edit: TIMEOUT_MS, the button text, and the messages below.
 */
(function () {
  'use strict';

  var API = 'https://dog.ceo/api/breeds/image/random';
  var TIMEOUT_MS = 6000;
  var frame = document.querySelector('.dog__frame');
  var button = document.getElementById('find-dog');
  var status = document.querySelector('.dog__status');
  if (!frame || !button) return;

  var imgs = frame.querySelectorAll('img');
  var front = imgs[0], back = imgs[1];
  var label = button.textContent;
  var busy = false;

  // "https://images.dog.ceo/breeds/retriever-golden/x.jpg" -> "golden retriever"
  function breedOf(url) {
    var m = String(url).match(/\/breeds\/([^/]+)\//);
    if (!m) return '';
    return m[1].split('-').reverse().join(' ');
  }

  function withTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function preload(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(url); };
      im.onerror = reject;
      im.src = url;
    });
  }

  function fetchDog(fromButton) {
    if (busy) return;
    busy = true;
    if (fromButton) { button.disabled = true; button.textContent = 'Sniffing…'; }
    status.textContent = '';
    withTimeout(fetch(API).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { if (data.status !== 'success' || !data.message) throw new Error('bad'); return preload(data.message); }))
      .then(function (url) {
        var breed = breedOf(url);
        back.src = url;
        back.alt = breed ? 'A random dog: ' + breed : 'A random dog';
        back.classList.remove('is-hidden');
        front.classList.add('is-hidden');
        front.alt = ''; front.setAttribute('aria-hidden', 'true');
        back.removeAttribute('aria-hidden');
        var t = front; front = back; back = t;            // the new photo is now in front
      })
      .catch(function () {
        if (fromButton) status.textContent = 'That one got away, try again.';
      })
      .then(function () {
        busy = false;
        button.disabled = false; button.textContent = label;
      });
  }

  button.addEventListener('click', function () { fetchDog(true); });
  fetchDog(false);   // swap the backup photo for a random dog right away
})();
