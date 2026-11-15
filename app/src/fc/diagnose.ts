import { isDshot, protocolName, type FcState } from './state';

/** Czesc drona, na ktorej skupia sie "ognisko" na rentgenie. */
export type Part = 'esc' | 'rx' | 'fc' | 'motors' | 'battery';

export const PART_LABEL: Record<Part, string> = {
  esc: 'ESC',
  rx: 'Odbiornik',
  fc: 'FC',
  motors: 'Silniki',
  battery: 'Bateria',
};

export type Severity = 'ok' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  label: string;
  severity: Severity;
  part: Part | null;
  detail?: string;
}

export interface Suggestion {
  id: string;
  part: Part;
  title: string;
  /** Prawdziwe komendy CLI Betaflight. */
  commands: string[];
  caveat?: string;
}

export interface Diagnosis {
  checks: Check[];
  suggestions: Suggestion[];
  /** Czesc z najpowazniejszym problemem (do ogniska) albo null, gdy wszystko OK. */
  focus: Part | null;
  /** Krotkie podsumowanie po polsku. */
  summary: string;
  /** Wszystkie proponowane komendy (bez duplikatow). */
  commands: string[];
}

/** Flagi blokady uzbrojenia Betaflight 4.4/4.5 (numer bitu -> nazwa i opis po polsku). */
export const ARMING_FLAGS: Array<{ bit: number; name: string; part: Part; desc: string }> = [
  { bit: 0, name: 'NOGYRO', part: 'fc', desc: 'Nie wykryto żyroskopu' },
  { bit: 1, name: 'FAILSAFE', part: 'rx', desc: 'Aktywny failsafe' },
  { bit: 2, name: 'RXLOSS', part: 'rx', desc: 'Brak sygnału z odbiornika' },
  { bit: 3, name: 'BADRX', part: 'rx', desc: 'Odbiornik daje błędne dane' },
  { bit: 4, name: 'BOXFAILSAFE', part: 'rx', desc: 'Przełącznik failsafe jest włączony' },
  { bit: 5, name: 'THROTTLE', part: 'rx', desc: 'Gaz nie jest na minimum' },
  { bit: 6, name: 'ANGLE', part: 'fc', desc: 'Dron jest za bardzo przechylony' },
  { bit: 7, name: 'BOOTGRACE', part: 'fc', desc: 'Trwa odliczanie po starcie (poczekaj chwilę)' },
  { bit: 8, name: 'NOPREARM', part: 'rx', desc: 'Wymagany przełącznik prearm' },
  { bit: 9, name: 'LOAD', part: 'fc', desc: 'Za duże obciążenie procesora' },
  { bit: 10, name: 'CALIB', part: 'fc', desc: 'Trwa kalibracja czujników' },
  { bit: 11, name: 'CLI', part: 'fc', desc: 'Aktywny tryb CLI' },
  { bit: 12, name: 'CMS', part: 'fc', desc: 'Otwarte menu OSD (CMS)' },
  { bit: 13, name: 'BST', part: 'fc', desc: 'Aktywny BST (Black Box / telemetria)' },
  { bit: 14, name: 'MSP', part: 'fc', desc: 'Podłączone narzędzie przez MSP' },
  { bit: 15, name: 'PARALYZE', part: 'fc', desc: 'Tryb Paralyze' },
  { bit: 16, name: 'GPS', part: 'fc', desc: 'Brak fixa GPS' },
  { bit: 17, name: 'RESCUE_SW', part: 'rx', desc: 'Przełącznik GPS Rescue jest włączony' },
  { bit: 18, name: 'RPMFILTER', part: 'esc', desc: 'Filtr RPM włączony, ale brak telemetrii RPM z ESC' },
  { bit: 19, name: 'REBOOT_REQD', part: 'fc', desc: 'Wymagany restart FC' },
  { bit: 20, name: 'DSHOT_BBANG', part: 'esc', desc: 'Bidirectional DShot wymaga innego timera/protokołu' },
  { bit: 21, name: 'NO_ACC_CAL', part: 'fc', desc: 'Brak kalibracji akcelerometru' },
  { bit: 22, name: 'MOTOR_PROTO', part: 'esc', desc: 'Nieprawidłowy protokół silników' },
  { bit: 23, name: 'ARMSWITCH', part: 'rx', desc: 'Przełącznik uzbrajania jest włączony (wyłącz i włącz ponownie)' },
];

