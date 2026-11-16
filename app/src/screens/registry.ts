/**
 * Screen registry: the single place that lists every screen (tab) of the app.
 * To add a tab: create screens/<name>.ts exporting `mount`, add an entry here and its
 * title to i18n/en.ts + pl.ts (tabs.<id>). The top bar and routing read from this array.
 */
import type { ScreenMount } from '../context';
import type { Key } from '../i18n';
import type { IconName } from '../ui/icons';
import * as autotune from './autotune';
import * as elrs from './elrs';
import * as esc from './esc';
import * as ustawienia from './ustawienia';
import * as warsztat from './warsztat';

export interface ScreenDef {
  /** Route id (location.hash). */
  id: string;
  titleKey: Key;
  icon: IconName;
  mount: ScreenMount;
  /** True when the screen is only useful with a connected FC (the tab is dimmed while disconnected). */
  requiresConnection: boolean;
  /** Show in the top tab bar (default true). Settings lives behind the gear button instead. */
  nav?: boolean;
}

export const SCREENS: ScreenDef[] = [
  { id: 'warsztat', titleKey: 'tabs.warsztat', icon: 'chip', mount: warsztat.mount, requiresConnection: false },
  { id: 'esc', titleKey: 'tabs.esc', icon: 'plug', mount: esc.mount, requiresConnection: true },
  { id: 'autotune', titleKey: 'tabs.autotune', icon: 'sliders', mount: autotune.mount, requiresConnection: false },
  { id: 'elrs', titleKey: 'tabs.elrs', icon: 'radio', mount: elrs.mount, requiresConnection: false },
  { id: 'ustawienia', titleKey: 'tabs.ustawienia', icon: 'settings', mount: ustawienia.mount, requiresConnection: false, nav: false },
];

export const DEFAULT_SCREEN = SCREENS[0]!.id;

export const findScreen = (id: string): ScreenDef | undefined => SCREENS.find((s) => s.id === id);
