# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that maintains a changelog of recently edited notes. The changelog file is **fully overwritten** on every update — no history is preserved.

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # typecheck + biome check
bun run typecheck        # tsc --noEmit
bun run lint:fix         # Auto-fix lint and format
bun run version          # Sync package.json version → manifest.json + versions.json
bun test                 # Run all tests
bun test src/changelog.test.ts         # Run a single test file
bun test -t "pattern"                  # Run tests matching a name pattern
bun run deploy           # Copy main.js/manifest.json/styles.css into the local notes vault
```

## Architecture

The plugin has an intentional split between pure logic and Obsidian integration:

- `src/changelog.ts` — **pure functions** (`filterAndSort`, `generateChangelog`) with no Obsidian imports. All unit tests target this file. Accepts a `TimeFormatter` callback so tests don't need `window.moment`.
- `src/main.ts` — `ChangelogPlugin` extends `Plugin`. Wires up the command, vault event handlers (`modify`/`delete`/`rename`), and I/O. Auto-update uses a 200ms `debounce` and skips edits to the changelog file itself (avoids self-triggering loops).
- `src/settings.ts` — `ChangelogSettingsTab` + `PathSuggest`. Path suggestions cache vault folder listings to avoid per-keystroke scanning.

### Settings persistence quirks

`loadSettings` in `main.ts` strips unknown keys from persisted data (so renamed/removed settings don't linger), then `normalizePath`s `changelogPath` and every `excludedFolders` entry. `maxRecentFiles` is clamped to `[1, MAX_RECENT_FILES=500]`. Keep these invariants when adding new settings.

### Writing the changelog

`writeToFile` tolerates a TOCTOU race: if `vault.create` throws because a concurrent event created the file, it falls back to `getAbstractFileByPath` rather than erroring. Preserve this behavior when editing.

### Build system

- `build.ts` uses Bun's native bundler; entry `src/main.ts` → `./main.js` (CommonJS, minified in production).
- `obsidian` and `electron` are marked external — never bundle them.
- Watch mode (`bun run dev`) skips rebuilds when only test files change.

## Release Process

Always merge PRs before tagging. Tags must point to the merged commit on `main`:

```bash
git tag -a 1.0.0 -m "Release 1.0.0"
git push origin 1.0.0
```

The GitHub Actions release workflow builds and publishes the release.

## Code Style

Biome is the single source of truth (2-space indent, organized imports). Run `bun run lint:fix` before committing. Target Bun as the runtime; use `bunx`/`bun run`/`bun install`, never npm or yarn.
