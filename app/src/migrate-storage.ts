/**
 * One-time rename migration (Rotorlab -> WorkspaceFPV): copies localStorage keys `rotorlab.*` to `workspacefpv.*`
 * when the new key is missing. Old keys are left in place (harmless, lets a downgrade keep working).
 */
export function migrateLegacyStorage(): void {
  try {
    const OLD = 'rotorlab.';
    const NEW = 'workspacefpv.';
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD)) keys.push(k);
    }
    for (const k of keys) {
      const nk = NEW + k.slice(OLD.length);
      if (localStorage.getItem(nk) === null) {
        const v = localStorage.getItem(k);
        if (v !== null) localStorage.setItem(nk, v);
      }
    }
  } catch {
    /* no localStorage */
  }
}
