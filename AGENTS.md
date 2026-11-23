# Working agreements / Ustalenia robocze

For humans and AI agents (Claude Code, Codex, …) working on this repository. `CLAUDE.md` points here.
Dla ludzi i agentów AI pracujących nad tym repozytorium.

## What this project is

WorkspaceFPV is a public, free, hobby project that makes our work in the FPV hobby easier (diagnosis, Betaflight configurator tabs, ESC/ELRS, autotune, AI assistant). It stands on its own: no personal branding and no personal media in the repo.

## Rules that always apply

1. **Public repo, changes only through pull requests.** Outside contributors work from forks; the maintainer (@0nskal) reviews and merges. `main` is protected: PR + code owner approval + checks `build`, `title`, `screenshots`. The maintainer may push release commits directly.
2. **Same model as [noyex/burn](https://github.com/noyex/burn):** every visible change needs **screenshots** in the PR description (before and after when changing something existing). Not visible → write "No UI change". Details: [CONTRIBUTING.md](CONTRIBUTING.md).
3. **PR title = Conventional Commits** in English (`feat: …`, `fix: …`, `docs: …`). Description in English and Polish. Use `.github/pull_request_template.md`.
4. **PR screenshots live on the orphan branch `pr-screenshots`** (folder per PR), linked by raw URL, never committed to `main`.
5. **Releases:** bump version in `package.json`, update `CHANGELOG.md` (English first, Polish below), tag `vX.Y.Z`; the Release workflow builds `WorkspaceFPV-Setup.exe` and `latest.yml` for in-app updates; deploy the site (`workspacefpv.pages.dev`) after the build. Release only when the maintainer asks.
6. **Before every PR:** `npm run typecheck`, `npm run build`, `npm test` all pass. CI runs the same.
7. **Two languages:** every user-facing text exists in `en` and `pl` (`app/src/i18n`); README, CHANGELOG, CONTRIBUTING stay bilingual.
8. **Safety:** nothing is written to the flight controller without an explicit user action and never while armed; ESC access is read-only, with one exception: the per-motor spin direction (DShot command through the FC, explicit click + confirmation, props-off lock, battery, disarmed); motor tests need the props-removed lock, STOP and auto-stop on disconnect.
9. **Privacy:** API keys stay local and go only to their own provider; never log or commit secrets, tokens, or personal data (no emails, phone numbers, drone/car dumps). No new dependency or network host without a reason in the PR.
10. **Demo mode** (`?demo=1`) must keep working: new MSP commands get a simulated reply in `app/src/serial/demo*.ts`.

## Ustalenia po polsku (skrót)

Repo publiczne; zmiany tylko przez PR z forka ze zrzutami ekranu (jak w Burn); tytuł PR w formacie Conventional Commits; zrzuty trzymamy na gałęzi `pr-screenshots`; przed PR `typecheck` + `build` + `test`; teksty w dwóch językach; bezpieczeństwo kontrolera (brak zapisu bez akcji użytkownika, ESC tylko odczyt poza kierunkiem silnika przez DShot z potwierdzeniem); żadnych sekretów ani danych osobistych w repo; wydanie tylko na prośbę opiekuna.
