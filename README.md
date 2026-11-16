<p align="center">
  <img src="docs/icon.png" width="128" height="128" alt="Rotorlab">
</p>

<h1 align="center">Rotorlab</h1>

<p align="center">
  A free AI-powered app for diagnosing, configuring and fixing FPV drones running Betaflight: the Configurator tabs, ESC and ELRS info, PID autotune from logs.
</p>

<p align="center">
  <a href="https://github.com/0nskal/rotorlab/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/0nskal/rotorlab?style=flat-square&color=0B1016&labelColor=0B1016"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%2F11-0B1016?style=flat-square&logo=windows&logoColor=DCEFF8">
  <img alt="Chrome/Edge WebSerial" src="https://img.shields.io/badge/Chrome%20%2F%20Edge-WebSerial-0B1016?style=flat-square&logo=googlechrome&logoColor=DCEFF8">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-0B1016?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/0nskal/rotorlab/releases/latest/download/Rotorlab-Setup.exe"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="https://rotorlab.pages.dev/app/"><b>Open in the browser</b></a>
  &nbsp;·&nbsp;
  <a href="https://rotorlab.pages.dev"><b>Website</b></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Rotorlab: X-ray style drone layout and a patient chart with the diagnosis" width="860">
</p>

<p align="center"><b>English</b> · <a href="#polski">Polski</a></p>

## Features

- **Diagnosis in a minute.** Reads the whole configuration over MSP when you connect and checks it against rules: ESC protocol, bidirectional DShot, voltage per cell, arming disable flags. The "What I checked" list shows every rule.
- **AI assistant.** With an Anthropic API key it completes the diagnosis and proposes Betaflight CLI commands. The configuration tabs have an "Ask AI about this tab" button. Without a key the rules still work.
- **Betaflight Configurator tabs.** Everything is read automatically on connect (no "read" buttons) and saved over MSP (SET commands, EEPROM write, reboot and reconnect when needed). Changed fields are marked until you press Save.
  - **Setup:** firmware and board info, live attitude, sensors, arming status, calibration, reboot to DFU/MSC, reset.
  - **Ports:** UART functions and baud rates.
  - **Configuration:** mixer, board alignment, accelerometer trim, PID loop, features, beepers, arming, names.
  - **Power & Battery:** live voltage/current, meter sources and scales, cell limits, voltage scale calculator.
  - **Failsafe:** guard time, procedure, per-channel fallback values.
  - **Receiver:** provider, channel map, RSSI channel, deadbands, RC smoothing, live channel bars and ELRS link quality.
  - **Modes:** AUX ranges for every flight mode with a live channel marker and the modes the FC reports as active.
  - **PID Tuning:** PID/D max/feedforward per profile, rates for all five rate types with live curves, throttle curve, filters with a frequency-response sketch.
  - **Motors:** protocol, bidirectional DShot, idle, motor poles, direction, live ESC telemetry (RPM, temperature, voltage, current), motor test with safety lock.
  - **OSD:** drag-and-drop element layout per profile, warnings, statistics, units and alarms.
  - **Blackbox:** logging device, rate and debug mode, flash usage, download (fast jumbo MSP frames), erase, mass-storage mode; a downloaded log opens straight in Autotune.
  - **CLI:** terminal with history and completion, `diff all` backup, load a diff file.
- **ESC info from the hardware.** Reads firmware, version and settings of every ESC over the 4-way interface (BLHeli_S, Bluejay and AM32 settings; BLHeli_32 only the MCU, its layout is closed). Read-only.
- **ELRS receiver version from the hardware** (CRSF passthrough), update checklist (binding phrase, LBT/FCC) and a shortcut to the official ELRS Web Flasher.
- **Autotune from a log.** Native `.bbl` from the FC or CSV from `blackbox_decode`: gyro spectrum, step response with overshoot, current and suggested PIDs, one click to carry them over to the PID Tuning tab.
- **Matches the firmware.** Rate curves (Betaflight, RaceFlight, KISS, Actual, Quick), the throttle curve, arming flags, beepers, features and port ids are checked against the Betaflight source (4.5 and 2025.12) with unit tests.
- **Demo mode.** A simulated FC so you can explore every tab without a drone.
- **English and Polish.** Switch the language under **Settings** (it applies instantly).

