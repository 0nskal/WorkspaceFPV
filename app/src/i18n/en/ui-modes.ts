/** Interface modes (Basic / Expert), lightbulb tips and the "point at a part of the app" snip for the AI. */
export const enMode = {
  label: 'Interface',
  basic: 'Basic',
  expert: 'Expert',
  basicTitle: 'Basic: fewer tabs, every setting explained',
  expertTitle: 'Expert: every Betaflight function',
  chooseTitle: 'How much do you know about FPV?',
  chooseLead: 'You can switch any time with the Basic / Expert toggle in the top bar.',
  basicCard: 'I am starting out',
  basicCardText: 'Only the tabs you need to get a quad flying. Next to every setting there is a lightbulb: hover over it and it tells you what the setting does and what to set. The AI answers in plain words.',
  expertCard: 'I know Betaflight',
  expertCardText: 'Every tab and every option, like Betaflight Configurator in Expert Mode: ports, failsafe, blackbox, filters, CLI. Tips stay available but stay out of the way.',
  toBasic: 'Basic mode. Expert tabs are hidden.',
  toExpert: 'Expert mode. All tabs are visible.',
  expertOnly: 'This tab is only in Expert mode.',
  expertOnlyAction: 'Switch to Expert',
  tipDiag: 'Diagnosis',
  tipParts: 'Parts',
  tipBattery: 'Battery',
  tipReceiver: 'Receiver',
  tipEsc: 'ESC',
};

export const enTipsUi = {
  aria: 'Tip',
  setting: 'Lightbulb tips in Expert mode',
  settingHint: 'In Basic mode the tips are always on.',
};

export const enSnip = {
  button: 'Point at a part of the app',
  hint: 'Drag a box around what you want to ask about. Esc cancels.',
  attached: 'Screen fragment: {screen}, {n} elements',
  detach: 'Remove the fragment',
  question: 'Explain what I selected and tell me what to do here.',
  show: 'Show',
  gone: 'That element is not on screen any more.',
  noImage: 'Without a picture: this provider gets the selected texts and values.',
  tooSmall: 'Drag a bigger box.',
};
