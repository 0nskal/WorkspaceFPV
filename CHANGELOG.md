# Changelog

English first, Polish below. / Najpierw po angielsku, niżej po polsku.

## 0.6.0 – 2026-11-17

- **New look, same X-ray colours.** Tabs moved to a sidebar grouped into Start, Hardware, Flight, Tuning and Tools, with a red/amber counter next to tabs that have problems. Ctrl+K searches tabs and settings (it finds a setting by its tip text, opens the tab and lights the bulb). The top bar shows the connection, craft and Betaflight version, VBAT and RSSI.
- **Assistant:** a 0-100 configuration health gauge, a To fix list and a collapsible All good list.
- **Ports:** a board schematic with UART pads coloured by function, one compact row per port with function chips, MSP switch and baud, and inline conflict warnings.
- **Motors:** readouts next to each motor on the frame (RPM, temperature, errors, ESC firmware), the problem motor highlighted, props lock and STOP in one bar, motor test columns and a protocol bar with the recommended setting.
- **PID tuning and Workshop:** restyled panels, tabs and charts; a new start screen with a USB connect zone.
- **Softer look:** rounded panels and buttons, pill switches, chips and status, round slider thumbs with an amber fill.

## 0.5.1 – 2026-11-17

- **Fix: FC stuck after the ELRS version read.** Some boards (seen on a GEPRC F722 with Betaflight 2026.6) do not restart when the app drops DTR after `serialpassthrough … reset`, so they keep forwarding to the receiver and every MSP request times out ("MSP timeout (command 1)"). The app now says what happened and to unplug and replug the USB cable, remembers that board and never reads ELRS on it automatically again. The automatic ELRS read after connecting is now off by default (Settings); the manual read warns about the replug.

## 0.5.0 – 2026-11-17

- **Basic and Expert mode.** On first start the app asks how much you know about FPV; switch any time in the top bar or in Settings. Basic shows only the tabs needed to get a quad flying (Workshop, Setup, Configuration, Power, Receiver, Modes, Motors, OSD, PID Tuning, ELRS), hides advanced fields and explains each tab at the top. Expert shows everything: Ports, Failsafe, Blackbox, Autotune, CLI and all advanced settings.
- **Lightbulb tips.** A small bulb next to settings lights up on hover and explains in plain words what the setting does and what to set. Always on in Basic mode, optional in Expert mode.
- **Point the AI at a part of the app.** The scissors button in the assistant lets you drag a box around any part of the window. The AI gets the texts and values inside it (and, in the desktop app with the Anthropic API or Gemini, a picture) and answers with **Show** buttons that scroll to the exact field and highlight it. In Basic mode it explains step by step in plain words.
- Smoother interface: the tab underline slides to the active tab, screens and dialogs fade in, buttons react to presses. Everything respects the system "reduce motion" setting.

## 0.4.1 – 2026-11-17

- **Fix: connecting to some boards** (e.g. GEPRC F722 Mark 5) ended with "MSP timeout (command 1)". The app now raises DTR/RTS after opening the port, like Betaflight Configurator.

## 0.4.0 – 2026-11-17

- **AI providers.** The assistant no longer needs the paid Anthropic API. Choose in Settings → AI assistant: **Claude Code** (your own installed and logged-in CLI, desktop app only, counts toward your plan), **Google Gemini** (free API key, default model gemini-2.5-flash), **Local model (Ollama)** (model list from `/api/tags`) or the **Anthropic API** as before. Each card shows its status and a Test button; the chat shows which provider answered. In the desktop app the default is Claude Code when it is detected and no Anthropic key is set.
- **Settings icon is a gear** now (it looked like a sun).
- **Contribution rules.** The repository stays public, but changes come only as pull requests from forks, with screenshots of what changed (same model as the Burn project). Added CONTRIBUTING.md, a PR template, an issue template, SECURITY.md, CODEOWNERS and automatic checks for the PR title and screenshots. CI now also runs the tests (`npm test`).
- README: WorkspaceFPV is described as a hobby project made to make our work in the FPV hobby easier.

## 0.3.0 – 2026-11-16

- **New name: WorkspaceFPV** (formerly Rotorlab). New repo `0nskal/WorkspaceFPV`, website `workspacefpv.pages.dev`, installer `WorkspaceFPV-Setup.exe`. Old links redirect.
- Rotorlab 0.2.0 updates in place from Settings → Updates; settings (API key, language, toggles) are carried over. The browser version moved to a new address, so its settings start fresh.

