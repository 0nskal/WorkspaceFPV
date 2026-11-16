import { t } from '../i18n';
import { escapeHtml } from './dom';

export interface ConfirmOptions {
  title: string;
  /** Tresc HTML (zaufana) lub gotowy element. */
  body: string | HTMLElement;
  confirmText?: string;
  cancelText?: string;
  /** Czerwony przycisk potwierdzenia (operacje ryzykowne). */
  danger?: boolean;
  /** The confirm button stays disabled until the user types exactly this text (destructive actions). */
  requireText?: string;
}

/** Okno potwierdzenia w stylu "karty pacjenta". Zwraca true po potwierdzeniu. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title)}">
      <div class="modal-h"><i></i>${escapeHtml(opts.title)}</div>
      <div class="modal-b"></div>
      <div class="modal-f">
        <button class="btn s" data-act="cancel">${escapeHtml(opts.cancelText ?? t('common.cancel'))}</button>
        <button class="btn p${opts.danger ? ' danger' : ''}" data-act="ok">${escapeHtml(opts.confirmText ?? t('common.confirm'))}</button>
      </div></div>`;
    const body = overlay.querySelector('.modal-b') as HTMLElement;
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else body.appendChild(opts.body);

    if (opts.requireText) {
      const ok = overlay.querySelector<HTMLButtonElement>('[data-act="ok"]') as HTMLButtonElement;
      ok.disabled = true;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'modal-req mono';
      inp.autocomplete = 'off';
      inp.setAttribute('aria-label', opts.requireText);
      inp.placeholder = opts.requireText;
      inp.addEventListener('input', () => (ok.disabled = inp.value.trim() !== opts.requireText));
      body.appendChild(inp);
    }

    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
    };
    overlay.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'ok') done(true);
      else if (act === 'cancel' || t === overlay) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    (overlay.querySelector('[data-act="cancel"]') as HTMLElement).focus();
  });
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Krotki komunikat na dole ekranu. */
export function toast(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.className = `toast ${kind} show`;
  t.textContent = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t?.classList.remove('show'), kind === 'error' ? 7000 : 3500);
}
