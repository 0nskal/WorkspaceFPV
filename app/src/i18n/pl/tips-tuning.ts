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
  pidWizard: {
    intro:
      "Kreator prowadzi przez jedną rundę strojenia: lista części, kopia ustawień, przygotowanie logowania, krótki lot według skryptu, wczytanie logu i nowe PID-y. Latasz Ty, aplikacja nigdy nie steruje dronem. Zapisz wynik, przeleć ten sam skrypt jeszcze raz i porównaj rundy.",
    quality:
      "Na ile log nadaje się do strojenia, od 0 do 100. Liczą się ostre ruchy drążkiem na każdej osi, zakres gazu, częstotliwość logowania, długość i to, jak często silniki dochodzą do 100 procent. Poniżej 50 propozycja jest zgrubna: poleć jeszcze raz z ruchami wypisanymi niżej.",
    headerPid:
      "Log Blackbox zapisuje PID-y, z którymi dron leciał. Jeśli po locie zmieniłeś PID-y, FC ma inne liczby niż log. Propozycja jest liczona od PID-ów z logu, bo to one dały lot, który widzisz.",
  },
  autotune: {
    intro:
      "Autotune czyta log Blackbox, sprawdza, jak quad szedł za ruchami drążków, i proponuje małe zmiany PID. Nie stroi w locie. Latasz, pobierasz log, wrzucasz go tutaj i sam decydujesz, czy zastosować propozycję. Najlepiej działa z logiem z kilkoma ostrymi ruchami drążków, jak rolki i flipy.",
    drop: "Użyj logu Blackbox jako .csv, .bbl lub .bfl. Musi zawierać dane gyro i setpoint (drążki) oraz realne ruchy drążkami. Log samego zawisu to za mało do analizy.",
    stepResponse:
      "Odpowiedź skokowa pokazuje, jak szybko i czysto quad idzie za nagłym ruchem drążka. Dobra krzywa szybko rośnie i ustala się na 100 procent. Krzywa mocno powyżej 100 procent to przeregulowanie, więc D jest chyba za niskie. Wolna krzywa oznacza niskie P albo F.",
    overshoot:
      "**Przeregulowanie** to o ile quad przeskakuje cel po nagłym ruchu, w procentach. Poniżej ok. 10 procent jest OK dla freestyle. Więcej wskazuje na większe D albo mniejsze P.",
    riseSettle:
      "**Rise** to czas dojścia do celu, **settle** to czas, aż odpowiedź zostanie blisko niego. Krótszy rise to ostrzejszy quad. Bardzo długi albo brakujący settle oznacza, że quad kołysze się po ruchu.",
    spectrum:
      "Jak silny jest szum żyroskopu na każdej częstotliwości. Ostre piki to zwykle szum silników albo drgania ramy. Szum na pikach grzeje silniki i ogranicza, ile D możesz użyć.",
    motorPeak:
      "Najsilniejszy pik szumu, który wygląda na pochodzący z silników. Duży pik to problem z szumem silników: sprawdź śmigła, łożyska, luźne śruby i filtry. Przy działającym filtrze RPM ten pik powinien być mały.",
    bidir:
      "Czy włączony jest dwukierunkowy DShot, którego potrzebuje filtr RPM. Gdy jest włączony, tuner dopuszcza większy wzrost D, bo szum silników jest filtrowany dokładniej.",
    table:
      "Aktualne PID-y obok wartości zaproponowanych z logu. Zmiany są celowo małe, więc zastosuj, polataj i w razie potrzeby powtórz. FF jest pokazane tylko strzałką, bo tuner mówi, żeby podnieść, ale nie o ile.",
    apply:
      "Zapisuje zaproponowane wartości do kontrolera jako komendy CLI po Twoim potwierdzeniu w oknie, a quad się restartuje. Sprawdź, czy zmiany pasują do tego, jak latasz, i zrób potem krótki lot testowy.",
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
