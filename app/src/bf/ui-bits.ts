/** Small DOM helpers shared by the Blackbox, CLI and OSD tabs. */
import type { AppContext } from '../context';
import { t } from '../i18n';
import { hasWebSerial } from '../serial/port';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';

/** "Connect or try the demo" card, same look as the ESC tab (reuses its .esc-empty classes). */
export function emptyHtml(ctx: AppContext, tag: string, title: string, lead: string): string {
  const s = ctx.state.get();
  const busy = s.conn === 'connecting';
  const noSerial = !hasWebSerial();
  return `<div class="esc-empty"><div class="esc-empty-card">
    <div class="esc-empty-t mono">${escapeHtml(tag)}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(lead)}</p>
    <div class="start-btns">
      <button class="btn light" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 16)}${busy ? t('common.connecting') : t('common.connect')}</button>
      <button class="btn ghost" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 16)}${t('common.demo')}</button>
    </div>
    ${noSerial ? `<div class="start-msg warn">${t('conn.noWebSerial')}</div>` : ''}
    ${s.error ? `<div class="start-msg err" role="alert">${escapeHtml(s.error)}</div>` : ''}
  </div></div>`;
}

/** Wires the connect / demo buttons of emptyHtml(). */
export function bindConnect(el: HTMLElement, ctx: AppContext): () => void {
  const h = (e: Event) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void ctx.connect();
    else if (act === 'demo') void ctx.connectDemo();
  };
  el.addEventListener('click', h);
  return () => el.removeEventListener('click', h);
}

/** Saves bytes as a file download. */
export function downloadBytes(filename: string, data: Uint8Array | string, mime = 'application/octet-stream'): void {
  const part: BlobPart = typeof data === 'string' ? data : (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
