# Suno Studio

Studio piosenek AI: teksty (OpenAI/Anthropic + biblioteka materiałów z BM25), generacja
muzyki w Suno (sunoapi.org), koncept-albumy, okładki AI, odtwarzacz z kolejką.
**Jedna baza kodu, dwie aplikacje:** web (PWA na Vercelu) i desktop (Tauri, macOS) — obie
na wspólnym backendzie Convex i wspólnym kodzie UI.

## Struktura (monorepo Nx + npm workspaces)

```
apps/
  web/          @suno/web      React + Vite — jedyny frontend (PWA i bundle desktopu)
    src/platform/              warstwa platformy: web.ts (ZIP, PWA) | tauri.ts (zapis na dysk)
  desktop/      @suno/desktop  cienka powłoka Tauri 2 (src-tauri/), ładuje apps/web
  web-e2e/      @suno/web-e2e  testy Playwright na lokalnym backendzie Convex
packages/
  core/         @suno/core     czysta logika: typy, prompty, BM25, parsowanie LLM, walidacja
  backend/      @suno/backend  Convex: schema, mutacje/akcje, scheduler, auth, testy convex-test
scripts/                       setup lokalnego backendu, build Vercela
```

Granice warstw pilnuje ESLint (`@nx/enforce-module-boundaries` + `no-restricted-imports`):
`core` nie zna Reacta/Convexa/Tauri; API Tauri wolno używać tylko w `platform/tauri.ts`;
widoki (`views/`) dostają dane przez propsy — Convex podpinany jest w `app/`.

Implementację platformy wybiera build (alias `@platform` w `apps/web/vite.config.ts`):

| | web | desktop |
|---|---|---|
| pobieranie plików | CDN bezpośrednio, fallback proxy `/download` | plugin-http (bez CORS) |
| zapis | download przeglądarki, album → ZIP | dysk: domyślny folder albo dialog, album → podfolder |
| aktualizacje | service worker PWA | tauri-plugin-updater (GitHub Releases) |
| routing | `BrowserRouter` | `HashRouter` |

## Polecenia

```bash
npm install                  # Node 24 (.nvmrc)
npm run check                # typecheck + lint + testy wszystkich projektów (Nx cache)
npx nx affected -t test      # tylko projekty dotknięte zmianą
npm run e2e                  # Playwright (sam startuje lokalny Convex i Vite)
npm run format               # Prettier
npx nx graph                 # graf zależności projektów
```

## Development

### Wariant A — deployment dev w chmurze Convex

```bash
npx convex dev               # z korzenia repo; tworzy .env.local (CONVEX_DEPLOYMENT, VITE_CONVEX_URL)
npm run dev:web              # http://localhost:5173
```

Funkcje Convex żyją w `packages/backend/convex/` (`convex.json` → `functions`), ale CLI
uruchamia się z korzenia — tam leży `.env.local`, który czyta też Vite.

> Deployment dev bywa współdzielony między worktree'ami — `convex dev` nadpisuje funkcje.
> Do eksperymentów używaj wariantu B.

### Wariant B — lokalny backend bez konta (zalecany do testów)

```bash
npm run setup:local                              # deployment lokalny + klucze Convex Auth + .env.local
CONVEX_AGENT_MODE=anonymous npx convex dev       # backend na 127.0.0.1:3210
npm run dev:web
```

Lokalny backend wymaga Node 20/22/24 (akcje `"use node"`).

### Desktop

```bash
npm run dev:desktop          # tauri dev: Vite w trybie tauri-dev (port 1420) + okno aplikacji
npm run build:desktop        # .app/.dmg w apps/desktop/src-tauri/target/release/bundle
```

Build desktopu zawsze łączy się z **produkcyjnym** Convex (`.env.tauri`); `tauri dev` używa
`.env.local`. Lokalny build z artefaktami aktualizacji wymaga klucza:
`TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/suno-studio.key)"` i
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/suno-studio.key.password)"`.

Ustawienia desktopu specyficzne dla maszyny (domyślny folder zapisu) leżą lokalnie
(`device.json` w danych aplikacji), nie na koncie.

## Wdrożenie

- **Web:** push na `main` → Vercel (`vercel.json` → `sh scripts/vercel-build.sh`, wynik
  `apps/web/dist`). Gdy na Vercelu (tylko środowisko **Production**!) ustawiony jest
  `CONVEX_DEPLOY_KEY` (Production deploy key z dashboardu Convex), build najpierw wdraża
  funkcje Convex, potem frontend — bez klucza wdraża sam frontend, a Convex ręcznie
  `npx convex deploy`.
- **Desktop:** tag `desktop-vX.Y.Z` → workflow *Release desktop* buduje `.dmg` (arm64 + x64)
  i szkic wydania z podpisanym `latest.json`; zainstalowane aplikacje proponują aktualizację
  przy starcie. Sekrety repo: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  (+ opcjonalnie `APPLE_*` do podpisu i notaryzacji). Wersję podbij w
  `apps/desktop/src-tauri/tauri.conf.json`.

### Zmienne środowiskowe

| Gdzie | Zmienna | Po co |
|---|---|---|
| Convex | `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | Convex Auth (wymagane) |
| Convex | `SUNO_CALLBACK_SECRET` | callbacki sunoapi.org (podpis HMAC); bez niego sam polling |
| Convex | `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM` | reset hasła kodem z e-maila (opcjonalnie) |
| Vercel | `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | adres backendu (bez `CONVEX_DEPLOY_KEY`) |
| Vercel | `CONVEX_DEPLOY_KEY` | auto-deploy funkcji Convex (tylko Production) |
| Vercel / `.env.tauri` | `VITE_SENTRY_DSN` | monitoring błędów (opcjonalnie) |

## Backend — skrót

- `schema.ts` — tabele per użytkownik; obiekt domenowy w polu `data`, kształt pilnowany
  na wejściu (`validators.ts`, `sanitize*` z `@suno/core`).
- `suno.ts` — generacja: callback `/suno-callback` (podpisany URL) + durable polling jako
  zabezpieczenie; przejście w SUCCESS i archiwizacja rozstrzygane w jednej mutacji.
- `archive.ts` — kopia MP3/WAV do Convex storage (Suno kasuje pliki po 14 dniach);
  wygasłe utwory można przegenerować.
- `cover.ts` — okładki AI (OpenAI gpt-image), dla albumu osobna per utwór (scheduler), reset.
- `limits.ts` — limity operacji płatnych (rate limiter) + dziennik zużycia.
- `account.ts` — zajętość archiwum, eksport JSON, usunięcie konta.
- `legacyImport.ts` — jednorazowy import danych starej aplikacji desktopowej.

## Migracja ze starej aplikacji desktopowej

Dawny `jash90/suno-studio` (Tauri z lokalnymi plikami JSON) jest teraz `apps/desktop`
(historia zachowana). Po zalogowaniu w nowej wersji desktopowej: **Ustawienia → Dane
z poprzedniej wersji → Importuj dane lokalne** — utwory, biblioteka, persony, album,
okładki AI i (do pustych pól) klucze API trafiają na konto. Import można powtórzyć.
