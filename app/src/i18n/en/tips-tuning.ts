/** Lightbulb tips (tips.<screen>.<key>): plain-language explanations shown on hover. See docs/TIPS.md. */
export const enTipsTuning = {
  tuning: {
    intro:
      "This is where the flight feel is set: PIDs (how hard the flight controller corrects), rates (how fast the quad turns for a given stick move) and filters. A fresh Betaflight build already flies. Change one thing at a time, fly, and note what you changed. If you are unsure, leave the PIDs alone and only play with rates.",
    pidTable:
      "One row per axis. P, I and D are the three terms of the controller that holds the quad where the sticks say. The defaults fly most 5-inch quads, so start from them and move values in small steps.",
    p: "**P** pulls the quad toward the stick position. Too low feels mushy and the quad drifts after a move. Too high gives a fast shake right after you stop the stick. On a 5-inch quad change it by 5 to 10 at a time.",
    i: "**I** holds the angle against slow forces like wind, uneven weight or a weaker motor. Too low and the quad slowly wanders or sags on punch-outs. Too high gives slow wobbles, mostly at low throttle.",
    d: "**D** brakes the quad when it moves too fast, so it damps overshoot and propwash. Too low and the quad bounces past the target after flips. Too high makes motors hot and adds noise. After raising D, check motor temperature following a short flight.",
    dMax: "**D max** is the D value used when the quad moves fast or the gyro shows propwash. At rest the quad runs the lower base D, so motors stay cooler. Keep it above D. Raising it helps propwash and heats the motors only while it is active.",
    ff: "**Feedforward (F)** reacts to how fast you move the stick, not to the error. Higher F makes the quad follow stick moves sharper, with less delay. Too high gives overshoot at the start of a flip and a twitchy feel with a noisy receiver link. Lower F feels softer and floatier.",
    profilePid:
      "A PID profile is a full set of PIDs and related settings stored on the quad. You can keep several (for example one tune per battery or prop) and switch between them with a switch or in the OSD. Switching here changes the profile you are viewing and editing.",
    profileRate:
      "A rate profile is a separate set of rates, which means how fast the quad turns. Use it for different flying styles or for a friend who flies other rates. It does not change PIDs or filters.",
    ratesType:
      "The formula that turns stick position into turn speed. **Betaflight** is the classic one with RC rate, super rate and expo. **Actual** and **Quick** use degrees per second directly (center sensitivity and max rate), which is easier to reason about. The same numbers feel different after a type change, so check the curve.",
    rcRate:
      "**RC rate** sets how fast the quad turns near the center of the stick. Higher means twitchier small corrections. Beginners are usually happier with a lower value.",
    rateCenter:
      "**Center sensitivity** is the turn speed in degrees per second near the center of the stick. Low values make small corrections gentle, which helps for filming and learning. On 5-inch freestyle it is often 100 to 200 deg/s.",
    superRate:
      "**Super rate** adds turn speed toward the end of the stick travel. Higher gives faster flips at full stick, but makes the whole range more sensitive. Judge it by the curve and the max values in the legend, not by the number.",
    maxRate:
      "**Max rate** is the turn speed at full stick in degrees per second. 360 deg/s is one full flip per second. Beginners often start around 400 to 600 deg/s, freestyle pilots tend to end up between 700 and 900.",
    expo:
      "**Expo** softens the middle of the stick and keeps the full-stick speed. Higher expo gives finer control near the center and a steeper curve at the ends. Too much and the quad feels dead at center, then sudden at the edge.",
    ratesCurve:
      "Turn speed (up) against stick position (right) for each axis. A flatter middle means calmer small moves. The legend shows the real max speed of each axis in degrees per second.",
    thrMid:
      "**Throttle mid** is the stick position that gives half of the throttle range. Move it so that the hover point sits near the stick center. Leave 0.5 if you have no reason to change it.",
    thrExpo:
      "**Throttle expo** softens throttle response around the mid point. A little makes hovering and careful low-throttle moves easier. Too much leaves the top of the stick doing very little. 0 is linear.",
    tpa: "**TPA** (throttle PID attenuation) lowers the gains at high throttle, to stop oscillations that show up only at full power. The rate is how much it lowers them. If the quad shakes at high throttle, raise the rate a little. The default mode lowers D only.",
    tpaBreakpoint:
      "The throttle value in microseconds where TPA starts to lower the gains. Raise it to start TPA later. Lower it if oscillations already start at mid throttle.",
    itermRelax:
      "**I-term relax** stops I from building up during quick stick moves. Without it, fast flips leave a bounce-back at the end. The default is right for almost everyone. Turn it off only if you know why.",
    itermRelaxCutoff:
      "The lower this cutoff, the more I-term relax acts. A higher value lets I wind up more during moves. The default is fine for 5-inch freestyle.",
    antiGravity:
      "**Anti-gravity** boosts I for a moment when you punch the throttle, so the nose does not dip on fast throttle changes. Too low gives a dip on punch-outs, too high a wobble when you chop throttle. The default is a good start.",
    dynDamping:
      "**Dynamic damping** controls how strongly D rises from its base value toward D max during fast moves or propwash. Gain is how quickly it reacts, advance lets it start earlier based on stick movement. Leave the defaults unless you chase propwash.",
    throttleBoost:
      "**Throttle boost** adds a little extra push when the throttle moves quickly, so the quad reacts faster. Too high makes throttle changes twitchy. It is polish, not a fix.",
    vbatSag:
      "**Vbat sag compensation** raises motor output as the battery sags, so the quad feels the same on a full pack and on a tired one. It only works with a correct battery voltage reading, so check that first. Higher means more compensation.",
    thrustLin:
      "**Thrust linearization** evens out how motor thrust follows throttle, since thrust rises faster at low throttle than at high. It helps keep the PIDs consistent across the throttle range. Too much makes low throttle jumpy.",
    filtersIntro:
      "Filters remove motor noise from the gyro signal before the PIDs use it. Too much filtering adds delay, so the quad feels floaty and propwash shows up. Too little lets noise through, and the motors run hot and can buzz. The defaults with RPM filter are a good start.",
    gyroLpf1:
      "**Gyro low-pass filter 1** smooths the gyro signal. A higher cutoff means less delay and more noise, a lower one the opposite. In dynamic mode the cutoff moves with throttle between a min and a max value. Raise it a little on a clean build, lower it on a noisy one.",
    dynLpf:
      "In dynamic mode the cutoff follows the throttle between the min and max value, low throttle gets the low one. Higher values mean less delay and more noise. Change in small steps and check motor temperature.",
    gyroLpf2:
      "**Gyro low-pass filter 2** is a second filter that runs after the first. Turning it down adds delay. Leave it unless the motors run hot even with the other filters in place.",
    dtermLpf:
      "**D-term low-pass filters** smooth only the D term, the part most sensitive to noise. Lower cutoffs mean cooler motors and quieter D, but weaker damping of fast moves (more propwash). If motors are hot, look here before touching P or I.",
    dynNotch:
      "The **dynamic notch** finds the strongest noise peaks in the gyro signal, usually the motor tone, and cuts them out. Count is how many peaks it follows (3 is typical). A higher Q means a narrower notch, less delay and less noise removed. Set the min and max range to cover your motor noise.",
    rpmFilter:
      "The **RPM filter** removes noise exactly at motor speed and its harmonics. It needs bidirectional DShot and ESC firmware that supports it (BLHeli_32, Bluejay, AM32). With it working you can filter less elsewhere, which means less delay. 3 harmonics is the usual setting.",
    rpmMin:
      "The lowest motor frequency the RPM filter tracks. Below it the filter is off. The default of 100 Hz suits most 5-inch builds.",
  },
  blackbox: {
    intro:
      "Blackbox records what the flight controller measures during a flight: gyro, motor output, stick input. The logs show noise, propwash and tuning problems. Beginners can skip it for now. To log, pick a device, fly with logging on, then download the log here.",
    device:
      "Where the log is stored. **Onboard flash** is a chip on the flight controller, small (usually 2 to 16 MB). An **SD card** holds much more. **None** turns logging off. Not every board has flash or an SD slot, and unavailable choices are greyed out.",
    rate: "How often a log frame is saved, as a fraction of the PID loop. A higher rate gives more detail but fills the memory sooner. The list shows the resulting kHz. For most tuning 1 to 2 kHz is plenty.",
    debug:
      "Debug mode adds extra internal values to the log for one purpose. **Gyro scaled** is the usual choice for noise analysis, the others are mostly for developers. Leave it alone unless a guide names the one to use.",
    flash:
      "How much of the onboard memory the logs use. When it is full, logging stops, so erase old logs before a flight you want to record.",
    download:
      "Reads the log from the flight controller over USB and saves it as a .bbl file. A big log takes a while. You can open the file in Blackbox Explorer or send it to the Autotune tab here.",
    erase:
      "Deletes **all** logs on the onboard flash. This cannot be undone, so download first if you want to keep the log. Big chips take a while to erase.",
    msc: "Restarts the flight controller as a USB drive, so you can copy logs from the SD card or flash on boards that support it. Betaflight does not run in this mode. Replug the USB cable to go back to normal.",
  },
  autotune: {
    intro:
      "Autotune reads a Blackbox log, checks how the quad followed your stick moves and suggests small PID changes. It does not tune in flight. You fly, download the log, drop it here and decide whether to apply the suggestion. It works best with a log that has a few sharp stick moves, like rolls and flips.",
    drop: "Use a Blackbox log as .csv, .bbl or .bfl. It must contain gyro and setpoint (stick) data and some real stick movement. A hover-only log does not give enough to analyse.",
    stepResponse:
      "The step response shows how fast and how cleanly the quad follows a sudden stick move. A good curve rises quickly and settles at 100 percent. A curve well above 100 percent is overshoot, so D is probably too low. A slow curve means P or F is low.",
    overshoot:
      "**Overshoot** is how far past the target the quad goes after a sudden move, in percent. Under about 10 percent is fine for freestyle. Higher values point to more D or less P.",
    riseSettle:
      "**Rise** is the time to reach the target, **settle** the time until the response stays near it. Shorter rise means a sharper quad. A very long or missing settle time means the quad keeps wobbling after the move.",
    spectrum:
      "How strong the gyro noise is at each frequency. Sharp peaks are usually motor noise or frame vibration. Noise at a peak heats the motors and limits how much D you can use.",
    motorPeak:
      "The strongest noise peak that looks like it comes from the motors. A big peak means motor noise is a problem: check props, bearings, loose screws and the filters. With a working RPM filter this peak should be small.",
    bidir:
      "Whether bidirectional DShot, which the RPM filter needs, is on. With it on, the tuner allows a bigger D increase, because motor noise is filtered more precisely.",
    table:
      "Current PIDs next to the values suggested from the log. The changes are small on purpose, so apply them, fly and repeat if needed. FF is shown only as an arrow, because the tuner says to raise it but not by how much.",
    apply:
      "Writes the suggested values to the flight controller as CLI commands after you confirm in a dialog, and the quad reboots. Check that the changes make sense for how you fly, and make a short test flight afterwards.",
  },
  cli: {
    intro:
      "The CLI is Betaflight's text console. Everything the other tabs set, plus settings that have no tab, can be changed here with commands. A beginner does not need it. If you use it, take a backup first (see the tip on diff all) and do not run commands you do not understand.",
    warn:
      "CLI commands can change or erase your whole setup. **defaults** wipes every setting, **save** writes changes and reboots the quad, and some commands (**resource**, **flash_erase**) can leave the quad unusable. If you did not write a command yourself, look up what it does first.",
    backup:
      "**diff all** lists every setting that differs from the defaults, for all profiles. Save it to a file before you change anything and after a tune that works. To restore, paste the file back and run **save**.",
    dump: "Reads **dump all**, the full list of every setting. It is long and mostly defaults. Use it for a complete record or when someone asks for it. For a backup, **diff all** is better.",
    save: "Adds **save** after your commands: the flight controller stores the settings and reboots. A **diff all** backup is downloaded first. Without it the session ends with **exit** and nothing is saved.",
    names:
      "Reads the list of setting names from the flight controller, so Tab completion works while you type commands.",
  },
};
