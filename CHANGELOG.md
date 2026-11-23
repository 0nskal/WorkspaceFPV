# Changelog

English first, Polish below. / Najpierw po angielsku, niżej po polsku.

## 1.2.0 – 2026-11-23

- **Shorter beginner menu: Drone, Radio, Motors.** Tuning and every other Betaflight tab stay behind the "All Betaflight tabs" switch.
- **Motors: a step-by-step check.** Props off, battery connected and the drone disarmed, then motors 1 to 4 one at a time on the drone picture. Each spins slowly for 2 seconds; you answer whether the right motor spun and in the right direction, and get a short list of what to fix. STOP, Space, switching windows and disconnecting stop the motor at once.
- **Radio: learn your switches.** Click a switch on the picture and flip the same one on your radio: the app remembers which AUX it is and labels it, with its flight mode, on the picture. Hover a mode (ANGLE, AIR MODE, …) to see what it does.
- **Drone: no false alarms on USB.** Without a battery the receiver, the ESCs and some sensors are off; those messages now sit in a calm "check with a battery" group instead of the red list. Hover a part of the drone to see what it does.
- **Assistant: short answers.** It answers first, in a few sentences or at most 5 steps, and suggests three beginner questions to start with. The panel has the same look as the rest of the app.
- **Ports for beginners: one question,** which UART the receiver is on, with a clickable board. The Radio screen links to it when there is no signal.
- **Configuration: buzzer presets** (Only important, Everything, Only when I lose the drone).
- **The remaining tabs follow the dark and light theme,** and Basic mode hides what a new pilot does not need (3D, gyro graphs, firmware info, LED, AND/OR mode logic).

## 1.1.0 – 2026-11-23

- **Made for beginners first.** The menu now has four items: Drone, Radio, Motors and Tuning. Every Betaflight tab is still there behind the "All Betaflight tabs" switch at the bottom of the menu. The "How much do you know about FPV?" window is gone.
- **Drone screen (new start screen).** Three steps to connect. Once connected you see a picture of the quad with real data next to its parts (board, ESC protocol, battery, receiver). A part with a problem pulses red. Each problem is described in plain words; where possible a **Fix** button changes the setting for you (with a confirmation and a backup), otherwise a button takes you to the right screen. The props spin when the motors run.
- **Radio screen (new).** The sticks on the picture move with your radio. A short test ticks off each direction once you push the stick all the way. You see which AUX arms the drone and which modes sit on each switch. Nothing is written to the flight controller here.
- **Dark and light theme.** Dark is the default. Light has high contrast for reading in the sun. Settings → Appearance, or follow the system.
- **Works on phones and tablets:** bottom tab bar, no fixed desktop width.
- **New app icon.**

## 1.0.0 – 2026-11-18

- **New look, built for reading.** Every flight-controller tab follows the Betaflight App layout with the WorkspaceFPV colours: a page title, panels with amber titles, rows of *control · label · help bulb* (the explanation opens from the bulb instead of sitting under every row), bigger text, and the assistant panel closed by default so the tab gets the full width.
- **New menu.** Start · Hardware (Ports, Configuration, Power, Receiver, Motors, Sensors, Failsafe, GPS, ELRS) · Tuning (PID/Rates, Modes, OSD, Blackbox, Autotune PID, CLI) · Tools: links to Betaflight App, ELRS Configurator, ESC Configurator, DJI Assistant 2 and the USB drivers (CP210x, Zadig, ImpulseRC Driver Fixer).
- **Sensors tab (new):** sensor hardware switches, board alignment, accelerometer calibration and trims, live attitude and live gyro / accelerometer / magnetometer / barometer graphs.
- **GPS tab (new):** GPS configuration, satellite signal table, position, speed, heading, DOP, a home radar and a link to OpenStreetMap.
- **Motors tab rebuilt:** model type with a clear quad diagram, ESC/motor settings (protocol, MOTOR_STOP, ESC_SENSOR, bidirectional DShot, poles, idle, dynamic idle, 3D), live gyro/accelerometer graph, and a motor test with RPM, error rate and temperature per motor and an "I understand the risks" switch. All safety locks stay.
- Setup, Ports, Power, Receiver, PID tuning, Modes, OSD, Blackbox, CLI, ELRS and Autotune PID restyled to the same layout.

