/**
 * Motors tab, settings column (Betaflight "Model type", "ESC/Motor features" and "3D" panels): mixer, reversed motor
 * direction, protocol, MOTOR_STOP / ESC_SENSOR / 3D features, bidirectional DShot, motor poles, idle, dynamic idle and
 * the 3D deadbands. Everything is read from and written to the FC over MSP as read-modify-write of the raw payloads;
 * nothing is sent until the pilot presses Save (confirm dialog, refused while armed by ctx.bf.saveSettings).
 */
import type { AppContext } from '../context';
import { t, type Key } from '../i18n';
import { MIXERS } from '../bf/decode';
import {
  MSPM,
  MOTOR_FEATURE,
  decodeAdvancedConfig,
  decodeMixerConfig,
  decodeMotor3d,
  decodeMotorConfig,
  encodeAdvancedConfig,
  encodeMixerConfig,
  encodeMotor3d,
  encodeMotorConfig,
  featureOn,
  protocolById,
  setFeature,
  supportsBidir,
  validateMotor3d,
  validateMotorEdit,
  type AdvancedConfig,
  type MixerConfig,
  type Motor3dConfig,
  type MotorConfig,
} from '../bf/motors';
import { AREA, CMD, rawOf, STEP } from '../bf/steps';
import { decodePidAdvanced, encodePidAdvanced } from '../bf/tuning';
import type { MspWrite } from '../bf/store';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { tip, type TipKey } from '../ui/tip';

export interface MotorCfgHosts {
  /** "Model type" panel body (mixer + reversed switch); the quad diagram sits next to it, owned by esc.ts. */
  model: HTMLElement;
  /** "ESC/Motor features" panel body. */
  esc: HTMLElement;
  /** "3D" panel body. */
  d3: HTMLElement;
  /** Save bar (footer). */
  bar: HTMLElement;
}

export interface Recommendation {
  /** Failing ESC checks from the diagnosis (labels). */
  problems: string[];
  protocol: number | null;
  bidir: boolean;
}

export interface MotorCfgHandle {
  destroy(): void;
  reversed(): boolean;
  /** Mixer id being edited (3 = Quad X). */
  mixer(): number;
  /** Re-reads everything from the FC. */
  reload(): Promise<void>;
  /** Repaints the recommendation box (diagnosis changed). */
  refreshRec(): void;
}

interface Edit {
  mixer: number;
  reversed: boolean;
  protocol: number;
  motorStop: boolean;
  escSensor: boolean;
  bidir: boolean;
  threeD: boolean;
  poles: string;
  idle: string;
  dynIdle: string;
  d3low: string;
  d3high: string;
  d3neutral: string;
}

type Key2 = keyof Edit;

const PROTOCOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const K = (k: string) => `bfMotors.${k}` as Key;

