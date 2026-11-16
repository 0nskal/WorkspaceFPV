/**
 * ESC tab, motor configuration panel: protocol, bidirectional DShot, idle, motor poles and motor direction,
 * all read from and written to the FC over MSP (no CLI). Read-modify-write on the raw payloads, a sticky
 * Save bar, nothing is sent until the pilot presses Save.
 */
import type { AppContext } from '../context';
import { t } from '../i18n';
import {
  MSPM,
  decodeAdvancedConfig,
  decodeMixerConfig,
  decodeMotorConfig,
  encodeAdvancedConfig,
  encodeMixerConfig,
  encodeMotorConfig,
  protocolById,
  supportsBidir,
  validateMotorEdit,
  type AdvancedConfig,
  type MixerConfig,
  type MotorConfig,
} from '../bf/motors';
import { AREA, rawOf, STEP } from '../bf/steps';
import type { MspWrite } from '../bf/store';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';

export interface MotorCfgHandle {
  destroy(): void;
  /** Sets the pending "props out" (reversed motor direction) value, e.g. from the toggle next to the drone. */
  setReversed(v: boolean): void;
  reversed(): boolean;
  /** Re-reads everything from the FC. */
  reload(): Promise<void>;
}

interface Edit {
  protocol: number;
  bidir: boolean;
  idle: string;
  poles: string;
  reversed: boolean;
}

const SHOWN = [0, 1, 3, 5, 6, 7];

