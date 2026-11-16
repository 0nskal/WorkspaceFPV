# Contributing to WorkspaceFPV

**English** · [Polski](#współpraca-przy-workspacefpv)

WorkspaceFPV is a hobby project: a tool that makes our work in the FPV hobby easier. Bug fixes, new tabs, better texts, translations and testing on real hardware are all welcome.
For anything bigger, open an issue first so we can agree on the approach before you write the code.

## Setup

You need Node.js 22+ and Chrome or Edge (WebSerial). The Windows installer is built with Electron.

```sh
npm install
npm run dev            # the app in the browser, open it with ?demo=1 for a simulated flight controller
npm run dev:electron   # the app in Electron
npm run build          # typecheck + build
npm test               # all node tests
npm run dist:win       # Windows installer into release/
```

Adding a tab is described in the README ("Development") and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). **Demo mode** (`?demo=1`) lets you work on every tab without a drone: when you add an MSP command, add its simulated reply in `app/src/serial/demo*.ts` too.

## Pull requests

You can't push to this repo directly: every change goes through a pull request from your fork, and only the maintainer (@0nskal) can approve and merge it.

1. Fork the repo on GitHub, then clone your fork and create a branch:

   ```sh
   git clone https://github.com/<you>/WorkspaceFPV.git
   cd WorkspaceFPV
   git switch -c fix/<short-name>   # or feat/<short-name>
   ```

2. Make the change. Keep the PR focused on one thing: small PRs get merged faster.
3. Check that `npm run build` and `npm test` pass and that you tried the change in the app.
4. Push the branch to your fork and open a PR against `0nskal/WorkspaceFPV` `main` (GitHub shows a "Compare & pull request" button, or run `gh pr create --repo 0nskal/WorkspaceFPV`).
5. Fill in the PR template: what and why, how to test, **screenshots of the change**, and whether you tested it on hardware.

### What happens next

- On your first PR the checks start only after the maintainer approves the run. That is a GitHub safety rule for outside contributors, not a sign anything is wrong.
- The maintainer reviews the PR, may ask for changes, and checks the screenshots. Pushing new commits after an approval needs a fresh approval.
- All checks must pass and all review comments must be resolved before the PR is merged.
- Your change ships with the next release; the maintainer cuts releases.

### Title