export function mountMotorConfig(hosts: MotorCfgHosts, ctx: AppContext, opts: { onReversed: (v: boolean) => void; stopTest: () => void; recommend: () => Recommendation | null }): MotorCfgHandle {
  const apiMinor = () => ctx.bf.get().api || 46;
  let adv: AdvancedConfig | null = null;
  let mot: MotorConfig | null = null;
  let mix: MixerConfig | null = null;
  let features: number | null = null;
  let pidAdvRaw: Uint8Array | null = null;
  let dynIdle: number | null = null;
  let d3: Motor3dConfig | null = null;
  let edit: Edit | null = null;
  let status: 'loading' | 'ready' | 'unsupported' = 'loading';
  let saving = false;
  let disposed = false;
  let rev = 0;

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

  function base(): Edit | null {
    if (!adv || !mot || !mix) return null;
    const fm = features ?? 0;
    return {
      mixer: mix.mixer,
      reversed: mix.reversed,
      protocol: adv.protocol,
      motorStop: featureOn(fm, MOTOR_FEATURE.MOTOR_STOP),
      escSensor: features === null ? mot.escSensor : featureOn(fm, MOTOR_FEATURE.ESC_SENSOR),
      bidir: mot.bidir,
      threeD: featureOn(fm, MOTOR_FEATURE.THREE_D),
      poles: String(mot.poles),
      idle: String(adv.idlePercent),
      dynIdle: dynIdle === null ? '' : String(dynIdle),
      d3low: d3 ? String(d3.low) : '',
      d3high: d3 ? String(d3.high) : '',
      d3neutral: d3 ? String(d3.neutral) : '',
    };
  }

  const NUMERIC: Key2[] = ['poles', 'idle', 'dynIdle', 'd3low', 'd3high', 'd3neutral'];
  function changed(k: Key2): boolean {
    const b = base();
    if (!b || !edit) return false;
    if (NUMERIC.includes(k)) return String(edit[k]).trim() !== '' && num(String(edit[k])) !== num(String(b[k]));
    return edit[k] !== b[k];
  }

  function changes(): string[] {
    const b = base();
    if (!b || !edit) return [];
    const out: string[] = [];
    const pn = (id: number) => protocolById(id)?.name ?? `#${id}`;
    const onOff = (v: boolean) => (v ? t('common.on') : t('common.off'));
    const mn = (id: number) => MIXERS.find(([v]) => v === id)?.[1] ?? `#${id}`;
    if (changed('mixer')) out.push(t(K('chMixer'), { from: mn(b.mixer), to: mn(edit.mixer) }));
    if (changed('reversed')) out.push(t(K('chDirection'), { to: edit.reversed ? t(K('propsOut')) : t(K('propsIn')) }));
    if (changed('protocol')) out.push(t(K('chProtocol'), { from: pn(b.protocol), to: pn(edit.protocol) }));
    if (changed('motorStop')) out.push(`MOTOR_STOP → ${onOff(edit.motorStop)}`);
    if (changed('escSensor')) out.push(`ESC_SENSOR → ${onOff(edit.escSensor)}`);
    if (changed('bidir')) out.push(t(K('chBidir'), { to: onOff(edit.bidir) }));
    if (changed('poles')) out.push(t(K('chPoles'), { from: b.poles, to: edit.poles }));
    if (changed('idle')) out.push(t(K('chIdle'), { from: b.idle, to: edit.idle }));
    if (changed('dynIdle')) out.push(t(K('chDynIdle'), { from: b.dynIdle, to: edit.dynIdle }));
    if (changed('threeD')) out.push(t(K('chThreeD'), { to: onOff(edit.threeD) }));
    if (changed('d3low') || changed('d3high') || changed('d3neutral')) out.push(t(K('ch3d'), { low: edit.d3low, neutral: edit.d3neutral, high: edit.d3high }));
    return out;
  }

  /** Like Betaflight: protocol, bidir, mixer and features need a reboot; the rest applies after the EEPROM write. */
  const needsReboot = (): boolean => (['protocol', 'bidir', 'mixer', 'motorStop', 'escSensor', 'threeD'] as Key2[]).some(changed);

  function issues(): string[] {
    if (!edit) return [];
    const bad: string[] = validateMotorEdit({ idlePercent: num(edit.idle), poles: num(edit.poles), protocol: edit.protocol, bidir: edit.bidir, dynIdle: dynIdle === null ? undefined : num(edit.dynIdle) });
    if (d3 && (changed('d3low') || changed('d3high') || changed('d3neutral')) && !validateMotor3d({ low: num(edit.d3low), high: num(edit.d3high), neutral: num(edit.d3neutral) })) bad.push('d3');
    return bad;
  }

  /** Decodes the payloads the Betaflight store holds; false when a core one is missing. */
  function fromStore(): boolean {
    const d = ctx.bf.get();
    const a = rawOf(d, STEP.advanced);
    const m = rawOf(d, STEP.motor);
    const x = rawOf(d, STEP.mixer);
    if (!a || !m || !x) return false;
    adv = decodeAdvancedConfig(a);
    mot = decodeMotorConfig(m, apiMinor());
    mix = decodeMixerConfig(x);
    features = d.features;
    pidAdvRaw = rawOf(d, STEP.pidAdv);
    const v = pidAdvRaw ? decodePidAdvanced(pidAdvRaw, apiMinor()).values.dynIdleMinRpm : undefined;
    dynIdle = v === undefined ? null : v;
    return true;
  }

  async function read3d(): Promise<void> {
    const p = await ctx.bf.send(MSPM.MOTOR_3D_CONFIG, undefined, 800).catch(() => null);
    d3 = p ? decodeMotor3d(p) : null;
  }

  function reset(): void {
    edit = base();
    if (edit) opts.onReversed(edit.reversed);
  }

  /** Shows the connect-time values at once, then re-reads them (they may have changed in the CLI or another tab). */
  async function load(): Promise<void> {
    if (fromStore()) {
      status = 'ready';
      reset();
    } else status = 'loading';
    paint();
    await ctx.bf.refresh([...AREA.motors, 'features', 'tuning']);
    await read3d();
    if (disposed || saving || changes().length) {
      paint();
      return;
    }
    if (fromStore()) {
      status = 'ready';
      reset();
    } else status = ctx.state.get().conn === 'connected' ? 'unsupported' : 'loading';
    paint();
  }

  /* ---------- rendering ---------- */
  const rowCls = (k: Key2, bad = false) => `bf-row mt-row${changed(k) ? ' chg' : ''}${bad ? ' bad' : ''}`;
  const sw = (k: Key2, label: string, tipKey: TipKey | null, disabled = false) => {
    const v = !!edit![k];
    return `<div class="${rowCls(k)}" data-row="${k}"><div class="bf-ctl"><label class="bf-sw${v ? ' on' : ''}"><input id="mt-${k}" type="checkbox" data-f="${k}" ${v ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i></i></label></div><label class="bf-lbl" for="mt-${k}">${label}</label>${tipKey ? tip(tipKey) : '<span class="bf-tip-gap"></span>'}</div>`;
  };
  const numRow = (k: Key2, label: string, tipKey: TipKey, a: { min: number; max: number; step: number; bad?: boolean; expert?: boolean }) =>
    `<div class="${rowCls(k, a.bad)}" data-row="${k}"${a.expert ? ' data-level="expert"' : ''}><div class="bf-ctl"><input id="mt-${k}" type="number" inputmode="decimal" min="${a.min}" max="${a.max}" step="${a.step}" value="${escapeHtml(String(edit![k]))}" data-f="${k}"></div><label class="bf-lbl" for="mt-${k}">${label}</label>${tip(tipKey)}</div>`;

  function recHtml(): string {
    const r = opts.recommend();
    if (!r || (!r.problems.length && r.protocol === null && !r.bidir)) return '';
    const parts = [r.protocol !== null ? protocolById(r.protocol)?.name ?? '' : '', r.bidir ? t(K('bidirName')) : ''].filter(Boolean);
    const already = !!edit && (r.protocol === null || edit.protocol === r.protocol) && (!r.bidir || edit.bidir);
    return `<div class="mt-rec" role="note">
      <div class="mt-rec-t">${icon('alert', 16)}<b>${escapeHtml(r.problems.join(' · ') || t(K('recTitle')))}</b></div>
      ${parts.length ? `<div class="mt-rec-b"><span>${escapeHtml(t(K('recommended'), { list: parts.join(' + ') }))}</span><button type="button" class="btn amber mt-btn-sm" data-act="rec" ${already ? 'disabled' : ''}>${already ? t(K('recSet')) : t(K('recApply'))}</button></div>` : ''}
    </div>`;
  }

  function paintRec(): void {
    const box = hosts.esc.querySelector('.mt-rec-host');
    if (box) box.innerHTML = recHtml();
  }

  function paint(): void {
    if (disposed) return;
    const s = ctx.state.get();
    if (s.conn !== 'connected' || status !== 'ready' || !edit) {
      const msg = status === 'unsupported' ? t(K('unsupported')) : s.conn !== 'connected' ? t(K('needFc')) : t(K('loading'));
      for (const h of [hosts.model, hosts.esc, hosts.d3]) h.innerHTML = `<p class="mt-msg">${escapeHtml(msg)}</p>`;
      paintBar();
      return;
    }
    const bad = issues();
    const mixOpts = MIXERS.some(([v]) => v === edit!.mixer) ? MIXERS : [...MIXERS, [edit.mixer, `#${edit.mixer}`] as [number, string]];
    hosts.model.innerHTML = `
      <div class="${rowCls('mixer')} mt-row-wide" data-row="mixer"><div class="bf-ctl"><select id="mt-mixer" data-f="mixer" aria-label="${escapeHtml(t(K('mixer')))}">${mixOpts.map(([v, n]) => `<option value="${v}" ${v === edit!.mixer ? 'selected' : ''}>${escapeHtml(n.toUpperCase())}</option>`).join('')}</select></div>${tip('tips.motors.mixer')}</div>
      ${sw('reversed', t(K('reversedLbl')), 'tips.motors.direction')}`;

    const dshot = supportsBidir(edit.protocol);
    const ids = PROTOCOLS.filter((id) => protocolById(id));
    hosts.esc.innerHTML = `
      <div class="mt-rec-host">${recHtml()}</div>
      <div class="${rowCls('protocol')}" data-row="protocol"><div class="bf-ctl"><select id="mt-protocol" data-f="protocol">${ids.map((id) => `<option value="${id}" ${id === edit!.protocol ? 'selected' : ''}>${protocolById(id)!.name}</option>`).join('')}</select></div><label class="bf-lbl" for="mt-protocol">${t(K('protocolLbl'))}</label>${tip('tips.motors.protocol')}</div>
      ${features !== null ? sw('motorStop', t(K('motorStopLbl')), 'tips.motors.motorStop') : ''}
      ${features !== null ? sw('escSensor', t(K('escSensorLbl')), 'tips.motors.escSensor') : ''}
      ${sw('bidir', t(K('bidirLbl')), 'tips.motors.bidir', !dshot)}
      ${numRow('poles', t(K('polesLbl')), 'tips.motors.poles', { min: 4, max: 64, step: 2, bad: bad.includes('poles') })}
      ${numRow('idle', t(K('idleLbl')), 'tips.motors.idle', { min: 0, max: 20, step: 0.25, bad: bad.includes('idle') })}
      ${dynIdle !== null ? numRow('dynIdle', t(K('dynIdleLbl')), 'tips.motors.dynIdle', { min: 0, max: 200, step: 1, bad: bad.includes('dynIdle') }) : ''}
      ${bad.length ? `<p class="mt-err" role="alert">${bad.map((k) => t(K(`err.${k}`))).join(' · ')}</p>` : ''}`;

    hosts.d3.innerHTML = features === null
      ? `<p class="mt-msg">${t(K('unsupported'))}</p>`
      : `${sw('threeD', t(K('threeDLbl')), 'tips.motors.threeD')}
        ${edit.threeD && d3
          ? `${numRow('d3low', t(K('d3low')), 'tips.motors.d3', { min: 1000, max: 1500, step: 1, bad: bad.includes('d3') })}
             ${numRow('d3high', t(K('d3high')), 'tips.motors.d3', { min: 1500, max: 2000, step: 1, bad: bad.includes('d3') })}
             ${numRow('d3neutral', t(K('d3neutral')), 'tips.motors.d3', { min: 1000, max: 2000, step: 1, bad: bad.includes('d3') })}`
          : ''}`;
    paintBar();
  }

  function paintBar(): void {
    const list = status === 'ready' ? changes() : [];
    const bad = issues();
    const reboot = needsReboot();
    const ready = status === 'ready' && ctx.state.get().conn === 'connected';
    const msg = !ready ? '' : list.length ? t(K('pending'), { n: list.length }) : t('esc.noChanges');
    hosts.bar.classList.toggle('dirty', list.length > 0);
    hosts.bar.innerHTML = `
      <span class="bf-save-msg${list.length ? ' mt-dirty' : ''}" title="${escapeHtml(list.join('\n'))}">${escapeHtml(msg)}${list.length ? `<small>${escapeHtml(list.join(' · '))}</small>` : ''}</span>
      <button type="button" class="btn ghost" data-act="ask">${icon('chip', 16)}${t(K('askAi'))}</button>
      <button type="button" class="btn ghost" data-act="revert" ${list.length === 0 || saving ? 'disabled' : ''}>${t(K('revert'))}</button>
      <button type="button" class="btn amber" data-act="save" ${!ready || list.length === 0 || bad.length || saving ? 'disabled' : ''}>${reboot ? t(K('saveReboot')) : t(K('save'))}</button>`;
  }

  /** Repaints only the row highlight and the bar while typing (keeps focus and caret). */
  function softPaint(k: Key2): void {
    const row = hosts.esc.querySelector(`[data-row="${k}"]`) ?? hosts.d3.querySelector(`[data-row="${k}"]`);
    const bad = issues();
    const badKey = k.startsWith('d3') ? 'd3' : k;
    row?.classList.toggle('chg', changed(k));
    row?.classList.toggle('bad', bad.includes(badKey));
    paintBar();
  }

  function summary(): string {
    const b = base();
    if (!b) return '';
    const p = protocolById(b.protocol)?.name ?? `#${b.protocol}`;
    return t(K('aiSummary'), { protocol: p, bidir: b.bidir ? 'ON' : 'OFF', idle: b.idle, poles: b.poles, dir: b.reversed ? t(K('propsOut')) : t(K('propsIn')) });
  }

  async function save(): Promise<void> {
    if (!adv || !mot || !mix || !edit || saving) return;
    const list = changes();
    if (!list.length || issues().length) return;
    const reboot = needsReboot();
    opts.stopTest();
    const ok = await ctx.confirm({
      title: t(K('confirmTitle')),
      confirmText: reboot ? t(K('saveReboot')) : t(K('save')),
      body: `<p>${t(K('confirmIntro'))}</p><pre class="code">${escapeHtml(list.join('\n'))}</pre>${reboot ? `<p class="save-note">${t(K('confirmReboot'))}</p>` : ''}<p class="warn-note">${t('apply.propsWarn')}</p>`,
    });
    if (!ok || !edit) return;
    saving = true;
    paintBar();
    const api = apiMinor();
    const writes: MspWrite[] = [];
    if (changed('protocol') || changed('idle'))
      writes.push({ code: MSPM.SET_ADVANCED_CONFIG, payload: encodeAdvancedConfig(adv, { protocol: edit.protocol, idlePercent: num(edit.idle) }), label: 'SET_ADVANCED_CONFIG' });
    if (changed('bidir') || changed('poles'))
      writes.push({ code: MSPM.SET_MOTOR_CONFIG, payload: encodeMotorConfig(mot, { poles: num(edit.poles), bidir: edit.bidir }, api), label: 'SET_MOTOR_CONFIG' });
    if (changed('mixer') || changed('reversed')) writes.push({ code: MSPM.SET_MIXER_CONFIG, payload: encodeMixerConfig({ mixer: edit.mixer, reversed: edit.reversed }), label: 'SET_MIXER_CONFIG' });
    if (features !== null && (changed('motorStop') || changed('escSensor') || changed('threeD'))) {
      let m = setFeature(features, MOTOR_FEATURE.MOTOR_STOP, edit.motorStop);
      m = setFeature(m, MOTOR_FEATURE.ESC_SENSOR, edit.escSensor);
      m = setFeature(m, MOTOR_FEATURE.THREE_D, edit.threeD);
      const p = new Uint8Array(4);
      new DataView(p.buffer).setUint32(0, m, true);
      writes.push({ code: MSPM.SET_FEATURE_CONFIG, payload: p, label: 'SET_FEATURE_CONFIG' });
    }
    if (pidAdvRaw && dynIdle !== null && changed('dynIdle'))
      writes.push({ code: CMD.SET_PID_ADVANCED, payload: encodePidAdvanced(pidAdvRaw, { dynIdleMinRpm: num(edit.dynIdle) }, api), label: 'SET_PID_ADVANCED' });
    if (d3 && (changed('d3low') || changed('d3high') || changed('d3neutral')))
      writes.push({ code: MSPM.SET_MOTOR_3D_CONFIG, payload: encodeMotor3d({ low: num(edit.d3low), high: num(edit.d3high), neutral: num(edit.d3neutral) }), label: 'SET_3D' });
    const res = await ctx.bf.saveSettings(writes, { reboot, areas: [...AREA.motors, 'features', 'tuning'] });
    saving = false;
    if (res.ok) ctx.toast(reboot ? t(K('savedReboot')) : t(K('saved')), 'ok');
    else ctx.toast(t(K('saveFail'), { msg: res.error ?? '' }), 'error');
    if (disposed) return;
    if (!reboot || res.ok) await read3d();
    if (!disposed && fromStore()) {
      status = 'ready';
      reset();
    }
    paint();
  }

  function setEdit<K extends Key2>(k: K, v: Edit[K]): void {
    if (!edit) return;
    edit[k] = v;
    if (k === 'protocol' && !supportsBidir(edit.protocol)) edit.bidir = false;
    if (k === 'reversed') opts.onReversed(edit.reversed);
  }

  function onClick(e: MouseEvent): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'rec' && edit) {
      const r = opts.recommend();
      if (r?.protocol !== null && r?.protocol !== undefined) setEdit('protocol', r.protocol);
      if (r?.bidir && supportsBidir(edit.protocol)) edit.bidir = true;
      paint();
    } else if (act === 'revert') {
      reset();
      paint();
    } else if (act === 'save') void save();
    else if (act === 'ask') ctx.askAi(summary());
  }

  function onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.f as Key2 | undefined;
    if (!k || !edit) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') setEdit(k, el.checked as never);
    else if (k === 'mixer' || k === 'protocol') setEdit(k, Number(el.value));
    else return; // numbers are handled on input
    paint();
  }

  function onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.f as Key2 | undefined;
    if (!k || !edit || el.type !== 'number') return;
    setEdit(k, el.value as never);
    softPaint(k);
  }

  const roots = [hosts.model, hosts.esc, hosts.d3, hosts.bar];
  for (const r of roots) {
    r.addEventListener('click', onClick);
    r.addEventListener('change', onChange);
    r.addEventListener('input', onInput);
  }
  const off = ctx.state.subscribe(() => {
    const r = ctx.state.get().conn === 'connected' ? 1 : 0;
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
      for (const r of roots) {
        r.removeEventListener('click', onClick);
        r.removeEventListener('change', onChange);
        r.removeEventListener('input', onInput);
      }
    },
    reversed: () => edit?.reversed ?? false,
    mixer: () => edit?.mixer ?? 3,
    reload: load,
    refreshRec: paintRec,
  };
}
