## What and why / Co i dlaczego

<!-- What does this change, and why? Link the issue if there is one: Closes #123. English is fine, Polish too. -->

## How to test / Jak sprawdzić

<!-- Steps a reviewer can follow, e.g. "Open Demo mode, go to PID Tuning → Rates, change the rate type". -->

## Screenshots / video / Zrzuty ekranu

<!--
Required when the change is visible in the app or on the website: drag images or a short screen recording here.
Show before AND after when you change something that already exists.
Not a UI change? Write "No UI change".
-->

## Tested on hardware? / Testowane na sprzęcie?

<!--
Anything that talks to a flight controller, ESC or receiver: say what you tested it on
(FC board, Betaflight version, ESC firmware, ELRS version) or write "demo mode only".
-->

## Checklist

- [ ] `npm run build` and `npm test` pass
- [ ] The PR title follows Conventional Commits (`feat: …`, `fix: …`, `docs: …`)
- [ ] UI changes have screenshots or a video above (before and after)
- [ ] New or changed texts exist in both languages (`app/src/i18n/en…` and `pl…`)
- [ ] No new network requests or dependencies, or I explained above where they go and why
- [ ] Nothing is written to the FC without an explicit user action (Save / confirmation)