## 0.2.0 – 2026-11-16

- In-app updates (Settings → Updates).
- Betaflight Configurator tabs read automatically on connect: Setup, Ports, Configuration, Power & Battery, Failsafe, Receiver, Modes, PID Tuning (PID, rates, filters), Motors, OSD, Blackbox, CLI.
- ESC firmware and settings via the 4-way interface (read-only); ELRS receiver version via CRSF passthrough.
- Native `.bbl` decoding for Autotune; blackbox download from the FC.
- English UI with Polish option; detailed X-ray drone drawing; new logo.
- Rate curves, throttle curve, arming flags and other tables checked against the Betaflight source.

## 0.1.0 – 2026-11-16

- First release: Workshop diagnosis with rules and AI assistant, ESC protocol and motor test, Autotune from CSV logs, ELRS checklist, Windows installer and browser version.

---

# Historia zmian

## Niewydane

- **Dostawcy AI.** Asystent nie wymaga już płatnego Anthropic API. Wybierasz w Ustawienia → Asystent AI: **Claude Code** (Twój zainstalowany i zalogowany CLI, tylko aplikacja desktopowa, liczy się do limitów planu), **Google Gemini** (darmowy klucz API, domyślny model gemini-2.5-flash), **Model lokalny (Ollama)** (lista modeli z `/api/tags`) albo **Anthropic API** jak dotąd. Każda karta pokazuje status i przycisk Test; w czacie widać, kto odpowiedział. W aplikacji desktopowej domyślnie działa Claude Code, gdy jest wykryty i nie ma klucza Anthropic.

## 0.6.0 – 2026-11-17

- **Nowy wygląd w tych samych kolorach „rentgena”.** Zakładki są w bocznym menu w grupach Start, Sprzęt, Lot, Strojenie i Narzędzia, a przy zakładkach z problemami jest czerwony albo bursztynowy licznik. Ctrl+K szuka zakładek i ustawień (ustawienie znajduje po tekście podpowiedzi, otwiera zakładkę i zapala żarówkę). Górny pasek pokazuje połączenie, nazwę drona i wersję Betaflight, VBAT i RSSI.
- **Asystent:** wskaźnik stanu konfiguracji 0–100, lista „Do poprawy” i zwijana lista „W porządku”.
- **Porty:** schemat płytki z padami UART w kolorach funkcji, jeden zwarty wiersz na port z chipami funkcji, przełącznikiem MSP i baudem oraz ostrzeżenia o konfliktach od razu w wierszu.
- **Silniki:** odczyty przy każdym silniku na ramie (obroty, temperatura, błędy, firmware ESC), podświetlony silnik z problemem, blokada śmigieł i STOP w jednym pasku, kolumny testu silników i pasek protokołu z zalecanym ustawieniem.
- **Strojenie PID i Warsztat:** nowe panele, zakładki i wykresy; nowy ekran startowy ze strefą podłączania USB.
- **Miękki wygląd:** zaokrąglone panele i przyciski, pigułkowe przełączniki, chipy i status, okrągłe uchwyty suwaków z bursztynowym wypełnieniem.

## 0.5.1 – 2026-11-17

- **Poprawka: FC zawieszony po odczycie wersji ELRS.** Niektóre płytki (np. GEPRC F722 z Betaflight 2026.6) nie restartują się, gdy appka opuszcza DTR po `serialpassthrough … reset`, więc dalej przekazują dane do odbiornika, a każde zapytanie MSP kończy się błędem „Timeout MSP (komenda 1)”. Appka mówi teraz, co się stało, i każe odpiąć i podpiąć kabel USB, zapamiętuje tę płytkę i już nigdy nie odczytuje na niej ELRS automatycznie. Automatyczny odczyt ELRS po połączeniu jest teraz domyślnie wyłączony (Ustawienia); ręczny odczyt ostrzega o konieczności ponownego podpięcia.

## 0.5.0 – 2026-11-17

