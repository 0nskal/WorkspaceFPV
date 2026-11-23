/**
 * Radio artwork: a top-down render of a generic gamepad-style radio with an SVG overlay in the same 776x600 space.
 * The rendered stick ends are covered and redrawn so they follow live RC channels (Mode 2: throttle left).
 * Every switch, knob and side slider on the render is a hotspot: the Radio screen lets the pilot click one, flip it
 * on the real radio and remembers which AUX channel moved (radios differ, so nothing is assumed).
 */
import type { Sticks } from '../bf/receiver';
import radioImg from '../assets/img/radio-top.webp';

export const RADIO_W = 776;
export const RADIO_H = 600;
const L = { x: 207, y: 285 };
const R = { x: 569, y: 285 };
const TRAVEL = 44;

/** Controls on the render. dy = where the AUX tag sits relative to the control. */
export const CONTROLS: Array<{ id: string; x: number; y: number; r: number; dy: number }> = [
  { id: 'sw-l-back-out', x: 130, y: 100, r: 17, dy: -30 },
  { id: 'sw-l-back-in', x: 186, y: 68, r: 17, dy: -30 },
  { id: 'sw-l-front-out', x: 160, y: 155, r: 17, dy: 32 },
  { id: 'sw-l-front-in', x: 214, y: 143, r: 17, dy: 32 },
  { id: 'sw-r-front-in', x: 560, y: 145, r: 17, dy: 32 },
  { id: 'sw-r-front-out', x: 612, y: 155, r: 17, dy: 32 },
  { id: 'sw-r-back-in', x: 588, y: 68, r: 17, dy: -30 },
  { id: 'sw-r-back-out', x: 638, y: 100, r: 17, dy: -30 },
  { id: 'pot-l', x: 316, y: 368, r: 26, dy: 40 },
  { id: 'pot-r', x: 460, y: 368, r: 26, dy: 40 },
  { id: 'slider-l', x: 205, y: 390, r: 24, dy: 30 },
  { id: 'slider-r', x: 568, y: 390, r: 24, dy: 30 },
];

function stick(c: { x: number; y: number }, id: string): string {
  return `<circle class="r-cover" cx="${c.x - 7}" cy="${c.y - 10}" r="30"/>
    <path class="r-gate" d="M${c.x - 54} ${c.y} H${c.x + 54} M${c.x} ${c.y - 54} V${c.y + 54}"/>
    <g data-stick="${id}" transform="translate(${c.x} ${c.y})">
      <circle class="r-trail" r="24"/>
      <circle class="r-end" r="17"/>
      ${Array.from({ length: 14 }, (_, k) => `<path class="r-knurl" d="M0 -17 V-12.5" transform="rotate(${(k * 360) / 14})"/>`).join('')}
      <circle class="r-end-top" r="7.5"/>
    </g>`;
}

function control(c: (typeof CONTROLS)[number], aria: string): string {
  return `<g class="r-ctl" data-ctl="${c.id}" transform="translate(${c.x} ${c.y})" role="button" tabindex="0" aria-label="${aria}">
    <circle class="r-hit" r="${c.r + 8}"/>
    <circle class="r-ring" r="${c.r}"/>
    <g class="r-tag" transform="translate(0 ${c.dy})"><rect x="-46" y="-15" width="92" height="30" rx="15"/><text text-anchor="middle" y="5.5"></text></g>
  </g>`;
}

export function radioArt(label: string, controlAria?: string): string {
  const ctls = controlAria ? CONTROLS.map((c) => control(c, controlAria)).join('') : '';
  return `<div class="r-stage">
    <img class="r-img" src="${radioImg}" alt="" width="${RADIO_W}" height="${RADIO_H}" decoding="async" draggable="false" />
    <svg class="r-over" viewBox="0 0 ${RADIO_W} ${RADIO_H}" role="group" aria-label="${label}">${stick(L, 'left')}${stick(R, 'right')}${ctls}</svg>
  </div>`;
}

/** Moves the stick ends. */
export function updateRadio(root: Element, s: Sticks | null): void {
  const move = (id: string, c: { x: number; y: number }, x: number, y: number) => {
    root.querySelector(`[data-stick="${id}"]`)?.setAttribute('transform', `translate(${(c.x + x * TRAVEL).toFixed(1)} ${(c.y - y * TRAVEL).toFixed(1)})`);
  };
  if (s) {
    move('left', L, s.yaw, s.throttle * 2 - 1);
    move('right', R, s.roll, s.pitch);
  }
}

export interface ControlView {
  /** Tag text, e.g. "AUX1 · ARM"; empty = no tag. */
  text: string;
  /** Mapped channel sits inside a mode range ('arm' when it is the arm range). */
  state: '' | 'on' | 'arm';
}

/** Draws the tags and live states of the mapped controls; `learning` pulses one control. */
export function setControls(root: Element, views: Record<string, ControlView>, learning: string | null): void {
  root.querySelectorAll<SVGGElement>('[data-ctl]').forEach((g) => {
    const v = views[g.dataset.ctl ?? ''];
    const tag = g.querySelector<SVGGElement>('.r-tag');
    const txt = g.querySelector('text');
    const rect = g.querySelector('rect');
    g.classList.toggle('mapped', !!v?.text);
    g.classList.toggle('on', v?.state === 'on');
    g.classList.toggle('arm', v?.state === 'arm');
    g.classList.toggle('learning', learning === g.dataset.ctl);
    if (!tag || !txt || !rect) return;
    const text = v?.text ?? '';
    if (txt.textContent !== text) {
      txt.textContent = text;
      // pill width follows the text (12 px semibold ~ 7 px per character)
      const w = Math.max(56, text.length * 8.6 + 24);
      rect.setAttribute('x', String(-w / 2));
      rect.setAttribute('width', String(w));
    }
  });
}
