import type { enTipsRx } from '../en/tips-rx';

export const plTipsRx: typeof enTipsRx = {
  receiver: {
    intro:
      'Ta zakładka mówi kontrolerowi lotu, jak czytać odbiornik. Przy ExpressLRS wystarczy protokół (CRSF) i kolejność kanałów (AETR). Rusz każdym drążkiem i patrz na paski na żywo: ma się ruszyć właściwy pasek, od 1000 do 2000. Potem zapisz.',
    provider:
      'Jak odbiornik rozmawia z kontrolerem. ExpressLRS i Crossfire używają **CRSF**, wiele odbiorników FrSky i DJI używa **SBUS**. Zły protokół to brak jakichkolwiek kanałów. Odbiornik potrzebuje też UART-a z włączonym Serial RX w zakładce Porty. Zmiana wymaga restartu.',
    map: 'Kolejność pierwszych czterech kanałów. **AETR** (lotki, wysokość, gaz, kierunek) to domyślne ustawienie Betaflight i to, co wysyła ExpressLRS. TAER to kolejność Spektrum. Jeśli pasek gazu rusza się po wychyleniu pitch, mapa jest zła. Z ELRS zostaw AETR.',
    rssiChannel:
      'Kanał, którym siła sygnału trafia na OSD. Przy CRSF/ELRS jakość łącza przychodzi sama, więc zostaw Wyłączone. Używaj tylko z odbiornikami typu SBUS, które dają RSSI na wolnym kanale AUX.',
    sticks:
      'Drążek w środku daje 1500, pełne wychylenie to około 1000 i 2000. Te progi mówią Betaflight, kiedy drążek jest "na dole", "w środku" albo "na górze" (uzbrajanie i komendy drążkami). Domyślne 1050 / 1500 / 1900 pasują prawie każdemu.',
    minCheck:
      'Poniżej tej wartości drążek liczy się jako wciśnięty do końca w dół. Domyślnie 1050. Jeśli gaz na minimum pokazuje więcej, nie uzbroisz. Najpierw popraw endpointy w aparaturze.',
    midRc:
      'Środek drążków, domyślnie 1500. Jeśli drążek nie wraca na 1500, popraw subtrim w aparaturze. Zmiana tutaj przesuwa wszystkie drążki.',
    maxCheck:
      'Powyżej tej wartości drążek liczy się jako wychylony do końca w górę. Domyślnie 1900. Potrzebne do komend drążkami, np. kalibracji. Jeśli pełne wychylenie daje mniej niż 1900, zwiększ endpointy w aparaturze, nie tutaj.',
    deadband:
      'Obszar wokół środka drążka (roll i pitch), w którym drobne ruchy są ignorowane. Domyślnie 0, dobre dla porządnych gimbali. Kilka µs uspokoi zużyty gimbal, ale środek robi się "drewniany". Nie maskuj tym złej kalibracji.',
    yawDeadband:
      'To samo co deadband, ale dla yaw. Domyślnie 0. Ruszaj tylko wtedy, gdy yaw drga przy drążku w środku.',
    smoothMode:
      'RC smoothing łagodzi schodki w sygnale drążków, żeby silniki nie goniły każdego pakietu. Włączone to domyślne i właściwe ustawienie. Wyłączone puszcza surowe schodki do PID-ów: quad jest nerwowy, silniki cieplejsze.',
    smoothSetpointCutoff:
      'Częstotliwość graniczna (Hz) filtra na sygnale z drążków. **0 = automatycznie**, na podstawie tempa łącza. Dla ELRS tak jest dobrze. Wartość ręczną ustawiaj tylko świadomie: niższa to miększe drążki, ale większe opóźnienie.',
    smoothThrottleCutoff: 'To samo wygładzanie dla kanału gazu. 0 = automatycznie. Zostaw.',
    smoothFeedforwardCutoff: 'Częstotliwość graniczna (Hz) wygładzania feedforward. 0 = automatycznie, w większości zestawów to właściwy wybór.',
    smoothAutoFactor:
      'Siła automatycznego wygładzania przy cutoff 0. Domyślnie 30. Wyżej jest gładziej i trochę wolniej, niżej ostrzej. Zmieniaj małymi krokami i porównuj w locie.',
    smoothAutoFactorThrottle: 'Siła automatycznego wygładzania gazu. Domyślnie 30. Zostaw, chyba że gaz reaguje z opóźnieniem.',
    live: 'Wartości z odbiornika na żywo, 1000 do 2000 µs. Rusz każdym drążkiem: właściwy pasek idzie 1000 (dół), 1500 (środek), 2000 (góra). Rusza się nie ten pasek: zła mapa kanałów. Nie dochodzi do 1000 lub 2000: popraw endpointy w aparaturze. CH5 i wyżej to przełączniki AUX do zakładki Tryby.',
    link: 'LQ to odsetek pakietów, które docierają, RSSI to siła sygnału w dBm. ELRS wysyła oba na kanałach 15 i 16, pokazują się tylko przy CRSF. LQ blisko 100% przy aparaturze to norma. W locie pilnuj, żeby nie spadło poniżej ok. 70%.',
    failsafe:
      'Failsafe testuj bez śmigieł: zasil quada i wyłącz aparaturę. Paski powinny zamarznąć albo spaść, a Betaflight zgłosić failsafe. Co quad wtedy robi (spadek albo GPS rescue), ustawiasz w zakładce Failsafe. W ELRS failsafe odbiornika zostaw na No Pulses, żeby decydował Betaflight.',
  },
  modes: {
    intro:
      'Tryby przypisują funkcję lotu do przełącznika. Tryb działa, gdy jego kanał AUX jest w ustawionym zakresie. Na początek ustaw ARM na przełączniku, którego nie ruszysz przez przypadek, potem ANGLE, jeśli chcesz samopoziomowanie. Przestaw przełącznik i zobacz, czy znacznik wchodzi w zakres.',
    ranges:
      'Tryb jest aktywny, gdy kanał AUX leży w zakresie. Impulsy: 1000 dół, 1500 środek, 2000 góra. Przełącznik 2-pozycyjny daje ok. 1000 i 2000, 3-pozycyjny jeszcze 1500. Biały znacznik pokazuje, gdzie przełącznik jest teraz. AUX1 to kanał 5. Jeden tryb może mieć kilka zakresów.',
    logic:
      'Ma znaczenie tylko, gdy tryb ma kilka zakresów. OR: tryb działa, gdy pasuje którykolwiek zakres. AND: działa tylko, gdy ten zakres i połączony tryb są włączone. Zostaw OR, chyba że budujesz coś specjalnego.',
    arm: 'Tryb, który uruchamia silniki. Bez zakresu tutaj nie uzbroisz. Użyj przełącznika 2-pozycyjnego, włączonego na górnym końcu (1700 do 2100), z dala od innych przełączników. W ELRS AUX1 jest najszybszym kanałem, więc ARM jest tam na miejscu. Testuj bez śmigieł.',
    angle:
      'Samopoziomowanie: quad trzyma limit przechyłu i sam się poziomuje, gdy puścisz drążki. Dobre na pierwsze loty i do wyjścia z kłopotów. Wymaga skalibrowanego akcelerometru. Zwykle jedna pozycja przełącznika 3-pozycyjnego.',
    horizon:
      'Poziomuje quada przy środku drążka, ale pozwala robić flipy przy pełnym wychyleniu. Coś pomiędzy ANGLE a acro. Większość freestylowców go pomija. Wymaga skalibrowanego akcelerometru.',
    airmode:
      'Zachowuje pełną kontrolę nad quadem przy zerowym gazie, więc flipy i nurkowania nie robią się "miękkie". Prawie każdy quad freestyle ma go włączonego cały czas po uzbrojeniu. Przypisz do tego samego zakresu co ARM albo do własnego, stale włączonego przełącznika.',
    beeper:
      'Włącza buzzer, żeby znaleźć quada po crashu w trawie. Daj na przełącznik albo wolną pozycję. Quad piszczy też sam po failsafe, jeśli ma podłączony buzzer.',
    turtle:
      '"Flip over after crash": gdy quad leży do góry kołami, włącz to przy rozbrojonym, uzbrój i wychyl roll albo pitch. Silniki kręcą się w drugą stronę i przewracają go na nogi. Wymaga DShot. Przed lotem wyłącz.',
    prearm:
      'Dodatkowe zabezpieczenie. Gdy PREARM jest ustawiony, ARM działa dopiero po wcześniejszym włączeniu PREARM. Przydatne, jeśli zdarza ci się uzbroić przez przypadek. Pomiń, jeśli wystarcza ci jeden przełącznik ARM.',
    failsafe:
      'To przełącznik, który celowo wywołuje failsafe, taki kill switch do testów. To nie jest konfiguracja failsafe. Zostaw pusty, jeśli nie wiesz po co ci to.',
  },
  osd: {
    intro:
      'OSD to tekst i liczby na obrazie z kamery: bateria, timer, jakość łącza. Zaznacz, co chcesz widzieć, i przeciągnij elementy na podglądzie. Najpierw ustaw system wideo (PAL, NTSC albo HD), potem zapisz. Wystarczy mało: napięcie, timer, jakość łącza i ostrzeżenia.',
    elements:
      'Każdy element to jedna pozycja na ekranie. Zaznacz, żeby pokazać, przeciągnij na podglądzie, żeby ustawić. Podgląd jest tylko orientacyjny, prawdziwą czcionkę dają gogle lub system wideo. Za dużo elementów zasłania obraz, 6 do 8 w zupełności wystarczy.',
    profile:
      'Trzy profile OSD to trzy osobne układy, np. jeden do gogli, drugi do filmowania. Kropka oznacza profil aktywny teraz. Aktywny można przełączać przełącznikiem w Betaflight.',
    video:
      'Dopasuj do swojego systemu wideo. **PAL** i **NTSC** to analog (30 × 16 lub 30 × 13 znaków). **HD** to systemy cyfrowe, które rysują OSD przez MSP DisplayPort: DJI O3/O4, Walksnail, HDZero. Auto czyta kamerę. Zły wybór wyrzuca elementy poza ekran.',
    units:
      'Metryczne pokazuje m, km/h, °C. Imperialne: stopy, mph, °F. Zmienia tylko sposób wyświetlania, nie pomiar.',
    rssiAlarm:
      'Poniżej tej siły sygnału (procent) OSD miga ostrzeżeniem. Przy ELRS przydatniejszy jest alarm jakości łącza niżej, więc ten może zostać na domyślnych 20.',
    lqAlarm: 'Jakość łącza (procent), poniżej której OSD miga ostrzeżeniem. Dla ELRS na początek 70. Za nisko i dowiesz się o problemie tuż przed failsafe.',
    capAlarm: 'Zużyta pojemność (mAh), po której OSD ostrzega. Ustaw na ok. 75% tego, co daje pakiet, np. 1100 dla 1500 mAh 6S. Wymaga czujnika prądu.',
    altAlarm: 'Wysokość (metry), powyżej której OSD ostrzega. 0 wyłącza. Przydaje się głównie przy lataniu z limitem wysokości.',
    warnings:
      'Ostrzeżenia migają na środku obrazu, gdy coś jest nie tak. Zostaw te ważne: blokada uzbrajania, niski akumulator, failsafe, RC smoothing. Wyłącz te, które irytują bez powodu.',
    warnArming: 'Pokazuje, dlaczego nie da się uzbroić, np. "RXLOSS" albo "THROTTLE". Bardzo przydatne w terenie, zostaw włączone.',
    warnBattery: 'Miga, gdy napięcie pakietu dojdzie do poziomu ostrzegawczego lub krytycznego z zakładki Zasilanie.',
    warnBeeper: 'Pokazuje migający znacznik na ekranie, gdy włączony jest przełącznik beepera, więc widzisz w goglach, że działa.',
    warnCrashFlip: 'Pokazuje się, gdy włączone jest flip over after crash (turtle), żebyś nie wystartował z aktywnym.',
    warnEsc: 'Ostrzega, gdy ESC zgłasza awarię lub nie odpowiada. Wymaga telemetrii ESC.',
    warnCoreTemp: 'Ostrzega, gdy układ kontrolera lotu się nagrzewa. Na quadzie 5" rzadko się zdarza.',
    warnSmoothing: 'Ostrzega, gdy RC smoothing nie ustaliło się względem tempa łącza. Jeśli się pojawia, sprawdź łącze z odbiornikiem.',
    warnFailsafe: 'Pokazuje się, gdy aktywny jest failsafe. Jeśli widzisz to w locie, łącza już nie ma.',
    warnLink: 'Ostrzega, gdy jakość łącza lub siła sygnału spadnie poniżej alarmu ustawionego w zakładce Ogólne.',
    stats:
      'Statystyki pokazują się po rozbrojeniu: czas lotu, minimalne napięcie, maksymalny prąd, najniższa jakość łącza itd. Dobre, żeby zobaczyć, jak poradził sobie pakiet. Timery 1 i 2 liczą czas uzbrojenia lub włączenia. Nic z tego nie wpływa na lot.',
    itemBattery: 'Napięcie pakietu. Czytelniejsze jest średnie napięcie na celę (obok): 3,7 V to prawie pusty LiPo, 4,2 V pełny.',
    itemMah: 'Dotychczas zużyta pojemność. Wymaga czujnika prądu albo estymacji z ESC lub ustawień baterii.',
    itemTimer: 'Timer: czas od uzbrojenia, czas włączenia albo czas lotu. Przyda się, żeby wylądować przed końcem pakietu.',
    itemRssi: 'Siła sygnału. Z ELRS lepiej patrzeć na jakość łącza, która mówi, ile pakietów dochodzi.',
    itemLink: 'Jakość łącza w procentach. Z ExpressLRS to liczba do pilnowania: ląduj, gdy spadnie poniżej ok. 70.',
    itemCrosshair: 'Stały krzyżyk na środku obrazu. Pomaga ocenić, gdzie patrzy kamera.',
    itemWarnings: 'Miejsce, w którym pojawiają się ostrzeżenia. Trzymaj na środku ekranu, wtedy ich nie przegapisz.',
    itemMode: 'Pokazuje aktywny tryb lotu (ACRO, ANGLE, HOR). Przydatne, gdy zmieniasz tryby w locie.',
  },
  elrs: {
    intro:
      'Ta zakładka pomaga sprawdzić, czy łącze ExpressLRS jest dobrze ustawione. Odczytaj wersję odbiornika, sprawdź, czy pasuje do modułu nadajnika, potwierdź binding phrase i region oraz zweryfikuj, że sygnał dochodzi. Samo wgrywanie firmware robisz w web flasherze ELRS.',
    protocol:
      'Protokół między odbiornikiem a kontrolerem lotu. ELRS używa **CRSF** po UART. Jeśli widać coś innego, odbiornik może być ustawiony na SBUS albo port jest zły. Popraw w zakładkach Odbiornik i Porty.',
    rxVersion: 'Wersja firmware ExpressLRS działającego na odbiorniku, odczytana z samego odbiornika. Potrzebne jest do tego działające łącze CRSF lub passthrough z Betaflight.',
    txVersion:
      'Wersja ELRS modułu TX w twojej aparaturze, znajdziesz ją w skrypcie Lua ELRS na aparaturze (albo na ekranie modułu). Wpisz ją tutaj, żeby aplikacja mogła porównać.',
    versionMatch:
      '**Wersja główna** modułu TX i odbiornika musi się zgadzać: 3.x z 3.x. Różne wersje główne nie zbindują się i nie połączą. Najlepiej ta sama pełna wersja, np. 3.5.3 po obu stronach. Starszy element zaktualizuj w web flasherze.',
    rssi: 'Siła sygnału z telemetrii, na żywo. Blisko aparatury powinna być wysoka. Mówi tylko, że łącze działa. Zasięg oceniaj po jakości łącza (LQ) w zakładce Odbiornik.',
    region:
      'Firmware ELRS 2,4 GHz jest w wersji **FCC** albo **LBT** (europejska, "listen before talk"). Wybierz tę dla swojego kraju i użyj jej w module i w odbiorniku. W UE bierz LBT.',
    phrase:
      'Binding phrase sprawia, że nadajnik i odbiornik się znajdują. Oba muszą mieć tę samą frazę, ustawioną przy wgrywaniu (web flasher) albo w konfiguracji. Inna fraza to brak łącza. Wymyśl własną, nie przykładową.',
    method:
      '**Passthrough** aktualizuje odbiornik przez kontroler lotu i jego UART, wymaga działającego połączenia CRSF. **WiFi** działa, gdy odbiornik po około minucie bez sygnału tworzy własną sieć; firmware wgrywasz wtedy z przeglądarki.',
    verify: 'Po wgraniu i bindingu: zasil odbiornik, włącz aparaturę i zobacz, czy dioda łącza świeci stałym światłem, a liczby w zakładce Odbiornik się ruszają. Zaznacz dopiero, gdy to prawda.',
    settings:
      'Ustawiane w skrypcie Lua ELRS na aparaturze, nie tutaj. **Packet rate**: 250 do 500 Hz pasuje do freestyle 5", niższe sięgają dalej. **Telemetry ratio**: jak często wraca telemetria, Std lub 1:128 wystarczy. **Switch mode**: Hybrid jest domyślny, ARM ustaw na AUX1. **Model match**: aparatura gada tylko z odbiornikiem o swoim ID modelu. **Moc TX**: zacznij od 100 mW, zwiększaj tylko na dalekie loty.',
  },
};
