/**
 * Radio artwork: a top-down render of a generic gamepad-style radio with an SVG overlay in the same 776x600 space.
 * The rendered stick ends are covered and redrawn so they follow live RC channels (Mode 2: throttle left).
 * Switches are not marked on the picture: which physical switch carries AUX1..AUX4 differs per radio.
 */
import type { Sticks } from '../bf/receiver';
import radioImg from '../assets/img/radio-top.webp';

export const RADIO_W = 776;
export const RADIO_H = 600;
const L = { x: 207, y: 285 };
const R = { x: 569, y: 285 };
const TRAVEL = 44;

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

export function radioArt(label: string): string {
  return `<div class="r-stage">
    <img class="r-img" src="${radioImg}" alt="" width="${RADIO_W}" height="${RADIO_H}" decoding="async" draggable="false" />
    <svg class="r-over" viewBox="0 0 ${RADIO_W} ${RADIO_H}" role="img" aria-label="${label}">${stick(L, 'left')}${stick(R, 'right')}</svg>
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
