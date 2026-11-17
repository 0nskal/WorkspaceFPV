import type { enTipsTuning } from '../en/tips-tuning';

export const plTipsTuning: typeof enTipsTuning = {
  tuning: {
    intro:
      "Tu ustawiasz, jak quad się prowadzi: PID-y (jak mocno kontroler korygował lot), rates (jak szybko quad się obraca przy danym ruchu drążka) i filtry. Świeży Betaflight już lata. Zmieniaj jedną rzecz naraz, lataj i zapisuj, co zmieniłeś. Jeśli nie jesteś pewien, nie ruszaj PID-ów, baw się tylko rates.",
    pidTable:
      "Jeden wiersz na oś. P, I i D to trzy człony regulatora, który trzyma quada tam, gdzie każą drążki. Domyślne wartości latają na większości 5-calowców, więc zacznij od nich i zmieniaj małymi krokami.",
    p: "**P** ciągnie quada do pozycji drążka. Za niskie daje miękkie, rozmyte prowadzenie i znoszenie po ruchu. Za wysokie to szybkie trzęsienie zaraz po puszczeniu drążka. Na 5-calowcu zmieniaj o 5 do 10.",
    i: "**I** trzyma kąt wbrew powolnym siłom, jak wiatr, nierówny ciężar czy słabszy silnik. Za niskie i quad powoli odpływa albo siada przy gwałtownym gazie. Za wysokie daje wolne kołysanie, głównie na niskim gazie.",
    d: "**D** hamuje quada, gdy rusza się zbyt szybko, więc tłumi przeregulowanie i propwash. Za niskie i quad odbija za cel po flipach. Za wysokie grzeje silniki i dodaje szumu. Po podniesieniu D sprawdź temperaturę silników po krótkim locie.",
    dMax: "**D max** to wartość D używana przy szybkich ruchach albo propwashu. W spoczynku quad jedzie na niższym D bazowym, więc silniki są chłodniejsze. Trzymaj ją powyżej D. Podniesienie pomaga na propwash i grzeje silniki tylko wtedy, gdy jest aktywne.",
    ff: "**Feedforward (F)** reaguje na to, jak szybko ruszasz drążkiem, a nie na błąd. Wyższe F sprawia, że quad ostrzej i z mniejszym opóźnieniem idzie za drążkiem. Za wysokie daje przeregulowanie na starcie flipa i nerwowość przy zaszumionym linku. Niższe F to bardziej miękki, pływający lot.",
    profilePid:
      "Profil PID to pełny zestaw PID-ów i powiązanych ustawień zapisany w quadzie. Możesz mieć kilka (np. osobny tune pod baterię albo śmigła) i przełączać je switchem lub w OSD. Przełączenie tutaj zmienia profil, który oglądasz i edytujesz.",
    profileRate:
      "Profil rates to osobny zestaw rates, czyli prędkości obrotu quada. Użyj go do innego stylu latania albo dla kolegi, który lata na innych rates. Nie zmienia PID-ów ani filtrów.",
    ratesType:
      "Wzór zamieniający położenie drążka na prędkość obrotu. **Betaflight** to klasyk z RC rate, super rate i expo. **Actual** i **Quick** używają stopni na sekundę wprost (czułość środka i max rate), co łatwiej ogarnąć. Te same liczby czuć inaczej po zmianie typu, więc sprawdź krzywą.",
    rcRate:
      "**RC rate** ustawia, jak szybko quad obraca się przy środku drążka. Wyższe to nerwowsze małe korekty. Początkujący zwykle wolą niższe.",
    rateCenter:
      "**Czułość środka** to prędkość obrotu w stopniach na sekundę przy środku drążka. Niskie wartości łagodzą małe korekty, co pomaga przy filmowaniu i nauce. W 5-calowym freestyle to często 100 do 200 deg/s.",
    superRate:
      "**Super rate** dodaje prędkość pod koniec skoku drążka. Wyższe daje szybsze flipy na pełnym drążku, ale uczula cały zakres. Oceniaj po krzywej i wartościach max w legendzie, nie po samej liczbie.",
    maxRate:
      "**Max rate** to prędkość obrotu na pełnym drążku w stopniach na sekundę. 360 deg/s to jeden pełny flip na sekundę. Początkujący zaczynają zwykle od 400 do 600 deg/s, a freestylowcy lądują między 700 a 900.",
    expo:
      "**Expo** zmiękcza środek drążka i zostawia prędkość na pełnym wychyleniu. Wyższe expo daje dokładniejszą kontrolę przy środku i stromszą krzywą na końcach. Za dużo i quad jest martwy przy środku, a potem nagły na krańcu.",
    ratesCurve:
      "Prędkość obrotu (w górę) względem położenia drążka (w prawo) dla każdej osi. Płaski środek to spokojniejsze małe ruchy. Legenda pokazuje realną prędkość max każdej osi w stopniach na sekundę.",
    thrMid:
      "**Throttle mid** to położenie drążka, które daje połowę zakresu gazu. Ustaw je tak, żeby zawis wypadał blisko środka drążka. Zostaw 0,5, jeśli nie masz powodu zmieniać.",
    thrExpo:
      "**Throttle expo** zmiękcza reakcję gazu wokół punktu środkowego. Trochę ułatwia zawis i ostrożne ruchy na niskim gazie. Za dużo i górna część drążka prawie nic nie robi. 0 to liniowo.",
    tpa: "**TPA** (throttle PID attenuation) zmniejsza wzmocnienia na wysokim gazie, żeby zdusić oscylacje pojawiające się tylko na pełnej mocy. Rate mówi, jak mocno je zmniejsza. Jeśli quad trzęsie się na wysokim gazie, podnieś rate trochę. Domyślny tryb tnie tylko D.",
    tpaBreakpoint:
      "Wartość gazu w mikrosekundach, od której TPA zaczyna obniżać wzmocnienia. Podnieś, żeby TPA ruszało później. Obniż, jeśli oscylacje zaczynają się już na średnim gazie.",
    itermRelax:
      "**I-term relax** nie pozwala narastać I podczas szybkich ruchów drążka. Bez tego szybkie flipy kończą się odbiciem. Domyślne ustawienie jest dobre dla prawie wszystkich. Wyłączaj tylko, jeśli wiesz po co.",
    itermRelaxCutoff:
      "Im niższy ten cutoff, tym mocniej działa I-term relax. Wyższa wartość pozwala I bardziej narastać w trakcie ruchów. Domyślna jest OK dla 5-calowego freestyle.",
    antiGravity:
      "**Anti-gravity** na chwilę podbija I, gdy gwałtownie dodajesz gazu, żeby nos nie siadał przy szybkich zmianach gazu. Za niskie to opadanie nosa na punch-outach, za wysokie kołysanie po ścięciu gazu. Domyślna to dobry start.",
    dynDamping:
      "**Dynamic damping** określa, jak mocno D rośnie z wartości bazowej w stronę D max przy szybkich ruchach i propwashu. Gain to szybkość reakcji, advance pozwala ruszyć wcześniej na podstawie ruchu drążka. Zostaw domyślne, chyba że gonisz propwash.",
    throttleBoost:
      "**Throttle boost** dodaje trochę mocy, gdy gaz zmienia się szybko, żeby quad reagował żwawiej. Za wysoki robi nerwowe zmiany gazu. To szlif, nie lekarstwo.",
    vbatSag:
      "**Vbat sag compensation** podnosi moc silników, gdy bateria siada, żeby quad czuć tak samo na pełnym i na zmęczonym pakiecie. Działa tylko przy poprawnym odczycie napięcia baterii, więc sprawdź to najpierw. Wyższe to mocniejsza kompensacja.",
    thrustLin:
      "**Thrust linearization** wyrównuje zależność ciągu silników od gazu, bo ciąg rośnie szybciej na niskim gazie niż na wysokim. Pomaga utrzymać spójne PID-y w całym zakresie gazu. Za dużo i niski gaz robi się skokowy.",
    filtersIntro:
      "Filtry wycinają szum silników z sygnału żyroskopu, zanim użyją go PID-y. Za dużo filtrowania daje opóźnienie, więc quad jest pływający i wychodzi propwash. Za mało i szum przechodzi dalej, a silniki się grzeją i mogą buczeć. Ustawienia domyślne z filtrem RPM to dobry start.",
    gyroLpf1:
      "**Gyro low-pass 1** wygładza sygnał żyroskopu. Wyższy cutoff to mniej opóźnienia i więcej szumu, niższy odwrotnie. W trybie dynamicznym cutoff idzie z gazem między wartością min a max. Na czystym buildzie podnieś trochę, na zaszumionym obniż.",
    dynLpf:
      "W trybie dynamicznym cutoff podąża za gazem między min a max, niski gaz dostaje niską wartość. Wyższe wartości to mniej opóźnienia i więcej szumu. Zmieniaj małymi krokami i sprawdzaj temperaturę silników.",
    gyroLpf2:
      "**Gyro low-pass 2** to drugi filtr, który działa po pierwszym. Obniżanie go dodaje opóźnienie. Zostaw, chyba że silniki grzeją się mimo pozostałych filtrów.",
    dtermLpf:
      "**Filtry low-pass D-term** wygładzają tylko człon D, najbardziej wrażliwy na szum. Niższe cutoffy to chłodniejsze silniki i cichsze D, ale słabsze tłumienie szybkich ruchów (więcej propwashu). Gdy silniki są gorące, zajrzyj tu, zanim ruszysz P albo I.",
    dynNotch:
      "**Dynamic notch** znajduje najsilniejsze piki szumu w sygnale żyroskopu, zwykle ton silników, i je wycina. Count to liczba śledzonych pików (typowo 3). Wyższe Q to węższy notch, mniej opóźnienia i mniej wyciętego szumu. Zakres min i max ustaw tak, by obejmował szum Twoich silników.",
    rpmFilter:
      "**Filtr RPM** usuwa szum dokładnie na obrotach silnika i jego harmonicznych. Wymaga dwukierunkowego DShot i firmware ESC, które to wspiera (BLHeli_32, Bluejay, AM32). Gdy działa, możesz mniej filtrować gdzie indziej, czyli mniej opóźnienia. Zwykle 3 harmoniczne.",
    rpmMin:
      "Najniższa częstotliwość silnika, którą śledzi filtr RPM. Poniżej filtr jest wyłączony. Domyślne 100 Hz pasuje do większości 5-calowców.",
  },
  blackbox: {
    intro:
      "Blackbox zapisuje, co kontroler mierzy w locie: żyroskop, wyjścia silników, ruchy drążków. Z logów widać szum, propwash i problemy z tuningiem. Początkujący mogą na razie pominąć. Żeby logować, wybierz nośnik, polataj z włączonym logowaniem i pobierz log tutaj.",
    device:
      "Gdzie zapisywany jest log. **Pamięć flash** to kość na kontrolerze, mała (zwykle 2 do 16 MB). **Karta SD** mieści znacznie więcej. **Brak** wyłącza logowanie. Nie każda płytka ma flash albo slot SD, niedostępne opcje są wyszarzone.",
    rate: "Jak często zapisywana jest klatka logu, jako ułamek pętli PID. Wyższy rate to więcej szczegółów, ale pamięć zapełnia się szybciej. Lista pokazuje wynikowe kHz. Do większości tuningu wystarczy 1 do 2 kHz.",
    debug:
      "Tryb debug dodaje do logu dodatkowe wartości wewnętrzne do jednego celu. **Gyro scaled** to typowy wybór do analizy szumu, reszta jest głównie dla deweloperów. Nie ruszaj, dopóki poradnik nie wskaże konkretnego.",
    flash:
      "Ile pamięci pokładowej zajmują logi. Gdy jest pełna, logowanie się zatrzymuje, więc skasuj stare logi przed lotem, który chcesz nagrać.",
    download:
      "Czyta log z kontrolera przez USB i zapisuje jako plik .bbl. Duży log trwa chwilę. Plik otworzysz w Blackbox Explorer albo wyślesz do zakładki Autotune tutaj.",
    erase:
      "Kasuje **wszystkie** logi z pamięci flash. Nie da się tego cofnąć, więc najpierw pobierz, jeśli chcesz zachować log. Duże kości kasują się dłużej.",
    msc: "Restartuje kontroler jako pendrive USB, żeby skopiować logi z karty SD albo flasha na płytkach, które to wspierają. Betaflight w tym trybie nie działa. Odłącz i podłącz USB, żeby wrócić do normalnej pracy.",
  },
  autotune: {
    intro:
      "**Jak działa Autotune:** robisz jeden krótki lot testowy, a dron go nagrywa. Aplikacja czyta to nagranie, sprawdza, jak czysto dron podąża za drążkami, jak bardzo drga i jak radzi sobie ze ścięciem gazu, a potem wybiera jedną małą, bezpieczną zmianę. Klikasz Zastosuj, lecisz jeszcze raz i widzisz, czy jest lepiej. Jedno kliknięcie Cofnij przywraca stare ustawienia.",
    bDrone:
      "Aplikacja odczytuje z drona baterię, protokół silników i firmware. Rozmiaru ramy nie widzi, więc go wybierasz. Rozmiar mówi, gdzie spodziewać się drgań i jakie typowe części masz.",
    bBackup:
      "Kopia ustawień to plik ze wszystkimi ustawieniami drona. Autotune zmienia tylko kilka z nich, ale jeśli wynik Ci się nie spodoba, **Cofnij** jednym kliknięciem wgrywa kopię z powrotem. Plik trafia też na Twój komputer.",
    bPrepare:
      "Do analizy dron musi nagrać lot z odpowiednimi danymi: żyroskop, drążki i silniki, wystarczająco często. **Przygotuj logowanie** zmienia tylko te ustawienia nagrywania. PID-y i filtry zostają bez zmian.",
    bFly:
      "Lataj na otwartej przestrzeni, około minuty. Włącz odliczanie przy starcie i rób to, co mówi duża karta: zawis, szybkie szarpnięcia na każdej osi, kilka pompek gazem i spadków. Aplikacja nie steruje dronem, tylko odlicza czas.",
    bLoad:
      "Log z lotu to plik nagrany przez drona. Na karcie SD to najnowszy plik .BBL. Upuść go tutaj, a aplikacja przeanalizuje go na tym komputerze; nic nie jest nigdzie wysyłane.",
    bLights:
      "Zielone jest w porządku, żółte może być lepsze, czerwone wymaga poprawy, szare znaczy, że log nie miał danych. **Charakter lotu** to to, jak czysto dron zatrzymuje się po szybkich ruchach. **Drgania** to szum silników i ramy. **Bujanie po ścięciu gazu** to propwash.",
    bResult:
      "Aplikacja wybiera jedną zmianę ze wszystkiego, co znalazła. Zmiana jest mała, gdy lot dał mało danych, a przy słabym logu nie zmienia nic; wtedy mówi, co polecieć następnym razem.",
    bApply:
      "Wysyła zmianę do drona po oknie potwierdzenia. Przed zapisem aplikacja sama robi jeszcze jedną kopię. Dron się zrestartuje i połączy ponownie.",
    bUndo:
      "Przywraca kopię ustawień z kroku 2: wszystko wraca do stanu sprzed Autotune. Po zapisie dron się zrestartuje.",
    bCompare:
      "Gdy polecisz jeszcze raz z nowymi ustawieniami i wczytasz nowy log, aplikacja porówna oba loty: mniej odbicia, szybsza reakcja, mniej drgań i mniej propwasha liczą się jako lepiej.",
    parts:
      'Rozmiar ramy i śmigieł ustawia pasma częstotliwości dla analizy szumu i propwasha (skalowane od 5": propwash 20-90 Hz, rama 100-250 Hz) oraz podpowiedź dynamicznego biegu jałowego. Reszta to kontekst dla Ciebie i dla oceny AI.',
    backup:
      "**diff all** z FC, zapisany jako before-pid-<data>.txt i trzymany w aplikacji (5 ostatnich). Przywracanie wysyła diff oraz stare wartości każdego klucza zmienionego przez Autotune, więc wracają też klucze, które miały wartość domyślną.",
    prepare:
      "Czego silnik analizy potrzebuje w logu: setpoint, żyroskop, silniki i RC, debug **GYRO_SCALED** dla niefiltrowanego żyroskopu (zalecenia filtrów, opóźnienie filtrów) i logowanie co najmniej 1,6 kHz dla dokładnych czasów. Każda poprawka to linia CLI zapisywana zwykłą drogą: potwierdzenie, kopia, zapis.",
    flight:
      "Skrypt pokrywa to, co mierzy silnik: szarpnięcia różnej wielkości na każdej osi (odpowiedź wg wychylenia), pompki gazem (pasma gazu, TPA, spektrogram) i spadki (propwash). Celem jest 30-90 s prawdziwych manewrów.",
    drop:
      "Plik .bbl lub .bfl prosto z FC jest dekodowany natywnie, ze wszystkimi lotami. CSV z Blackbox Explorera też działa, ale bez nagłówka nie ma ustawień, suwaków ani filtrów do odczytu, więc możliwe są tylko surowe zmiany.",
    quality:
      "0-100 z okien skokowych na osiach, ruchów drążkami, częstotliwości logowania, pokrycia gazu, długości i nasycenia silników. Skaluje każdą propozycję: poniżej 50 zmiany PID są dużo mniejsze albo pomijane.",
    headerPid:
      "Log Blackbox zapisuje PID-y, z którymi dron latał. Jeśli po locie zmieniłeś PID-y, FC ma inne liczby niż log. Propozycje są liczone od PID-ów z logu, bo to one dały lot, który widzisz.",
    overview:
      "Te same cztery obszary co w trybie podstawowym, ale z liczbami. Pomaga zdecydować, od czego zacząć: filtry przed PID-ami, gdy szum jest czerwony; lepszy log przed czymkolwiek, gdy log jest czerwony.",
    needs:
      "Czego brakuje w logu i co przez to tracisz. Na przykład bez GYRO_SCALED nie ma niefiltrowanego żyroskopu, więc nie ma opóźnienia filtrów, a zalecenia notch / RPM są słabsze. Linia CLI ustawia to na następny lot.",
    apply:
      "Zaznacz zmiany, które chcesz; pasek na dole łączy je w jedną listę CLI (jedno simplified_tuning apply na końcu) i zapisuje zwykłą drogą: potwierdzenie, automatyczna kopia, zapis. Ważność mówi, jak bardzo to istotne, a procent, na ile log to potwierdza.",
    stepResponse:
      "Średnia odpowiedź na prawdziwe ruchy drążka znalezione w logu (1,0 = cel z drążka). Dobra krzywa szybko rośnie, przekracza 1,0 o 5-10 % i w ciągu ~100 ms mieści się w zacienionym paśmie ±5 %. Podział wg wychylenia pokazuje nieliniowość, podział wg gazu sprawdza TPA.",
    stepMetrics:
      '**Narastanie** 10-90 % (5" freestyle: 20-40 ms dobrze, ponad 80 ms wolno). **Opóźnienie do 50 %** za setpointem. **Przeregulowanie** idealnie 5-10 %. **Ustalanie** = ostatnia chwila poza ±2 / ±5 %. **Oscylacje** = przejścia przez ±3 % po szczycie (3 i więcej to drgania). **Odbicie** po zatrzymaniu wskazuje na I-term relax.',
    buckets:
      "Mediana metryk ruchów w każdym koszyku. Większe przeregulowanie na wysokim gazie niż na niskim znaczy więcej TPA. Bardzo różne małe i duże ruchy wskazują raczej na feedforward albo limity rate niż na P/D.",
    spectrum:
      "Szum uśredniony po gazie dla każdej częstotliwości. Piki **silnik** przesuwają się z gazem (to działka filtra RPM), piki **rama** stoją w miejscu (filtr notch, mechanika). Zielona przerywana linia to tło; piki 12 dB ponad nim to rezonanse.",
    spectrogram:
      "Częstotliwość w poziomie, gaz w pionie, jaśniej = głośniej. Szum silników rysuje ukośne grzbiety (biała przerywana linia), które rosną z gazem; rezonans ramy to pionowa linia (bursztynowa). Kreskowane wiersze nie miały danych przy tym gazie.",
    peaks:
      "Każdy pik z wysokością ponad tło. Ponad 6 dB to pik, ponad 12 dB rezonans, który warto usunąć. Grzbiety to te same piki śledzone przez kolejne przedziały gazu, z częstotliwością na niskim i wysokim gazie.",
    filters:
      "Czego potrzebuje zmierzony szum: harmoniczne i min Hz filtra RPM z grzbietów silników, liczba i zakres notch ze stałych pików, mnożniki filtrów z pozostałego szumu żyroskopu i D-term. Mniej filtrowania to mniejsze opóźnienie; celuj w najmniej filtrowania, przy którym silniki są chłodne.",
    filterDelay:
      'Opóźnienie między niefiltrowanym a filtrowanym żyroskopem (wymaga GYRO_SCALED). Poniżej 2 ms jest dobrze dla 5"; powyżej dron robi się „miękki”, a propwash rośnie.',
    propwash:
      "Energia błędu śledzenia roll/pitch w paśmie propwash przez 400 ms po każdym ścięciu gazu, podzielona przez tę samą energię w spokojnym locie. Poniżej 2× jest dobrze, 2-5× średnio, ponad 5× mocno. Potrzeba co najmniej 3 ścięć.",
    pids:
      "Obecne wartości z nagłówka logu obok propozycji. D min / D max zależy od schematu D w firmware. Zmiany są ograniczone do ±25 % na rundę i skalowane jakością oraz pewnością.",
    sliders:
      "Gdy dron używa uproszczonego strojenia (RP lub RPY), ta sama zmiana jest podana jako ruch suwaków w siatce 0,05 Konfiguratora. Wybieraj tę postać: Betaflight trzyma suwaki w zgodzie. Postać surowa wyłącza simplified_pids_mode.",
    hot:
      "Zaznacz, jeśli po locie testowym silniki były gorące. Wtedy silnik analizy nigdy nie podnosi D: obniża P i ostrzega o filtrach D-term.",
    form:
      "**Suwaki** zapisuje wartości simplified_* i uruchamia simplified_tuning apply. **Surowe CLI** zapisuje wartości p_/i_/d_/f_ i wyłącza suwaki PID. Zalecenia filtrów idą za tym samym wyborem.",
    session:
      "Plik .bbl może mieć kilka lotów (jeden na uzbrojenie). Domyślnie analizowany jest najdłuższy użyteczny; tu wybierzesz inny. Pozostałe dalej biorą udział w porównaniu serii.",
    series:
      "Porównywane są loty, które różnią się dokładnie jednym suwakiem (albo jednym wzmocnieniem): każdy dostaje ocenę z narastania, przeregulowania blisko 8 %, oscylacji i ustalania (feedforward: opóźnienie i korelacja śledzenia). Przy remisie wygrywa niższa wartość: chłodniejsze silniki, większy zapas.",
    procedure:
      "Zwykła kolejność pełnego strojenia: najpierw filtry, potem przemiatanie P&I z I i FF na 0, potem master, przywrócenie I, feedforward (acro) i dynamiczny bieg jałowy. Podświetlony krok to ten po serii, którą właśnie poleciałeś.",
    rounds:
      "Jeden wiersz na każdy wczytany log w tej sesji. Zielone komórki poprawiły się względem poprzedniej rundy, bursztynowe pogorszyły. Wykres pokazuje odpowiedź skokową roll z ostatnich rund.",
  },
  cli: {
    intro:
      "CLI to tekstowa konsola Betaflight. Wszystko, co ustawiają inne zakładki, plus ustawienia bez własnej zakładki, możesz zmienić tu komendami. Początkujący tego nie potrzebuje. Jeśli używasz, najpierw zrób backup (patrz tip przy diff all) i nie odpalaj komend, których nie rozumiesz.",
    warn:
      "Komendy CLI mogą zmienić albo skasować cały setup. **defaults** czyści każde ustawienie, **save** zapisuje zmiany i restartuje quada, a niektóre komendy (**resource**, **flash_erase**) mogą zostawić quada bezużytecznym. Jeśli komendy nie napisałeś sam, sprawdź najpierw, co robi.",
    backup:
      "**diff all** wypisuje każde ustawienie różne od domyślnego, dla wszystkich profili. Zapisz go do pliku przed zmianami i po udanym tunie. Żeby przywrócić, wklej plik z powrotem i wykonaj **save**.",
    dump: "Czyta **dump all**, pełną listę wszystkich ustawień. Jest długa i w większości domyślna. Użyj do pełnego zapisu albo gdy ktoś o to prosi. Na backup lepsze jest **diff all**.",
    save: "Dodaje **save** po Twoich komendach: kontroler zapisuje ustawienia i restartuje się. Wcześniej pobierany jest backup **diff all**. Bez tego sesja kończy się komendą **exit** i nic się nie zapisuje.",
    names:
      "Czyta z kontrolera listę nazw ustawień, żeby Tab działał jako uzupełnianie przy wpisywaniu komend.",
  },
};