**Tested on hardware vs. not yet:** the Betaflight tabs were built against the MSP protocol from the firmware source and tested against the simulated FC (demo mode) and unit tests. Saving settings, Blackbox download/erase/MSC, the 4-way ESC read and the ELRS passthrough have **not been tested on a real flight controller yet**. Keep a `diff all` backup (the CLI tab makes one in one click) and remove the props.

<p align="center">
  <img src="docs/screenshot-setup.png" alt="Rotorlab Setup tab: firmware and board, attitude, sensors, arming status" width="860">
</p>
<p align="center">
  <img src="docs/screenshot-tuning.png" alt="Rotorlab PID Tuning tab: rates with live curves and the throttle curve" width="860">
</p>

## Install

### Windows

1. Download [`Rotorlab-Setup.exe`](https://github.com/0nskal/rotorlab/releases/latest/download/Rotorlab-Setup.exe) from the latest release.
2. Run the installer. The app is not code-signed, so SmartScreen may show a warning: **More info → Run anyway**.

### Browser

Open [rotorlab.pages.dev/app](https://rotorlab.pages.dev/app/) in **Chrome or Edge 89+** (WebSerial). Firefox and Safari do not support the serial port.

Requirements: a USB data cable, Betaflight 4.3+ on the flight controller.

## First run

1. Close Betaflight Configurator (it holds the port) and remove the props.
2. Plug in the flight controller over USB and click **Connect**. No drone at hand? Choose **Demo mode**.
3. Optionally paste your Anthropic API key in **Settings**. It is stored locally and never goes to the repo or any Rotorlab server.

## How it works

| What | Where from |
| --- | --- |
| Reading the configuration (all tabs, on connect) and live data | MSP v1/v2 over WebSerial |
| Saving settings from the tabs | MSP SET commands + EEPROM write |
| AI fixes, `diff all`, CLI tab | Betaflight CLI over the serial port |
| ESC firmware and settings | 4-way interface (read-only) |
| ELRS receiver version | CRSF over `serialpassthrough` |
| AI diagnosis and command proposals | Claude API (Anthropic) |
| PID autotune: spectrum and step response | `.bbl` from the FC or CSV from `blackbox_decode` / Blackbox Explorer |

Architecture of the Betaflight layer: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Safety and privacy

- Before every CLI change Rotorlab saves a `diff all` backup, shows the list of commands and waits for confirmation. Tab edits are only sent when you press Save, and never while the drone is armed.
- While connected Rotorlab disables arming (like the Betaflight Configurator); it is released on disconnect.
- The motor test only works after you tick "Props removed", has a STOP button and stops on disconnect or tab change.
- The API key is stored locally on your device.
- Drone data (configuration, `diff all`, rule results) goes to Anthropic only when you ask the AI assistant a question.

## Development

```bash
npm install
npm run dev            # app in the browser (Vite)
npm run dev:electron   # app in Electron
npm run build          # typecheck + build to dist/
npm run dist:win       # Windows installer to release/
```

Adding a tab: create `app/src/screens/<name>.ts` exporting `mount`, register it in `app/src/screens/registry.ts`, and add its title to `app/src/i18n/en.ts` and `pl.ts`. All user-facing text lives in those two dictionaries (`pl.ts` must satisfy the type of `en.ts`). Betaflight tabs read through `ctx.bf` (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

Tests (Node, bundled with esbuild), e.g.:

```bash
npx esbuild app/src/bf/test-firmware.mjs --bundle --platform=node --format=esm --outfile=$TEMP/t.mjs && node $TEMP/t.mjs
```

The same works for `app/src/analysis/test.mjs` and every `app/src/bf/test-*.mjs`.

### Website deploy

```bash
npm run build && node scripts/build-site.mjs && npx wrangler pages deploy site --project-name rotorlab
```

`scripts/build-site.mjs` copies `dist/` to `site/app/`, so the browser app is served under `/app/`. The website (`site/`) is English by default with an EN/PL switch (`?lang=pl` also works).

## Updates

The Windows version updates from inside the app: **Settings → Updates** ("Check for updates", download with a progress bar, "Install and restart"). By default Rotorlab checks for new versions ~5 s after start (you can turn that off in the same place) and shows a quiet notice. A downloaded update also installs itself when you close the app. This applies from version 0.2.0; 0.1.0 has to be downloaded manually once. The browser version updates itself when you reload the page.

## Releases

Process: bump `version` in `package.json` (e.g. `0.2.0`), commit, `git tag v0.2.0 && git push --tags`, and GitHub Actions does the rest. The workflow checks that the tag matches the version in `package.json` (it fails otherwise), builds on Windows and uploads `Rotorlab-Setup.exe`, `Rotorlab-Setup.exe.blockmap` and `latest.yml` (used by the update mechanism) to the GitHub Release.

Pushing a `v*` tag runs GitHub Actions with automatic release notes. The CI workflow builds the project on every push and pull request.

## Roadmap

- Testing the Betaflight tabs on more flight controllers
- Per-motor spin direction and motor order (DShot commands)
- Flashing ELRS from inside the app
- macOS and Linux

## License

[MIT](LICENSE)

---

## Polski

<p align="center"><a href="#features">English</a> · <b>Polski</b></p>

## Funkcje

- **Diagnoza w minutę.** Po połączeniu Rotorlab czyta całą konfigurację przez MSP i sprawdza ją regułami: protokół ESC, bidirectional DShot, napięcie na celę, flagi blokady uzbrojenia. Lista „Co sprawdziłem” pokazuje każdą regułę.
- **Asystent AI.** Z kluczem Anthropic API dopowiada diagnozę i proponuje komendy CLI Betaflight. Zakładki konfiguracji mają przycisk „Zapytaj AI o tę kartę”. Bez klucza działają same reguły.
- **Zakładki jak w Betaflight Configuratorze.** Wszystko czyta się samo przy połączeniu (bez przycisków „odczytaj”), zapis idzie przez MSP (komendy SET, zapis EEPROM, restart i ponowne połączenie, gdy trzeba). Zmienione pola są zaznaczone, dopóki nie klikniesz Zapisz.
  - **Setup:** firmware i płytka, położenie na żywo, czujniki, blokady uzbrojenia, kalibracja, restart do DFU/MSC, reset.
  - **Porty:** funkcje UART i prędkości.
  - **Konfiguracja:** mikser, orientacja płytki, trym akcelerometru, pętla PID, funkcje, beepery, uzbrajanie, nazwy.
  - **Zasilanie:** napięcie i prąd na żywo, źródła i skale mierników, limity ogniw, kalkulator skali napięcia.
  - **Failsafe:** czas ochronny, procedura, wartości zastępcze kanałów.
  - **Odbiornik:** protokół, mapa kanałów, kanał RSSI, martwe strefy, RC smoothing, paski kanałów na żywo i jakość łącza ELRS.
  - **Tryby:** zakresy AUX dla każdego trybu z podglądem kanału i trybami, które FC zgłasza jako aktywne.
  - **Strojenie PID:** PID/D max/feedforward per profil, rates dla wszystkich pięciu typów z krzywymi na żywo, krzywa gazu, filtry ze szkicem charakterystyki.
  - **Silniki:** protokół, bidirectional DShot, idle, liczba biegunów, kierunek, telemetria ESC na żywo (RPM, temperatura, napięcie, prąd), test silników z blokadą.
  - **OSD:** układ elementów przeciąganiem per profil, ostrzeżenia, statystyki, jednostki i alarmy.
  - **Blackbox:** urządzenie, częstotliwość i tryb debug, zajętość flasha, pobieranie (szybkie ramki jumbo MSP), kasowanie, tryb pamięci masowej; pobrany log od razu otwiera się w Autotune.
  - **CLI:** terminal z historią i podpowiedziami, kopia `diff all`, wczytanie pliku diff.
- **Informacje o ESC ze sprzętu.** Firmware, wersja i ustawienia każdego ESC przez interfejs 4-way (ustawienia BLHeli_S, Bluejay i AM32; z BLHeli_32 tylko MCU, bo jego format jest zamknięty). Tylko odczyt.
- **Wersja odbiornika ELRS ze sprzętu** (CRSF passthrough), checklista aktualizacji (binding phrase, LBT/FCC) i skrót do oficjalnego ELRS Web Flasher.
- **Autotune z logu.** Natywny `.bbl` z FC albo CSV z `blackbox_decode`: widmo gyro, step response z overshootem, PID obecne i sugerowane, jednym kliknięciem przenoszone do zakładki Strojenie PID.
- **Zgodność z firmware.** Krzywe rates (Betaflight, RaceFlight, KISS, Actual, Quick), krzywa gazu, flagi uzbrojenia, beepery, funkcje i numery portów są sprawdzone z kodem Betaflight (4.5 i 2025.12) testami jednostkowymi.
- **Tryb demo.** Symulowany FC, żeby obejrzeć każdą zakładkę bez drona.
- **Angielski i polski.** Język przełączysz w **Ustawieniach** (działa od razu).

**Co jest sprawdzone na sprzęcie, a co nie:** zakładki Betaflight powstały na podstawie protokołu MSP z kodu firmware i są przetestowane na symulowanym FC (tryb demo) oraz testami jednostkowymi. Zapis ustawień, pobieranie/kasowanie Blackboxa i tryb MSC, odczyt ESC przez 4-way i passthrough ELRS **nie były jeszcze testowane na prawdziwym kontrolerze lotu**. Zrób kopię `diff all` (zakładka CLI robi ją jednym kliknięciem) i zdejmij śmigła.

## Instalacja

### Windows

1. Pobierz [`Rotorlab-Setup.exe`](https://github.com/0nskal/rotorlab/releases/latest/download/Rotorlab-Setup.exe) z najnowszego wydania.
2. Uruchom instalator. Appka nie jest podpisana certyfikatem, więc SmartScreen może pokazać ostrzeżenie: **Więcej informacji → Uruchom mimo to**.

### Przeglądarka

Otwórz [rotorlab.pages.dev/app](https://rotorlab.pages.dev/app/) w **Chrome lub Edge 89+** (WebSerial). Firefox i Safari nie obsługują portu szeregowego.

Wymagania: kabel USB z danymi, Betaflight 4.3+ na kontrolerze lotu.

## Pierwsze uruchomienie

1. Zamknij Betaflight Configurator (zajmuje port) i zdejmij śmigła.
2. Podłącz kontroler lotu kablem USB i kliknij **Połącz**. Nie masz drona pod ręką? Wybierz **Tryb demo**.
3. Opcjonalnie wklej klucz Anthropic API w **Ustawieniach**. Zapisuje się lokalnie, nie trafia do repo ani na żaden serwer Rotorlab.

## Jak to działa

| Co | Skąd |
| --- | --- |
| Odczyt konfiguracji (wszystkie zakładki, przy połączeniu) i dane na żywo | MSP v1/v2 przez WebSerial |
| Zapis ustawień z zakładek | komendy MSP SET + zapis EEPROM |
| Poprawki od AI, `diff all`, zakładka CLI | CLI Betaflight przez port szeregowy |
| Firmware i ustawienia ESC | interfejs 4-way (tylko odczyt) |
| Wersja odbiornika ELRS | CRSF przez `serialpassthrough` |
| Diagnoza AI i propozycje komend | Claude API (Anthropic) |
| Autotune PID: widmo i step response | `.bbl` z FC albo CSV z `blackbox_decode` / Blackbox Explorera |

Architektura warstwy Betaflight: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Bezpieczeństwo i prywatność

- Przed każdą zmianą przez CLI Rotorlab zapisuje kopię `diff all`, pokazuje listę komend i czeka na potwierdzenie. Zmiany w zakładkach idą do FC dopiero po kliknięciu Zapisz i nigdy, gdy dron jest uzbrojony.
- Po połączeniu Rotorlab blokuje uzbrajanie (jak Betaflight Configurator); blokada znika po rozłączeniu.
- Test silników działa tylko po zaznaczeniu „Śmigła zdjęte”, ma przycisk STOP i zatrzymuje się po rozłączeniu albo zmianie zakładki.
- Klucz API jest przechowywany lokalnie na Twoim urządzeniu.
- Dane drona (konfiguracja, `diff all`, wynik reguł) trafiają do Anthropic tylko wtedy, gdy zadajesz pytanie asystentowi AI.

## Rozwój

```bash
npm install
npm run dev            # appka w przeglądarce (Vite)
npm run dev:electron   # appka w Electronie
npm run build          # typecheck + build do dist/
npm run dist:win       # instalator Windows do release/
```

Dodanie zakładki: utwórz `app/src/screens/<nazwa>.ts` z eksportem `mount`, zarejestruj go w `app/src/screens/registry.ts` i dopisz tytuł w `app/src/i18n/en.ts` oraz `pl.ts`. Cały tekst interfejsu siedzi w tych dwóch słownikach (`pl.ts` musi spełniać typ z `en.ts`). Zakładki Betaflight czytają dane przez `ctx.bf` (zobacz [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

Testy (Node, bundlowane esbuildem), np. `npx esbuild app/src/bf/test-firmware.mjs --bundle --platform=node --format=esm --outfile=$TEMP/t.mjs && node $TEMP/t.mjs`; tak samo `app/src/analysis/test.mjs` i każdy `app/src/bf/test-*.mjs`.

### Deploy strony

```bash
npm run build && node scripts/build-site.mjs && npx wrangler pages deploy site --project-name rotorlab
```

Skrypt `scripts/build-site.mjs` kopiuje `dist/` do `site/app/`, dzięki czemu appka w przeglądarce działa pod `/app/`. Strona (`site/`) jest domyślnie po angielsku z przełącznikiem EN/PL (działa też `?lang=pl`).

## Aktualizacje

Wersja Windows aktualizuje się z poziomu appki: **Ustawienia → Aktualizacje** (przycisk „Sprawdź aktualizacje”, pobieranie z paskiem postępu, „Zainstaluj i uruchom ponownie”). Domyślnie Rotorlab sprawdza nowe wersje ~5 s po starcie (można wyłączyć tym samym miejscu) i pokazuje dyskretną informację. Pobrana aktualizacja instaluje się też sama po zamknięciu appki. Dotyczy to wersji od 0.2.0; 0.1.0 trzeba raz pobrać ręcznie. Wersja w przeglądarce aktualizuje się sama po odświeżeniu strony.

## Wydania

Proces: podbij `version` w `package.json` (np. `0.2.0`), zacommituj, `git tag v0.2.0 && git push --tags`, a resztę robi GitHub Actions. Workflow sprawdza, że tag zgadza się z wersją w `package.json` (inaczej kończy się błędem), buduje na Windows i wgrywa do GitHub Release `Rotorlab-Setup.exe`, `Rotorlab-Setup.exe.blockmap` oraz `latest.yml` (z tego pliku korzysta mechanizm aktualizacji).

Wypchnięcie tagu `v*` uruchamia GitHub Actions z automatycznymi notatkami wydania. Workflow CI buduje projekt przy każdym pushu i pull requeście.

## Roadmap

- Testy zakładek Betaflight na kolejnych kontrolerach lotu
- Kierunek obrotów i kolejność silników per silnik (komendy DShot)
- Flashowanie ELRS z poziomu appki
- macOS i Linux

## Licencja

[MIT](LICENSE)
