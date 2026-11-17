import type { enTipsMotors } from '../en/tips-motors';

export const plTipsMotors: typeof enTipsMotors = {
  motors: {
    intro:
      'Tu ustawiasz, jak kontroler lotu rozmawia z ESC i silnikami: protokół, bidirectional DShot, kierunek obrotów i liczbę biegunów. Możesz też na chwilę uruchomić każdy silnik, żeby sprawdzić numerację i kierunek, oraz zobaczyć, co meldują ESC. Przed ruszeniem suwakami testu zdejmij śmigła.',
    protocol:
      'Cyfrowy język między kontrolerem a ESC. W 5-calowym quadzie wybierz **DSHOT300** albo **DSHOT600**; oba pasują do pętli PID 8 kHz, 600 ma po prostu większy zapas. PWM, Oneshot i Multishot to stare protokoły analogowe, mają sens tylko na bardzo starych ESC. Jeśli ESC nie rozumieją protokołu, silniki nie zareagują. Wymaga restartu.',
    bidir:
      'Bidirectional DShot pozwala ESC odsyłać obroty silnika tym samym przewodem sygnałowym. Betaflight używa tego do filtra RPM, który bardzo czysto usuwa szum od silników. Potrzebuje firmware ESC, który to obsługuje: Bluejay, AM32 lub BLHeli_32. Fabryczny BLHeli_S nie. Włącz w każdej nowoczesnej piątce; na nieobsługiwanych ESC silniki mogą szarpać albo nie kręcić. Wymaga restartu.',
    idle: 'Gaz, który silniki trzymają przy drążku na dole po uzbrojeniu, w procentach pełnego zakresu. Za mało i silniki mogą gasnąć lub tracić synchronizację przy ostrych manewrach; za dużo i quad „pływa”. Domyślne (ok. 5,5 %) to dobry start. Przy bidirectional DShot Betaflight może zamiast tego użyć dynamic idle (na podstawie RPM), ustawianego w CLI.',
    poles:
      'Liczba magnesów na dzwonie silnika, nie ramion stojana. Policz je albo sprawdź w opisie silnika. Silnik do 5 cali ma zwykle **14**, niektóre malutkie 12. Betaflight przelicza z tym obroty elektryczne na prawdziwe RPM, więc zła wartość ustawia notche filtra RPM w złym miejscu.',
    direction:
      'W którą stronę kręcą się śmigła. **Props in** to domyślne ustawienie Betaflight: patrząc z góry, przednie śmigła kręcą się do siebie z przodu, a tylne do siebie z tyłu. **Props out** jest odwrotnie. Ten przełącznik zmienia tylko mixer. Silniki naprawdę muszą się tak kręcić, więc kierunek ustaw najpierw w ESC. Jeśli quad przewraca się przy starcie, kierunek albo numeracja są złe.',
    numbering:
      'Numeracja quad X w Betaflight: M1 tył prawy, M2 przód prawy, M3 tył lewy, M4 przód lewy. Przewody silników muszą się z tym zgadzać, inaczej quad nie utrzyma poziomu. Test silników niżej pokaże, które śmigło rusza po suwaku M1–M4.',
    telemetry:
      'Dane na żywo odsyłane przez ESC: RPM, temperatura, napięcie, prąd i procent utraconych ramek. RPM pojawia się tylko przy bidirectional DShot albo z czujnikiem ESC. Wartości widać, gdy kontroler dostaje poprawne odpowiedzi z ESC.',
    rpm: 'Prędkość silnika w obrotach na minutę, mierzona przez ESC. Wszystkie cztery silniki powinny mieć zbliżone wartości przy tym samym gazie. Jeden wyraźnie niższy albo skaczący wskazuje na zły silnik, łożysko, śmigło lub połączenie.',
    lost: 'Procent odpowiedzi telemetrii DShot, które nie dotarły albo mają zły checksum. Kilka procent to norma. **Err 100 %** znaczy, że kontroler w ogóle nie dostaje poprawnej telemetrii z tego ESC, i stąd flaga uzbrajania DSHOT_TELEM. Sprawdź, czy bidirectional DShot jest włączony, czy firmware ESC go obsługuje i czy przewód sygnałowy jest w porządku.',
    temp: 'Temperatura ESC podawana przez sam ESC. Do ok. 60 stopni na stole jest dobrze; powyżej 80–90 pod obciążeniem to za gorąco. Gdy rośnie, sprawdź śmigła, silnik i filtrowanie.',
    testHead:
      'Kręci po jednym silniku, żebyś sprawdził okablowanie, numerację i kierunek obrotów. Śmigła **muszą być zdjęte**, bo silniki mogą nagle się rozpędzić. Suwaki są zablokowane, dopóki nie potwierdzisz, że śmigieł nie ma. STOP lub spacja zatrzymuje w każdej chwili; test kończy się też po rozłączeniu albo wyjściu z karty.',
    propsOff:
      'To blokada bezpieczeństwa: suwaki odblokowują się dopiero po potwierdzeniu, że na silnikach nie ma śmigieł. Nie zaznaczaj, jeśli to nieprawda.',
    unlock:
      'Normalnie suwaki kończą się na 30 % gazu, co w zupełności wystarcza, żeby zobaczyć kierunek obrotów. Zdjęcie limitu pozwala na 100 %. Rób to tylko bez śmigieł i z quadem przytrzymanym albo leżącym na stole.',
    escInfo: {
      head: 'Odczytuje ustawienia zapisane w każdym ESC przez przewód sygnałowy. Tutaj tylko do odczytu. Silniki nie kręcą się podczas odczytu, ale i tak zdejmij śmigła. Wynik mówi, jaki masz firmware ESC i czy obsłuży bidirectional DShot.',
      firmware:
        'Oprogramowanie ESC. **Bluejay** i **AM32** są otwarte, obsługują bidirectional DShot i dziś są zwykłym wyborem. Fabryczny **BLHeli_S** tego nie obsługuje, ale na większość ESC z BLHeli_S da się wgrać Bluejay. **BLHeli_32** jest zamknięty i to obsługuje, ale nie jest już rozwijany.',
      bidirStatus:
        'Czy firmware tego ESC umie odsyłać RPM. Jeśli pisze, że nie, wgraj Bluejay lub AM32, zanim włączysz bidirectional DShot w Betaflight.',
      direction:
        'W którą stronę kręci się ten silnik, ustawione w ESC. Gdy jeden silnik kręci się źle, odwróć go w ustawieniach ESC zamiast zamieniać przewody, i sprawdź testem silników (bez śmigieł).',
      pwm: 'Częstotliwość, którą ESC steruje silnikiem. Wyższa daje gładszą i cichszą pracę, ale trochę bardziej grzeje ESC. Na piątce domyślna jest w porządku. Zmieniaj tylko przy piszczeniu lub problemach z temperaturą.',
      timing:
        'Jak wcześnie ESC przełącza fazy silnika. Domyślne (medium-high albo ok. 22 stopni) pasuje do większości silników. Za wysokie może grzać silnik i ESC, za niskie odbiera moc. Zostaw, chyba że silnik gubi synchronizację.',
      startupPower:
        'Ile mocy ESC daje, żeby ruszyć silnik z postoju. Za mało i silnik może nie wystartować; za dużo i start jest szarpany i gorący. Zostaw domyślne, chyba że silnik szarpie przy uzbrajaniu.',
      brakeOnStop:
        'Hamuje silnik w chwili, gdy sygnał gazu spada do zera. W multirotorze zostaw wyłączone; to jest do składanych śmigieł w samolotach.',
      beacon:
        'ESC potrafi pikać silnikami, żeby łatwiej znaleźć zgubiony quad. Siła ustawia głośność (wyższa to większy prąd i grzanie silnika), opóźnienie mówi, po jakim czasie od ostatniego sygnału zaczyna. Słychać to tylko, gdy silniki stoją.',
      tempProtection:
        'Gdy ESC osiągnie tę temperaturę, zmniejsza moc silnika, żeby się chronić. Nie wyłączaj tego tylko po to, żeby przestało działać; znajdź, czemu ESC jest gorący.',
      more: 'Rzadziej używane ustawienia zapisane w firmware ESC. Zmieniaj je tylko wtedy, gdy wiesz, co robią, i w konfiguratorze ESC, nie tutaj.',
    },
  },
};
