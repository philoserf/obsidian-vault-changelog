# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that maintains a changelog of recently edited notes. The changelog file is **fully overwritten** on every update — no history is preserved.

The current next step for this repo is tracked in the workspace backlog at `../NEXT.md` (the `obsidian-vault-changelog` row). Read it when starting work; update it when that step ships.

`THEORY.md` (design rationale and invariants) and `WALKTHROUGH.md` (linear code tour) are tracked and go deeper than this file. `.issues/` is untracked scratch output from the review skills — a backlog of candidate issues, not decisions.

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # typecheck + biome check
bun run typecheck        # tsc --noEmit
bun run lint:fix         # Auto-fix lint and format
bun run audit            # bun audit --audit-level=critical (also gates CI)
bun run version          # Sync package.json version → manifest.json + versions.json
bun test                 # Run all tests
bun test src/changelog.test.ts         # Run a single test file
bun test -t "pattern"                  # Run tests matching a name pattern
bun run deploy           # Copy main.js/manifest.json/styles.css into a local vault
```

`bun run deploy` requires `OBSIDIAN_DEPLOY_DEST` (the plugin folder inside the target vault), set in the gitignored `.env.local`.

`bun run version` reads `npm_package_version`, so it only works when invoked through `bun run` after bumping `package.json`.

## Architecture

The plugin has an intentional split between pure logic and Obsidian integration:

- `src/changelog.ts` — **pure functions** (`filterAndSort`, `renderChangelog`, `normalizeLoadedSettings`, `clampMaxRecentFiles`, `isValidChangelogPath`, `isPluginGeneratedChangelog`, `validateExcludedFolder`) with no Obsidian imports. All unit tests target this file. `renderChangelog` is the one render entry point: it takes the whole `ChangelogSettings` rather than six fields positionally, and calls `filterAndSort` itself. Obsidian is kept out by injection — a `TimeFormatter` callback so tests don't need `window.moment`, a `LinkTextResolver` (production passes `MetadataCache.fileToLinktext`), and an injected path normalizer for `normalizeLoadedSettings`.
- `src/main.ts` — `ChangelogPlugin` extends `Plugin`. Wires up the command, vault event handlers (`modify`/`delete`/`rename`), and I/O. Auto-update uses a 200ms `debounce` and skips edits to the changelog file itself (avoids self-triggering loops).
- `src/settings.ts` — `ChangelogSettingsTab` + `PathSuggest`. Path suggestions cache vault folder/file listings per suggester instance to avoid per-keystroke scanning.

### Settings persistence quirks

`normalizeLoadedSettings` in `changelog.ts` (called from `main.loadSettings`) strips unknown keys from persisted data (so renamed/removed settings don't linger), falls back to defaults for known keys whose runtime type is wrong (hand-edited or corrupt `data.json`), `normalizePath`s `changelogPath` and every `excludedFolders` entry, clamps `maxRecentFiles` to `[1, MAX_RECENT_FILES=500]` via `clampMaxRecentFiles`, and trims `changelogHeading`. Keep these invariants when adding new settings.

### Writing the changelog

`updateChangelog` does the whole write, and two behaviors in it are load-bearing.

It tolerates a TOCTOU race: if `vault.create` throws because a concurrent event created the file, it falls back to `getAbstractFileByPath` rather than erroring, attaching the original error as `cause`. Preserve this when editing.

It also refuses to overwrite a file that does not look plugin-generated, via `isPluginGeneratedChangelog`. The plugin replaces the file at `changelogPath` wholesale and every note in the vault satisfies the only other check (`.md`), so that predicate is what enforces the ownership invariant. Note its deliberate tolerance: the heading slot accepts *whatever* heading is currently in the file, so changing `changelogHeading` cannot lock the plugin out of the changelog it wrote.

### Build system

- `build.ts` uses Bun's native bundler; entry `src/main.ts` → `./main.js` (CommonJS, minified in production).
- `obsidian` and `electron` are marked external — never bundle them.
- Watch mode (`bun run dev`) skips rebuilds when only test files change.
- **`main.js` is committed** — Obsidian ships the committed bundle. CI runs `bun run build` then `git diff --exit-code main.js`, so any change to `src/` or to dependencies must be followed by a rebuild and a commit of `main.js` or the PR fails. Bun is deliberately unpinned in CI, so a bundler-output shift trips the same check; the fix is the same.
- `tsconfig.json` excludes `src/**/*.test.ts`, so `bun run typecheck` never sees the tests — type errors there surface only under `bun test`.

## Release Process

Use the `obsidian-gate` then `obsidian-ship` skills — do not tag by hand. `.github/workflows/release.yml` triggers only on bare `X.Y.Z` tags (no `v` prefix) and publishes `main.js`, `manifest.json`, and `styles.css` with build provenance.

## Code Style

Biome is the single source of truth (2-space indent, organized imports). Run `bun run lint:fix` before committing. Target Bun as the runtime; use `bunx`/`bun run`/`bun install`, never npm or yarn.
