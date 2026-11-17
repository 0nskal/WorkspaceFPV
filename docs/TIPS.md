# Basic / Expert mode and lightbulb tips

WorkspaceFPV has two interface modes, switched in the top bar (and chosen once on first start):

- **Basic**: for people new to FPV. Only the tabs needed to get a quad flying, a short "what is this tab for" note at the top of each screen, a lightbulb next to every setting, and the AI explains in plain words.
- **Expert**: every tab and option, like Betaflight Configurator in Expert Mode. Tips stay available (Settings can switch them off).

## Hiding things

| Markup | Effect |
| --- | --- |
| `level: 'expert'` on a screen in `screens/registry.ts` | the tab is only in Expert mode |
| `data-level="expert"` on any element | hidden in Basic mode (advanced fields, raw values, filters…) |
| `data-only="basic"` on any element | hidden in Expert mode (beginner explanations) |

Hide whole blocks or rows, not single inputs inside a row. Never hide a safety warning, the Save bar or a value that a visible control depends on.

## Tips

```ts
import { intro, tip } from '../ui/tip';

el.innerHTML = `${intro('tips.setup.intro')}
  <label>${t('bfSetup.craftName')} ${tip('tips.setup.craftName')}</label>`;
```

- `tip(key, label?)` returns a small bulb button. Hover or focus lights it up and opens a bubble with the text; click pins it (touch screens). One delegated controller (`initTips`) serves the whole page.
- `intro(key)` returns the "what is this tab for" block (Basic mode only).
- Texts live in `app/src/i18n/en/tips-<group>.ts` and `pl/tips-<group>.ts` as `{ <screen>: { intro: '…', <key>: '…' } }`. English is the source; the Polish file must have the same keys (TypeScript checks it). `**bold**` and `\n` work inside a tip.

### How to write a tip

Say what the setting does, what happens when it is wrong, and what to set, in two to four short sentences. Write for someone who has built one quad. Name real things (DShot600, 6S, ELRS 3.x), not "the appropriate value". If a value depends on the build, say on what ("on 5-inch quads usually …"). No marketing tone, no "it is important to note", no "plays a key role", no em dashes chaining sentences, no closing moral. Polish texts follow the same rules (see the `czlowiek` guidelines): plain words, "jest" instead of "stanowi", no "ponadto", no "warto zauważyć".

## AI screen fragments

The scissors button in the assistant drawer lets the user drag a box over any part of the app. Everything inside gets an id (`[s3-7]`) and goes to the model with the question; in the desktop app a PNG of the box goes along for providers that read images (Anthropic API, Gemini). The model answers with `[[s3-7]]` next to the thing it means, and the drawer turns that into a **Show** button that scrolls to the element and rings it. Code: `app/src/ui/snip.ts`, prompt rules in `app/src/ai/prompts.ts`.
