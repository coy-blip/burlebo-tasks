/* ==========================================================================
   BURLEBO Analytics — theme.js
   Loads theme.css, restores the saved theme, and drops a switch into the nav.

   Loaded once from auth.js, which every page already pulls in, so no page
   files need editing. Runs immediately (not on DOMContentLoaded) so the
   data-theme attribute is set before first paint — no flash.

   Themes: 'light' (Classic Deer) and 'dark' (Bendita). Light is default.
   Choice is remembered per browser in localStorage under 'blb-theme'.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'blb-theme';
  var DEFAULT = 'light';

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* private mode — fine */ }
  }
  function current() {
    return document.documentElement.getAttribute('data-theme') || DEFAULT;
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // --- 1. Set the theme before anything paints -----------------------------
  var saved = read();
  apply(saved === 'dark' || saved === 'light' ? saved : DEFAULT);

  // --- 2. Pull in the stylesheet -------------------------------------------
  if (!document.getElementById('blb-theme-css')) {
    var link = document.createElement('link');
    link.id = 'blb-theme-css';
    link.rel = 'stylesheet';
    link.href = '/theme.css';
    document.head.appendChild(link);
  }

  // --- 3. Mount the switch --------------------------------------------------
  // The nav is filled in asynchronously by each page's loadSharedNav(), so
  // this retries briefly rather than assuming the nav exists yet.
  function label(btn) {
    var dark = current() === 'dark';
    btn.textContent = dark ? '\u2600' : '\u263E';           // sun / moon
    btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    btn.setAttribute('aria-label', btn.title);
  }

  function mount() {
    if (document.getElementById('theme-toggle')) return true;
    var nav = document.getElementById('main-nav');
    if (!nav) return false;

    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.className = 'theme-toggle';
    btn.type = 'button';
    label(btn);

    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      write(next);
      label(btn);
    });

    // Appended last so it sits to the right of the role pill. The nav loader
    // inserts links *before* the pill, so appending keeps it out of the way.
    nav.appendChild(btn);
    return true;
  }

  function start() {
    if (mount()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (mount() || ++tries > 40) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
