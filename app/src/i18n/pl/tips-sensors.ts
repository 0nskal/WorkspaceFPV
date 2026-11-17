import type { enTipsSensors } from '../en/tips-sensors';

export const plTipsSensors: typeof enTipsSensors = {
  sensors: {
    intro: 'Tu włączasz i wyłączasz czujniki, mówisz FC, jak jest zamontowana płytka, i kalibrujesz akcelerometr. Model i liczby po prawej pokazują, co FC widzi teraz: przechyl drona ręką, a muszą za nim iść. Zmiany zapisujesz przyciskiem Zapisz.',
    hardware: 'Każdy przełącznik włącza jeden układ czujnika. Betaflight wyłącza czujnik, ustawiając jego sprzęt na NONE. Żyroskopu nie da się wyłączyć. Zmiana przełącznika wymaga restartu, który zrobi za ciebie Zapisz.',
    acc: 'Akcelerometr mówi FC, gdzie jest "dół". Potrzebują go Angle, Horizon, GPS Rescue i horyzont w OSD. W acro latasz bez niego, ale uzbrajanie może narzekać, gdy go brakuje.',
    mag: 'Kompas daje kierunek bez ruchu GPS. Potrzebny tylko do GPS Rescue w niektórych konfiguracjach. Źle umieszczony kompas jest gorszy niż żaden, więc wyłącz go, jeśli nie siedzi na maszcie z dala od przewodów zasilania.',
    baro: 'Mierzy wysokość z ciśnienia powietrza. Używa go GPS Rescue i odczyt wysokości. Wiele płytek ma go na pokładzie; kawałek pianki na nim chroni przed podmuchem ze śmigieł.',
    orientation: 'Jak płytka FC jest obrócona względem ramy, w stopniach. Wszędzie 0, gdy strzałka na płytce wskazuje przód i płytka leży płasko. Yaw 90, 180 lub 270, gdy płytka jest tak obrócona. Zła wartość przewraca drona przy starcie, więc sprawdź model po prawej.',
    autoAlign: 'Mierzy przechył płytki z grawitacji, gdy dron leży poziomo, i wpisuje Roll oraz Pitch. Nie wykrywa Yaw. Nadal musisz kliknąć Zapisz, a potem sprawdzić, czy model stoi poziomo.',
    calibrate: 'Uczy FC, co to jest "poziom". Połóż drona na płaskiej powierzchni i nie ruszaj go przez 3 sekundy. Rób to po zmianie ułożenia płytki albo gdy tryb Angle ucieka w bok.',
    trim: 'Mała korekta poziomu dla Angle, Horizon i GPS Rescue, w dziesiątych częściach stopnia. Zostaw 0, chyba że dron po kalibracji ciągle ucieka w jedną stronę w trybie Angle.',
    attitude: 'Położenie drona na żywo z FC. Roll to przechył w lewo i prawo, pitch to nos w górę lub w dół, yaw to kierunek. "Resetuj oś Z" zeruje tylko yaw widoczny tutaj, w FC nic nie zmienia.',
    live: 'Surowe odczyty czujników jako wykresy: żyroskop w stopniach na sekundę, akcelerometr w g (około 1 g na osi pionowej w spoczynku), magnetometr surowo, wysokość z barometru. Przydatne do szukania szumów, martwej osi albo czujnika, który nie odpowiada. Szybsze odświeżanie bardziej obciąża łącze.',
  },
  gps: {
    intro: 'Tu ustawiasz moduł GPS i patrzysz, jak łapie satelity. Dobry fix wymaga otwartego nieba: wyjdź z dronem na zewnątrz i poczekaj, aż liczba satelit wyniesie 8 lub więcej, a fix pokaże OK. Moduł potrzebuje UART-a z funkcją GPS w zakładce Porty.',
    enable: 'Włącza funkcję GPS w firmware. Wymaga modułu GPS na UART-cie z włączoną funkcją GPS (zakładka Porty). Potrzebna do GPS Rescue oraz do danych GPS w OSD, telemetrii i blackboxie. Wymaga restartu.',
    protocol: 'Jak moduł rozmawia z FC. UBLOX pasuje do niemal każdego modułu sprzedawanego do FPV (M8, M10, M9). NMEA to ogólny protokół tekstowy, MSP dla GPS podłączonego przez inne urządzenie MSP, VIRTUAL do symulacji.',
    autoConfig: 'Pozwala FC samemu skonfigurować moduł u-blox przy starcie: częstotliwość odświeżania, włączone systemy satelitarne, SBAS. Zostaw włączone, chyba że skonfigurowałeś moduł w u-center.',
    galileo: 'Używaj też europejskich satelit Galileo. Więcej satelit w zasięgu to szybszy i stabilniejszy fix. Działa na modułach M8 i nowszych; bardzo stare moduły to ignorują.',
    homeOnce: 'Włączone: punkt domowy ustawia się przy pierwszym fixie po włączeniu zasilania i już się nie zmienia. Wyłączone: zeruje się przy każdym uzbrojeniu. Dla GPS Rescue bezpieczniejsze jest "jednorazowo", o ile uzbrajasz dopiero po pierwszym fixie.',
    sbas: 'Naziemny sygnał korekcyjny dla dokładniejszej pozycji. Wybierz system dla swojego regionu: EGNOS w Europie, WAAS w Ameryce Północnej, MSAS w Japonii, GAGAN w Indiach. W większości przypadków wystarczy wykrywanie automatyczne.',
    signal: 'Każda satelita, którą widzi moduł. Plakietka ID jest zielona, gdy satelita jest używana do pozycji, czerwona, gdy nie. Pasek to siła sygnału (C/N0). Dużo w pełni zablokowanych satelit z mocnymi paskami oznacza dobry fix.',
    general: 'Pozycja, z którą FC pracuje w tej chwili. Kierunek pokazuje IMU (żyroskop) i kurs GPS; zgadzają się tylko, gdy dron się porusza. Prędkość jest w cm/s.',
    dop: 'Rozmycie dokładności: jak równomiernie satelity są rozłożone na niebie. Poniżej 1 to świetnie, 1 do 2 dobrze, powyżej 5 słabo. Im mniej, tym lepiej.',
    declination: 'Różnica między północą rzeczywistą a magnetyczną w twoim miejscu, w stopniach. FC używa jej, by zamienić kierunek z kompasu na kierunek rzeczywisty.',
    location: 'Prosty radar: punkt domowy pośrodku, dron jako strzałka, północ u góry. Żadna mapa nie jest pobierana, więc działa offline. Link otwiera pozycję w OpenStreetMap w przeglądarce.',
  },
};
