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
import * as bfSensors from './bf-sensors';
import * as bfGps from './bf-gps';
import * as bfTuning from './bf-tuning';
import * as bfBlackbox from './bf-blackbox';
import * as bfCli from './bf-cli';
import * as bfOsd from './bf-osd';
import * as elrs from './elrs';
import * as esc from './esc';
import * as ustawienia from './ustawienia';
import * as warsztat from './warsztat';
import * as radio from './radio';

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
  /** Beginner nav item (the short list shown in both modes) and its short label. */
  simple?: Key;
  /** Drawn with the new light/dark design layer (ui/theme.css); others render in the legacy dark panel. */
  modern?: boolean;
}

export const SCREENS: ScreenDef[] = [
  { id: 'warsztat', titleKey: 'simple.nav.drone', icon: 'drone', mount: warsztat.mount, requiresConnection: false, group: 'overview', level: 'basic', simple: 'simple.nav.drone', modern: true },
  { id: 'radio', titleKey: 'simple.nav.radio', icon: 'gamepad', mount: radio.mount, requiresConnection: true, group: 'overview', level: 'basic', simple: 'simple.nav.radio', modern: true },
  { id: 'setup', titleKey: 'bfSetup.tab', icon: 'chip', mount: bfSetup.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'ports', titleKey: 'bfPorts.tab', icon: 'plug', mount: bfPorts.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'config', titleKey: 'bfConfig.tab', icon: 'sliders', mount: bfConfig.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'power', titleKey: 'bfPower.tab', icon: 'battery', mount: bfPower.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'bf-receiver', titleKey: 'bfReceiver.tab', icon: 'radio', mount: bfReceiver.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'esc', titleKey: 'tabs.esc', icon: 'fan', mount: esc.mount, requiresConnection: true, group: 'fc', level: 'basic', simple: 'simple.nav.motors' },
  { id: 'sensors', titleKey: 'sensors.tab', icon: 'gauge', mount: bfSensors.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'failsafe', titleKey: 'bfFailsafe.tab', icon: 'shield', mount: bfFailsafe.mount, requiresConnection: true, group: 'fc', level: 'expert' },
  { id: 'gps', titleKey: 'gps.tab', icon: 'pin', mount: bfGps.mount, requiresConnection: true, group: 'fc', level: 'expert' },
  { id: 'elrs', titleKey: 'tabs.elrs', icon: 'radio', mount: elrs.mount, requiresConnection: false, group: 'tools', level: 'basic' },
  { id: 'bf-modes', titleKey: 'bfModes.tab', icon: 'panel', mount: bfModes.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'osd', titleKey: 'bfOsd.tab', icon: 'monitor', mount: bfOsd.mount, requiresConnection: true, group: 'fc', level: 'basic' },
  { id: 'bf-tuning', titleKey: 'bfTuning.tab', icon: 'sliders', mount: bfTuning.mount, requiresConnection: true, group: 'tuning', level: 'basic' },
  { id: 'blackbox', titleKey: 'bfBlackbox.tab', icon: 'wave', mount: bfBlackbox.mount, requiresConnection: true, group: 'tuning', level: 'expert' },
  { id: 'autotune', titleKey: 'tabs.autotune', icon: 'target', mount: autotune.mount, requiresConnection: false, group: 'tuning', level: 'expert' },
  { id: 'cli', titleKey: 'bfCli.tab', icon: 'terminal', mount: bfCli.mount, requiresConnection: true, group: 'tools', level: 'expert' },
  { id: 'ustawienia', titleKey: 'tabs.ustawienia', icon: 'settings', mount: ustawienia.mount, requiresConnection: false, nav: false, group: 'tools', level: 'basic' },
];

export const DEFAULT_SCREEN = SCREENS[0]!.id;

/** Sidebar sections (Start, Hardware, Tuning; Tools holds external links) and which tab belongs where. */
export type Section = 'start' | 'hardware' | 'tuning' | 'tools';
export const SECTIONS: Section[] = ['start', 'hardware', 'tuning', 'tools'];
const SECTION_OF: Record<string, Section> = {
  warsztat: 'start',
  setup: 'start',
  ports: 'hardware',
  config: 'hardware',
  power: 'hardware',
  'bf-receiver': 'hardware',
  esc: 'hardware',
  sensors: 'hardware',
  failsafe: 'hardware',
  gps: 'hardware',
  elrs: 'hardware',
  'bf-tuning': 'tuning',
  'bf-modes': 'tuning',
  osd: 'tuning',
  blackbox: 'tuning',
  autotune: 'tuning',
  cli: 'tuning',
};
export const sectionOf = (id: string): Section => SECTION_OF[id] ?? 'tools';

/** Tools: links to the official configurators and USB driver utilities (open in the system browser). */
export interface ToolLink {
  id: string;
  labelKey: Key;
  url: string;
}
export const TOOL_LINKS: ToolLink[] = [
  { id: 'betaflight', labelKey: 'nav.links.betaflight', url: 'https://app.betaflight.com/' },
  { id: 'elrs', labelKey: 'nav.links.elrs', url: 'https://github.com/ExpressLRS/ExpressLRS-Configurator/releases' },
  { id: 'esc', labelKey: 'nav.links.esc', url: 'https://esc-configurator.com/' },
  { id: 'dji', labelKey: 'nav.links.dji', url: 'https://www.dji.com/pl/downloads/softwares/dji-assistant-2-consumer-drones-series' },
  { id: 'cp210x', labelKey: 'nav.links.cp210x', url: 'https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers' },
  { id: 'zadig', labelKey: 'nav.links.zadig', url: 'https://zadig.akeo.ie/' },
  { id: 'impulserc', labelKey: 'nav.links.impulserc', url: 'https://github.com/ImpulseRC/ImpulseRC_Driver_Fixer' },
];

/** Tabs visible in the given interface mode. */
export const screenVisible = (sc: ScreenDef, mode: 'basic' | 'expert'): boolean => mode === 'expert' || sc.level === 'basic';

export const findScreen = (id: string): ScreenDef | undefined => SCREENS.find((s) => s.id === id);
