import type { enTipsCore } from '../en/tips-core';

export const plTipsCore: typeof enTipsCore = {
  warsztat: {
    intro:
      'To ekran startowy. Podłącz kontroler lotu przez USB (albo włącz tryb demo), a WorkspaceFPV odczyta konfigurację Betaflight i ją sprawdzi. Rysunek pokazuje twojego quada i zaznacza część z problemem. Asystent po prawej wypisuje testy i proponuje poprawki, które zastosujesz jednym kliknięciem.',
    connect:
      'Najpierw podłącz FC do komputera kablem USB, przy odłączonym pakiecie. W oknie, które się otworzy, wybierz jego port szeregowy. Samo odczytywanie niczego na FC nie zmienia.',
    demo: 'Symulowany quad 5" z problemem w ESC. Zobaczysz, jak działa aplikacja, zanim podłączysz prawdziwego drona. Nic tu nie dotyka sprzętu.',
    diagnosis:
      'Aplikacja porównuje twoje ustawienia z prostymi regułami, np. protokół silników, którego ESC nie obsługuje, albo zbyt niski akumulator. Część z problemem jest zaznaczona na rysunku, a asystent po prawej ją wyjaśnia.',
    parts:
      'FC to kontroler lotu (płytka z Betaflight), RX to odbiornik radiowy, ESC steruje silnikami. Podpis przy każdej części pokazuje, co aplikacja na niej znalazła.',
    battery:
      'Liczba przed **S** to liczba cel (4S = cztery cele LiPo, ok. 16,8 V po naładowaniu). Na samym USB bez pakietu widać tylko 5 V z USB. Zdrowa cela ma między 3,5 a 4,2 V.',
    receiver:
      'Pokazuje łącze radiowe: protokół, np. ELRS lub Crossfire, i siłę sygnału. „Brak danych” znaczy, że odbiornik nic nie wysyła do FC. Sprawdź przewody i zakładkę Odbiornik.',
    esc: 'ESC steruje silnikami protokołem (częste są DShot300 i DShot600) i ma własny firmware. „bidir OFF” oznacza wyłączony dwukierunkowy DShot, więc filtr RPM nie zadziała.',
  },
  settings: {
    interface:
      '**Podstawowy** pokazuje tylko zakładki potrzebne, żeby quad poleciał, i tłumaczy każde ustawienie. **Ekspert** pokazuje wszystkie funkcje Betaflight. Przełączysz tu albo przełącznikiem na górnym pasku, nic się przy tym nie gubi.',
    aiProviders:
      'Asystent AI potrzebuje modelu, z którym rozmawia. Wybierasz jednego dostawcę, a aplikacja wysyła tam twoje pytania. Claude Code i Ollama nie wymagają klucza, Gemini ma darmowy limit, a API Anthropic jest płatne za użycie.',
    claudeCode:
      'Narzędzie Claude Code w wierszu poleceń, które możesz mieć już zainstalowane i zalogowane. Aplikacja z niego korzysta, więc klucza tu nie trzeba. Działa na twojej subskrypcji Claude, tylko w aplikacji desktopowej.',
    gemini:
      'Model Google. Klucz wygenerujesz na aistudio.google.com i wklejasz tutaj. Darmowy limit wystarcza do zwykłego użycia, w granicach dziennych limitów. Pytania i obrazy ekranu trafiają do Google.',
    ollama:
      'Uruchamia model na twoim komputerze: za darmo i offline, nic nie wychodzi poza maszynę. Najpierw instalujesz Ollamę i pobierasz model. Małe modele odpowiadają wolniej i gorzej niż Claude czy Gemini.',
    anthropic:
      'API Claude z twoim kluczem z console.anthropic.com. Płacisz za użycie, zwykle kilka groszy za długą rozmowę. Działa w przeglądarce i w aplikacji desktopowej oraz potrafi czytać obrazy ekranu.',
    armDisable:
      'Gdy FC jest połączony, aplikacja blokuje uzbrajanie, żeby silniki nie ruszyły przypadkiem podczas testów na biurku. Wyłącz to tylko wtedy, gdy wiesz, po co.',
    autoEscInfo:
      'Po połączeniu aplikacja odczytuje firmware i ustawienia ESC przez FC. To tylko odczyt, nic nie jest zapisywane do ESC. Wydłuża łączenie o kilka sekund.',
    autoElrsInfo:
      'Po połączeniu aplikacja odczytuje wersję i ustawienia odbiornika ELRS. To tylko odczyt, dzięki niemu diagnoza podaje dokładny firmware. Wyłącz, jeśli łączenie wydaje się wolne.',
    updates:
      'W aplikacji desktopowej wersja jest sprawdzana na GitHubie. Sam decydujesz, kiedy pobrać i zainstalować. Nic nie instaluje się bez twojego kliknięcia.',
  },
  drawer: {
    snip: 'Kliknij nożyczki i przeciągnij ramkę nad dowolną częścią aplikacji. Asystent dostaje teksty i wartości z ramki. Przy API Anthropic lub Gemini w aplikacji desktopowej dostaje też jej obraz. Może odpowiedzieć przyciskami **Pokaż**, które podświetlają dokładne pole.',
    apply:
      '„Zastosuj na FC” najpierw prosi o potwierdzenie. Potem aplikacja zapisuje kopię (`diff all`), wysyła komendy, zapisuje je na FC i restartuje go. Nic nie jest zapisywane bez twojego potwierdzenia i nigdy przy uzbrojonym quadzie.',
  },
};
