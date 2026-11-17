/** Lightbulb tips (tips.<screen>.<key>): plain-language explanations shown on hover. See docs/TIPS.md. */
export const enTipsCore = {
  warsztat: {
    intro:
      'This is the start screen. Connect the flight controller over USB (or open Demo mode) and WorkspaceFPV reads the Betaflight setup and checks it. The drawing shows your quad and marks the part with a problem. The assistant on the right lists the checks and offers fixes you can apply with one click.',
    connect:
      'Plug the FC into the computer with a USB cable first, with the battery unplugged. Pick its serial port in the dialog that opens. Nothing is changed on the FC while it is only being read.',
    demo: 'A simulated 5-inch quad with an ESC problem. Use it to see how the app works before you plug in a real drone. Nothing here touches hardware.',
    diagnosis:
      'The app compares your settings with common sense rules, for example a motor protocol the ESC does not support or a battery that is too low. The part that fails is marked on the drawing, and the assistant on the right explains it.',
    parts:
      'FC is the flight controller (the board running Betaflight), RX is the radio receiver, ESC drives the motors. The label next to each part shows what the app found on it.',
    battery:
      'The number before **S** is the cell count (4S = four LiPo cells, about 16.8 V full). On USB without a battery you see only the 5 V USB voltage. A healthy cell sits between 3.5 and 4.2 V.',
    receiver:
      'Shows the radio link: a protocol such as ELRS or Crossfire and the signal strength. "No data" means the receiver is not sending anything to the FC. Check the wiring and the Receiver tab.',
    esc: 'The ESC runs the motors with a protocol (DShot300 or DShot600 are common) and its own firmware. "bidir OFF" means bidirectional DShot is off, so RPM filtering cannot work.',
  },
  settings: {
    interface:
      '**Basic** shows only the tabs you need to get a quad flying and explains every setting. **Expert** shows every Betaflight function. You can switch here or with the toggle in the top bar, and nothing is lost either way.',
    aiProviders:
      'The AI assistant needs a model to talk to. You pick one provider and the app sends your questions there. Claude Code and Ollama need no key, Gemini has a free tier, and the Anthropic API is paid per use.',
    claudeCode:
      'The Claude Code command-line tool you may already have installed and logged in to. The app uses it, so no key is stored here. It runs on your Claude subscription and works in the desktop app only.',
    gemini:
      "Google's model. Create a key at aistudio.google.com and paste it here. The free tier is enough for normal use, within daily limits. Your questions and screen pictures go to Google.",
    ollama:
      'Runs a model on your own computer: free and offline, nothing leaves the machine. You install Ollama and download a model first. Small models answer slower and less well than Claude or Gemini.',
    anthropic:
      'The Claude API with your own key from console.anthropic.com. You pay per use, usually a few cents for a long conversation. It works in the browser and in the desktop app, and it can read screen pictures.',
    armDisable:
      'While the FC is connected the app blocks arming, so the motors cannot start by accident when you are testing on the bench. Turn this off only if you know why you need it.',
    autoEscInfo:
      'After connecting, the app reads the ESC firmware and settings through the FC. It is read-only, nothing is written to the ESC. It adds a few seconds to the connection.',
    autoElrsInfo:
      'After connecting, the app reads the version and settings of an ELRS receiver. It is read-only and helps the diagnosis name the exact firmware. Turn it off if the connection feels slow.',
    updates:
      'In the desktop app the version is checked on GitHub. You decide when to download and install. Nothing is installed without your click.',
  },
  drawer: {
    snip: 'Click the scissors, then drag a box around any part of the app. The assistant gets the texts and values inside the box. With the Anthropic API or Gemini in the desktop app it also gets a picture of it. It can answer with **Show** buttons that highlight the exact field.',
    apply:
      '"Apply to FC" first asks you to confirm. Then the app saves a backup (`diff all`), sends the commands, saves them to the FC and reboots it. Nothing is written without your confirmation and never while armed.',
  },
};
