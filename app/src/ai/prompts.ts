import type { Diagnosis } from '../fc/diagnose';
import { decodeArmingFlags } from '../fc/diagnose';
import { firmwareName, boardDisplayName } from '../fc/board';
import { protocolName, rssiPct, type FcState } from '../fc/state';

/** Stały prompt systemowy (cache'owany). */
export const SYSTEM_PROMPT = `Jesteś asystentem Rotorlab: ekspertem od dronów FPV, Betaflight, ELRS (ExpressLRS), ESC z Bluejay/BLHeli/AM32 i strojenia PID.
Odpowiadasz po polsku, krótko i konkretnie, bez wstępów i bez tłumaczenia podstaw, chyba że użytkownik o to poprosi.

Zasady:
- Propozycje zmian w FC podawaj WYŁĄCZNIE jako blok kodu \`\`\`cli z prawdziwymi komendami CLI Betaflight (jedna komenda na linię, np. "set motor_pwm_protocol = DSHOT600"). Nie dodawaj "save" ani "exit" - aplikacja zrobi to sama po potwierdzeniu użytkownika.
- Nigdy nie proponuj komendy "defaults" ani flashowania/bootloadera bez wyraźnego ostrzeżenia, że to kasuje konfigurację, i bez zaznaczenia, że aplikacja takich komend nie wyśle.
- Przy każdej sugestii dotyczącej silników przypomnij o zdjęciu śmigieł podczas testów.
- Opieraj się na danych z kontekstu poniżej (FC, wynik reguł, diff all). Jeśli brakuje danych, powiedz czego brakuje, zamiast zgadywać.
- Jeśli nie jesteś pewien nazwy parametru w danej wersji Betaflight, zaznacz to i podaj, jak sprawdzić ("get <fragment>").
- Nie wymyślaj wersji firmware ESC/ELRS, których nie ma w kontekście.`;

/** Kontekst o aktualnym dronie (stały w obrębie rozmowy, cache'owany; pytanie użytkownika idzie na końcu). */
export function buildContext(state: Readonly<FcState>, diag: Diagnosis | null): string {
  if (!state.info || !state.config) {
    return 'KONTEKST: brak połączenia z FC. Odpowiadaj ogólnie i zaproponuj użytkownikowi połączenie z dronem.';
  }
  const c = state.config;
  const lines: string[] = ['KONTEKST (odczyt z FC):'];
  lines.push(`- Płyta: ${boardDisplayName(state.info)} (${state.info.boardId}), ${firmwareName(state.info)}, MSP API ${state.info.apiVersion.major}.${state.info.apiVersion.minor}`);
  lines.push(`- Nazwa drona: ${state.info.craftName}`);
  lines.push(`- Silniki: ${c.motorCount}, protokół ${protocolName(c.motorPwmProtocol)}, dshot_bidir ${c.bidir ? 'ON' : 'OFF'}, motor_poles ${c.motorPoles}, minthrottle ${c.minThrottle}, mincommand ${c.minCommand}`);
  lines.push(`- Pętle: gyro_sync_denom ${c.gyroSyncDenom}, pid_process_denom ${c.pidProcessDenom}`);
  const t = state.telemetry;
  if (t) {
    lines.push(`- Bateria: ${t.vbat.toFixed(2)} V${state.cells ? ` (~${state.cells}S)` : ' (zasilanie z USB?)'}, RSSI ${rssiPct(t.rssi)}%`);
    if (t.motors.length) lines.push(`- Surowe wartości silników: ${t.motors.join(', ')}`);
  }
  if (state.status) {
    const flags = decodeArmingFlags(state.status.armingDisableFlags).map((f) => f.name);
    lines.push(`- Uzbrojony: ${state.status.armed ? 'tak' : 'nie'}; blokady uzbrojenia: ${flags.length ? flags.join(', ') : 'brak'}; CPU ${state.status.cpuLoad}%; błędy I2C ${state.status.i2cErrors}`);
  }
  if (state.pid) {
    const p = state.pid;
    lines.push(`- PID (roll/pitch/yaw, P I D): ${p.roll.join('/')}  ${p.pitch.join('/')}  ${p.yaw.join('/')}`);
  }
  if (state.meta.elrsVersion) lines.push(`- ELRS (wpisane ręcznie): ${state.meta.elrsVersion}`);
  if (diag) {
    lines.push('', 'WYNIK REGUŁ (diagnoza bez AI):');
    for (const ch of diag.checks) lines.push(`- [${ch.severity}] ${ch.label}${ch.detail ? ` - ${ch.detail}` : ''}`);
    if (diag.commands.length) lines.push('Komendy proponowane przez reguły: ' + diag.commands.join('; '));
  }
  if (state.diff) lines.push('', 'DIFF ALL:', state.diff);
  else lines.push('', '(diff all nie został jeszcze pobrany - jeśli potrzebny, poproś użytkownika o "Pobierz konfigurację".)');
  return lines.join('\n');
}
