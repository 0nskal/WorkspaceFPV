# Changelog

English first, Polish below. / Najpierw po angielsku, niżej po polsku.

## Unreleased

- **AI providers.** The assistant no longer needs the paid Anthropic API. Choose in Settings → AI assistant: **Claude Code** (your own installed and logged-in CLI, desktop app only, counts toward your plan), **Google Gemini** (free API key, default model gemini-2.5-flash), **Local model (Ollama)** (model list from `/api/tags`) or the **Anthropic API** as before. Each card shows its status and a Test button; the chat shows which provider answered. In the desktop app the default is Claude Code when it is detected and no Anthropic key is set.

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
