/** Settings → AI assistant: provider cards (Claude Code, Gemini, Ollama, Anthropic API) with status, fields and a Test button. */
import type { AppContext } from '../context';
import { desktopAi } from '../ai/bridge';
import { ollamaStatus } from '../ai/providers';
import { CLAUDE_CODE_MODELS, DEFAULT_GEMINI_MODEL, PROVIDER_IDS, type ProviderId } from '../ai/types';
import { t } from '../i18n';
import { MODELS } from '../settings';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';

const keyField = (name: string, value: string, placeholder: string, label: string) => `
  <label class="field">
    <span>${label}</span>
    <div class="field-row">
      <input type="password" name="${name}" value="${escapeHtml(value)}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
      <button class="btn s" type="button" data-act="toggle" data-for="${name}">${t('settings.show')}</button>
    </div>
  </label>`;

export function aiSettingsHtml(ctx: AppContext): string {
  const s = ctx.settings.get();
  const sel = ctx.ai.providerId();
  const desktop = !!desktopAi();

  const body: Record<ProviderId, string> = {
    'claude-code': `
      <label class="field">
        <span>${t('aiProviders.cc.model')}</span>
        <select name="ccModel">${CLAUDE_CODE_MODELS.map((m) => `<option value="${m}" ${m === s.claudeCodeModel ? 'selected' : ''}>${escapeHtml(t(m === 'opus' ? 'aiProviders.cc.modelOpus' : 'aiProviders.cc.modelSonnet'))}</option>`).join('')}</select>
      </label>
      <small>${t('aiProviders.cc.note')}</small>
      <p class="about" data-cc-missing hidden>${t('aiProviders.cc.missing')}</p>
      <div class="field-row actions"><button class="btn s" type="button" data-act="refresh" data-for="claude-code">${t('aiProviders.cc.refresh')}</button></div>`,
    gemini: `
      ${keyField('gemKey', s.geminiKey, 'AIza...', t('aiProviders.gemini.key'))}
      <small>${t('aiProviders.gemini.get')}</small>
      <label class="field" style="margin-top:14px">
        <span>${t('aiProviders.gemini.model')}</span>
        <div class="field-row"><input type="text" name="gemModel" value="${escapeHtml(s.geminiModel)}" placeholder="${DEFAULT_GEMINI_MODEL}" autocomplete="off" spellcheck="false" /></div>
        <small>${t('aiProviders.gemini.modelNote')}</small>
      </label>
      <small>${t('aiProviders.gemini.note')}</small>`,
    ollama: `
      <label class="field">
        <span>${t('aiProviders.ollama.url')}</span>
        <div class="field-row"><input type="text" name="ollUrl" value="${escapeHtml(s.ollamaUrl)}" autocomplete="off" spellcheck="false" /></div>
      </label>
      <label class="field">
        <span>${t('aiProviders.ollama.model')}</span>
        <div class="field-row"><select name="ollModel"><option value="${escapeHtml(s.ollamaModel)}">${escapeHtml(s.ollamaModel || t('aiProviders.ollama.pickModel'))}</option></select>
        <button class="btn s" type="button" data-act="refresh" data-for="ollama">${t('aiProviders.ollama.refresh')}</button></div>
      </label>
      <p class="about" data-oll-cors hidden>${t('aiProviders.ollama.corsHelp', { origin: escapeHtml(location.origin) })}</p>
      <small>${t('aiProviders.ollama.help')}</small>`,
    anthropic: `
      ${keyField('key', s.apiKey, 'sk-ant-...', t('settings.apiKey'))}
      <small>${t('settings.keyNote')}</small>
      <label class="field" style="margin-top:14px">
        <span>${t('settings.model')}</span>
        <select name="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${escapeHtml(t(m.labelKey))}</option>`).join('')}</select>
      </label>`,
  };

  const cards = PROVIDER_IDS.map((id) => {
    const disabled = id === 'claude-code' && !desktop;
    const initial = disabled ? t('aiProviders.state.desktopOnly') : t('aiProviders.state.checking');
    return `
    <div class="prov${id === sel ? ' on' : ''}${disabled ? ' off' : ''}" data-prov="${id}">
      <label class="prov-h">
        <input type="radio" name="prov" value="${id}" ${id === sel ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <b>${t(`aiProviders.name.${id}`)}</b>
        ${id === 'claude-code' && desktop ? `<span class="prov-tag">${t('aiProviders.recommended')}</span>` : ''}
        <span class="prov-st mono" data-st="${id}">${initial}</span>
      </label>
      <p class="about">${t(`aiProviders.desc.${id}`)}</p>
      <div class="prov-body" ${id === sel ? '' : 'hidden'}>
        ${disabled ? '' : body[id]}
        ${
          disabled
            ? ''
            : `<div class="field-row actions">
          <button class="btn s" type="button" data-act="test" data-for="${id}">${icon('check')}${t('aiProviders.test.run')}</button>
          ${id === 'anthropic' ? `<button class="btn s" type="button" data-act="clear">${t('settings.clearKey')}</button>` : ''}
          <span class="prov-test" data-test="${id}" aria-live="polite"></span>
        </div>`
        }
      </div>
    </div>`;
  }).join('');

  return `
      <section class="card" id="ai">
        <div class="ch">${t('settings.ai')}</div>
        <p class="about">${t('aiProviders.intro')}</p>
        <div class="prov-list" role="radiogroup" aria-label="${t('aiProviders.head')}">${cards}</div>
        <div class="field-row actions">
          <button class="btn p" type="button" data-act="save">${icon('check')}${t('settings.save')}</button>
          <button class="btn s" type="button" data-act="chat">${t('settings.clearChat')}</button>
          <span class="saved mono" aria-live="polite"></span>
        </div>
      </section>`;
}

/** Wires the AI card. Returns a function that persists the typed values (call before re-mounting, e.g. on language change). */
export function bindAiSettings(el: HTMLElement, ctx: AppContext, flash: (msg: string) => void): () => void {
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
  const val = (name: string) => (q<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '').trim();

  const collect = () => {
    const prev = ctx.settings.get();
    ctx.settings.set({
      apiKey: val('key'),
      model: val('model') || prev.model,
      claudeCodeModel: val('ccModel') || prev.claudeCodeModel,
      geminiKey: val('gemKey'),
      geminiModel: val('gemModel') || DEFAULT_GEMINI_MODEL,
      ollamaUrl: val('ollUrl') || prev.ollamaUrl,
      ollamaModel: q<HTMLSelectElement>('[name="ollModel"]')?.value ?? prev.ollamaModel,
    });
  };

  const setStatus = (id: ProviderId, ok: boolean, text: string) => {
    const e = q<HTMLElement>(`[data-st="${id}"]`);
    if (!e) return;
    e.textContent = text;
    e.classList.toggle('ok', ok);
    e.classList.toggle('bad', !ok);
  };

  let alive = true;
  const refresh = async (id: ProviderId) => {
    if (id === 'claude-code') {
      if (!desktopAi()) return;
      const a = await ctx.ai.provider('claude-code').available();
      if (!alive) return;
      setStatus(id, a.ok, a.reason ?? '');
      const m = q<HTMLElement>('[data-cc-missing]');
      if (m) m.hidden = a.ok;
    } else if (id === 'ollama') {
      const st = await ollamaStatus(val('ollUrl') || ctx.settings.get().ollamaUrl);
      if (!alive) return;
      const sel = q<HTMLSelectElement>('[name="ollModel"]');
      if (sel) {
        const cur = ctx.settings.get().ollamaModel;
        const names = st.models.includes(cur) || !cur ? st.models : [cur, ...st.models];
        sel.innerHTML = names.length ? [`<option value="">${t('aiProviders.ollama.pickModel')}</option>`, ...names.map((n) => `<option value="${escapeHtml(n)}" ${n === cur ? 'selected' : ''}>${escapeHtml(n)}</option>`)].join('') : `<option value="">${t('aiProviders.ollama.noModel')}</option>`;
      }
      const cors = q<HTMLElement>('[data-oll-cors]');
      if (cors) cors.hidden = st.kind !== 'cors';
      const text = st.kind === 'ok' ? t('aiProviders.state.ollamaRunning', { n: st.models.length }) : st.kind === 'noModels' ? t('aiProviders.state.ollamaNoModels') : st.kind === 'cors' ? t('aiProviders.state.ollamaCors') : t('aiProviders.state.ollamaDown');
      setStatus(id, st.kind === 'ok', text);
    } else if (id === 'gemini') {
      const has = !!val('gemKey');
      setStatus(id, has, t(has ? 'aiProviders.state.keySet' : 'aiProviders.state.missingKey'));
    } else {
      const has = !!val('key');
      setStatus(id, has, t(has ? 'aiProviders.state.keySet' : 'aiProviders.state.missingKey'));
    }
  };
  const refreshAll = () => PROVIDER_IDS.forEach((id) => void refresh(id));
  refreshAll();

  const showSelected = (id: ProviderId) => {
    el.querySelectorAll<HTMLElement>('.prov').forEach((c) => {
      const on = c.dataset.prov === id;
      c.classList.toggle('on', on);
      const b = c.querySelector<HTMLElement>('.prov-body');
      if (b) b.hidden = !on;
    });
  };

  el.querySelectorAll<HTMLInputElement>('input[name="prov"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (!r.checked) return;
      ctx.settings.set({ aiProvider: r.value as ProviderId });
      showSelected(r.value as ProviderId);
    }),
  );
  for (const n of ['key', 'gemKey']) q<HTMLInputElement>(`[name="${n}"]`)?.addEventListener('input', () => void refresh(n === 'key' ? 'anthropic' : 'gemini'));

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = b?.dataset.act;
    if (!b || !act) return;
    const id = b.dataset.for as ProviderId | undefined;
    if (act === 'toggle') {
      const inp = q<HTMLInputElement>(`[name="${b.dataset.for}"]`);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.textContent = inp.type === 'password' ? t('settings.show') : t('settings.hide');
    } else if (act === 'save') {
      collect();
      flash(t('settings.saved'));
      refreshAll();
    } else if (act === 'clear') {
      const k = q<HTMLInputElement>('[name="key"]');
      if (k) k.value = '';
      ctx.settings.set({ apiKey: '' });
      void refresh('anthropic');
      flash(t('settings.keyRemoved'));
    } else if (act === 'chat') {
      ctx.ai.clear();
      flash(t('settings.chatCleared'));
    } else if (act === 'refresh' && id) {
      collect();
      void refresh(id);
    } else if (act === 'test' && id) {
      collect();
      const out = q<HTMLElement>(`[data-test="${id}"]`);
      if (!out) return;
      (b as HTMLButtonElement).disabled = true;
      out.className = 'prov-test';
      out.textContent = t('aiProviders.test.running');
      void ctx.ai.test(id).then((r) => {
        (b as HTMLButtonElement).disabled = false;
        out.textContent = r.message;
        out.className = `prov-test ${r.ok ? 'ok' : 'bad'}`;
        void refresh(id);
      });
    }
  });

  return () => {
    alive = false;
    collect();
  };
}
