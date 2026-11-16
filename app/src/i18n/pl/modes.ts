/** Polskie teksty zakładki Tryby. */
import type { enBfModes } from '../en/modes';

export const plBfModes: typeof enBfModes = {
  tab: 'Tryby',
  note: 'Użyto {used} z {max} zakresów',
  onlyConfigured: 'Tylko tryby z zakresami',
  pulse: 'IMPULS µs',
  noArm: 'ARM nie ma zakresu: quada nie da się uzbroić przełącznikiem. Dodaj zakres dla ARM.',
  aux: 'Kanał AUX',
  from: 'Początek zakresu',
  to: 'Koniec zakresu',
  logic: 'Logika',
  linked: 'Powiązany tryb',
  noLink: 'brak powiązania',
  remove: 'Usuń zakres',
  active: 'AKTYWNY',
  add: 'Dodaj zakres',
  noSlots: 'Wszystkie 20 miejsc na zakresy jest zajętych.',
  tips: {
    logic: 'OR: tryb włącza się, gdy zakres pasuje. AND: wymaga też włączonego powiązanego trybu.',
  },
  ai: {
    intro: 'Karta Tryby, zakresów: {n}:',
    active: 'Aktywne teraz tryby: {list}',
  },
};