- **Tryb podstawowy i ekspert.** Przy pierwszym uruchomieniu appka pyta, ile wiesz o FPV; zmienisz to w każdej chwili na górnym pasku albo w Ustawieniach. Podstawowy pokazuje tylko zakładki potrzebne, żeby dron poleciał (Warsztat, Setup, Konfiguracja, Zasilanie, Odbiornik, Tryby, Silniki, OSD, Strojenie PID, ELRS), chowa zaawansowane pola i u góry każdej zakładki tłumaczy, do czego służy. Ekspert pokazuje wszystko: porty, failsafe, blackbox, autotune, CLI i wszystkie zaawansowane ustawienia.
- **Żarówki z podpowiedziami.** Mała żarówka obok ustawienia zapala się po najechaniu i prostymi słowami tłumaczy, co robi to ustawienie i co wpisać. W trybie podstawowym zawsze włączone, w ekspercie do wyłączenia.
- **Wskaż AI fragment aplikacji.** Przyciskiem z nożyczkami w asystencie zaznaczasz prostokątem dowolny fragment okna. AI dostaje teksty i wartości z tego miejsca (a w appce na Windows z API Anthropic albo Gemini także obrazek) i odpowiada przyciskami **Pokaż**, które przewijają do konkretnego pola i je podświetlają. W trybie podstawowym tłumaczy krok po kroku.
- Płynniejszy interfejs: podkreślenie zakładki przesuwa się do aktywnej, ekrany i okna płynnie się pojawiają, przyciski reagują na kliknięcie. Wszystko respektuje systemowe ustawienie ograniczenia animacji.

## 0.4.1 – 2026-11-17

- **Poprawka: łączenie z niektórymi płytkami** (np. GEPRC F722 Mark 5) kończyło się błędem „Timeout MSP (komenda 1)”. Appka podnosi teraz DTR/RTS po otwarciu portu, jak Betaflight Configurator.

## 0.4.0 – 2026-11-17

- **Dostawcy AI.** Asystent nie wymaga już płatnego API Anthropic. Wybierz w Ustawienia → Asystent AI: **Claude Code** (Twój zainstalowany i zalogowany CLI, tylko appka na Windows, liczy się do limitów planu), **Google Gemini** (darmowy klucz API, domyślny model gemini-2.5-flash), **Model lokalny (Ollama)** (lista modeli z `/api/tags`) albo **API Anthropic** jak dotąd. Każda karta pokazuje status i przycisk Testuj; w czacie widać, który dostawca odpowiedział. W appce na Windows domyślnie wybierany jest Claude Code, gdy jest wykryty i nie ma klucza Anthropic.
- **Ikona ustawień to zębatka** (wyglądała jak słońce).
- **Zasady współpracy.** Repozytorium zostaje publiczne, ale zmiany przychodzą tylko jako pull requesty z forków, ze zrzutami ekranu zmian (jak w projekcie Burn). Dodane: CONTRIBUTING.md, szablon PR, szablon zgłoszenia błędu, SECURITY.md, CODEOWNERS oraz automatyczne sprawdzanie tytułu PR i zrzutów ekranu. CI uruchamia teraz także testy (`npm test`).
- README: WorkspaceFPV opisany jako projekt hobbystyczny, który ma ułatwiać nam pracę w hobby FPV.

## 0.3.0 – 2026-11-16

- **Nowa nazwa: WorkspaceFPV** (wcześniej Rotorlab). Nowe repo `0nskal/WorkspaceFPV`, strona `workspacefpv.pages.dev`, instalator `WorkspaceFPV-Setup.exe`. Stare linki przekierowują.
- Rotorlab 0.2.0 aktualizuje się na miejscu z Ustawienia → Aktualizacje; ustawienia (klucz API, język, przełączniki) zostają. Wersja w przeglądarce ma nowy adres, więc tam ustawienia startują od zera.

## 0.2.0 – 2026-11-16

- Aktualizacje w appce (Ustawienia → Aktualizacje).
- Zakładki Betaflight Configuratora odczytywane automatycznie po podłączeniu: Setup, Porty, Konfiguracja, Zasilanie, Failsafe, Odbiornik, Tryby, Strojenie PID (PID, rates, filtry), Silniki, OSD, Blackbox, CLI.
- Firmware i ustawienia ESC przez interfejs 4-way (tylko odczyt); wersja odbiornika ELRS przez CRSF passthrough.
- Natywne logi `.bbl` w Autotune; pobieranie blackboxa z FC.
- Interfejs po angielsku z opcją polską; szczegółowy rysunek RTG drona; nowe logo.
- Krzywe rates, krzywa gazu, flagi uzbrojenia i inne tabele sprawdzone z kodem Betaflight.

## 0.1.0 – 2026-11-16

- Pierwsze wydanie: diagnoza w Warsztacie z regułami i asystentem AI, protokół ESC i test silników, Autotune z logów CSV, checklista ELRS, instalator Windows i wersja w przeglądarce.
