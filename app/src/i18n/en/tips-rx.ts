/** Lightbulb tips (tips.<screen>.<key>): plain-language explanations shown on hover. See docs/TIPS.md. */
export const enTipsRx = {
  receiver: {
    intro:
      'This tab tells the flight controller how to read your radio receiver. With ExpressLRS you only need the protocol (CRSF) and the channel order (AETR). Move each stick and watch the live bars: the right bar must move, from 1000 to 2000. Then save.',
    provider:
      'How the receiver talks to the flight controller. ExpressLRS and Crossfire use **CRSF**; many FrSky and DJI receivers use **SBUS**. The wrong protocol means no channels at all. The receiver also needs a UART with Serial RX switched on in Ports. Changing this needs a reboot.',
    map: 'Order of the first four channels. **AETR** (aileron, elevator, throttle, rudder) is the Betaflight default and what ExpressLRS sends. TAER is the Spektrum order. If the throttle bar moves when you push pitch, this is wrong. With ELRS leave it on AETR.',
    rssiChannel:
      'A channel that carries signal strength to the OSD. With CRSF/ELRS the link quality arrives on its own, so leave this on Disabled. Use it only with SBUS-type receivers that put RSSI on a spare AUX channel.',
    sticks:
      'A centred stick sends 1500, full travel is about 1000 and 2000. These thresholds tell Betaflight when a stick counts as "at the bottom", "centred" or "at the top" (arming and stick commands). The defaults 1050 / 1500 / 1900 are right for almost everyone.',
    minCheck:
      'Below this value a stick counts as fully down. Default 1050. If your throttle at minimum reads higher than that on the bars you cannot arm. Fix the endpoints in the radio before you touch this.',
    midRc:
      'Stick centre, default 1500. If a stick does not rest at 1500, fix the subtrim in the radio. Changing it here shifts every stick.',
    maxCheck:
      'Above this value a stick counts as fully up. Default 1900. Needed for stick commands such as calibration. If full stick shows below 1900, raise the endpoints in the radio, not here.',
    deadband:
      'Area around stick centre (roll and pitch) where tiny movements are ignored. Default 0, right for good gimbals. A few µs can calm a worn gimbal but makes the centre feel numb. Do not use it to hide a bad calibration.',
    yawDeadband:
      'Same as deadband, but for the yaw stick. Default 0. Leave it unless yaw twitches while the stick rests in the centre.',
    smoothMode:
      'RC smoothing softens the steps in your stick signal so motors do not chase every packet. On is the default and what you want. Off passes the raw steps to the PIDs: the quad feels twitchy and motors run warmer.',
    smoothSetpointCutoff:
      'Cutoff (Hz) of the smoothing filter on stick input. **0 = automatic**, based on the link rate. That is right for ELRS. A manual value is only worth it if you know why; lower means softer sticks but more delay.',
    smoothThrottleCutoff: 'Same smoothing for the throttle channel. 0 = automatic. Leave it.',
    smoothFeedforwardCutoff: 'Cutoff (Hz) of the smoothing on feedforward. 0 = automatic, which is right for most setups.',
    smoothAutoFactor:
      'How strong the automatic smoothing is when the cutoff is 0. Default 30. Higher is smoother and slightly slower, lower is sharper. Change it in small steps and compare in flight.',
    smoothAutoFactorThrottle: 'Strength of the automatic smoothing on throttle. Default 30. Leave it unless throttle feels laggy.',
    live: 'Live values from the receiver, 1000 to 2000 µs. Move every stick: the matching bar goes 1000 (low), 1500 (centre), 2000 (high). Wrong bar moves means a wrong channel map. Not reaching 1000 or 2000 means fix the endpoints in the radio. CH5 and up are AUX switches for the Modes tab.',
    link: 'LQ is the share of packets that arrive, RSSI is signal strength in dBm. ELRS sends both on channels 15 and 16, shown only with CRSF. LQ near 100% close to the radio is normal. In flight, watch it fall below about 70%.',
    failsafe:
      'Test failsafe with props off: power the quad, then switch the radio off. The bars should freeze or drop and Betaflight should report failsafe. What the quad does then (drop or GPS rescue) is set in the Failsafe tab. With ELRS the receiver failsafe stays on No Pulses so Betaflight decides.',
  },
  modes: {
    intro:
      'Modes tie a flight function to a switch. Each mode is on while its AUX channel sits inside a range you set. At least set ARM on a switch you will not flip by accident, then add ANGLE if you want self-leveling. Move the switch and watch the marker land in the range.',
    ranges:
      'A mode is active when its AUX channel is inside the range. Pulses: 1000 low, 1500 middle, 2000 high. A 2-position switch gives about 1000 and 2000, a 3-position one also 1500. The white marker shows where the switch is now. AUX1 is channel 5. One mode can have several ranges.',
    logic:
      'Only matters when a mode has several ranges. OR: the mode is on if any range matches. AND: it is on only when this range and the linked mode are both on. Leave it on OR unless you build something special.',
    arm: 'The mode that spins the motors. Without a range here you cannot arm. Use a 2-position switch, on at the high end (1700 to 2100) and away from your other switches. With ELRS, AUX1 is the fastest channel, so ARM belongs there. Test with props off.',
    angle:
      'Self-level: the quad holds its tilt limit and levels itself when you let go of the sticks. Good for the first flights and for backing out of trouble. Needs the accelerometer to be calibrated. Usually on one position of a 3-position switch.',
    horizon:
      'Levels the quad around centre stick but lets you flip at full stick. A step between ANGLE and acro. Most freestyle pilots skip it. Needs a calibrated accelerometer.',
    airmode:
      'Keeps the quad fully controllable at zero throttle, so flips and dives do not go limp. Almost all freestyle quads run it all the time while armed. Assign it to the same range as ARM or to its own switch that stays on.',
    beeper:
      'Makes the buzzer beep so you can find a crashed quad in the grass. Put it on a switch or a spare position. The quad also beeps on its own after failsafe, if a buzzer is wired.',
    turtle:
      '"Flip over after crash": when the quad lies upside down, turn this on while disarmed, arm, and push roll or pitch. The motors spin in reverse and flip it upright. Needs DShot. Switch it off again before flying.',
    prearm:
      'An extra safety. When PREARM is set, ARM only works after you switched PREARM on first. Good if you often arm by accident. Skip it if one arm switch is enough for you.',
    failsafe:
      'This is a switch that triggers failsafe on purpose, a kill switch for testing. It is not the failsafe setup. Leave it empty unless you know why you want it.',
  },
  osd: {
    intro:
      'The OSD is the text and numbers drawn on your video: battery, timer, link quality. Tick what you want to see. Drag the chips on the preview to move them. Set the video system first (PAL, NTSC or HD), then save. Keep it simple: voltage, timer, link quality and warnings are enough.',
    elements:
      'Each element is one item on screen. Tick to show it, drag its chip in the preview to place it. The preview is only a guide, the real font comes from the goggles or the video system. Too many elements hide the picture, 6 to 8 is plenty.',
    profile:
      'Three OSD profiles hold three separate layouts, for example one for goggles and one for a cinematic setup. The dot marks the profile that is active now. You can switch the active one with a switch in Betaflight.',
    video:
      'Match this to your video system. **PAL** and **NTSC** are analog (30 × 16 or 30 × 13 characters). **HD** is for digital systems that draw the OSD over MSP DisplayPort: DJI O3/O4, Walksnail, HDZero. Auto reads the camera. A wrong choice puts elements off screen.',
    units:
      'Metric shows m, km/h, °C. Imperial shows feet, mph, °F. Only changes how values are shown, not what is measured.',
    rssiAlarm:
      'Below this signal strength (percent) the OSD flashes a warning. With ELRS the link quality alarm below is more useful, so this one can stay at the default 20.',
    lqAlarm: 'Link quality (percent) below which the OSD flashes a warning. For ELRS 70 is a reasonable start. Set it too low and you only learn about the problem right before failsafe.',
    capAlarm: 'Battery capacity used (mAh) after which the OSD warns. Set it to about 75% of what the pack gives, for example 1100 on a 1500 mAh 6S. Needs a current sensor.',
    altAlarm: 'Altitude (metres) above which the OSD warns. 0 turns it off. Mostly useful when you fly with a height limit.',
    warnings:
      'Warnings flash in the middle of your picture when something is wrong. Keep the important ones on: arming disabled, low battery, failsafe, RC smoothing. Turn off ones that nag you for no good reason.',
    warnArming: 'Shows why arming is blocked, for example "RXLOSS" or "THROTTLE". Very handy at the field, keep it on.',
    warnBattery: 'Flashes when the pack voltage reaches the warning or critical level set in the Power tab.',
    warnBeeper: 'Shows a flashing box on screen when the beeper switch is on, so you can see in the goggles that it is active.',
    warnCrashFlip: 'Shows when flip over after crash (turtle) is on, so you do not take off with it active.',
    warnEsc: 'Warns when the ESC reports a failure or does not answer. Needs ESC telemetry.',
    warnCoreTemp: 'Warns when the flight controller chip gets hot. On a 5-inch quad this rarely fires.',
    warnSmoothing: 'Warns if the RC smoothing could not settle on the link rate. If it shows up, check the receiver link.',
    warnFailsafe: 'Shows when failsafe is active. If you see this in flight, the link is gone.',
    warnLink: 'Warns when link quality or signal strength falls below the alarm set under General.',
    stats:
      'Stats are shown after you disarm: flight time, minimum battery, maximum current, lowest link quality and so on. Handy to see how the pack coped. Timers 1 and 2 count armed or on time. None of this affects flying.',
    itemBattery: 'Pack voltage. Showing it as per-cell average (next to it) is easier to read: 3.7 V is nearly empty on LiPo, 4.2 V is full.',
    itemMah: 'Capacity used so far. Needs a current sensor, or an estimate from the ESC or battery settings.',
    itemTimer: 'A timer: time since arming, on time or flight time. Good for landing before the battery is flat.',
    itemRssi: 'Signal strength. With ELRS you rather want link quality, which says how many packets arrive.',
    itemLink: 'Link quality in percent. With ExpressLRS this is the number to watch: land if it drops under about 70.',
    itemCrosshair: 'A fixed cross in the centre of the picture. Helps to judge where the camera points.',
    itemWarnings: 'The place where warnings appear. Keep it in the middle of the screen and it will never be missed.',
    itemMode: 'Shows the active flight mode (ACRO, ANGLE, HOR). Useful when you switch modes in flight.',
  },
  elrs: {
    intro:
      'This tab helps you check that your ExpressLRS link is set up properly. Read the receiver version, check that it matches the transmitter module, confirm the binding phrase and region, and verify that signal shows up. The flashing itself happens in the ELRS web flasher.',
    protocol:
      'Protocol between receiver and flight controller. ELRS uses **CRSF** over a UART. If something else shows, the receiver may be set to SBUS or the port is wrong. Fix it in Receiver and Ports.',
    rxVersion: 'The ExpressLRS firmware version running on the receiver, read from the receiver itself. The Betaflight passthrough or CRSF link must work for that.',
    txVersion:
      'The ELRS version of your radio\'s TX module, found in the ELRS Lua script on the radio (or the module screen). Type it here so the app can compare.',
    versionMatch:
      'The **major version** of the TX module and the receiver must match: 3.x with 3.x. Different majors do not bind or link. Same full version, e.g. 3.5.3 on both, is best. Update the older one in the web flasher.',
    rssi: 'Signal strength from telemetry, shown live. Close to the radio it should be high. It tells you the link works, nothing more. For range, look at link quality (LQ) on the Receiver tab.',
    region:
      '2.4 GHz ELRS firmware comes as **FCC** or **LBT** (the EU one, "listen before talk"). Choose the one for your country and use it on both module and receiver. In the EU, take LBT.',
    phrase:
      'The binding phrase makes a transmitter and a receiver find each other. Both must have the same phrase, set when you flash (web flasher) or in the config. A different phrase means no link. Use your own words, not the example.',
    method:
      '**Passthrough** updates the receiver through the flight controller over its UART and needs a working CRSF connection. **WiFi** works when the receiver makes its own network after about a minute without signal; you then upload the firmware from a browser.',
    verify: 'After flashing and binding: power the receiver, turn the radio on and see the link LED stay solid and the numbers move in the Receiver tab. Tick only when it is true.',
    settings:
      'Set in the ELRS Lua script on the radio, not here. **Packet rate**: 250 to 500 Hz suits 5-inch freestyle, lower rates reach further. **Telemetry ratio**: how often data comes back, Std or 1:128 is fine. **Switch mode**: Hybrid is default, ARM goes on AUX1. **Model match**: the radio only talks to the receiver with its model ID. **TX power**: start at 100 mW, raise it only for long range.',
  },
};