## 0.8.0 – 2026-11-17

- **CHIRP analysis in PID Autotune (Expert).** Reads the sweep that Betaflight 2026 adds in CHIRP mode and shows how the drone follows every frequency: Bode charts (tracking, sensitivity, phase, coherence), bandwidth, phase and gain margin, a step response computed from the sweep and a rating per axis. Hints are for review only and are never applied automatically. A setup guide and a button for `debug_mode = CHIRP` are included. CHIRP flights in a multi-flight log are kept out of the normal step analysis. The sample log has a synthetic CHIRP flight.

## 0.7.0 – 2026-11-17

- **One PID Autotune tab.** The separate tuning wizard is now part of PID Autotune and works in both modes, with lightbulb tips that say what to do and what Autotune does.
- **Basic mode:** pick the drone size and style, back up the settings (`before-pid`), prepare the drone, fly a short coached test flight, load the log and get four traffic lights (flight feel, vibrations, propwash, log quality) plus one small, safe change. Apply, Undo (restore the backup) or fly again and compare.
- **Expert mode:** a new analysis engine with charts. Step response from real stick moves (also per throttle range), throttle × frequency spectrograms that tell motor noise from frame resonance and low mount vibrations, filter delay and filter advice (RPM, dynamic notch, gyro and D-term sliders), propwash detection, PID advice with confidence, comparison of a flight series, settings read from the log header and BBL files with several flights. Tick the changes you want, then Apply selected, Copy CLI or Ask AI.

## 0.6.3 – 2026-11-17

- **Fix: Gemini "unexpected model name format".** If the Model field holds something that is not a model id (for example the key name "Default Gemini API Key" copied from AI Studio), the app now uses the default gemini-2.5-flash instead of failing; a "models/" prefix is accepted. The key field also mentions the newer key format (AQ.…).

## 0.6.2 – 2026-11-17

- **Illustrations.** Five generated illustrations in the app's X-ray style (no text, small WebP files, about 135 kB together): a quad on the Workshop start screen, a flight controller with a USB cable in the connect zone and on tabs that need a connected FC, pictures on the Basic / Expert cards and a radio link on the ELRS tab (Basic mode).
- ELRS tab: the beginner note no longer covers the receiver data.

## 0.6.1 – 2026-11-17

- **Setup: a real 3D quad instead of the wireframe.** The attitude view is now a generic 5-inch freestyle quad (X frame, motors, 3-blade props, FC stack, camera with a red lens at the nose, battery, antenna) drawn with three.js. It follows the FC smoothly at the screen refresh rate instead of jumping with every telemetry sample. three.js loads only on this tab; without WebGL the old drawing stays.

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

## 1.2.0 – 2026-11-23

- **Krótsze menu dla początkujących: Dron, Aparatura, Silniki.** Strojenie i pozostałe zakładki Betaflight są pod przełącznikiem „Wszystkie zakładki Betaflight”.
- **Silniki: sprawdzanie krok po kroku.** Śmigła zdjęte, bateria podłączona, dron rozbrojony, potem silniki 1–4 po kolei na zdjęciu drona. Każdy kręci się wolno przez 2 sekundy; odpowiadasz, czy zakręcił się właściwy i w dobrą stronę, i dostajesz krótką listę, co poprawić. STOP, spacja, zmiana okna i rozłączenie od razu zatrzymują silnik.
- **Aparatura: nauka przełączników.** Klikasz przełącznik na rysunku i przestawiasz ten sam w aparaturze: aplikacja zapamiętuje, który to AUX, i podpisuje go na rysunku razem z trybem. Najechanie na tryb (ANGLE, AIR MODE…) mówi, co robi.
- **Dron: bez fałszywych alarmów na USB.** Bez baterii odbiornik, ESC i część czujników nie mają prądu; te komunikaty trafiają do spokojnej grupy „sprawdzimy z baterią” zamiast na czerwoną listę. Najechanie na część drona mówi, do czego służy.
- **Asystent: krótkie odpowiedzi.** Najpierw odpowiedź, kilka zdań albo najwyżej 5 kroków, a na start trzy pytania dla początkujących. Panel wygląda jak reszta aplikacji.
- **Porty dla początkujących: jedno pytanie,** na którym UART jest odbiornik, z klikalną płytką. Aparatura prowadzi tu, gdy nie ma sygnału.
- **Konfiguracja: gotowe zestawy brzęczyka** (Tylko ważne, Wszystko, Tylko gdy zgubię drona).
- **Pozostałe zakładki mają ciemny i jasny motyw,** a tryb podstawowy chowa to, czego nowa osoba nie potrzebuje (3D, wykresy żyroskopu, informacje o firmware, LED, logika I/LUB w trybach).

