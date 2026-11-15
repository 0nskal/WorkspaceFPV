# Rotorlab – specyfikacja v0.1

Rotorlab to darmowa, open-source appka (MIT) do diagnozy i naprawy drona FPV z Betaflight, z asystentem AI.
Działa jako **aplikacja na Windows** (Electron, instalator `Rotorlab-Setup.exe` z GitHub Releases) i jako **appka w przeglądarce**
(Chrome/Edge, WebSerial) pod `https://rotorlab.pages.dev/app/`. Język UI: polski. Repo: `github.com/0nskal/rotorlab`.

## Układ repo
```
app/                 aplikacja (Vite + TypeScript, bez frameworka UI albo z Preact – wybór agenta, lekko)
  index.html
  src/
    main.ts          start, routing zakładek (#warsztat, #esc, #autotune, #elrs, #ustawienia)
    serial/          WebSerial: port.ts, msp.ts (MSP v1), cli.ts (tryb CLI Betaflight), demo.ts (symulowany dron)
    fc/              model drona: state.ts (store + eventy), read.ts (odczyt przez MSP), diagnose.ts (reguły)
    ai/              assistant.ts (Claude API), prompts.ts
    ui/              komponenty, style (styles.css), drone-xray.ts (SVG rozkładu drona w stylu Rentgen)
    screens/         warsztat.ts, esc.ts, autotune.ts, elrs.ts, ustawienia.ts
electron/            main.ts (okno, obsługa wyboru portu szeregowego), preload.ts
site/                strona produktu (statyczna, Cloudflare Pages), app/ budowana do site/app przy deployu
docs/                SPEC.md, screenshot.png, icon.png
.github/workflows/   release.yml (tag v* -> build Windows -> Release z Rotorlab-Setup.exe)
README.md, LICENSE (MIT)
```
`design/` (makiety) jest w `.gitignore`.

## Styl (obowiązkowy): „Rentgen”
Wzór 1:1: `design/html/H-s5-rentgen.html` + `design/mockups/H-s5-rentgen.png`, generator rysunku `design/html/src-h/gen-H-rentgen.js`.
- Scena: klisza #070B10 z poświatą od środka (radial do #0F1A24) i ziarnem; rozkład drona prześwietlony (fill #CFE6F2 opacity 0.08–0.25, kontury #DCEFF8 z glow).
  Problem = czerwone „ognisko” #FF4A2E na części. Oznaczenia kliszy w mono (L, „ROTORLAB · <nazwa> · <data>”, „kV 60 · mAs 2”).
- Górny pasek #0B1016: logo, status połączenia, nazwa drona, zakładki Warsztat/ESC/Autotune PID/ELRS, mini gyro + LQ/RSSI.
- Szuflada AI z prawej 440px: jasna „karta pacjenta” #F2F5F7, tekst #0B1016, CLI na #0B1016, przycisk główny ciemny.
- Fonty IBM Plex Sans + IBM Plex Mono (pakiety `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` – lokalnie, appka ma działać offline). Rogi 0, bez cieni (poza glow na kliszy), ikony inline SVG (Lucide-style).
- Okno min. 1280x800, układ elastyczny (scena rośnie, szuflada stała).
- `drone-xray.ts`: port generatora do TS, funkcja `renderDrone({highlight: 'esc'|'rx'|'fc'|'motors'|'battery'|null, labels})` zwracająca SVG.

## Połączenie z FC
- `navigator.serial.requestPort()`; 115200 baud. W Electronie: `session.on('select-serial-port')` wybiera port (pierwszy pasujący VID STM32 0x0483 lub z listy w małym oknie wyboru) + `setPermissionCheckHandler`/`setDevicePermissionHandler` dla 'serial'.
- MSP v1: ramka `$M<` [size][cmd][payload][xor checksum], odpowiedź `$M>`; kolejka żądań z timeoutem 1 s.
  Odczyt: MSP_API_VERSION(1), MSP_FC_VARIANT(2), MSP_FC_VERSION(3), MSP_BOARD_INFO(4), MSP_NAME(10), MSP_STATUS(101), MSP_RAW_IMU(102),
  MSP_MOTOR(104), MSP_ANALOG(110: vbat u8 0.1V, mAh u16, rssi u16 0–1023, amperage s16; od API 1.41 dodatkowo vbat u16 0.01V), MSP_PID(112),
  MSP_ADVANCED_CONFIG(90: gyro_sync_denom u8, pid_process_denom u8, use_unsyncedPwm u8, motor_pwm_protocol u8, motor_pwm_rate u16, …),
  MSP_MOTOR_CONFIG(131: minthrottle u16, maxthrottle u16, mincommand u16, motorCount u8, motorPoles u8, useDshotTelemetry u8, useEscSensor u8).
  Enum protokołu (BF 4.x): 0 PWM, 1 ONESHOT125, 2 ONESHOT42, 3 MULTISHOT, 4 BRUSHED, 5 DSHOT150, 6 DSHOT300, 7 DSHOT600, 8 PROSHOT1000, 9 DISABLED.
  Telemetria co 100 ms (motor, analog, raw_imu) gdy połączone i nie w CLI.
  Test silników: MSP_SET_MOTOR(214, 8× u16 1000–2000) – tylko po zaznaczeniu „Śmigła zdjęte”, z przyciskiem STOP i auto-stopem po rozłączeniu/zmianie zakładki.
