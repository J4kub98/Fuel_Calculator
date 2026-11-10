// Nastaví barevný motiv ještě před prvním vykreslením stránky (zabrání probliknutí).
// Uložená volba: localStorage 'dark-mode' = 'true' | 'false' | (nic = podle systému).
(function () {
  var THEME_COLORS = { light: '#f2f2f4', dark: '#000000' };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function readPreference() {
    try {
      var stored = localStorage.getItem('dark-mode');
      if (stored === 'true') return 'dark';
      if (stored === 'false') return 'light';
    } catch (e) {
      // localStorage může být nedostupné (např. soukromý režim) — použijeme systém.
    }
    return 'auto';
  }

  function resolve(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    return media && media.matches ? 'dark' : 'light';
  }

  function apply(pref) {
    var theme = resolve(pref);
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    // Jediný theme-color meta tag odpovídající skutečnému motivu (status bar v PWA)
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].parentNode.removeChild(metas[i]);
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = THEME_COLORS[theme];
    document.head.appendChild(meta);
    return theme;
  }

  function setPreference(pref) {
    try {
      if (pref === 'dark') localStorage.setItem('dark-mode', 'true');
      else if (pref === 'light') localStorage.setItem('dark-mode', 'false');
      else localStorage.removeItem('dark-mode');
    } catch (e) {
      // Ignorujeme — volba pak platí jen do zavření stránky.
    }
    return apply(pref);
  }

  if (media) {
    var onChange = function () {
      if (readPreference() === 'auto') apply('auto');
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  window.FuelTheme = { get: readPreference, set: setPreference, apply: apply };
  apply(readPreference());
})();