export function decodeArmingFlags(mask: number) {
  return ARMING_FLAGS.filter((f) => (mask & (1 << f.bit)) !== 0);
}

const SEVERITY_RANK: Record<Severity, number> = { fail: 3, warn: 2, info: 1, ok: 0 };
/** Przy remisie waznosci wygrywa czesc wyzej na liscie. */
const PART_PRIORITY: Part[] = ['esc', 'battery', 'motors', 'rx', 'fc'];

export function recommendedDshot(pidProcessDenom: number, gyroSyncDenom: number): { name: 'DSHOT300' | 'DSHOT600'; speed: number } {
  // Zakladamy zyroskop 8 kHz (typowy dla F4/F7/H7 w BF 4.x): petla PID = 8000 / (gyro_sync x pid_process).
  const pidHz = 8000 / Math.max(1, gyroSyncDenom) / Math.max(1, pidProcessDenom);
  return pidHz <= 4000 ? { name: 'DSHOT300', speed: 300 } : { name: 'DSHOT600', speed: 600 };
}

const DSHOT_SPEED: Record<number, number> = { 5: 150, 6: 300, 7: 600, 8: 1000 };

/** Reguly diagnostyczne dzialajace zawsze (bez AI). */
export function diagnose(state: Readonly<FcState>): Diagnosis {
  const checks: Check[] = [];
  const suggestions: Suggestion[] = [];
  const { config, status, telemetry, cells } = state;

  if (!config) {
    return { checks, suggestions, focus: null, summary: 'Brak danych z FC.', commands: [] };
  }

  // 1. Mapowanie / liczba silnikow
  checks.push(
    config.motorCount === 4
      ? { id: 'motors', label: 'Mapowanie silników: zgodne', severity: 'ok', part: 'motors', detail: '4 silniki (M1-M4)' }
      : { id: 'motors', label: `Liczba silników: ${config.motorCount}`, severity: 'warn', part: 'motors', detail: 'Quad powinien mieć 4 silniki. Sprawdź mixer.' },
  );

  // 2. Napiecie baterii
  if (telemetry && cells) {
    const perCell = telemetry.vbat / cells;
    const txt = `Napięcie ${cells}S ${telemetry.vbat.toFixed(1)} V`;
    if (perCell < 3.5) {
      checks.push({ id: 'vbat', label: `${txt}: za niskie`, severity: 'fail', part: 'battery', detail: `${perCell.toFixed(2)} V na celę (min. zalecane 3.5 V)` });
    } else {
      checks.push({ id: 'vbat', label: `${txt}: OK`, severity: 'ok', part: 'battery', detail: `${perCell.toFixed(2)} V na celę` });
    }
  } else if (telemetry) {
    checks.push({ id: 'vbat', label: 'Bateria: zasilanie z USB', severity: 'info', part: 'battery', detail: 'Podłącz akumulator, aby sprawdzić napięcie.' });
  }

  // 3. Protokol silnikow
  const rec = recommendedDshot(config.pidProcessDenom, config.gyroSyncDenom);
  const protoName = protocolName(config.motorPwmProtocol);
  if (!isDshot(config.motorPwmProtocol)) {
    checks.push({ id: 'protocol', label: `Protokół: ${protoName}`, severity: 'fail', part: 'esc', detail: 'Analogowe protokoły (PWM/OneShot/Multishot) są przestarzałe. Użyj DShot.' });
    suggestions.push({ id: 'protocol', part: 'esc', title: `Przełącz protokół na ${rec.name}`, commands: [`set motor_pwm_protocol = ${rec.name}`] });
  } else {
    const speed = DSHOT_SPEED[config.motorPwmProtocol] ?? 0;
    if (speed > 0 && speed < rec.speed) {
      checks.push({ id: 'protocol', label: `Protokół: DShot${speed}`, severity: 'fail', part: 'esc', detail: `Przy tej częstotliwości PID zalecany jest ${rec.name}.` });
      suggestions.push({ id: 'protocol', part: 'esc', title: `Przełącz protokół na ${rec.name}`, commands: [`set motor_pwm_protocol = ${rec.name}`], caveat: 'ESC musi obsługiwać wybraną prędkość (BLHeli_S zwykle DShot300/600).' });
    } else {
      checks.push({ id: 'protocol', label: `Protokół: DShot${speed}`, severity: 'ok', part: 'esc', detail: `Zgodny z częstotliwością PID (zalecany ${rec.name}).` });
    }
  }

  // 4. Bidirectional DShot
  if (isDshot(config.motorPwmProtocol)) {
    if (!config.bidir) {
      checks.push({ id: 'bidir', label: 'Bidirectional DShot: wyłączony', severity: 'fail', part: 'esc', detail: 'Bez niego nie działa filtr RPM i telemetria obrotów.' });
      suggestions.push({
        id: 'bidir',
        part: 'esc',
        title: 'Włącz Bidirectional DShot (filtr RPM)',
        commands: ['set dshot_bidir = ON'],
        caveat: 'Wymaga ESC z Bluejay, BLHeli_32 lub AM32. Nie działa na gołym BLHeli_S.',
      });
    } else {
      checks.push({ id: 'bidir', label: 'Bidirectional DShot: włączony', severity: 'ok', part: 'esc', detail: 'Filtr RPM może działać.' });
    }
  }

  // 5. Silniki przy uzbrojeniu
  if (status?.armed) {
    const maxMotor = Math.max(0, ...(telemetry?.motors ?? []));
    if (!telemetry || maxMotor <= 1000) {
      checks.push({ id: 'armed-motors', label: 'Uzbrojony, ale silniki stoją', severity: 'fail', part: 'motors', detail: 'Brak odczytu MSP_MOTOR lub wartości na minimum po uzbrojeniu.' });
    } else {
      checks.push({ id: 'armed-motors', label: 'Uzbrojony: silniki dostają sygnał', severity: 'ok', part: 'motors' });
    }
  }

  // 6. Blokady uzbrojenia
  if (status) {
    const flags = decodeArmingFlags(status.armingDisableFlags);
    if (flags.length === 0) {
      checks.push({ id: 'arming', label: 'Blokady uzbrojenia: brak', severity: 'ok', part: 'fc' });
    } else {
      for (const f of flags) {
        checks.push({ id: `arm-${f.name}`, label: `Blokada uzbrojenia: ${f.name}`, severity: f.name === 'BOOTGRACE' || f.name === 'CLI' || f.name === 'MSP' ? 'info' : 'warn', part: f.part, detail: f.desc });
      }
    }
    if (status.cpuLoad > 70) checks.push({ id: 'cpu', label: `Obciążenie CPU: ${status.cpuLoad}%`, severity: 'warn', part: 'fc', detail: 'Zmniejsz częstotliwość PID albo wyłącz zbędne funkcje.' });
    if (status.i2cErrors > 0) checks.push({ id: 'i2c', label: `Błędy I2C: ${status.i2cErrors}`, severity: 'warn', part: 'fc', detail: 'Sprawdź połączenia barometru/magnetometru.' });
  }

  // Ognisko: najpowazniejszy problem
  let focus: Part | null = null;
  let best = -1;
  for (const c of checks) {
    if (c.severity !== 'fail' && c.severity !== 'warn') continue;
    if (!c.part) continue;
    const score = SEVERITY_RANK[c.severity] * 10 + (PART_PRIORITY.length - PART_PRIORITY.indexOf(c.part));
    if (score > best) {
      best = score;
      focus = c.part;
    }
  }

  const problems = checks.filter((c) => c.severity === 'fail' || c.severity === 'warn');
  const summary = problems.length === 0 ? 'Reguły nie znalazły problemów.' : `Reguły znalazły problemy: ${problems.length}. Największy dotyczy: ${PART_LABEL[focus ?? 'fc']}.`;
  const commands = [...new Set(suggestions.flatMap((s) => s.commands))];
  return { checks, suggestions, focus, summary, commands };
}