- CLI: wysłanie `#` → prompt `# `; komendy linia po linii, zbieranie wyjścia do następnego `# `. `diff all` do kopii i kontekstu AI.
  Zastosowanie zmian: zawsze najpierw zapis kopii (`diff all` do pliku w Pobranych / IndexedDB + przycisk „Pobierz kopię”), potem komendy, potem `save` (FC się restartuje) → automatyczne ponowne połączenie.
- Tryb demo (bez drona): symulowany FC z danymi z makiet (SpeedyBee F405 V4, BF 4.5.1, DSHOT300, bidir off, 6S 24.9 V, silniki 62/71/58/66 %), żeby appkę dało się obejrzeć i zrobić zrzuty. Przycisk „Tryb demo” na ekranie startowym.

## Diagnoza bez AI (reguły, `diagnose.ts`)
Lista „Co sprawdziłem” z ✓/✗ i proponowane komendy, m.in.: protokół nie-DShot → DSHOT600 (lub 300 przy pid_process 4k); `dshot_bidir` OFF → ON (RPM filter; uwaga: wymaga Bluejay/BLHeli_32/AM32, nie działa na gołym BLHeli_S);
napięcie na celę < 3.5 V; brak MSP_MOTOR przy uzbrojeniu; flagi blokady uzbrojenia z MSP_STATUS (arming disable flags: rozpisane po polsku: RXLOSS, THROTTLE, ANGLE, BOOTGRACE, NOPREARM, ARMSWITCH itd.).
Reguły działają zawsze; AI je uzupełnia.

## Asystent AI (`ai/assistant.ts`)
- Anthropic TypeScript SDK `@anthropic-ai/sdk`, w przeglądarce: `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`. Klucz podaje użytkownik w Ustawieniach (zapis lokalny, nigdy w repo). Bez klucza: tylko reguły + komunikat jak dodać klucz.
- Model `claude-opus-5-5`, `thinking: {type: "adaptive"}`, `output_config: {effort: "medium"}`, streaming (`client.messages.stream(...)` + `finalMessage()`), max_tokens 16000.
  Refusal fallback: beta `server-side-fallback-2026-07-01` z `fallbacks: "default"` (przez `client.beta.messages.stream`). Sprawdzaj `stop_reason` przed czytaniem treści.
- Prompt systemowy: ekspert FPV/Betaflight/ELRS/Bluejay, odpowiada po polsku, krótko; propozycje zmian wyłącznie jako blok ```cli z prawdziwymi komendami Betaflight; nigdy nie proponuje `defaults` bez ostrzeżenia; przypomina o zdjęciu śmigieł.
  Kontekst (stały, cache'owany): dane FC, `diff all`, wynik reguł. Pytanie użytkownika na końcu.
- UI: odpowiedź strumieniowana do szuflady; blok ```cli renderowany jako czarny blok z przyciskami „Zastosuj w FC” (z oknem potwierdzenia: lista komend + „Najpierw zapiszę kopię ustawień”) i „Kopiuj”.
- Przed pisaniem sprawdź aktualną dokumentację `@anthropic-ai/sdk` (README i streaming). Nie zgaduj API.

## Ekrany v0.1
1. **Warsztat**: start (Połącz / Tryb demo), po połączeniu rozkład drona z etykietami z prawdziwych danych, ognisko na części z najpoważniejszym problemem, szuflada AI z „Co sprawdziłem”.
2. **ESC**: widok z góry (M1–M4 Betaflight), wybór protokołu (zapis przez CLI `set motor_pwm_protocol`), przełącznik bidir, test silników z blokadą.
3. **Autotune PID**: import logu. v0.1 obsługuje CSV z `blackbox_decode` / Blackbox Explorer (kolumny `time (us)`, `setpoint[0..2]`, `gyroADC[0..2]`, `motor[0..3]`); `.bbl` → komunikat jak wyeksportować CSV. Analiza: widmo gyro (FFT, Hann, 0–500 Hz, piki opisane), step response (dekonwolucja Wienera setpoint→gyro w oknach, średnia; overshoot, czas ustalania), tabela PID obecne (MSP_PID) → sugerowane (reguły + AI), CLI z `set p_roll=` itd.
4. **ELRS**: informacje o odbiorniku (z CLI `get serialrx_provider`, wersji nie da się odczytać z FC – pole ręczne), checklista aktualizacji (zgodność wersji 3.x TX/RX, binding phrase, LBT/FCC), przycisk otwierający oficjalny ELRS Web Flasher, opis passthrough. Flashowanie z appki – w planach (README: „Roadmap”).
5. **Ustawienia**: klucz API, model, tryb demo, eksport kopii.

## Jakość
- `npm run build` bez błędów TS (strict). Brak zależności od zdjęć. Brak danych osobowych w kodzie.
- Bezpieczeństwo: żadnych zmian w FC bez potwierdzenia; test silników wyłącznie z blokadą; klucz API tylko lokalnie.