## 1.1.0 – 2026-11-23

- **Najpierw dla początkujących.** Menu ma teraz cztery pozycje: Dron, Aparatura, Silniki i Strojenie. Wszystkie zakładki Betaflight dalej są, pod przełącznikiem „Wszystkie zakładki Betaflight” na dole menu. Okno „Ile wiesz o FPV?” zniknęło.
- **Ekran Dron (nowy ekran startowy).** Trzy kroki do połączenia. Po połączeniu widać zdjęcie quada z prawdziwymi danymi przy częściach (płytka, protokół ESC, bateria, odbiornik). Część z problemem pulsuje na czerwono. Każdy problem jest opisany prostymi słowami; jeśli się da, przycisk **Napraw** zmienia ustawienie za Ciebie (z potwierdzeniem i kopią), a jeśli nie, przycisk prowadzi na właściwy ekran. Śmigła kręcą się, gdy pracują silniki.
- **Ekran Aparatura (nowy).** Drążki na rysunku ruszają się razem z Twoją aparaturą. Krótki test zalicza każdy kierunek, gdy wychylisz drążek do końca. Widać, który AUX uzbraja drona i jakie tryby są na przełącznikach. Ten ekran niczego nie zapisuje do kontrolera.
- **Motyw ciemny i jasny.** Domyślnie ciemny. Jasny ma wysoki kontrast do czytania w słońcu. Ustawienia → Wygląd albo jak w systemie.
- **Działa na telefonie i tablecie:** dolny pasek zakładek, bez sztywnej szerokości z komputera.
- **Nowa ikona aplikacji.**

## 1.0.0 – 2026-11-18

- **Nowy, czytelny wygląd.** Każda zakładka kontrolera ma układ jak w Betaflight App, w kolorach WorkspaceFPV: tytuł strony, panele z bursztynowymi tytułami, wiersze *kontrolka · etykieta · żarówka* (opis otwiera się z żarówki zamiast leżeć pod każdym wierszem), większa czcionka, a panel asystenta jest domyślnie zwinięty, więc zakładka ma całą szerokość.
- **Nowe menu.** Start · Sprzęt (Porty, Konfiguracja, Zasilanie, Odbiornik, Silniki, Czujniki, Failsafe, GPS, ELRS) · Strojenie (PID/Rates, Tryby, OSD, Blackbox, Autotune PID, CLI) · Narzędzia: odnośniki do Betaflight App, ELRS Configurator, ESC Configurator, DJI Assistant 2 i sterowników USB (CP210x, Zadig, ImpulseRC Driver Fixer).
- **Zakładka Czujniki (nowa):** włączanie czujników, ułożenie płytki, kalibracja i trym akcelerometru, położenie na żywo i wykresy żyroskopu, akcelerometru, magnetometru i barometru.
- **Zakładka GPS (nowa):** konfiguracja GPS, tabela sygnału satelitów, pozycja, prędkość, kurs, DOP, radar względem domu i odnośnik do OpenStreetMap.
- **Silniki od nowa:** typ modelu z czytelnym schematem, ustawienia ESC/silników (protokół, MOTOR_STOP, ESC_SENSOR, dwukierunkowy DShot, bieguny, bieg jałowy, dynamiczny bieg jałowy, 3D), wykres żyroskopu/akcelerometru na żywo i test silników z obrotami, błędami i temperaturą każdego silnika oraz przełącznikiem „Rozumiem zagrożenia”. Wszystkie zabezpieczenia zostają.
- Setup, Porty, Zasilanie, Odbiornik, Strojenie PID, Tryby, OSD, Blackbox, CLI, ELRS i Autotune PID w tym samym układzie.

