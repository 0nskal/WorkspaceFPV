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
  /** 'basic' = shown in both modes, 'expert' = only in expert mode (like Betaflight's expert-only tabs). */
  level: 'basic' | 'expert';
}

export const SCREENS: ScreenDef[] = [
  { id: 'warsztat', titleKey: 'tabs.warsztat', icon: 'home', mount: warsztat.mount, requiresConnection: false, group: 'overview', level: 'basic' },
  { id: 'setup', titleKey: 'bfSetup.tab', icon: 'chip', mount: bfSetup.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'ports', titleKey: 'bfPorts.tab', icon: 'plug', mount: bfPorts.mount, requiresConnection: true, group: 'fc', level: 'expert' },
  { id: 'config', titleKey: 'bfConfig.tab', icon: 'sliders', mount: bfConfig.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'power', titleKey: 'bfPower.tab', icon: 'battery', mount: bfPower.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'failsafe', titleKey: 'bfFailsafe.tab', icon: 'shield', mount: bfFailsafe.mount, requiresConnection: true, group: 'fc', level: 'expert' },
  { id: 'bf-receiver', titleKey: 'bfReceiver.tab', icon: 'radio', mount: bfReceiver.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'bf-modes', titleKey: 'bfModes.tab', icon: 'panel', mount: bfModes.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'esc', titleKey: 'tabs.esc', icon: 'fan', mount: esc.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'osd', titleKey: 'bfOsd.tab', icon: 'monitor', mount: bfOsd.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'bf-tuning', titleKey: 'bfTuning.tab', icon: 'sliders', mount: bfTuning.mount, requiresConnection: true, group: 'tuning', level: 'basic' },
  { id: 'blackbox', titleKey: 'bfBlackbox.tab', icon: 'wave', mount: bfBlackbox.mount, requiresConnection: true, group: 'tuning', level: 'expert' },
  { id: 'autotune', titleKey: 'tabs.autotune', icon: 'target', mount: autotune.mount, requiresConnection: false, group: 'tuning', level: 'basic' },
  { id: 'elrs', titleKey: 'tabs.elrs', icon: 'radio', mount: elrs.mount, requiresConnection: false, group: 'tools', level: 'basic' },
  { id: 'cli', titleKey: 'bfCli.tab', icon: 'terminal', mount: bfCli.mount, requiresConnection: true, group: 'tools', level: 'expert' },
  { id: 'ustawienia', titleKey: 'tabs.ustawienia', icon: 'settings', mount: ustawienia.mount, requiresConnection: false, nav: false, group: 'tools', level: 'basic' },
];

export const DEFAULT_SCREEN = SCREENS[0]!.id;

/** Sidebar sections (Start, Hardware, Flight, Tuning, Tools) and which tab belongs where. */
export type Section = 'start' | 'hardware' | 'flight' | 'tuning' | 'tools';
export const SECTIONS: Section[] = ['start', 'hardware', 'flight', 'tuning', 'tools'];
const SECTION_OF: Record<string, Section> = {
  warsztat: 'start',
  setup: 'start',
  ports: 'hardware',
  config: 'hardware',
  power: 'hardware',
  'bf-receiver': 'hardware',
  esc: 'hardware',
  'bf-modes': 'flight',
  failsafe: 'flight',
  osd: 'flight',
  'bf-tuning': 'tuning',
  blackbox: 'tuning',
  autotune: 'tuning',
  elrs: 'tools',
  cli: 'tools',
};
export const sectionOf = (id: string): Section => SECTION_OF[id] ?? 'tools';

/** Tabs visible in the given interface mode. */
export const screenVisible = (sc: ScreenDef, mode: 'basic' | 'expert'): boolean => mode === 'expert' || sc.level === 'basic';

export const findScreen = (id: string): ScreenDef | undefined => SCREENS.find((s) => s.id === id);
