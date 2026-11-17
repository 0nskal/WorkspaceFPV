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
      "**How Autotune works:** you fly one short test flight while the drone records it. The app reads that recording, checks how cleanly the drone follows your sticks, how much it vibrates and how it handles throttle drops, then picks one small, safe change. You press Apply, fly again and see if it got better. One click on Undo brings your old settings back.",
    bDrone:
      "The app reads the battery, motor protocol and firmware from the drone. It cannot see the frame size, so you pick it. The size tells the app where to expect vibrations and which typical parts you have.",
    bBackup:
      "The safety copy is a file with every setting of your drone. Autotune changes only a few of them, but if you do not like the result, **Undo** puts the copy back in one click. It is also downloaded to your computer.",
    bPrepare:
      "For the analysis the drone must record the flight with the right data: gyro, sticks and motors, fast enough. **Prepare logging** changes only these recording settings. PIDs and filters stay as they are.",
    bFly:
      "Fly in an open space, about one minute. Start the timer at take-off and do what the big card says: hover, quick snaps on each axis, a few throttle punches and drops. The app does not control the drone, it only counts the time.",
    bLoad:
      "The flight log is the file the drone recorded. With an SD card it is the newest .BBL file on it. Drop it here and the app analyses it on this computer; nothing is sent anywhere.",
    bLights:
      "Green is fine, amber could be better, red needs work, grey means the log had no data for it. **Flight feel** is how cleanly the drone stops after quick moves. **Vibrations** are motor and frame noise. **Wobble after throttle drops** is propwash.",
    bResult:
      "The app picks one change from everything it found. It keeps the change small when the flight gave little data, and changes nothing when the log is poor; then it says what to fly next time.",
    bApply:
      "Sends the change to the drone after a confirmation window. Before writing, the app saves another backup automatically. The drone restarts and reconnects by itself.",
    bUndo:
      "Restores the safety copy from step 2: every setting goes back to how it was before Autotune. The drone restarts after saving.",
    bCompare:
      "After you fly again with the new settings and load the new log, the app compares the two flights: less bounce, faster response, fewer vibrations and less propwash count as better.",
    parts:
      'Frame and prop size set the frequency bands used for the noise and propwash analysis (scaled from 5": propwash 20-90 Hz, frame 100-250 Hz) and the dynamic idle hint. The rest is context for you and for the AI review.',
    backup:
      "**diff all** of the FC, saved as before-pid-<date>.txt and kept in the app (last 5). Restore re-sends the diff plus the old values of every key Autotune changed, so keys that were at their default come back too.",
    prepare:
      "What the engine needs in the log: setpoint, gyro, motors and RC, **GYRO_SCALED** debug for the unfiltered gyro (filter advice, filter delay), and at least 1.6 kHz logging for the step timing. Each fix is a CLI line applied through the usual confirm, backup and save.",
    flight:
      "The script covers what the engine measures: snaps of several sizes on each axis (step response by stick size), throttle punches (throttle bands, TPA, spectrogram) and drops (propwash). 30-90 s of real moves is the target.",
    drop:
      "A .bbl or .bfl straight from the FC is decoded natively, every flight in it. A Blackbox Explorer CSV works too, but without the header there are no settings, sliders or filters to read, so only raw changes are possible.",
    quality:
      "0-100 from the step windows per axis, stick activity, sample rate, throttle coverage, length and motor saturation. It scales every proposal: under 50 the PID changes shrink a lot or are skipped.",
    headerPid:
      "A Blackbox log stores the PIDs it was flown with. If you changed PIDs after the flight, the FC has other numbers than the log. Suggestions are computed from the log's PIDs, because those produced the flight you see.",
    overview:
      "The same four areas Basic mode shows, with numbers. Use it to decide where to look first: filters before PIDs when the noise is red, a better log before anything when the log is red.",
    needs:
      "What the log is missing and what that costs. For example without GYRO_SCALED there is no unfiltered gyro, so no filter delay and weaker notch / RPM advice. The CLI line sets it up for the next flight.",
    apply:
      "Tick the changes you want; the bar at the bottom merges them into one CLI list (one simplified_tuning apply at the end) and applies it through the normal confirmation, automatic backup and save. Severity says how much it matters, the percentage how well the log supports it.",
    stepResponse:
      "Mean response to the real stick steps found in the log (1.0 = the stick target). A good curve rises fast, peaks 5-10 % above 1.0 and settles inside the shaded ±5 % band within ~100 ms. Split by stick size to see non-linear behaviour, by throttle to check TPA.",
    stepMetrics:
      '**Rise** 10-90 % (5" freestyle: 20-40 ms good, over 80 ms slow). **Delay to 50 %** behind the setpoint. **Overshoot** 5-10 % ideal. **Settle** = last time outside ±2 / ±5 %. **Ringing** = crossings of ±3 % after the peak (3 or more means oscillation). **Bounce-back** after stops points to I-term relax.',
    buckets:
      "Median metrics of the steps in each bucket. More overshoot at high throttle than at low throttle means more TPA. Very different small and large steps point to feedforward or rate limits rather than P/D.",
    spectrum:
      "Throttle-averaged noise per frequency. Peaks labelled **motor** move with throttle (RPM filter territory), **frame** peaks stay put (dynamic notch, hardware). The green dashed line is the noise floor; peaks 12 dB above it are resonances.",
    spectrogram:
      "Frequency across, throttle up, brighter = louder. Motor noise draws diagonal ridges (dashed white) that climb with throttle; frame resonance is a vertical line (amber). Hatched rows had no data at that throttle.",
    peaks:
      "Each peak with its height over the noise floor. Over 6 dB is a peak, over 12 dB a resonance worth fixing. Ridges are the same peaks followed across throttle bins, with their frequency at low and high throttle.",
    filters:
      "What the measured noise needs: RPM harmonics and min Hz from the motor ridges, notch count and range from fixed peaks, filter multipliers from the remaining gyro and D-term noise. Less filtering means less delay; aim for the least filtering that keeps motors cool.",
    filterDelay:
      'Lag between the unfiltered and the filtered gyro (needs GYRO_SCALED). Under 2 ms is fine on a 5" quad; above it the quad feels floaty and propwash grows.',
    propwash:
      "Energy of the roll/pitch tracking error in the propwash band during 400 ms after each throttle chop, divided by the same energy in calm flight. Under 2× is fine, 2-5× moderate, over 5× severe. Needs at least 3 chops.",
    pids:
      "Current values from the log header next to the suggestion. D min / D max follows the firmware's D scheme. Changes are capped at ±25 % per round and scaled by quality and confidence.",
    sliders:
      "When the quad uses simplified tuning (RP or RPY), the same change is expressed as slider moves on the Configurator's 0.05 grid. Prefer this form: Betaflight keeps the sliders in sync. The raw form switches simplified_pids_mode OFF.",
    hot:
      "Tick it if the motors came down hot after the test flight. The engine then never raises D: it lowers P instead and warns about the D-term filters.",
    form:
      "**Sliders** writes simplified_* values and runs simplified_tuning apply. **Raw CLI** writes p_/i_/d_/f_ values and turns the PID sliders off. Filter advice follows the same choice.",
    session:
      "A .bbl can hold several flights (one per arm). The longest usable one is analysed by default; pick another here. The others still feed the series comparison.",
    series:
      "Flights that differ in exactly one slider (or raw gain) are compared: each gets a score from rise, overshoot near 8 %, ringing and settling (feedforward: tracking delay and correlation). Near-ties go to the lower value: cooler motors, more margin.",
    procedure:
      "The usual order of a full tune: filters first, then a P&I sweep with I and FF at 0, then master, restore I, feedforward (acro) and dynamic idle. The highlighted step is the one after the series you just flew.",
    rounds:
      "One row per loaded log in this session. Green cells improved over the previous round, amber got worse. The overlay shows the roll step response of the last rounds.",
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
