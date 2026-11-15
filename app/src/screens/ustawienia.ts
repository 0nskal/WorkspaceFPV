import type { ScreenMount } from '../context';
import { MODELS } from '../settings';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';

export const mount: ScreenMount = (el, ctx) => {
  const s = ctx.settings.get();
  const connected = () => ctx.state.get().conn === 'connected';

  el.innerHTML = `
    <div class="page">
      <h1>Ustawienia</h1>

      <section class="card">
        <div class="ch">Asystent AI</div>
        <label class="field">
          <span>Klucz API Anthropic</span>
          <div class="field-row">
            <input type="password" name="key" value="${escapeHtml(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
            <button class="btn s" type="button" data-act="toggle">Pokaż</button>
          </div>
          <small>Klucz zapisuje się tylko lokalnie na tym komputerze (localStorage) i jest wysyłany wyłącznie do API Anthropic. Klucz wygenerujesz w console.anthropic.com. Bez klucza działają same reguły diagnostyczne.</small>
        </label>
        <label class="field">
          <span>Model</span>
          <select name="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}</select>
        </label>
        <div class="field-row actions">
          <button class="btn p" type="button" data-act="save">${icon('check')}Zapisz</button>
          <button class="btn s" type="button" data-act="clear">Wyczyść klucz</button>
          <button class="btn s" type="button" data-act="chat">Wyczyść rozmowę</button>
          <span class="saved mono" aria-live="polite"></span>
        </div>
      </section>

      <section class="card">
        <div class="ch">Wersja ELRS (wpisana ręcznie)</div>
        <label class="field">
          <span>Wersja firmware odbiornika</span>
          <div class="field-row"><input type="text" name="elrs" value="${escapeHtml(s.elrsVersion)}" placeholder="np. 3.4.3" autocomplete="off" /></div>
          <small>FC nie zna wersji ELRS. Wpisana tutaj pojawi się na rozkładzie drona.</small>
        </label>
      </section>

      <section class="card">
        <div class="ch">Dane i demo</div>
        <div class="field-row actions">
          <button class="btn s" type="button" data-act="demo">Tryb demo</button>
          <button class="btn s" type="button" data-act="backup">${icon('download')}Pobierz kopię ustawień</button>
          <button class="btn s" type="button" data-act="fetch" ${connected() ? '' : 'disabled'}>Odczytaj konfigurację z FC</button>
        </div>
        <small>Kopia to ostatni zapisany wynik <code>diff all</code>. Rotorlab zapisuje ją automatycznie przed każdą zmianą w FC. Odczyt z FC restartuje płytkę (CLI Betaflight kończy się restartem).</small>
      </section>

      <section class="card">
        <div class="ch">O programie</div>
        <p class="about">Rotorlab 0.1 · MIT · aplikacja działa lokalnie, a dane z drona nie opuszczają komputera poza pytaniami do asystenta AI.</p>
      </section>
    </div>`;

  const keyInput = el.querySelector<HTMLInputElement>('input[name="key"]') as HTMLInputElement;
  const modelSel = el.querySelector<HTMLSelectElement>('select[name="model"]') as HTMLSelectElement;
  const elrsInput = el.querySelector<HTMLInputElement>('input[name="elrs"]') as HTMLInputElement;
  const saved = el.querySelector<HTMLElement>('.saved') as HTMLElement;

  const flash = (t: string) => {
    saved.textContent = t;
    setTimeout(() => (saved.textContent = ''), 2500);
  };

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'toggle') {
      const b = e.target as HTMLElement;
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      b.textContent = keyInput.type === 'password' ? 'Pokaż' : 'Ukryj';
    } else if (act === 'save') {
      ctx.settings.set({ apiKey: keyInput.value.trim(), model: modelSel.value, elrsVersion: elrsInput.value.trim() });
      flash('Zapisano.');
    } else if (act === 'clear') {
      keyInput.value = '';
      ctx.settings.set({ apiKey: '' });
      flash('Klucz usunięty.');
    } else if (act === 'chat') {
      ctx.ai.clear();
      flash('Rozmowa wyczyszczona.');
    } else if (act === 'demo') {
      void ctx.connectDemo().then(() => ctx.navigate('warsztat'));
    } else if (act === 'backup') {
      if (!ctx.downloadBackup()) ctx.toast('Nie ma jeszcze kopii. Połącz się z FC i zastosuj zmianę albo odczytaj konfigurację.', 'info');
    } else if (act === 'fetch') {
      void ctx.fetchDiff().then((t) => t && ctx.downloadBackup());
    }
  });

  return () => undefined;
};
