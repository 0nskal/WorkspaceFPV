# Security / Bezpieczeństwo

WorkspaceFPV talks to flight controllers and ESCs over USB and can store an API key for AI providers, so security reports are taken seriously.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through
[GitHub's security advisories](https://github.com/0nskal/WorkspaceFPV/security/advisories/new).
You will get an answer within a few days.

## What WorkspaceFPV promises

- Nothing is written to the flight controller or ESC without an explicit action from the user (Save, confirmation dialog), and never while the drone is armed. ESC access is read-only.
- API keys stay on your computer and are sent only to the provider you chose.
- Drone data goes to an AI provider only when you ask the assistant a question.

Anything that breaks one of these is a vulnerability.

---

Prosimy nie zgłaszać luk publicznie, tylko prywatnie przez
[zgłoszenie bezpieczeństwa na GitHubie](https://github.com/0nskal/WorkspaceFPV/security/advisories/new).
Odpowiedź w kilka dni. Obietnice powyżej (zapis do FC tylko po wyraźnej akcji użytkownika i nigdy przy uzbrojonym dronie, ESC tylko do odczytu, klucze API lokalnie, dane drona do AI tylko na pytanie) dotyczą też wersji polskiej; ich złamanie to luka.
