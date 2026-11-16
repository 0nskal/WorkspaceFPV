/**
 * Screen registry: the single place that lists every screen (tab) of the app.
 * To add a tab: create screens/<name>.ts exporting `mount`, add an entry here and its
 * title to i18n/en.ts + pl.ts (tabs.<id>). The tab bar (grouped) and routing read from this array.
 */
import type { ScreenMount } from '../context';
import type { Key } from '../i18n';
import type { IconName } from '../ui/icons';
import * as autotune from './autotune';
import * as bfConfig from './bf-config';
import * as bfFailsafe from './bf-failsafe';
import * as bfPorts from './bf-ports';
import * as bfPower from './bf-power';
import * as bfSetup from './bf-setup';
import * as bfModes from './bf-modes';
import * as bfReceiver from './bf-receiver';
import * as bfTuning from './bf-tuning';
import * as bfBlackbox from './bf-blackbox';
import * as bfCli from './bf-cli';
import * as bfOsd from './bf-osd';
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
  /** Show in the tab bar (default true). Settings lives behind the gear button instead. */
  nav?: boolean;
  /** Tab bar group (Betaflight-like order): overview, flight-controller setup, tuning and logs, tools. */
  group: 'overview' | 'fc' | 'tuning' | 'tools';
}

export const SCREENS: ScreenDef[] = [
  { id: 'warsztat', titleKey: 'tabs.warsztat', icon: 'chip', mount: warsztat.mount, requiresConnection: false, group: 'overview' },
  { id: 'setup', titleKey: 'bfSetup.tab', icon: 'chip', mount: bfSetup.mount, requiresConnection: true, group: 'fc' },
  { id: 'ports', titleKey: 'bfPorts.tab', icon: 'plug', mount: bfPorts.mount, requiresConnection: true, group: 'fc' },
  { id: 'config', titleKey: 'bfConfig.tab', icon: 'sliders', mount: bfConfig.mount, requiresConnection: true, group: 'fc' },
  { id: 'power', titleKey: 'bfPower.tab', icon: 'chart', mount: bfPower.mount, requiresConnection: true, group: 'fc' },
  { id: 'failsafe', titleKey: 'bfFailsafe.tab', icon: 'alert', mount: bfFailsafe.mount, requiresConnection: true, group: 'fc' },
  { id: 'bf-receiver', titleKey: 'bfReceiver.tab', icon: 'radio', mount: bfReceiver.mount, requiresConnection: true, group: 'fc' },
  { id: 'bf-modes', titleKey: 'bfModes.tab', icon: 'panel', mount: bfModes.mount, requiresConnection: true, group: 'fc' },
  { id: 'esc', titleKey: 'tabs.esc', icon: 'plug', mount: esc.mount, requiresConnection: true, group: 'fc' },
  { id: 'osd', titleKey: 'bfOsd.tab', icon: 'panel', mount: bfOsd.mount, requiresConnection: true, group: 'fc' },
  { id: 'bf-tuning', titleKey: 'bfTuning.tab', icon: 'sliders', mount: bfTuning.mount, requiresConnection: true, group: 'tuning' },
  { id: 'blackbox', titleKey: 'bfBlackbox.tab', icon: 'download', mount: bfBlackbox.mount, requiresConnection: true, group: 'tuning' },
  { id: 'autotune', titleKey: 'tabs.autotune', icon: 'sliders', mount: autotune.mount, requiresConnection: false, group: 'tuning' },
  { id: 'elrs', titleKey: 'tabs.elrs', icon: 'radio', mount: elrs.mount, requiresConnection: false, group: 'tools' },
  { id: 'cli', titleKey: 'bfCli.tab', icon: 'play', mount: bfCli.mount, requiresConnection: true, group: 'tools' },
  { id: 'ustawienia', titleKey: 'tabs.ustawienia', icon: 'settings', mount: ustawienia.mount, requiresConnection: false, nav: false, group: 'tools' },
];

export const DEFAULT_SCREEN = SCREENS[0]!.id;

export const findScreen = (id: string): ScreenDef | undefined => SCREENS.find((s) => s.id === id);
