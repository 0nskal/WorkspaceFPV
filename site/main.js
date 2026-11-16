/*
 * Rotorlab site: English by default, Polish via the EN/PL switch.
 * English copy lives in index.html (so it works without JS and in link previews); the Polish copy is the PL table below,
 * keyed by data-i18n / data-i18n-aria attributes. Choice: ?lang=pl|en wins, then localStorage, then the browser language.
 */
(function () {
  'use strict';
  var PL = {
  "features": "Funkcje",
  "install": "Instalacja",
  "dl": "Pobierz",
  "h1": "Prześwietl swojego drona.",
  "lead": "Darmowa appka z AI do diagnozy drona FPV z Betaflight. Sprawdza protokół ESC, testuje silniki, robi autotune PID z logów i pilnuje aktualizacji ELRS.",
  "dlwin": "Pobierz na Windows",
  "openweb": "Otwórz w przeglądarce",
  "source": "Kod na GitHubie",
  "chart": "karta pacjenta",
  "aicard": "Nowe ESC nie odpowiada na DShot300. Przełącz protokół:",
  "sec1": "Pięć rzeczy, które zwykle robisz po omacku.",
  "f1t": "Diagnoza w minutę",
  "f1p": "Rotorlab czyta konfigurację przez MSP i sprawdza ją regułami: protokół ESC, bidirectional DShot, napięcie na celę, flagi blokady uzbrojenia. Z kluczem API AI dopowiada resztę i podsuwa komendy CLI. Zawsze widzisz listę, co sprawdzono.",
  "checked": "Co sprawdziłem",
  "rules5": "5 reguł",
  "c1": "Mapowanie silników: zgodne",
  "c2": "Napięcie 6S 24.9 V: OK",
  "c3": "Protokół: DShot300",
  "c4": "Bidirectional DShot: wyłączony",
  "c5": "Blokada uzbrojenia: RXLOSS, ARMSWITCH",
  "f2t": "ESC bez zgadywania",
  "f2p": "Protokół DShot wybierasz z listy, a zapis idzie komendą CLI. Rotorlab przypomina, że bidirectional DShot wymaga Bluejay, BLHeli_32 albo AM32 i nie działa na gołym BLHeli_S. Test silników ruszy dopiero po zaznaczeniu „Śmigła zdjęte”. Ma przycisk STOP i zatrzymuje się sam po rozłączeniu.",
  "escproto": "PROTOKÓŁ ESC",
  "motortest": "TEST SILNIKÓW",
  "props": "Śmigła zdjęte",
  "f3t": "Autotune z logu",
  "f3p": "Wrzucasz CSV z blackbox_decode albo z Blackbox Explorera. Rotorlab liczy widmo gyro (0–500 Hz, piki opisane) i step response z wymierzonym overshootem, a potem pokazuje obecne PID obok sugerowanych, razem z gotowymi komendami <span class=\"mono\">set p_roll=</span>.",
  "time": "czas [ms]",
  "sugg": "- - sugerowane PID",
  "spectrum": "WIDMO GYRO",
  "motors168": "168 Hz · silniki",
  "f4t": "ELRS bez stresu",
  "f4p": "Wersji ELRS nie da się odczytać z kontrolera lotu, więc wpisujesz ją ręcznie. Rotorlab prowadzi przez checklistę: zgodność wersji 3.x nadajnika i odbiornika, binding phrase, LBT/FCC. Potem otwiera oficjalny ELRS Web Flasher. Flashowanie z poziomu appki jest w planach.",
  "receiver": "Odbiornik",
  "e1": "Protokół szeregowy: CRSF",
  "e2": "Nadajnik i odbiornik: ta sama linia 3.x",
  "e3": "Binding phrase: sprawdź w obu urządzeniach",
  "e4": "Dostępna 3.5.1. Zrób kopię opcji przed flashem",
  "openflasher": "Otwórz ELRS Web Flasher",
  "passthrough": "Jak działa passthrough",
  "f5t": "Nic nie zmienia się bez Twojej zgody",
  "f5p": "Zanim jakakolwiek komenda trafi do kontrolera, Rotorlab zapisuje kopię <span class=\"mono\">diff all</span> i pokazuje pełną listę zmian do potwierdzenia. Dopiero potem robi <span class=\"mono\">save</span> i łączy się ponownie. Klucz API zostaje w Twojej przeglądarce albo appce i nie trafia nigdzie poza Anthropic.",
  "applyq": "Zastosować w FC?",
  "cmds2": "2 komendy",
  "backupfirst": "Najpierw zapiszę kopię: ",
  "keylocal": "Klucz API: tylko na tym urządzeniu",
  "applyfc": "Zastosuj w FC",
  "cancel": "Anuluj",
  "sec2": "Pobierz, podłącz, sprawdź.",
  "req": "WYMAGANIA",
  "r1": "<b>Windows 10/11 64-bit</b> albo <b>Chrome / Edge 89+</b> z WebSerial",
  "r2": "<b>Kabel USB z danymi</b> (nie sam do ładowania)",
  "r3": "<b>Betaflight 4.3+</b> na kontrolerze lotu",
  "r4": "Klucz Anthropic API: <b>opcjonalny</b>. Bez niego działa diagnoza regułami.",
  "s1": "<b>Pobierz instalator.</b> <a class=\"lnk\" href=\"https://github.com/0nskal/rotorlab/releases/latest/download/Rotorlab-Setup.exe\">Rotorlab-Setup.exe</a> z GitHub Releases. Albo otwórz <a class=\"lnk\" href=\"./app/\">wersję w przeglądarce</a>.",
  "s2": "<b>Uruchom.</b> Appka nie jest podpisana, więc SmartScreen może zapytać: Więcej informacji, Uruchom mimo to.",
  "s3": "<b>Podłącz drona.</b> Kabel USB do kontrolera lotu, zamknięty Betaflight Configurator (zajmuje port). Śmigła zdjęte.",
  "s4": "<b>Kliknij Połącz.</b> Nie masz drona pod ręką? Tryb demo pokaże symulowany FC.",
  "aria_nav": "Główna",
  "aria_drone": "Rozkład drona FPV jak na kliszy RTG, ognisko na ESC",
  "aria_step": "Step response z overshootem 16%",
  "aria_spec": "Widmo gyro z pikiem około 168 Hz",
  "meta_title": "Rotorlab – diagnoza drona FPV z Betaflight i AI",
  "meta_desc": "Darmowa appka z AI do diagnozy drona FPV z Betaflight: protokół ESC, test silników, autotune PID z logów, ELRS. Windows albo przeglądarka. MIT."
};

  var UI = {
    en: { winTip: 'The installer is Windows only. On this system use the browser version (Chrome/Edge).' },
    pl: { winTip: 'Instalator jest tylko na Windows. Na tym systemie użyj wersji w przeglądarce (Chrome/Edge).' },
  };

  var EN = {}; // original English strings, captured from the markup
  var root = document.documentElement;
  var nonWindows = false;

  function capture() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      EN[el.getAttribute('data-i18n')] = el.innerHTML;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      EN[el.getAttribute('data-i18n-aria')] = el.getAttribute('aria-label');
    });
    EN.meta_title = document.title;
    var d = document.querySelector('meta[name="description"]');
    EN.meta_desc = d ? d.getAttribute('content') : '';
  }

  function pick(lang, key) {
    return lang === 'pl' && PL[key] != null ? PL[key] : EN[key];
  }

  function apply(lang) {
    root.setAttribute('lang', lang);
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = pick(lang, el.getAttribute('data-i18n'));
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var v = pick(lang, el.getAttribute('data-i18n-aria'));
      if (v != null) el.setAttribute('aria-label', v);
    });
    document.title = pick(lang, 'meta_title');
    var d = document.querySelector('meta[name="description"]');
    if (d) d.setAttribute('content', pick(lang, 'meta_desc'));
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang));
    });
    if (nonWindows) {
      document.querySelectorAll('.btn-primary').forEach(function (b) {
        b.setAttribute('title', UI[lang].winTip);
      });
    }
  }

  function initial() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q === 'pl' || q === 'en') return q;
    } catch (e) {}
    try {
      var saved = localStorage.getItem('rotorlab.site.lang');
      if (saved === 'pl' || saved === 'en') return saved;
    } catch (e) {}
    return /^pl\b/i.test(navigator.language || '') ? 'pl' : 'en';
  }

  function set(lang, persist) {
    apply(lang);
    if (persist) {
      try {
        localStorage.setItem('rotorlab.site.lang', lang);
      } catch (e) {}
    }
  }

  try {
    var ua = navigator.userAgent || '';
    if (/Mac|Linux|Android|iPhone|iPad/i.test(ua) && !/Windows/i.test(ua)) {
      nonWindows = true;
      root.classList.add('non-windows');
    }
  } catch (e) {}

  // old Polish anchors keep working
  if (location.hash === '#funkcje') location.hash = '#features';
  if (location.hash === '#instalacja') location.hash = '#install';

  capture();
  var lang = initial();
  if (lang !== 'en' || nonWindows) apply(lang);
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      set(b.getAttribute('data-lang'), true);
    });
  });
})();
