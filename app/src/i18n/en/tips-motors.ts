/** Lightbulb tips (tips.<screen>.<key>): plain-language explanations shown on hover. See docs/TIPS.md. */
export const enTipsMotors = {
  motors: {
    intro:
      'Here you set how the flight controller talks to the ESCs and motors: the protocol, bidirectional DShot, motor direction and pole count. You can also spin each motor briefly to check numbering and direction, and read what the ESCs report. Take the props off before you touch the test sliders.',
    protocol:
      'The digital language between flight controller and ESCs. On a 5-inch quad use **DSHOT300** or **DSHOT600**; both are fine with an 8 kHz PID loop, 600 just has more headroom. PWM, Oneshot and Multishot are old analog protocols and only make sense on very old ESCs. If the ESCs do not understand the protocol, the motors will not respond. Needs a reboot.',
    bidir:
      'Bidirectional DShot lets the ESC send motor RPM back over the signal wire. Betaflight uses it for the RPM filter, which removes motor noise very cleanly. It needs ESC firmware that supports it: Bluejay, AM32 or BLHeli_32. Stock BLHeli_S does not. Turn it on for any modern 5-inch build; on unsupported ESCs motors may stutter or not spin. Needs a reboot.',
    idle: 'The throttle the motors keep when the stick is at the bottom while armed, in percent of full range. Too low and motors can stall or desync during hard moves; too high and the quad feels floaty. The default (about 5.5 %) is a good start. With bidirectional DShot Betaflight can use dynamic idle (RPM based) instead, set in the CLI.',
    poles:
      'The number of magnets on the motor bell, not the stator arms. Count them or look up the motor. A 5-inch motor usually has **14**, some tiny motors have 12. Betaflight turns electrical RPM into real RPM with this number, so a wrong value puts the RPM filter notches in the wrong place.',
    direction:
      'Which way the props spin. **Props in** is the Betaflight default: looking from above, the front props spin toward each other at the front and the rear props toward each other at the back. **Props out** is the opposite. This switch only changes the mixer. The motors themselves must really spin that way, so set the direction in the ESC first. If the quad flips on takeoff, direction or numbering is wrong.',
    numbering:
      'Quad X numbering in Betaflight: M1 rear right, M2 front right, M3 rear left, M4 front left. The motor wires must match this, or the quad will not stay level. Use the motor test below to check which prop moves when you slide M1 to M4.',
    telemetry:
      'Live data the ESCs send back: RPM, temperature, voltage, current and the lost-frame percentage. RPM shows up only with bidirectional DShot or an ESC sensor. Values appear when the FC receives valid replies from the ESCs.',
    rpm: 'Motor speed in revolutions per minute, as the ESC measures it. All four motors should be close to each other at the same throttle. One much lower or jumping motor points to a bad motor, bearing, prop or connection.',
    lost: 'Share of DShot telemetry replies that did not arrive or failed the checksum. A few percent is normal. **Err 100 %** means the FC gets no valid telemetry from that ESC at all, and that is what raises the DSHOT_TELEM arming flag. Check that bidirectional DShot is on, the ESC firmware supports it, and the signal wire is fine.',
    temp: 'ESC temperature as the ESC reports it. Up to about 60 degrees on the bench is fine; over 80 to 90 under load is too hot. Check props, motor and filtering if it climbs.',
    testHead:
      'Spins one motor at a time so you can check wiring, numbering and spin direction. Props **must be off**, because motors can spin up suddenly. The sliders stay locked until you confirm that the props are removed. Press STOP or Space at any time; the test also stops if you disconnect or leave the tab.',
    propsOff:
      'This lock is the safety check: the sliders unlock only after you confirm that no props are on the motors. Do not tick it unless it is true.',
    unlock:
      'Normally the sliders stop at 30 % of throttle, which is plenty to see which way a motor spins. Lifting the limit allows 100 %. Only do it with props off and the quad held down or on a bench.',
    mixer:
      'The frame layout Betaflight mixes the motors for. A normal 4-motor quad is **QUAD X**. Change it only for other frames (hexa, tricopter, wing). Needs a reboot.',
    motorStop:
      'With MOTOR_STOP the motors stand still when you arm with zero throttle instead of spinning at idle. Most pilots leave it off: spinning props show that the quad is armed. It does nothing while AIRMODE is on. Needs a reboot.',
    escSensor:
      'Reads telemetry (RPM, temperature, current) from a separate ESC telemetry wire on a UART, as KISS and BLHeli_32 ESCs offer. With bidirectional DShot you usually do not need it. Needs a reboot.',
    dynIdle:
      'Dynamic idle keeps the motors at least at this speed (in hundreds of RPM) when the throttle is low, which helps against desyncs and keeps control in flips and dives. It needs bidirectional DShot. 0 turns it off. For 5-inch props about **30 to 40** (3000 to 4000 RPM) is common.',
    threeD:
      'For reversible (3D) ESCs only: the motors can spin both ways, so the quad can fly upside down. On a normal quad it must stay off, because the throttle centre becomes motor stop. Needs a reboot and ESCs set to 3D.',
    d3: 'In 3D mode the throttle range is split: below **deadband low** the motors spin backwards, above **deadband high** forwards, and **neutral** is the stop point in between. Defaults: 1406, 1514, 1460.',
    liveGraph:
      'Live gyro (rotation in deg/s) or accelerometer (g) of the FC, with voltage, current and used capacity below. Use it with the motor test: a motor that shakes the frame much more than the others shows up as a bigger wave. Data comes from the normal telemetry loop, only while this tab is open.',
    master:
      'Moves all four motors together. Useful to compare RPM of all motors at the same throttle.',
    escInfo: {
      head: 'Reads the settings stored inside each ESC over the signal wire. It is read-only here. The motors do not spin during the read, but take the props off anyway. The result tells you which ESC firmware you have and whether it can do bidirectional DShot.',
      firmware:
        'The software on the ESC. **Bluejay** and **AM32** are open firmware, support bidirectional DShot and are the usual choice now. Stock **BLHeli_S** does not support it, but Bluejay can be flashed onto most BLHeli_S ESCs. **BLHeli_32** is closed and supports it, but is no longer developed.',
      bidirStatus:
        'Whether this ESC firmware can send RPM back. If it says no, flash Bluejay or AM32 before you turn bidirectional DShot on in Betaflight.',
      direction:
        'Which way this motor spins, as set in the ESC. If one motor spins the wrong way, reverse it in the ESC settings instead of swapping wires, then check it with the motor test (props off).',
      pwm: 'The frequency the ESC drives the motor with. Higher is smoother and quieter but warms the ESC a bit more. The default is fine on a 5-inch quad. Change it only if you hear whine or have heat problems.',
      timing:
        'How early the ESC switches the motor phases. The default (medium-high, or about 22 degrees) fits most motors. Too high can heat motor and ESC, too low can cost power. Leave it unless a motor desyncs.',
      startupPower:
        'How much power the ESC gives to get the motor turning from standstill. Too low and the motor may fail to start; too high gives a jerky start and heat. Leave the default unless a motor stutters when arming.',
      brakeOnStop:
        'Brakes the motor the moment the throttle signal hits zero. Keep it off on a multirotor; it is meant for folding props on planes.',
      beacon:
        'The ESC can beep the motors to help you find a lost quad. Strength sets how loud (higher draws more current and warms the motor), delay sets how long after the last signal it starts. It only sounds while the motors are not spinning.',
      tempProtection:
        'When the ESC gets this hot it lowers motor power to protect itself. Do not switch it off just to stop it triggering; find out why the ESC is hot.',
      more: 'Less common ESC settings stored in the firmware. Change them only when you know what they do, and with an ESC configurator, not here.',
    },
  },
};