Use [Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `refactor: …`, `perf: …`, `style: …`, `docs: …`, `test: …`, `build: …`, `ci: …`, `chore: …`. Imperative mood, in English, for example `fix: show the right unit for motor temperature`. A check enforces it.

### Screenshots

**Every change you can see in the app or on the website needs a screenshot or a short video in the PR description.** If you change something that already exists, show it before and after. Check both languages when you touch texts.

A check enforces this: PRs that touch `app/src/screens/`, `app/src/ui/`, `assets/`, `site/` or `docs/screenshot*` fail until the description has an image or video. If you only refactored UI code and nothing visible changed, say so in the description and the maintainer will add the `no-ui` label.

Easy way to capture: `npm run dev`, open `http://localhost:5173/?demo=1#<tab>` and take a screenshot (Win+Shift+S).

### Hardware, safety and privacy

This app can change settings on a flight controller, so changes get extra scrutiny:

- Nothing is written to the FC without an explicit user action (Save button, confirmation dialog), and never while the drone is armed.
- ESC access stays read-only unless we agree otherwise in an issue first.
- Anything that spins motors needs the "props removed" lock, a STOP button and an automatic stop on disconnect.
- API keys are stored locally and sent only to the provider they belong to. Never log or commit them.
- A new network host or a new dependency needs a clear reason in the PR description.
- Say in the PR what you tested on real hardware (FC board, Betaflight version, ESC firmware, ELRS version), or write "demo mode only".

## Code style

Match the code around you: TypeScript (strict), no UI framework, small focused files. All user-facing text lives in `app/src/i18n` (`en` is the source, `pl` must match): never hardcode strings in screens. Comments explain why, not what.

## License

By contributing you agree that your contribution is licensed under the [MIT license](LICENSE) of this project.

---

# Współpraca przy WorkspaceFPV

[English](#contributing-to-workspacefpv) · **Polski**

WorkspaceFPV to projekt hobbystyczny: narzędzie, które ułatwia nam pracę w tym hobby (FPV). Poprawki błędów, nowe zakładki, lepsze teksty, tłumaczenia i testy na prawdziwym sprzęcie są mile widziane.
Przy większych rzeczach najpierw otwórz issue, żebyśmy ustalili podejście, zanim napiszesz kod.

## Pierwsze kroki

Potrzebujesz Node.js 22+ oraz Chrome lub Edge (WebSerial). Instalator Windows jest budowany w Electronie.

```sh
npm install
npm run dev            # appka w przeglądarce, otwórz z ?demo=1 dla symulowanego kontrolera lotu
npm run dev:electron   # appka w Electronie
npm run build          # typecheck + build
npm test               # wszystkie testy
npm run dist:win       # instalator Windows do release/
```

Dodawanie zakładki opisuje README (sekcja „Rozwój”) i [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). **Tryb demo** (`?demo=1`) pozwala pracować nad każdą zakładką bez drona: dodając komendę MSP, dopisz też jej symulowaną odpowiedź w `app/src/serial/demo*.ts`.

## Pull requesty

Nie możesz pushować bezpośrednio do tego repo: każda zmiana idzie przez pull request z Twojego forka, a zatwierdzić i scalić ją może tylko opiekun (@0nskal).

1. Zrób fork repo na GitHubie, sklonuj go i utwórz gałąź:

   ```sh
   git clone https://github.com/<ty>/WorkspaceFPV.git
   cd WorkspaceFPV
   git switch -c fix/<krotka-nazwa>   # albo feat/<krotka-nazwa>
   ```

2. Wprowadź zmianę. Jeden PR = jedna sprawa: małe PR-y wchodzą szybciej.
3. Sprawdź, że `npm run build` i `npm test` przechodzą i że wypróbowałeś zmianę w appce.
4. Wypchnij gałąź do swojego forka i otwórz PR do `0nskal/WorkspaceFPV` `main` (GitHub pokazuje przycisk „Compare & pull request” albo `gh pr create --repo 0nskal/WorkspaceFPV`).
5. Wypełnij szablon PR: co i dlaczego, jak sprawdzić, **zrzuty ekranu zmiany** oraz czy testowałeś na sprzęcie.

### Co dalej

- Przy pierwszym PR sprawdzenia ruszają dopiero po zatwierdzeniu przez opiekuna. To zasada bezpieczeństwa GitHuba dla osób z zewnątrz, nie znak, że coś jest nie tak.
- Opiekun przegląda PR, może poprosić o poprawki i sprawdza zrzuty ekranu. Nowe commity po zatwierdzeniu wymagają ponownego zatwierdzenia.
- Wszystkie sprawdzenia muszą przejść, a komentarze zostać rozwiązane, zanim PR zostanie scalony.
- Zmiana trafia do następnego wydania; wydania robi opiekun.

### Tytuł

Użyj [Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `refactor: …`, `perf: …`, `style: …`, `docs: …`, `test: …`, `build: …`, `ci: …`, `chore: …`. Tryb rozkazujący, po angielsku, np. `fix: show the right unit for motor temperature`. Pilnuje tego automatyczne sprawdzenie.

### Zrzuty ekranu

**Każda zmiana widoczna w appce lub na stronie wymaga zrzutu ekranu albo krótkiego wideo w opisie PR.** Jeśli zmieniasz coś, co już istnieje, pokaż przed i po. Przy zmianie tekstów sprawdź oba języki.

Pilnuje tego automatyczne sprawdzenie: PR dotykający `app/src/screens/`, `app/src/ui/`, `assets/`, `site/` lub `docs/screenshot*` nie przejdzie, dopóki opis nie zawiera obrazka lub wideo. Jeśli tylko przerobiłeś kod UI i nic widocznego się nie zmieniło, napisz to w opisie, a opiekun doda etykietę `no-ui`.

Najłatwiej: `npm run dev`, otwórz `http://localhost:5173/?demo=1#<zakładka>` i zrób zrzut (Win+Shift+S).

### Sprzęt, bezpieczeństwo i prywatność

Ta appka może zmieniać ustawienia kontrolera lotu, więc zmiany sprawdzamy dokładniej:

- Nic nie jest zapisywane do FC bez wyraźnej akcji użytkownika (przycisk Zapisz, okno potwierdzenia) i nigdy przy uzbrojonym dronie.
- Dostęp do ESC zostaje tylko do odczytu, chyba że ustalimy inaczej w issue.
- Wszystko, co kręci silnikami, wymaga blokady „śmigła zdjęte”, przycisku STOP i automatycznego zatrzymania po rozłączeniu.
- Klucze API są przechowywane lokalnie i wysyłane tylko do swojego dostawcy. Nigdy ich nie loguj ani nie commituj.
- Nowy host sieciowy lub nowa zależność wymaga jasnego uzasadnienia w opisie PR.
- Napisz w PR, co przetestowałeś na prawdziwym sprzęcie (płytka FC, wersja Betaflight, firmware ESC, wersja ELRS), albo „tylko tryb demo”.

## Styl kodu

Dopasuj się do otoczenia: TypeScript (strict), bez frameworka UI, małe, zwarte pliki. Cały tekst interfejsu siedzi w `app/src/i18n` (`en` jest źródłem, `pl` musi pasować): nie wpisuj tekstów na sztywno w ekranach. Komentarze tłumaczą dlaczego, nie co.

## Licencja

Wnosząc zmianę, zgadzasz się, że obowiązuje ją [licencja MIT](LICENSE) tego projektu.