## 0.8.0 – 2026-11-17

- **Analiza CHIRP w Autotune PID (Ekspert).** Czyta przemiatanie, które Betaflight 2026 dodaje w trybie CHIRP, i pokazuje, jak dron nadąża na każdej częstotliwości: wykresy Bodego (śledzenie, czułość, faza, koherencja), pasmo, zapas fazy i wzmocnienia, odpowiedź skokową policzoną z przemiatania i ocenę każdej osi. Wskazówki są tylko do przejrzenia i nigdy nie są wprowadzane automatycznie. W środku instrukcja lotu i przycisk dla `debug_mode = CHIRP`. Loty CHIRP w logu z wieloma lotami są pomijane w zwykłej analizie odpowiedzi skokowej. Przykładowy log ma syntetyczny lot CHIRP.

## 0.7.0 – 2026-11-17

- **Jedna zakładka Autotune PID.** Osobny kreator strojenia jest teraz częścią Autotune PID i działa w obu trybach, z tipami (żarówki), które mówią, co robić i co robi Autotune.
- **Tryb podstawowy:** wybierasz rozmiar i styl drona, robisz kopię ustawień (`before-pid`), przygotowujesz drona, lecisz krótki lot testowy z podpowiedziami, wczytujesz log i dostajesz cztery światła (charakter lotu, drgania, propwash, jakość logu) oraz jedną małą, bezpieczną zmianę. Zastosuj, Cofnij (przywraca kopię) albo poleć jeszcze raz i porównaj.
- **Tryb ekspert:** nowy silnik analizy z wykresami. Odpowiedź skokowa z prawdziwych ruchów drążka (także osobno dla zakresów gazu), spektrogramy częstotliwość × gaz, które odróżniają szum silników od rezonansu ramy i niskich drgań mocowania, opóźnienie i zalecenia filtrów (RPM, dynamiczny notch, suwaki gyro i D-term), wykrywanie propwasha, zalecenia PID z oceną pewności, porównanie serii lotów, ustawienia z nagłówka logu i pliki BBL z wieloma lotami. Zaznaczasz zmiany i klikasz Zastosuj zaznaczone, Kopiuj CLI albo Poproś AI.

## 0.6.3 – 2026-11-17

- **Poprawka: Gemini „unexpected model name format”.** Jeśli w polu Model jest coś, co nie jest nazwą modelu (np. nazwa klucza „Default Gemini API Key” skopiowana z AI Studio), appka używa domyślnego gemini-2.5-flash zamiast zwracać błąd; prefiks „models/” jest akceptowany. Pole klucza podpowiada też nowszy format kluczy (AQ.…).

## 0.6.2 – 2026-11-17

- **Ilustracje.** Pięć wygenerowanych ilustracji w stylu „rentgena” aplikacji (bez napisów, lekkie pliki WebP, razem ok. 135 kB): dron na ekranie startowym Warsztatu, kontroler lotu z kablem USB w strefie podłączania i w zakładkach, które wymagają połączenia, obrazki na kartach Podstawowy / Ekspert oraz łącze radiowe w zakładce ELRS (tryb podstawowy).
- Zakładka ELRS: notka dla początkujących nie zasłania już danych odbiornika.

## 0.6.1 – 2026-11-17

- **Setup: prawdziwy dron 3D zamiast siatki.** Widok położenia to teraz uniwersalny dron freestyle 5" (rama X, silniki, trójłopatowe śmigła, stos FC, kamera z czerwonym obiektywem z przodu, bateria, antena) rysowany w three.js. Płynnie podąża za FC z częstotliwością odświeżania ekranu zamiast przeskakiwać przy każdej próbce telemetrii. three.js ładuje się tylko w tej zakładce; bez WebGL zostaje stary rysunek.

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