export function mountMotorConfig(host: HTMLElement, ctx: AppContext, opts: { onReversed: (v: boolean) => void; stopTest: () => void }): MotorCfgHandle {
  const apiMinor = () => ctx.bf.get().api || 46;
  let adv: AdvancedConfig | null = null;
  let mot: MotorConfig | null = null;
  let mix: MixerConfig | null = null;
  let edit: Edit | null = null;
  let status: 'loading' | 'ready' | 'unsupported' | 'error' = 'loading';
  let saving = false;
  let disposed = false;
  let rev = 0;

  const q = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);

  const base = (): Edit | null =>
    adv && mot && mix ? { protocol: adv.protocol, bidir: mot.bidir, idle: String(adv.idlePercent), poles: String(mot.poles), reversed: mix.reversed } : null;

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

  function changes(): string[] {
    const b = base();
    if (!b || !edit) return [];
    const out: string[] = [];
    const pn = (id: number) => protocolById(id)?.name ?? `#${id}`;
    if (edit.protocol !== b.protocol) out.push(t('bfMotors.chProtocol', { from: pn(b.protocol), to: pn(edit.protocol) }));
    if (edit.bidir !== b.bidir) out.push(t('bfMotors.chBidir', { to: edit.bidir ? t('common.on') : t('common.off') }));
    if (num(edit.idle) !== num(b.idle)) out.push(t('bfMotors.chIdle', { from: b.idle, to: edit.idle }));
    if (num(edit.poles) !== num(b.poles)) out.push(t('bfMotors.chPoles', { from: b.poles, to: edit.poles }));
    if (edit.reversed !== b.reversed) out.push(t('bfMotors.chDirection', { to: edit.reversed ? t('bfMotors.propsOut') : t('bfMotors.propsIn') }));
    return out;
  }

  /** Protocol/bidir changes need a reboot; idle, poles and direction apply right after EEPROM write. */
  const needsReboot = (): boolean => {
    const b = base();
    return !!b && !!edit && (edit.protocol !== b.protocol || edit.bidir !== b.bidir);
  };

  function issues(): string[] {
    if (!edit) return [];
    return validateMotorEdit({ idlePercent: num(edit.idle), poles: num(edit.poles), protocol: edit.protocol, bidir: edit.bidir });
  }

  /** Decodes the payloads the Betaflight store read on connect; false when one of them is missing. */
  function fromStore(): boolean {
    const d = ctx.bf.get();
    const a = rawOf(d, STEP.advanced);
    const m = rawOf(d, STEP.motor);
    const x = rawOf(d, STEP.mixer);
    if (!a || !m || !x) return false;
    adv = decodeAdvancedConfig(a);
    mot = decodeMotorConfig(m, apiMinor());
    mix = decodeMixerConfig(x);
    edit = base();
    opts.onReversed(edit!.reversed);
    return true;
  }

  /** Shows the connect-time values at once, then re-reads them (they may have changed in the CLI or the Config tab). */
  async function load(): Promise<void> {
    const cached = fromStore();
    status = cached ? 'ready' : 'loading';
    paint();
    await ctx.bf.refresh(AREA.motors);
    if (disposed || saving || changes().length) return;
    if (fromStore()) status = 'ready';
    else status = ctx.state.get().conn === 'connected' ? 'unsupported' : 'error';
    paint();
  }

  function fieldCls(changed: boolean) {
    return changed ? ' bf-motors-changed' : '';
  }

  function paint(): void {
    if (disposed) return;
    const s = ctx.state.get();
    if (s.conn !== 'connected' || status === 'loading' || status !== 'ready' || !edit) {
      const msg = s.conn !== 'connected' ? t('bfMotors.needFc') : status === 'loading' ? t('bfMotors.loading') : t('bfMotors.unsupported');
      host.innerHTML = `<header><span class="mono">${t('bfMotors.head')}</span><span class="mono esc-key">MSP</span></header><p class="bf-motors-msg mono">${escapeHtml(msg)}</p>`;
      return;
    }
    const b = base()!;
    const bad = issues();
    const list = changes();
    const reboot = needsReboot();
    const dshot = supportsBidir(edit.protocol);
    const protoIds = SHOWN.includes(edit.protocol) || !protocolById(edit.protocol) ? SHOWN : [...SHOWN, edit.protocol];
    const seg = protoIds
      .map((id) => {
        const p = protocolById(id)!;
        const isCur = id === b.protocol;
        const isSel = id === edit!.protocol;
        const tag = isCur && isSel ? t('esc.tagCurrent') : isCur ? t('esc.tagCurrent') : isSel ? t('esc.tagNew') : '';
        return `<button type="button" class="esc-seg-b${isSel ? ' sel' : ''}${isCur && !isSel ? ' cur' : ''}" role="radio" aria-checked="${isSel}" data-proto="${id}"><span class="${isCur && !isSel ? 'strike' : ''}">${p.name}</span><small>${tag || '&nbsp;'}</small></button>`;
      })
      .join('');
    const idleBad = bad.includes('idle');
    const polesBad = bad.includes('poles');
    host.innerHTML = `
      <header><span class="mono">${t('bfMotors.head')}</span><span class="mono esc-key">MSP · API 1.${apiMinor()}</span></header>
      <div class="esc-seg bf-motors-seg" role="radiogroup" aria-label="${t('esc.protoAria')}">${seg}</div>
      <div class="esc-bidir${fieldCls(edit.bidir !== b.bidir)}">
        <div><b>${t('esc.bidirTitle')}</b><small class="mono" title="${escapeHtml(t('bfMotors.bidirTip'))}">dshot_bidir</small></div>
        <button type="button" class="esc-sw${edit.bidir ? ' on' : ''}" role="switch" aria-checked="${edit.bidir}" data-act="bidir" ${dshot ? '' : 'disabled'} aria-label="${t('esc.bidirAria')}"><span class="esc-sw-t mono">${edit.bidir ? 'ON' : 'OFF'}</span><i></i></button>
      </div>
      ${dshot ? '' : `<p class="esc-note esc-bidir-note mono">${t('esc.bidirDshotOnly')}</p>`}
      <div class="bf-motors-grid">
        <label class="bf-motors-f${fieldCls(num(edit.idle) !== num(b.idle))}${idleBad ? ' bad' : ''}" title="${escapeHtml(t('bfMotors.idleTip'))}">
          <span>${t('bfMotors.idle')}</span>
          <span class="bf-motors-in"><input type="number" inputmode="decimal" min="0" max="20" step="0.25" value="${escapeHtml(edit.idle)}" data-f="idle" aria-label="${t('bfMotors.idle')}"><em class="mono">%</em></span>
          <small class="mono">dshot_idle_value</small>
        </label>
        <label class="bf-motors-f${fieldCls(num(edit.poles) !== num(b.poles))}${polesBad ? ' bad' : ''}" title="${escapeHtml(t('bfMotors.polesTip'))}">
          <span>${t('bfMotors.poles')}</span>
          <span class="bf-motors-in"><input type="number" inputmode="numeric" min="4" max="64" step="2" value="${escapeHtml(edit.poles)}" data-f="poles" aria-label="${t('bfMotors.poles')}"><em class="mono">pcs</em></span>
          <small class="mono">motor_poles</small>
        </label>
      </div>
      <div class="esc-bidir${fieldCls(edit.reversed !== b.reversed)}">
        <div><b>${t('bfMotors.direction')}</b><small class="mono" title="${escapeHtml(t('bfMotors.directionTip'))}">yaw_motors_reversed</small></div>
        <span class="esc-tog" role="group" aria-label="${t('bfMotors.direction')}"><button type="button" data-act="dir-in" class="${edit.reversed ? '' : 'on'}" aria-pressed="${!edit.reversed}">${t('bfMotors.propsIn')}</button><button type="button" data-act="dir-out" class="${edit.reversed ? 'on' : ''}" aria-pressed="${edit.reversed}">${t('bfMotors.propsOut')}</button></span>
      </div>
      <p class="esc-note mono">${t('esc.bidirNote')}</p>
      ${bad.length ? `<p class="bf-motors-err mono" role="alert">${bad.map((k) => t(`bfMotors.err.${k}` as 'bfMotors.err.idle')).join(' · ')}</p>` : ''}
      <div class="bf-motors-bar">
        <pre class="esc-cmds mono">${list.length ? escapeHtml(list.join('\n')) : t('esc.noChanges')}</pre>
        <div class="bf-motors-btns">
          <button type="button" class="btn light" data-act="save" ${list.length === 0 || bad.length || saving ? 'disabled' : ''}>${icon('check', 16)}${reboot ? t('bfMotors.saveReboot') : t('bfMotors.save')}</button>
          <button type="button" class="btn ghost" data-act="revert" ${list.length === 0 || saving ? 'disabled' : ''}>${t('bfMotors.revert')}</button>
          <button type="button" class="btn ghost" data-act="ask">${icon('chip', 16)}${t('bfMotors.askAi')}</button>
        </div>
      </div>`;
  }

  function summary(): string {
    const b = base();
    if (!b) return '';
    const p = protocolById(b.protocol)?.name ?? `#${b.protocol}`;
    return t('bfMotors.aiSummary', { protocol: p, bidir: b.bidir ? 'ON' : 'OFF', idle: b.idle, poles: b.poles, dir: b.reversed ? t('bfMotors.propsOut') : t('bfMotors.propsIn') });
  }

  async function save(): Promise<void> {
    if (!adv || !mot || !mix || !edit || saving) return;
    const list = changes();
    if (!list.length || issues().length) return;
    const reboot = needsReboot();
    opts.stopTest();
    const ok = await ctx.confirm({
      title: t('bfMotors.confirmTitle'),
      confirmText: reboot ? t('bfMotors.saveReboot') : t('bfMotors.save'),
      body: `<p>${t('bfMotors.confirmIntro')}</p><pre class="code">${escapeHtml(list.join('\n'))}</pre>${reboot ? `<p class="save-note">${t('bfMotors.confirmReboot')}</p>` : ''}<p class="warn-note">${t('apply.propsWarn')}</p>`,
    });
    if (!ok) return;
    saving = true;
    paint();
    const b = base()!;
    const writes: MspWrite[] = [];
    if (edit.protocol !== b.protocol || num(edit.idle) !== num(b.idle))
      writes.push({ code: MSPM.SET_ADVANCED_CONFIG, payload: encodeAdvancedConfig(adv, { protocol: edit.protocol, idlePercent: num(edit.idle) }), label: 'SET_ADVANCED_CONFIG' });
    if (edit.bidir !== b.bidir || num(edit.poles) !== num(b.poles))
      writes.push({ code: MSPM.SET_MOTOR_CONFIG, payload: encodeMotorConfig(mot, { poles: num(edit.poles), bidir: edit.bidir }, apiMinor()), label: 'SET_MOTOR_CONFIG' });
    if (edit.reversed !== b.reversed) writes.push({ code: MSPM.SET_MIXER_CONFIG, payload: encodeMixerConfig({ mixer: mix.mixer, reversed: edit.reversed }), label: 'SET_MIXER_CONFIG' });
    const res = await ctx.bf.saveSettings(writes, { reboot, areas: AREA.motors });
    saving = false;
    if (res.ok) ctx.toast(reboot ? t('bfMotors.savedReboot') : t('bfMotors.saved'), 'ok');
    else ctx.toast(t('bfMotors.saveFail', { msg: res.error ?? '' }), 'error');
    if (!disposed && fromStore()) status = 'ready';
    paint();
  }

  function onClick(e: MouseEvent): void {
    const tg = e.target as HTMLElement;
    const proto = tg.closest<HTMLElement>('[data-proto]');
    if (proto && edit) {
      edit.protocol = Number(proto.dataset.proto);
      if (!supportsBidir(edit.protocol)) edit.bidir = false;
      return paint();
    }
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || !edit) return;
    if (act === 'bidir' && supportsBidir(edit.protocol)) {
      edit.bidir = !edit.bidir;
      paint();
    } else if (act === 'dir-in' || act === 'dir-out') {
      edit.reversed = act === 'dir-out';
      opts.onReversed(edit.reversed);
      paint();
    } else if (act === 'revert') {
      edit = base();
      if (edit) opts.onReversed(edit.reversed);
      paint();
    } else if (act === 'save') void save();
    else if (act === 'ask') ctx.askAi(summary());
  }

  function onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const f = el.dataset.f;
    if (!f || !edit) return;
    if (f === 'idle') edit.idle = el.value;
    else if (f === 'poles') edit.poles = el.value;
    // repaint only the bar and the field highlight, keep the caret in the input
    const pos = el.selectionStart;
    const key = f;
    paint();
    const again = q<HTMLInputElement>(`[data-f="${key}"]`);
    if (again) {
      again.focus();
      try {
        if (pos !== null) again.setSelectionRange(pos, pos);
      } catch {
        /* number inputs do not support selection ranges */
      }
    }
  }

  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  const off = ctx.state.subscribe(() => {
    const s = ctx.state.get();
    const r = s.conn === 'connected' ? 1 : 0;
    if (r !== rev) {
      rev = r;
      if (r) void load();
      else paint();
    }
  });
  paint();
  if (ctx.state.get().conn === 'connected') {
    rev = 1;
    void load();
  }

  return {
    destroy() {
      disposed = true;
      off();
      host.removeEventListener('click', onClick);
      host.removeEventListener('input', onInput);
    },
    setReversed(v) {
      if (!edit) return;
      edit.reversed = v;
      paint();
    },
    reversed: () => edit?.reversed ?? false,
    reload: load,
  };
}

