// Podświetl link „Pobierz na Windows” dla innych systemów: na macOS/Linux sugerujemy wersję w przeglądarce.
(function () {
  try {
    var ua = navigator.userAgent || '';
    if (/Mac|Linux|Android|iPhone|iPad/i.test(ua) && !/Windows/i.test(ua)) {
      document.documentElement.classList.add('non-windows');
      document.querySelectorAll('.btn-primary').forEach(function (b) {
        b.setAttribute('title', 'Instalator jest tylko na Windows. Na tym systemie użyj wersji w przeglądarce (Chrome/Edge).');
      });
    }
  } catch (e) {}
})();
