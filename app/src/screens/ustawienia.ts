import type { ScreenMount } from '../context';
import { aiSettingsHtml, bindAiSettings } from './ai-settings';
import { LANGS, fmtNum, getLang, setLang, t, type Lang } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { APP_VERSION, updatesApi, type UpdateStatus } from '../updates';

export const mount: ScreenMount = (el, ctx) => {
  const s = ctx.settings.get();
  const upd = updatesApi();
  const connected = () => ctx.state.get().conn === 'connected';

  el.innerHTML = `
    <div class="page">
      <h1>${t('settings.title')}</h1>

      <section class="card">
        <div class="ch">${t('settings.appTitle')}</div>
        <label class="field">
          <span>${t('lang.label')}</span>
          <div class="field-row"><select name="lang">${LANGS.map((l) => `<option value="${l}" ${l === getLang() ? 'selected' : ''}>${t(`lang.${l}`)}</option>`).join('')}</select></div>
        </label>
      </section>

${aiSettingsHtml(ctx)}

      <section class="card">
        <div class="ch">${t('bfInfo.settings.head')}</div>
        <label class="upd-chk"><input type="checkbox" name="autoEscInfo" ${s.autoEscInfo ? 'checked' : ''} /><span>${t('bfInfo.settings.autoEsc')}</span></label>
        <p class="about">${t('bfInfo.settings.autoEscNote')}</p>
        <label class="upd-chk"><input type="checkbox" name="autoElrsInfo" ${s.autoElrsInfo ? 'checked' : ''} /><span>${t('bfInfo.settings.autoElrs')}</span></label>
        <p class="about">${t('bfInfo.settings.autoElrsNote')}</p>
      </section>

      <section class="card">
        <div class="ch">${t('settings.dataHead')}</div>
        <div class="field-row actions">
          <button class="btn s" type="button" data-act="demo">${t('settings.demo')}</button>
          <button class="btn s" type="button" data-act="backup">${icon('download')}${t('settings.backup')}</button>
          <button class="btn s" type="button" data-act="fetch" ${connected() ? '' : 'disabled'}>${t('settings.fetch')}</button>
        </div>
        <small>${t('settings.dataNote')}</small>
        <label class="upd-chk"><input type="checkbox" name="armDisable" ${s.armingDisable ? 'checked' : ''} /><span>${t('bfCore.armDisableSetting')}</span></label>
        <small>${t('bfCore.armDisableNote')}</small>
      </section>

      <section class="card" id="upd">
        <div class="ch">${t('settings.updHead')}</div>
        <p class="upd-ver">${t('settings.updVersion')} <b class="mono" data-upd="ver">${escapeHtml(APP_VERSION)}</b></p>
        ${
          upd
            ? `<label class="upd-chk"><input type="checkbox" name="checkUpdates" ${s.checkUpdates ? 'checked' : ''} /><span>${t('settings.updAuto')}</span></label>
        <div class="upd-bar" data-upd="bar" hidden><div class="upd-fill" data-upd="fill"></div></div>
        <p class="upd-msg" data-upd="msg" aria-live="polite">${t('settings.updNever')}</p>
        <div class="field-row actions">
          <button class="btn s" type="button" data-act="upd-check">${t('settings.updCheck')}</button>
          <button class="btn p" type="button" data-act="upd-download" hidden>${t('settings.updDownload')}</button>
          <button class="btn p" type="button" data-act="upd-install" hidden>${t('settings.updInstall')}</button>
          <a class="btn s" href="https://github.com/0nskal/WorkspaceFPV/releases" target="_blank" rel="noopener">${t('settings.updNotes')}</a>
        </div>`
            : `<p class="about">${t('settings.updWeb')}</p>`
        }
      </section>

      <section class="card">
        <div class="ch">${t('settings.about')}</div>
        <p class="about">${escapeHtml(t('settings.aboutText', { version: APP_VERSION }))}</p>
      </section>
    </div>`;

  const saved = el.querySelector<HTMLElement>('.saved') as HTMLElement;

  const flash = (t: string) => {
    saved.textContent = t;
    setTimeout(() => (saved.textContent = ''), 2500);
  };

  const saveAi = bindAiSettings(el, ctx, flash);

  // --- Aktualizacje ---
  const q = (k: string) => el.querySelector<HTMLElement>(`[data-upd="${k}"]`);
  const btn = (a: string) => el.querySelector<HTMLElement>(`[data-act="${a}"]`);
  const fmtMB = (n: number) => t('settings.mb', { n: fmtNum(n / 1048576, 1) });
  const renderUpd = (st: UpdateStatus) => {
    const msg = q('msg');
    const bar = q('bar');
    const fill = q('fill');
    if (!msg || !bar || !fill) return;
    const bCheck = btn('upd-check');
    const bDown = btn('upd-download');
    const bInst = btn('upd-install');
    bar.hidden = st.state !== 'downloading';
    if (bDown) bDown.hidden = st.state !== 'available';
    if (bInst) bInst.hidden = st.state !== 'downloaded';
    if (bCheck) (bCheck as HTMLButtonElement).disabled = st.state === 'checking' || st.state === 'downloading';
    switch (st.state) {
      case 'dev':
        msg.textContent = t('settings.updDev');
        break;
      case 'checking':
        msg.textContent = t('settings.updChecking');
        break;
      case 'available':
        msg.textContent = t('settings.updAvailable', { version: st.version });
        break;
      case 'not-available':
        msg.textContent = t('settings.updLatest');
        break;
      case 'downloading':
        fill.style.width = `${Math.round(st.percent)}%`;
        msg.textContent = t('settings.updDownloading', { pct: Math.round(st.percent), speed: fmtMB(st.bytesPerSecond), total: fmtMB(st.total) });
        break;
      case 'downloaded':
        msg.textContent = t('settings.updDownloaded', { version: st.version });
        break;
      case 'error':
        msg.textContent = t('settings.updError', { msg: st.message });
        break;
    }
  };
  let offStatus: (() => void) | null = null;
  if (upd) {
    void upd.getVersion().then((v) => {
      const e = q('ver');
      if (e) e.textContent = v;
    });
    void upd.getStatus().then((st) => st && renderUpd(st));
    offStatus = upd.onStatus(renderUpd);
    el.querySelector<HTMLInputElement>('input[name="checkUpdates"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      ctx.settings.set({ checkUpdates: on });
      void upd.setAutoCheck(on);
    });
  }

  el.querySelector<HTMLInputElement>('input[name="armDisable"]')?.addEventListener('change', (e) => {
    ctx.settings.set({ armingDisable: (e.target as HTMLInputElement).checked });
  });
  for (const name of ['autoEscInfo', 'autoElrsInfo'] as const) {
    el.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.addEventListener('change', (e) => ctx.settings.set({ [name]: (e.target as HTMLInputElement).checked }));
  }

  // Language switches instantly: the shell and this screen are re-mounted by the app (onLanguageChange).
  el.querySelector<HTMLSelectElement>('select[name="lang"]')?.addEventListener('change', (e) => {
    // keep what was typed in the fields, so re-mounting does not lose it
    saveAi();
    setLang((e.target as HTMLSelectElement).value as Lang);
  });

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'upd-check') {
      void upd?.check().then(renderUpd);
    } else if (act === 'upd-download') {
      void upd?.download();
    } else if (act === 'upd-install') {
      void upd?.install();
    } else if (act === 'demo') {
      void ctx.connectDemo().then(() => ctx.navigate('warsztat'));
    } else if (act === 'backup') {
      if (!ctx.downloadBackup()) ctx.toast(t('settings.noBackup'), 'info');
    } else if (act === 'fetch') {
      void ctx.fetchDiff().then((t) => t && ctx.downloadBackup());
    }
  });

  return () => offStatus?.();
};
