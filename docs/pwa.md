# PWA (installable, offline-capable app)

Vinegar ships as a Progressive Web App: the production build can be installed
from the browser and started with no network. There is no server component, so
once the shell is cached the whole editor works offline — documents live in the
user's own files plus the IndexedDB recovery snapshot (`src/io/recovery.ts`).

## What produces it

`vite-plugin-pwa` (`VitePWA` in `vite.config.ts`) is the only moving part. On
`pnpm build` it emits `dist/manifest.webmanifest`, `dist/sw.js` (Workbox
`generateSW`) and `dist/registerSW.js`, and links them from `index.html`.
Nothing is emitted by `pnpm dev` — `devOptions` is off, so the dev server never
serves a service worker and cannot serve stale code.

Manifest source of truth is the `manifest` block in `vite.config.ts`; do not add
a hand-written `public/manifest.webmanifest` alongside it.

## Update policy: "prompt" without a prompt

`registerType: "prompt"` with `injectRegister: "script-defer"`. A new build is
downloaded in the background and then **waits**: it takes over the next time
every Vinegar window is closed. This is deliberate. `autoUpdate` reloads the
page as soon as the new worker activates, which in a drawing editor can wipe out
an in-progress stroke or an unsaved selection state; a version that lags by one
session is the cheaper failure.

The cost is that a user who never closes the app stays on the old build. The
fix, when we want it, is a toast — "A new version is available / Reload" —
driven by `registerSW`'s `onNeedRefresh` from `virtual:pwa-register`. That
requires adding `workbox-window` as a dependency (it is a peer of the virtual
module and pnpm will not resolve it otherwise) and switching `injectRegister`
back to the default.

## Caching

Everything is precached: the JS/CSS shell, both web workers
(`scriptWorker`, `generatorWorker`), icons and the manifest — around 1.6 MiB.
`maximumFileSizeToCacheInBytes` is raised to 6 MiB because the main chunk is
already past Workbox's 2 MiB default; if a build ever silently drops a chunk
from the precache, check that number first. `navigateFallback: "index.html"`
serves the shell for any in-scope navigation.

No runtime caching rules exist because the app fetches nothing at runtime: fonts
are system stacks (`src/fonts.ts`) and there is no API.

## Icons

`public/pwa-192x192.png`, `public/pwa-512x512.png` (transparent, `any`) and
`public/pwa-maskable-512x512.png` (opaque `#1c1e22` background, logo inside the
maskable safe zone) are generated from `public/logo.svg`:

```bash
convert -background none public/logo.svg -resize 172x172 -gravity center -extent 192x192 public/pwa-192x192.png
convert -background none public/logo.svg -resize 460x460 -gravity center -extent 512x512 public/pwa-512x512.png
convert -background '#1c1e22' public/logo.svg -resize 280x280 -gravity center -extent 512x512 -flatten public/pwa-maskable-512x512.png
```

Regenerate them whenever the logo changes. `theme_color` / `background_color`
mirror the dark theme's `bg` token in `src/styles/theme.css.ts`; keep them in
sync if that token moves.

## iPad / iOS

Installation is Safari-only: Share ▸ "Add to Home Screen". Chrome and Edge on
iOS cannot install a web app — they can only bookmark it. From the Home Screen
the app launches standalone with no browser chrome, and the precached shell
means it starts offline.

Two consequences worth knowing:

- **Separate storage.** A Home Screen web app gets its own storage bucket, so
  the IndexedDB recovery snapshot written while browsing in Safari is *not*
  visible in the installed app, and vice versa. Save to a file before switching.
- **No File System Access API.** `supportsFileSystem()` is false on Safari, so
  File ▸ Save falls back to `io/download.ts` (a fresh copy into Files) instead
  of overwriting the attached file. That is the pre-existing fallback path, not
  something the PWA changes.

`index.html` carries both `mobile-web-app-capable` and the legacy
`apple-mobile-web-app-capable`, plus a 180×180 `apple-touch-icon`, so older
iPadOS versions that ignore the manifest still launch standalone with the right
icon.

## Verifying

`pnpm build && pnpm preview`, then in DevTools → Application: the manifest lists
the three icons, the service worker is activated, and the app still loads with
"Offline" checked. Installation requires HTTPS (or `localhost`) and a `start_url`
that the deployment actually serves at the site root — `scope`/`start_url` are
`/`, so a subdirectory deployment needs both of them and Vite's `base` changed
together.
